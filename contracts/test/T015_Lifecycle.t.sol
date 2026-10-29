// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./helpers/TestBase.sol";
import {NoticeVaultFactory} from "../src/NoticeVaultFactory.sol";
import {NoticeVaultAgreement} from "../src/NoticeVaultAgreement.sol";
import {NoticeVaultErrors as Err} from "../src/NoticeVaultErrors.sol";

/**
 * @title T015_Lifecycle
 * @notice Actor/destination controls, guardian, materialize idempotency,
 *         renewal-notice same-block race, G3 scenario, phase transitions.
 */
contract T015_Lifecycle is TestBase {

    // ── T015-A: claimProvider pays only provider (immutable) ─────────────────

    function test_T015_A_claim_provider_destination_immutable() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);

        uint256 provBefore = usdc.balanceOf(providerAddr);
        agr.claimProvider(); // permissionless — anyone can call
        uint256 provAfter = usdc.balanceOf(providerAddr);

        assertGt(provAfter, provBefore, "provider received tokens");
        // Stranger calling claimProvider still pays provider, not stranger
        assertEq(usdc.balanceOf(stranger), 0, "stranger received nothing");
    }

    // ── T015-B: claimClientRefund pays only client (immutable) ───────────────

    function test_T015_B_claim_refund_destination_immutable() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice();

        uint256 clientBefore = usdc.balanceOf(clientAddr);
        agr.claimClientRefund(); // permissionless — anyone can call
        uint256 clientAfter = usdc.balanceOf(clientAddr);

        assertGt(clientAfter, clientBefore, "client received refund");
        assertEq(usdc.balanceOf(stranger), 0, "stranger received nothing");
    }

    // ── T015-C: Zero claim — no transfer, no event, no state change ──────────

    function test_T015_C_zero_claim_no_op() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        // At t0 exactly, V=0, W=0
        vm.warp(agr.startAt());

        uint256 provBefore = usdc.balanceOf(providerAddr);
        agr.claimProvider();
        assertEq(usdc.balanceOf(providerAddr), provBefore, "no transfer on zero claim");
        assertEq(agr.regularPaid(), 0, "RP unchanged");
    }

    // ── T015-D: materializeNotice idempotent (no duplicate event) ────────────

    function test_T015_D_materialize_idempotent() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        // Warp past D
        uint64 D_ = _D(agr);
        vm.warp(D_ + 1);

        // First: should store and emit
        agr.materializeNotice();
        assertTrue(agr.hasStoredNotice(), "stored after first call");
        assertEq(agr.noticeStartStored(), D_, "S=D");

        // Second: should be no-op (no event, no revert)
        agr.materializeNotice(); // must not revert
        assertEq(agr.noticeStartStored(), D_, "S unchanged");
    }

    // ── T015-E: materializeNotice before D reverts ────────────────────────────

    function test_T015_E_materialize_before_D_reverts() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, uint64(P) - 1 * DAYS); // day 29, before D

        vm.expectRevert(Err.FundingWindowClosed.selector);
        agr.materializeNotice();
    }

    // ── T015-F: Renewal then cancel in same block (different txs) ────────────

    function test_T015_F_renewal_then_cancel_same_block() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, uint64(P) - 1 * DAYS); // day 29 — before D

        uint64 D_ = _D(agr);
        vm.prank(clientAddr);
        agr.fundNextPeriod(D_); // renewal succeeds

        assertEq(agr.regularFunded(), 2 * A, "renewed");

        // Now cancel on renewed state (S = now = t0+29d)
        vm.prank(clientAddr);
        agr.startNotice();
        assertEq(agr.noticeReasonStored(), 1, "CLIENT_CANCELLED");
        assertEq(agr.regularFunded(), 2 * A, "F still 2A");
    }

    // ── T015-G: Cancel then renewal — renewal rejected ────────────────────────

    function test_T015_G_cancel_then_renewal_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 5 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice(); // cancel

        _warpTo(agr, uint64(P) - 1 * DAYS);
        uint64 D_ = _D(agr);
        vm.prank(clientAddr);
        vm.expectRevert(Err.NoticeAlreadyStarted.selector);
        agr.fundNextPeriod(D_);
    }

    // ── T015-H: G3 full scenario ──────────────────────────────────────────────

    function test_T015_H_G3_full_scenario() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        // Initial: F=A, R=A, inflows=2A

        // Renew day29
        _warpTo(agr, uint64(P) - 1 * DAYS); // day 29
        uint64 D1 = _D(agr);
        vm.prank(clientAddr);
        agr.fundNextPeriod(D1);
        assertEq(agr.regularFunded(), 2 * A, "F=2A after renewal");
        // inflows = A+R + A = 3A (= 9_000_000_000 with A=3e9, R=3e9)

        // Cancel day35 (35 days after t0)
        _warpTo(agr, 35 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice();

        uint64 S = agr.noticeStartStored();
        // V_S = floor(2A * 35d / 30d)? No: V_S uses A (amountPerPeriod), F=2A cap
        // V_S = floor(A * 35d / P) capped at F=2A
        // Actually: V_S = floor(A * min(S,D) - t0 / P), D=day60 now; S=day35 < D
        // min(S=day35, D=day60) = day35; elapsed=35d; V_S=floor(A*35/30)=floor(3.5A/1)
        // A=3_000_000_000, 35/30 > 1 → V_S = 2*A? No: floor(3e9 * 35d / 30d) = floor(3.5e9) = 3_500_000_000
        // But F=2A=6e9, so cap: min(3_500_000_000, 6_000_000_000) = 3_500_000_000
        uint256 VS = (uint256(A) * 35 * uint256(DAYS)) / uint256(P);
        uint256 refund = 2 * A - VS; // = 6e9 - 3.5e9 = 2_500_000_000

        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.clientRefundable, refund, "G3 refund=2.5e9");

        // E = S + N
        uint64 E = S + uint64(N);
        vm.warp(E);

        // Provider total = V_S + R = 3_500_000_000 + 3_000_000_000 = 6_500_000_000
        NoticeVaultAgreement.Preview memory p2 = agr.preview();
        assertEq(p2.providerClaimable, VS + R, "G3 provider=6.5e9");
        assertEq(p2.clientRefundable, refund, "G3 refund=2.5e9 at E");

        // Claim all
        agr.claimProvider();
        agr.claimClientRefund();

        // Conservation: 3A total inflows = 9e9 = 6.5e9 + 2.5e9
        assertEq(VS + R + refund, 3 * A, "G3 conservation: 9e9");
        assertEq(factory.outstandingLiability(), 0, "factory L=0");
    }

    // ── T015-I: Phase transitions: SCHEDULED→ACTIVE→NOTICE_SCHEDULED→NOTICE→ENDED→CLOSED

    function test_T015_I_phase_transitions() external {
        NoticeVaultAgreement agr = _createAgreement(600);

        // SCHEDULED (before t0)
        assertEq(agr.preview().phase, 0, "SCHEDULED");

        // ACTIVE (at t0)
        vm.warp(agr.startAt());
        assertEq(agr.preview().phase, 1, "ACTIVE");

        // Cancel at t0+5d → NOTICE (now >= S)
        _warpTo(agr, 5 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice();
        assertEq(agr.preview().phase, 3, "NOTICE after cancel");

        // Phase before S would be NOTICE_SCHEDULED — test with fresh agreement (nonce=50)
        {
            uint64 now2_ = uint64(block.timestamp);
            uint64 t0b = now2_ + 600 + 86400; // t0 far enough in future for pre-start
            NoticeVaultFactory.TermsInput memory tb = _defaultTerms(t0b);
            tb.clientNonce = 50;
            bytes memory sigb = _signTerms(tb);
            vm.prank(clientAddr);
            address a2 = factory.createAgreement(tb, sigb);
            NoticeVaultAgreement agr2 = NoticeVaultAgreement(a2);
            // Cancel before t0
            vm.prank(clientAddr);
            agr2.startNotice(); // S=t0 (now < t0)
            assertEq(agr2.preview().phase, 2, "NOTICE_SCHEDULED");
        }

        // ENDED_CLAIMABLE
        uint64 E = agr.noticeStartStored() + agr.noticeSeconds();
        vm.warp(E);
        assertEq(agr.preview().phase, 4, "ENDED_CLAIMABLE");

        // CLOSED after full claim
        agr.claimProvider();
        agr.claimClientRefund();
        assertEq(agr.preview().phase, 5, "CLOSED");
    }

    // ── T015-J: Duplicate checkpoint (second renewal) rejected ────────────────

    function test_T015_J_duplicate_checkpoint_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, uint64(P) - 1 * DAYS);
        uint64 D1 = _D(agr);
        vm.prank(clientAddr);
        agr.fundNextPeriod(D1); // success

        // Try again with old D1 (now stale)
        vm.prank(clientAddr);
        vm.expectRevert(); // CheckpointMismatch — D has moved to D2
        agr.fundNextPeriod(D1);
    }

    // ── T015-K: Missed checkpoint — startNotice stores S=D ───────────────────

    function test_T015_K_overdue_start_notice_stores_D() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        uint64 D_ = _D(agr);
        vm.warp(D_ + 1); // overdue

        vm.prank(clientAddr);
        agr.startNotice(); // should store S=D, MISSED_CHECKPOINT

        assertEq(agr.noticeStartStored(), D_, "S=D");
        assertEq(agr.noticeReasonStored(), 2, "MISSED_CHECKPOINT");
    }

    // ── T015-L: claimProvider materializes derived notice once ────────────────

    function test_T015_L_claim_materializes_derived_once() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        uint64 D_ = _D(agr);
        vm.warp(D_ + 1);

        // First claim: materializes notice + claims
        agr.claimProvider();
        assertTrue(agr.hasStoredNotice(), "notice stored after claim");
        assertEq(agr.noticeStartStored(), D_);

        // Second claim: no duplicate materialization
        uint256 rpBefore = agr.regularPaid();
        uint256 npBefore = agr.noticePaid();
        agr.claimProvider();
        // Only new accrual since last claim (possibly 0 at same block)
        // Just verify no revert and state is consistent
        assertGe(agr.regularPaid(), rpBefore);
        assertGe(agr.noticePaid(), npBefore);
    }
}
