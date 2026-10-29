// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./helpers/TestBase.sol";
import {NoticeVaultAgreement} from "../src/NoticeVaultAgreement.sol";
import {NoticeVaultErrors as Err} from "../src/NoticeVaultErrors.sol";

/**
 * @title T012_Accounting
 * @notice Balance, RP/NP/CR/R/L correctness: mid-notice, pre-start, missed funding.
 * Golden fixtures match M01 domain package.
 * Independent expected math (never uses contract output as oracle).
 */
contract T012_Accounting is TestBase {

    // ── T012-A: Initial state ─────────────────────────────────────────────────

    function test_T012_A_initial_state() external {
        NoticeVaultAgreement agr = _createAgreement(600);

        assertEq(agr.regularFunded(),  A,  "F=A");
        assertEq(agr.regularPaid(),    0,   "RP=0");
        assertEq(agr.noticePaid(),     0,   "NP=0");
        assertEq(agr.clientRefunded(), 0,   "CR=0");
        assertEq(agr.noticeReserve(),  R,   "R=A when P=N");
        assertEq(usdc.balanceOf(address(agr)), A + R, "balance=A+R");
        assertFalse(agr.hasStoredNotice(), "no stored notice");
    }

    // ── T012-B: R = ceil(A*N/P) when P=N → R=A ───────────────────────────────

    function test_T012_B_R_equal_A_when_PN_equal() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        assertEq(agr.noticeReserve(), A);
    }

    // ── T012-C: G1 day15 — provider claimable = V = 1_500_000_000 ─────────────

    function test_T012_C_G1_day15_provider_claimable() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);

        // V = floor(A * 15d / 30d) = 1_500_000_000; W = 0 (no notice)
        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.V, 1_500_000_000,  "V day15");
        assertEq(p.W, 0,              "W=0 before notice");
        assertEq(p.providerClaimable, 1_500_000_000, "claimable");
        assertEq(p.clientRefundable, 0, "no refund before notice");
        assertEq(p.phase, 1, "ACTIVE");
    }

    // ── T012-D: Cancel day15 → instant refund, V frozen ──────────────────────

    function test_T012_D_cancel_day15_refund_and_frozen_V() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);

        vm.prank(clientAddr);
        agr.startNotice();

        // V_S = 1_500_000_000; refund = A - V_S = 1_500_000_000
        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.clientRefundable, 1_500_000_000, "refund after cancel");
        assertEq(p.V, 1_500_000_000, "V frozen at V_S");
        assertEq(p.W, 0, "W=0 at S exactly");
        assertEq(p.phase, 3, "NOTICE"); // now >= S
    }

    // ── T012-E: V does NOT continue after notice start ────────────────────────

    function test_T012_E_V_frozen_after_notice() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice();

        // Observe at day 20 — V must still be 1_500_000_000
        _warpTo(agr, 20 * DAYS);
        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.V, 1_500_000_000, "V frozen after notice");
    }

    // ── T012-F: G1 day45 — W=R, provider total 4_500_000_000 ─────────────────

    function test_T012_F_G1_day45_full_notice() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice();

        uint64 S = agr.noticeStartStored();
        uint64 E = S + agr.noticeSeconds();
        vm.warp(E);

        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.W, R, "W=R at E");
        // V_S = 1_500_000_000; total provider = V_S + R = 4_500_000_000
        assertEq(p.providerClaimable, 1_500_000_000 + R, "provider total");
        assertEq(p.clientRefundable, 1_500_000_000, "client refund");
        // Conservation: A + R = provider + refund
        assertEq(1_500_000_000 + R + 1_500_000_000, A + R, "conservation");
    }

    // ── T012-G: Pre-start cancel → S=t0, V_S=0, refund=A ────────────────────

    function test_T012_G_prestart_cancel_full_refund() external {
        NoticeVaultAgreement agr = _createAgreement(600); // t0 = now+600
        // Still before t0
        vm.prank(clientAddr);
        agr.startNotice(); // S = max(now, t0) = t0

        assertEq(agr.noticeStartStored(), agr.startAt(), "S=t0");
        assertEq(agr.noticeReasonStored(), 1, "CLIENT_CANCELLED");

        NoticeVaultAgreement.Preview memory p = agr.preview();
        // Before t0: NOTICE_SCHEDULED
        assertEq(p.phase, 2, "NOTICE_SCHEDULED");
        // V_S = 0 (nothing earned yet); refund = A
        assertEq(p.clientRefundable, A, "full refund");
    }

    // ── T012-H: G2 missed checkpoint day40 ───────────────────────────────────

    function test_T012_H_G2_day40_derived_notice() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 40 * DAYS); // past D=day30

        // Derived notice: S=D=t0+30d
        uint64 D_ = agr.startAt() + uint64(P);
        uint64 N_ = agr.noticeSeconds();

        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.S, D_, "S=D (derived)");
        assertFalse(p.hasStoredNotice_, "not stored");

        // W = floor(R * 10d / 30d) = 1_000_000_000
        uint256 elapsed = (40 - 30) * uint256(DAYS);
        uint256 expectedW = (R * elapsed) / uint256(N_);
        assertEq(p.W, expectedW, "W day40");
        assertEq(p.W, 1_000_000_000, "W=1e9 day40");

        // L = A+R - RP - NP - CR = A+R (nothing claimed)
        assertEq(p.L, A + R, "L=A+R");
    }

    // ── T012-I: G2 day60 — all provider, no refund ────────────────────────────

    function test_T012_I_G2_day60_full_provider() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        uint64 E = agr.startAt() + uint64(P) + uint64(N);
        vm.warp(E);

        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.W, R, "W=R at E");
        assertEq(p.V, A, "V=A=F");
        assertEq(p.providerClaimable, A + R, "all to provider");
        assertEq(p.clientRefundable, 0, "no refund");
        assertEq(p.phase, 4, "ENDED_CLAIMABLE");
    }

    // ── T012-J: G2 day61 after full claim → CLOSED, L=0 ─────────────────────

    function test_T012_J_G2_closed_after_claim() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        uint64 E = agr.startAt() + uint64(P) + uint64(N);
        vm.warp(E);

        agr.claimProvider();
        agr.claimClientRefund();

        vm.warp(E + 1);
        NoticeVaultAgreement.Preview memory p = agr.preview();
        assertEq(p.phase, 5, "CLOSED");
        assertEq(p.L, 0, "L=0");
        assertEq(usdc.balanceOf(address(agr)), 0, "zero balance");
    }

    // ── T012-K: L conservation at every step ─────────────────────────────────

    function test_T012_K_conservation() external {
        NoticeVaultAgreement agr = _createAgreement(600);

        // Before notice
        _warpTo(agr, 15 * DAYS);
        {
            uint256 F = agr.regularFunded();
            uint256 Rv = agr.noticeReserve();
            uint256 L = F + Rv - agr.regularPaid() - agr.noticePaid() - agr.clientRefunded();
            assertEq(L, F + Rv, "conservation before notice");
        }

        // After cancel
        vm.prank(clientAddr);
        agr.startNotice();
        {
            uint256 F = agr.regularFunded();
            uint256 Rv = agr.noticeReserve();
            uint256 L = F + Rv - agr.regularPaid() - agr.noticePaid() - agr.clientRefunded();
            assertEq(L, F + Rv, "conservation after cancel (nothing claimed yet)");
        }

        // After claim provider
        uint64 E = agr.noticeStartStored() + agr.noticeSeconds();
        vm.warp(E);
        agr.claimProvider();
        {
            uint256 F = agr.regularFunded();
            uint256 Rv = agr.noticeReserve();
            uint256 L = F + Rv - agr.regularPaid() - agr.noticePaid() - agr.clientRefunded();
            // L should equal remaining unclaimed (refundable = 1_500_000_000)
            assertEq(L, 1_500_000_000, "conservation after provider claim");
        }

        // After client refund
        agr.claimClientRefund();
        {
            uint256 L = agr.regularFunded() + agr.noticeReserve()
                        - agr.regularPaid() - agr.noticePaid() - agr.clientRefunded();
            assertEq(L, 0, "conservation: L=0 after all claims");
        }
    }
}
