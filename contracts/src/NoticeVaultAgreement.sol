// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {NoticeVaultErrors as Err} from "./NoticeVaultErrors.sol";
import {NoticeVaultMath as M} from "./NoticeVaultMath.sol";

interface INoticeVaultFactory {
    /// @notice Called by agreement on successful funding (reserve capacity).
    /// @param delta Exact amount of new liability added (always A for renewal).
    function reserveCapacity(uint256 delta) external;

    /// @notice Called by agreement on claim or refund (release capacity).
    /// @param delta Exact amount of liability released (claimable + refundable).
    function releaseCapacity(uint256 delta) external;
}

/**
 * @title NoticeVaultAgreement
 * @notice Immutable prefunded paid-availability retainer between one client and one provider.
 *
 * - Deployed atomically by NoticeVaultFactory (constructor-only, no proxy).
 * - Holds client funds; client approves factory for A+R at creation.
 * - Provider/client addresses are immutable after deployment.
 * - No owner rescue, no arbitrary token calls, no mutable beneficiaries.
 * - Guardian pauses new CREATION only; valid renewals/claims/refunds always proceed.
 *
 * Financial model: specs/CORE-CONTRACT-M01.md (same as packages/domain).
 * LOCAL_FIXTURE token used in tests; no Arc USDC address hardcoded.
 */
