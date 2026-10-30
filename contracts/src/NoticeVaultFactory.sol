// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {NoticeVaultAgreement} from "./NoticeVaultAgreement.sol";
import {NoticeVaultErrors as Err} from "./NoticeVaultErrors.sol";
import {NoticeVaultMath as M} from "./NoticeVaultMath.sol";

/**
 * @title NoticeVaultFactory
 * @notice Deploys and registers immutable NoticeVaultAgreement contracts.
 *
 * Security properties:
 * - No proxy, no delegatecall, no selfdestruct, no owner rescue.
 * - No mutable beneficiaries, no fee collector, no permit shortcut.
 * - Guardian pauses NEW creation only; renewals/claims/refunds are unaffected.
 * - Provider signature binds all canonical terms via EIP-712.
 * - Nonce consumed atomically; reverted creation consumes nothing.
 * - Factory holds no long-term token custody; tokens go directly to child agreements.
 *
 * LOCAL_FIXTURE: token allowlist set in constructor; no Arc USDC address hardcoded.
 */
contract NoticeVaultFactory {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ── EIP-712 ──────────────────────────────────────────────────────────────

    bytes32 public immutable DOMAIN_SEPARATOR;

    // keccak256("AgreementTerms(uint32 schemaVersion,address client,address provider,
    //   address token,uint256 amountPerPeriod,uint64 periodSeconds,uint64 noticeSeconds,
    //   uint64 startAt,uint256 clientNonce,uint64 acceptanceDeadline,bytes32 termsDocumentHash)")
    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "AgreementTerms("
        "uint32 schemaVersion,"
        "address client,"
        "address provider,"
        "address token,"
        "uint256 amountPerPeriod,"
        "uint64 periodSeconds,"
        "uint64 noticeSeconds,"
        "uint64 startAt,"
        "uint256 clientNonce,"
        "uint64 acceptanceDeadline,"
        "bytes32 termsDocumentHash"
        ")"
    );

    // ── Configuration ─────────────────────────────────────────────────────────

    address public immutable guardian;
    address public immutable allowlistedToken; // single token for simplicity; extend via mapping for multi-token

    uint256 public factoryCap;    // max outstanding factory liability
    uint256 public agreementCap;  // max outstanding liability per agreement

    bool public creationPaused;

    // ── State ─────────────────────────────────────────────────────────────────

    /// @dev Outstanding liability per registered agreement child
    mapping(address => uint256) public perAgreementLiability;
    /// @dev Registered child agreements
    mapping(address => bool) public registeredAgreement;
    /// @dev Total outstanding factory liability (sum of per-child)
    uint256 public outstandingLiability;

    /// @dev Nonces: true = unavailable (consumed or invalidated)
    mapping(address => mapping(uint256 => bool)) private _nonces;

    // ── Events ────────────────────────────────────────────────────────────────

    event AgreementCreated(
        address indexed agreement,
        address indexed client,
        address indexed provider,
        uint256 amountPerPeriod,
        uint64  periodSeconds,
        uint64  noticeSeconds,
        uint64  startAt,
        uint256 noticeReserve,
        uint256 initialFunded
    );
    event NonceInvalidated(address indexed client, uint256 nonce);
    event CapacityChanged(address indexed agreement, int256 delta, uint256 newAgreementL, uint256 newFactoryL);
    event CreationPauseChanged(bool paused);

    // ── Validation constants ──────────────────────────────────────────────────

    uint64 internal constant P_MIN = 3_600;
    uint64 internal constant P_MAX = 2_678_400;
    uint64 internal constant N_MIN = 3_600;
    uint64 internal constant N_MAX = 7_776_000;
    uint64 internal constant T0_LOOKAHEAD_MIN = 300;
    uint64 internal constant T0_LOOKAHEAD_MAX = 604_800;
    uint32 internal constant SCHEMA_VERSION = 1;
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address guardian_,
        address token_,
        uint256 factoryCap_,
        uint256 agreementCap_
    ) {
        require(guardian_ != address(0), "NVF: zero guardian");
        require(token_ != address(0), "NVF: zero token");
        guardian = guardian_;
        allowlistedToken = token_;
        factoryCap = factoryCap_;
        agreementCap = agreementCap_;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("NoticeVaultAgreement"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ── Guardian ──────────────────────────────────────────────────────────────

    function setCreationPaused(bool paused) external {
        require(msg.sender == guardian, "NVF: not guardian");
        creationPaused = paused;
        emit CreationPauseChanged(paused);
    }

    // ── Nonce management ──────────────────────────────────────────────────────

    function isNonceUnavailable(address client_, uint256 nonce) external view returns (bool) {
        return _nonces[client_][nonce];
    }

    function invalidateNonce(uint256 nonce) external {
        _nonces[msg.sender][nonce] = true;
        emit NonceInvalidated(msg.sender, nonce);
    }

    // ── EIP-712 digest ────────────────────────────────────────────────────────

    function termsDigest(
        uint32  schemaVersion,
        address client,
        address provider,
        address token,
        uint256 amountPerPeriod,
        uint64  periodSeconds,
        uint64  noticeSeconds,
        uint64  startAt,
        uint256 clientNonce,
        uint64  acceptanceDeadline,
        bytes32 termsDocumentHash
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            TERMS_TYPEHASH,
            schemaVersion,
            client,
            provider,
            token,
            amountPerPeriod,
            periodSeconds,
            noticeSeconds,
            startAt,
            clientNonce,
            acceptanceDeadline,
            termsDocumentHash
        ));
        return MessageHashUtils.toTypedDataHash(DOMAIN_SEPARATOR, structHash);
    }

    // ── createAgreement ───────────────────────────────────────────────────────

    struct TermsInput {
        uint32  schemaVersion;
        address client;
        address provider;
        address token;
        uint256 amountPerPeriod;
        uint64  periodSeconds;
        uint64  noticeSeconds;
        uint64  startAt;
        uint256 clientNonce;
        uint64  acceptanceDeadline;
        bytes32 termsDocumentHash;
    }

    /**
     * @notice Atomically validate terms, verify provider signature, deploy child,
     *         register, reserve capacity, and transfer A+R from client to child.
     *
     * Client must have approved factory for at least A+R before calling.
     * msg.sender must be the client named in terms.
     */
    function createAgreement(
        TermsInput calldata t,
        bytes calldata providerSig
    ) external returns (address agreement) {
        if (creationPaused) revert Err.CreationPaused();

        // ── 1. Validate terms ─────────────────────────────────────────────────
        uint64 now_ = uint64(block.timestamp);
        _validateTerms(t, now_);

        // msg.sender must be client
        if (msg.sender != t.client) revert Err.UnauthorizedClient(msg.sender, t.client);

        // Deadline: equality = expired
        if (now_ >= t.acceptanceDeadline) revert Err.AcceptanceExpired();

        // ── 2. Nonce check + consume ───────────────────────────────────────────
        if (_nonces[t.client][t.clientNonce]) revert Err.NonceUnavailable(t.client, t.clientNonce);

        // ── 3. Verify provider signature (EIP-712) ─────────────────────────────
        bytes32 digest = termsDigest(
            t.schemaVersion, t.client, t.provider, t.token,
            t.amountPerPeriod, t.periodSeconds, t.noticeSeconds,
            t.startAt, t.clientNonce, t.acceptanceDeadline, t.termsDocumentHash
        );
        _verifyProviderSignature(t.provider, digest, providerSig);

        // ── 4. Compute R and initial amounts ──────────────────────────────────
        uint256 R = M.computeR(t.amountPerPeriod, t.noticeSeconds, t.periodSeconds);
        uint256 initialAmount = M.safeAdd(t.amountPerPeriod, R); // A + R

        // ── 5. Cap validation ─────────────────────────────────────────────────
        // initialLiability = A + R (first period funded + reserve)
        uint256 initL = initialAmount;
        if (initL > agreementCap) revert Err.AgreementCapExceeded(initL, agreementCap);
        uint256 newFactoryL = M.safeAdd(outstandingLiability, initL);
        if (newFactoryL > factoryCap) revert Err.FactoryCapExceeded(newFactoryL, factoryCap);

        // ── 6. Consume nonce ──────────────────────────────────────────────────
        _nonces[t.client][t.clientNonce] = true;

        // ── 7. Deploy child ───────────────────────────────────────────────────
        agreement = address(new NoticeVaultAgreement(
            t.schemaVersion, t.client, t.provider, t.token,
            t.amountPerPeriod, t.periodSeconds, t.noticeSeconds,
            t.startAt, t.clientNonce, t.acceptanceDeadline, t.termsDocumentHash,
            address(this)
        ));

        // ── 8. Register child with zero liability (will be set below) ─────────
        registeredAgreement[agreement] = true;
        perAgreementLiability[agreement] = 0;

        // ── 9. Reserve capacity ───────────────────────────────────────────────
        perAgreementLiability[agreement] = initL;
        outstandingLiability = newFactoryL;

        // ── 10. Transfer A+R from client to child ─────────────────────────────
        uint256 balBefore = IERC20(t.token).balanceOf(agreement);
        IERC20(t.token).safeTransferFrom(t.client, agreement, initialAmount);
        uint256 balAfter = IERC20(t.token).balanceOf(agreement);
        if (balAfter - balBefore != initialAmount) revert Err.TransferAmountMismatch(initialAmount, balAfter - balBefore);

        emit AgreementCreated(
            agreement, t.client, t.provider, t.amountPerPeriod,
            t.periodSeconds, t.noticeSeconds, t.startAt, R, t.amountPerPeriod
        );
        emit CapacityChanged(agreement, int256(initL), initL, newFactoryL);
    }

    // ── Capacity callbacks (called by registered children only) ───────────────

    /**
     * @notice Reserve additional capacity on renewal. Called by agreement only.
     * @param delta Exact A (amountPerPeriod of calling agreement).
     */
    function reserveCapacity(uint256 delta) external {
        address agr = msg.sender;
        if (!registeredAgreement[agr]) revert Err.UnregisteredAgreement(agr);
        if (delta == 0) revert Err.InvalidCapacityRelease(agr, delta);

        uint256 currentL = perAgreementLiability[agr];
        uint256 newAgrL = currentL + delta;
        if (newAgrL > agreementCap) revert Err.AgreementCapExceeded(newAgrL, agreementCap);

        uint256 newFactL = M.safeAdd(outstandingLiability, delta);
        if (newFactL > factoryCap) revert Err.FactoryCapExceeded(newFactL, factoryCap);

        perAgreementLiability[agr] = newAgrL;
        outstandingLiability = newFactL;

        emit CapacityChanged(agr, int256(delta), newAgrL, newFactL);
    }

    /**
     * @notice Release capacity on claim or refund. Called by agreement only.
     * @param delta Exact amount released (must not exceed agreement's outstanding liability).
     */
    function releaseCapacity(uint256 delta) external {
        address agr = msg.sender;
        if (!registeredAgreement[agr]) revert Err.UnregisteredAgreement(agr);
        if (delta == 0) return; // zero release: no-op

        uint256 currentL = perAgreementLiability[agr];
        if (delta > currentL) revert Err.InvalidCapacityRelease(agr, delta);
        // Overclaim guard: delta cannot exceed factory outstanding
        if (delta > outstandingLiability) revert Err.InvalidCapacityRelease(agr, delta);

        uint256 newAgrL = currentL - delta;
        uint256 newFactL = outstandingLiability - delta;

        perAgreementLiability[agr] = newAgrL;
        outstandingLiability = newFactL;

        emit CapacityChanged(agr, -int256(delta), newAgrL, newFactL);
    }

    // ── Internal validation ───────────────────────────────────────────────────

    function _validateTerms(TermsInput calldata t, uint64 now_) internal view {
        if (t.schemaVersion != SCHEMA_VERSION)
            revert Err.InvalidTerms("schemaVersion != 1");
        if (t.client == address(0) || t.provider == address(0))
            revert Err.InvalidTerms("zero address");
        if (t.client == t.provider)
            revert Err.InvalidTerms("client == provider");
        if (t.token == address(0))
            revert Err.InvalidToken(t.token);
        if (t.token != allowlistedToken)
            revert Err.InvalidToken(t.token);
        if (t.amountPerPeriod == 0)
            revert Err.InvalidTerms("A == 0");
        if (t.periodSeconds < P_MIN || t.periodSeconds > P_MAX)
            revert Err.InvalidTerms("P out of range");
        if (t.noticeSeconds < N_MIN || t.noticeSeconds > N_MAX)
            revert Err.InvalidTerms("N out of range");

        uint64 t0min = now_ + T0_LOOKAHEAD_MIN;
        uint64 t0max = now_ + T0_LOOKAHEAD_MAX;
        if (t.startAt < t0min || t.startAt > t0max)
            revert Err.InvalidTerms("startAt out of range");

        M.assertInt64(uint256(t.startAt), "startAt");
        M.assertInt64(uint256(t.acceptanceDeadline), "deadline");

        // termsDocumentHash must be non-zero (zero bytes32 not a valid hash)
        if (t.termsDocumentHash == bytes32(0))
            revert Err.InvalidTerms("zero termsDocumentHash");

        // Validate initial D and D+N fit int64
        uint64 initialD = M.computeD(t.amountPerPeriod, t.amountPerPeriod, t.periodSeconds, t.startAt);
        M.assertInt64(uint256(initialD), "initialD");
        M.assertInt64(uint256(initialD) + uint256(t.noticeSeconds), "initialD+N");

        // Validate F+R fits uint256
        uint256 R = M.computeR(t.amountPerPeriod, t.noticeSeconds, t.periodSeconds);
        M.safeAdd(t.amountPerPeriod, R); // reverts on overflow
    }

    function _verifyProviderSignature(
        address provider_,
        bytes32 digest,
        bytes calldata sig
    ) internal view {
        // Contract wallets own their validation policy, regardless of payload length.
        if (provider_.code.length > 0) {
            try IERC1271(provider_).isValidSignature(digest, sig) returns (bytes4 magic) {
                if (magic == ERC1271_MAGIC) return;
            } catch {}
        } else {
            (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, sig);
            if (error == ECDSA.RecoverError.NoError && recovered == provider_) return;
        }
        revert Err.InvalidSignature();
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function token() external view returns (address) {
        return allowlistedToken;
    }
}
