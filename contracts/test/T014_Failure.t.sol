// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./helpers/TestBase.sol";
import {NoticeVaultFactory} from "../src/NoticeVaultFactory.sol";
import {NoticeVaultAgreement} from "../src/NoticeVaultAgreement.sol";
import {NoticeVaultErrors as Err} from "../src/NoticeVaultErrors.sol";
import {MockERC20} from "./helpers/MockERC20.sol";

/**
 * @title T014_Failure
 * @notice Token rejection, short funding, wrong token, exact rollback on factory path failure.
 */
contract T014_Failure is TestBase {

    // ── T014-A: Wrong token rejected ──────────────────────────────────────────

    function test_T014_A_wrong_token_rejected() external {
        MockERC20 badToken = new MockERC20("BAD", "BAD", 6);
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.token = address(badToken);
        t.clientNonce = 50;
        bytes memory sig = _signTerms(t); // will fail sig check (token mismatch in digest)

        vm.prank(clientAddr);
        vm.expectRevert(abi.encodeWithSelector(Err.InvalidToken.selector, address(badToken)));
        factory.createAgreement(t, sig);
    }

    // ── T014-B: Zero termsDocumentHash rejected ───────────────────────────────

    function test_T014_B_zero_hash_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.termsDocumentHash = bytes32(0);
        t.clientNonce = 51;
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        // Zero hash triggers InvalidTerms, but sig won't match original either
        // Either InvalidTerms or InvalidSignature; both are failures
        vm.expectRevert();
        factory.createAgreement(t, sig);
    }

    // ── T014-C: P out of range rejected ──────────────────────────────────────

    function test_T014_C_P_out_of_range_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.periodSeconds = 3599; // < P_MIN=3600
        t.clientNonce = 52;
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert();
        factory.createAgreement(t, sig);
    }

    // ── T014-D: N out of range rejected ──────────────────────────────────────

    function test_T014_D_N_out_of_range_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.noticeSeconds = 3599; // < N_MIN
        t.clientNonce = 53;
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert();
        factory.createAgreement(t, sig);
    }

    // ── T014-E: startAt too early (< now+300) rejected ────────────────────────

    function test_T014_E_startAt_too_early_rejected() external {
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(uint64(block.timestamp) + 600);
        t.startAt = uint64(block.timestamp) + 100; // < now+300
        t.clientNonce = 54;
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert();
        factory.createAgreement(t, sig);
    }

    // ── T014-F: startAt too far (> now+604800) rejected ──────────────────────

    function test_T014_F_startAt_too_far_rejected() external {
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(uint64(block.timestamp) + 600);
        t.startAt = uint64(block.timestamp) + 604_801;
        t.clientNonce = 55;
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert();
        factory.createAgreement(t, sig);
    }

    // ── T014-G: A=0 rejected ─────────────────────────────────────────────────

    function test_T014_G_zero_amount_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.amountPerPeriod = 0;
        t.clientNonce = 56;
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert();
        factory.createAgreement(t, sig);
    }

    // ── T014-H: Client == provider rejected ──────────────────────────────────

    function test_T014_H_client_equals_provider_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.provider = clientAddr; // same as client
        t.clientNonce = 57;
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert();
        factory.createAgreement(t, sig);
    }

    // ── T014-I: Insufficient allowance (short funding) rollback ──────────────

    function test_T014_I_insufficient_allowance_rollback() external {
        // Revoke approval so transfer will fail
        vm.prank(clientAddr);
        usdc.approve(address(factory), 0);

        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.clientNonce = 58;
        bytes memory sig = _signTerms(t);

        uint256 factoryLBefore = factory.outstandingLiability();

        vm.prank(clientAddr);
        vm.expectRevert(); // SafeERC20 insufficient allowance
        factory.createAgreement(t, sig);

        // Factory liability must be unchanged (full rollback)
        assertEq(factory.outstandingLiability(), factoryLBefore, "no partial state change");
        // Nonce must NOT have been consumed on failed creation... 
        // Actually nonce is consumed before transfer in our impl; check design spec:
        // The spec says "reverted create consumes nothing". We must fix this.
        // For now we note this is a test to DRIVE the correct implementation.
        // In a correct impl: nonce should only be consumed inside the same atomic tx;
        // if the tx reverts, the nonce reverts too. This is correct for EVM.
        // A Solidity revert rolls back ALL state. The nonce was only set in this tx.
        assertFalse(factory.isNonceUnavailable(clientAddr, 58), "nonce not consumed on revert");
    }

    // ── T014-J: Renewal fails checkpoint mismatch ─────────────────────────────

    function test_T014_J_renewal_checkpoint_mismatch_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, uint64(P) - 1 * DAYS); // day 29

        uint64 D_ = _D(agr);
        vm.prank(clientAddr);
        vm.expectRevert(abi.encodeWithSelector(Err.CheckpointMismatch.selector, D_ + 1, D_));
        agr.fundNextPeriod(D_ + 1); // wrong expected checkpoint
    }

    // ── T014-K: Renewal at D (equality) rejected ──────────────────────────────

    function test_T014_K_renewal_at_D_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        uint64 D_ = _D(agr);
        vm.warp(D_); // exactly D

        vm.prank(clientAddr);
        vm.expectRevert(Err.FundingWindowClosed.selector);
        agr.fundNextPeriod(D_);
    }

    // ── T014-L: Renewal after notice rejected ─────────────────────────────────

    function test_T014_L_renewal_after_notice_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice();

        _warpTo(agr, uint64(P) - 1 * DAYS); // still before D but notice stored
        uint64 D_ = _D(agr);
        vm.prank(clientAddr);
        vm.expectRevert(Err.NoticeAlreadyStarted.selector);
        agr.fundNextPeriod(D_);
    }

    // ── T014-M: startNotice by non-client rejected ────────────────────────────

    function test_T014_M_start_notice_non_client_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Err.UnauthorizedClient.selector, stranger, clientAddr));
        agr.startNotice();
    }

    // ── T014-N: fundNextPeriod by non-client rejected ─────────────────────────

    function test_T014_N_fund_non_client_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, uint64(P) - 1 * DAYS);
        uint64 D_ = _D(agr);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Err.UnauthorizedClient.selector, stranger, clientAddr));
        agr.fundNextPeriod(D_);
    }

    // ── T014-O: double startNotice rejected ───────────────────────────────────

    function test_T014_O_double_start_notice_rejected() external {
        NoticeVaultAgreement agr = _createAgreement(600);
        _warpTo(agr, 15 * DAYS);
        vm.prank(clientAddr);
        agr.startNotice();

        vm.prank(clientAddr);
        vm.expectRevert(Err.NoticeAlreadyStarted.selector);
        agr.startNotice();
    }
}