contract NoticeVaultAgreement is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable terms ──────────────────────────────────────────────────────

    uint32  public immutable schemaVersion;
    address public immutable client;
    address public immutable provider;
    address public immutable token;
    uint256 public immutable amountPerPeriod;   // A
    uint64  public immutable periodSeconds;      // P
    uint64  public immutable noticeSeconds;      // N
    uint64  public immutable startAt;            // t0
    uint256 public immutable clientNonce;
    uint64  public immutable acceptanceDeadline;
    bytes32 public immutable termsDocumentHash;

    // ── Immutable derived ────────────────────────────────────────────────────

    uint256 public immutable noticeReserve;     // R = ceil(A*N/P)
    address public immutable factory;           // INoticeVaultFactory

    // ── Accounting state ─────────────────────────────────────────────────────

    uint256 public regularFunded;   // F = initial A, each renewal +A
    uint256 public regularPaid;     // RP
    uint256 public noticePaid;      // NP
    uint256 public clientRefunded;  // CR

    // Notice: both null or both set
    uint64  public noticeStartStored;    // 0 = not stored (zero timestamp safe: startAt > 0)
    bool    public hasStoredNotice;      // explicit flag to distinguish zero from absent
    uint8   public noticeReasonStored;   // 0=absent 1=CLIENT_CANCELLED 2=MISSED_CHECKPOINT

    // ── Constants ────────────────────────────────────────────────────────────

    uint8 internal constant REASON_NONE              = 0;
    uint8 internal constant REASON_CLIENT_CANCELLED  = 1;
    uint8 internal constant REASON_MISSED_CHECKPOINT = 2;

    // ── Events ───────────────────────────────────────────────────────────────

    event RegularFunded(uint256 newF, uint64 newD, uint256 amount);
    event NoticeStarted(uint64 S, uint8 reason);
    event ProviderClaimed(uint256 regularDelta, uint256 noticeDelta, uint256 total);
    event ClientRefunded(uint256 amount);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        uint32  _schemaVersion,
        address _client,
        address _provider,
        address _token,
        uint256 _amountPerPeriod,
        uint64  _periodSeconds,
        uint64  _noticeSeconds,
        uint64  _startAt,
        uint256 _clientNonce,
        uint64  _acceptanceDeadline,
        bytes32 _termsDocumentHash,
        address _factory
    ) {
        // Terms already validated by factory; store immutables.
        schemaVersion       = _schemaVersion;
        client              = _client;
        provider            = _provider;
        token               = _token;
        amountPerPeriod     = _amountPerPeriod;
        periodSeconds       = _periodSeconds;
        noticeSeconds       = _noticeSeconds;
        startAt             = _startAt;
        clientNonce         = _clientNonce;
        acceptanceDeadline  = _acceptanceDeadline;
        termsDocumentHash   = _termsDocumentHash;
        factory             = _factory;

        noticeReserve = M.computeR(_amountPerPeriod, _noticeSeconds, _periodSeconds);

        // Initial state: F = A, no payments, no notice
        regularFunded = _amountPerPeriod;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _D() internal view returns (uint64) {
        return M.computeD(regularFunded, amountPerPeriod, periodSeconds, startAt);
    }

    /// @dev Resolve effective notice. Returns (hasNotice, S, reason).
    function _resolveNotice(uint64 now_) internal view returns (bool, uint64, uint8) {
        if (hasStoredNotice) {
            return (true, noticeStartStored, noticeReasonStored);
        }
        uint64 D_ = _D();
        if (now_ >= D_) {
            return (true, D_, REASON_MISSED_CHECKPOINT);
        }
        return (false, 0, REASON_NONE);
    }

    function _storeNotice(uint64 S, uint8 reason) internal {
        noticeStartStored = S;
        noticeReasonStored = reason;
        hasStoredNotice = true;
    }

    function _V(uint64 now_) internal view returns (uint256) {
        (bool hn, uint64 S,) = _resolveNotice(now_);
        return M.computeVCapped(
            amountPerPeriod, regularFunded, periodSeconds, startAt, _D(), now_, hn, S
        );
    }

    function _W(uint64 now_) internal view returns (uint256) {
        (bool hn, uint64 S,) = _resolveNotice(now_);
        if (!hn) return 0;
        return M.computeW(noticeReserve, noticeSeconds, S, now_);
    }

    function _L() internal view returns (uint256) {
        return regularFunded + noticeReserve - regularPaid - noticePaid - clientRefunded;
    }

    // ── fundNextPeriod ────────────────────────────────────────────────────────

    /**
     * @notice Client funds the next period. Exact A transferred; must call before D.
     * @param expectedFundedThrough Must equal current D exactly (checkpoint match).
     */
    function fundNextPeriod(uint64 expectedFundedThrough) external nonReentrant {
        if (msg.sender != client) revert Err.UnauthorizedClient(msg.sender, client);

        // No stored notice
        if (hasStoredNotice) revert Err.NoticeAlreadyStarted();

        uint64 D_ = _D();
        uint64 now_ = uint64(block.timestamp);

        // Derived notice check (overdue)
        if (now_ >= D_) revert Err.FundingWindowClosed();

        // Checkpoint match
        if (expectedFundedThrough != D_) revert Err.CheckpointMismatch(expectedFundedThrough, D_);

        uint256 A = amountPerPeriod;
        uint256 newF = regularFunded + A;

        // Validate new D and D+N fit int64
        uint64 newD = M.computeD(newF, A, periodSeconds, startAt);
        M.assertInt64(uint256(newD), "newD");
        M.assertInt64(uint256(newD) + uint256(noticeSeconds), "newD+N");

        // Validate new F+R fits uint256 (no overflow)
        uint256 newFR = M.safeAdd(newF, noticeReserve);
        require(newFR > 0, "NVA: newF+R zero"); // always true, guard for linter

        // Notify factory for cap check (factory validates against caps)
        INoticeVaultFactory(factory).reserveCapacity(A);

        // Commit state before transfer (effects before interactions)
        regularFunded = newF;

        // Transfer exact A from client to this agreement
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), A);
        uint256 balAfter = IERC20(token).balanceOf(address(this));
        if (balAfter - balBefore != A) revert Err.TransferAmountMismatch(A, balAfter - balBefore);

        emit RegularFunded(newF, newD, A);
    }

    // ── startNotice ────────────────────────────────────────────────────────────

    /**
     * @notice Client starts the notice period.
     * - Stored notice → revert.
     * - Overdue (now >= D) → store S=D / MISSED_CHECKPOINT.
     * - Otherwise → S = max(now, t0) / CLIENT_CANCELLED.
     */
    function startNotice() external {
        if (msg.sender != client) revert Err.UnauthorizedClient(msg.sender, client);
        if (hasStoredNotice) revert Err.NoticeAlreadyStarted();

        uint64 D_ = _D();
        uint64 now_ = uint64(block.timestamp);
        uint64 S;
        uint8 reason;

        if (now_ >= D_) {
            S = D_;
            reason = REASON_MISSED_CHECKPOINT;
        } else {
            S = now_ > startAt ? now_ : startAt;
            reason = REASON_CLIENT_CANCELLED;
        }

        _storeNotice(S, reason);
        emit NoticeStarted(S, reason);
    }

    // ── materializeNotice ─────────────────────────────────────────────────────

    /**
     * @notice Permissionless: materialize a derived overdue notice into stored state.
     * - Already stored → no-op (no duplicate event).
     * - now >= D → store S=D / MISSED_CHECKPOINT, emit event.
     * - Otherwise → revert FundingWindowClosed.
     */
    function materializeNotice() external {
        if (hasStoredNotice) return; // idempotent, no event

        uint64 D_ = _D();
        uint64 now_ = uint64(block.timestamp);
        if (now_ < D_) revert Err.FundingWindowClosed();

        _storeNotice(D_, REASON_MISSED_CHECKPOINT);
        emit NoticeStarted(D_, REASON_MISSED_CHECKPOINT);
    }

    // ── claimProvider ─────────────────────────────────────────────────────────

    /**
     * @notice Permissionless. Pays cumulative earned amounts to the immutable provider.
     * Materializes derived notice if applicable (single event). Zero claim → no-op.
     */
    function claimProvider() external nonReentrant {
        uint64 now_ = uint64(block.timestamp);

        // Materialize derived notice if applicable (emits event once)
        if (!hasStoredNotice) {
            uint64 D_ = _D();
            if (now_ >= D_) {
                _storeNotice(D_, REASON_MISSED_CHECKPOINT);
                emit NoticeStarted(D_, REASON_MISSED_CHECKPOINT);
            }
        }

        uint256 V = _V(now_);
        uint256 W = _W(now_);

        uint256 regularDelta = V - regularPaid;
        uint256 noticeDelta  = W - noticePaid;
        uint256 total = regularDelta + noticeDelta;

        if (total == 0) return; // zero claim: no transfer, no event, no cap release

        // Effects before interactions (reentrancy guard also active)
        regularPaid += regularDelta;
        noticePaid  += noticeDelta;

        // Release capacity at factory
        INoticeVaultFactory(factory).releaseCapacity(total);

        // Transfer to immutable provider
        _safeTransferOut(token, provider, total);

        emit ProviderClaimed(regularDelta, noticeDelta, total);
    }

    // ── claimClientRefund ─────────────────────────────────────────────────────

    /**
     * @notice Permissionless. Pays client's refundable amount to the immutable client.
     * Valid after stored or derived notice. Zero refund → no-op.
     */
    function claimClientRefund() external nonReentrant {
        uint64 now_ = uint64(block.timestamp);

        (bool hn, uint64 S,) = _resolveNotice(now_);
        if (!hn) return; // no notice → refund = 0, no-op

        uint64 D_ = _D();
        uint256 V_S = M.computeVS(amountPerPeriod, regularFunded, periodSeconds, startAt, D_, S);
        uint256 F   = regularFunded;
        uint256 CR  = clientRefunded;
        uint256 raw = F - V_S;
        uint256 refund = raw > CR ? raw - CR : 0;

        if (refund == 0) return; // no-op

        // Effects before interactions
        clientRefunded += refund;

        // Release capacity at factory
        INoticeVaultFactory(factory).releaseCapacity(refund);

        // Transfer to immutable client
        _safeTransferOut(token, client, refund);

        emit ClientRefunded(refund);
    }

    // ── preview / snapshot ────────────────────────────────────────────────────

    struct Preview {
        // Source label: always SIMULATION in pure model; here ONCHAIN_PREVIEW
        uint64  observationTimestamp;
        uint8   phase;          // 0=SCHEDULED 1=ACTIVE 2=NOTICE_SCHEDULED 3=NOTICE 4=ENDED_CLAIMABLE 5=CLOSED
        uint256 R;
        uint64  D;
        bool    hasStoredNotice_;
        uint64  S;              // 0 if no notice
        uint64  E;              // 0 if no notice
        uint8   reason;
        uint256 V;
        uint256 W;
        uint256 RP;
        uint256 NP;
        uint256 providerClaimable;
        uint256 clientRefundable;
        uint256 L;
        uint256 noticeRemaining;
    }

    function preview() external view returns (Preview memory p) {
        uint64 now_ = uint64(block.timestamp);
        p.observationTimestamp = now_;
        p.R = noticeReserve;
        p.D = _D();
        p.hasStoredNotice_ = hasStoredNotice;

        (bool hn, uint64 S_, uint8 reason_) = _resolveNotice(now_);
        p.S = hn ? S_ : 0;
        p.E = hn ? S_ + noticeSeconds : 0;
        p.reason = reason_;

        p.V   = _V(now_);
        p.W   = _W(now_);
        p.RP  = regularPaid;
        p.NP  = noticePaid;
        p.L   = _L();
        p.providerClaimable = (p.V - p.RP) + (p.W - p.NP);
        p.noticeRemaining   = noticeReserve - noticePaid;

        if (hn) {
            uint64 D_ = p.D;
            uint256 V_S = M.computeVS(amountPerPeriod, regularFunded, periodSeconds, startAt, D_, S_);
            uint256 raw = regularFunded - V_S;
            p.clientRefundable = raw > clientRefunded ? raw - clientRefunded : 0;
        }

        // Phase
        if (!hn) {
            p.phase = now_ < startAt ? 0 : 1; // SCHEDULED or ACTIVE
        } else {
            uint64 E_ = p.E;
            if (now_ < S_) p.phase = 2;          // NOTICE_SCHEDULED
            else if (now_ < E_) p.phase = 3;      // NOTICE
            else if (p.L > 0) p.phase = 4;        // ENDED_CLAIMABLE
            else p.phase = 5;                     // CLOSED
        }
    }

    // ── Accounting accessors ──────────────────────────────────────────────────

    function terms() external view returns (
        uint32, address, address, address, uint256, uint64, uint64, uint64, uint256, uint64, bytes32
    ) {
        return (
            schemaVersion, client, provider, token,
            amountPerPeriod, periodSeconds, noticeSeconds, startAt,
            clientNonce, acceptanceDeadline, termsDocumentHash
        );
    }

    function accounting() external view returns (
        uint256 F, uint256 RP_, uint256 NP_, uint256 CR_, uint256 R_,
        bool hn_, uint64 S_, uint8 reason_, uint256 L_
    ) {
        return (
            regularFunded, regularPaid, noticePaid, clientRefunded, noticeReserve,
            hasStoredNotice, noticeStartStored, noticeReasonStored, _L()
        );
    }

    // ── Internal transfer ─────────────────────────────────────────────────────

    function _safeTransferOut(address tkn, address to, uint256 amount) internal {
        uint256 balBefore = IERC20(tkn).balanceOf(to);
        IERC20(tkn).safeTransfer(to, amount);
        uint256 balAfter = IERC20(tkn).balanceOf(to);
        if (balAfter - balBefore != amount) revert Err.TransferFailed();
    }
}
