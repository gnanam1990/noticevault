// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestBase} from "./helpers/TestBase.sol";
import {NoticeVaultFactory} from "../src/NoticeVaultFactory.sol";
import {NoticeVaultAgreement} from "../src/NoticeVaultAgreement.sol";
import {NoticeVaultErrors as Err} from "../src/NoticeVaultErrors.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/**
 * @title T011_Consent
 * @notice EIP-712 signed consent tests: field mutations, replay, domain binding,
 *         deadline equality, nonce invalidation, EOA + ERC-1271.
 */
contract T011_Consent is TestBase {

    // ── T011-A: Valid creation succeeds ───────────────────────────────────────

    function test_T011_A_valid_creation() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        address agr = factory.createAgreement(t, sig);

        assertTrue(factory.registeredAgreement(agr));
        assertEq(factory.perAgreementLiability(agr), A + R);
        assertEq(factory.outstandingLiability(), A + R);
        assertEq(usdc.balanceOf(agr), A + R);
    }

    // ── T011-B: Mutated field (amountPerPeriod) rejected ─────────────────────

    function test_T011_B_mutated_amount_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t); // sign original

        // Mutate A after signing
        t.amountPerPeriod = A + 1;
        vm.prank(clientAddr);
        vm.expectRevert(Err.InvalidSignature.selector);
        factory.createAgreement(t, sig);
    }

    // ── T011-C: Mutated provider field rejected ───────────────────────────────

    function test_T011_C_mutated_provider_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);

        t.provider = stranger;
        vm.prank(clientAddr);
        vm.expectRevert(Err.InvalidSignature.selector);
        factory.createAgreement(t, sig);
    }

    // ── T011-D: Mutated termsDocumentHash rejected ────────────────────────────

    function test_T011_D_mutated_hash_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);

        t.termsDocumentHash = bytes32(uint256(0xDEAD));
        vm.prank(clientAddr);
        vm.expectRevert(Err.InvalidSignature.selector);
        factory.createAgreement(t, sig);
    }

    // ── T011-E: Replay on same factory (nonce consumed) ───────────────────────

    function test_T011_E_nonce_replay_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        factory.createAgreement(t, sig);

        // Second call with same terms and sig → nonce consumed
        vm.prank(clientAddr);
        vm.expectRevert(abi.encodeWithSelector(Err.NonceUnavailable.selector, clientAddr, uint256(0)));
        factory.createAgreement(t, sig);
    }

    // ── T011-F: Cross-chain replay (different chainId → domain mismatch) ──────

    function test_T011_F_cross_chain_replay_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);

        // Sign on "other chain" (chainId=999 domain separator differs)
        // Manually compute digest with wrong chainId
        bytes32 wrongDomainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("NoticeVaultAgreement"),
            keccak256("1"),
            uint256(999), // wrong chain
            address(factory)
        ));
        bytes32 structHash = keccak256(abi.encode(
            factory.TERMS_TYPEHASH(),
            t.schemaVersion, t.client, t.provider, t.token,
            t.amountPerPeriod, t.periodSeconds, t.noticeSeconds,
            t.startAt, t.clientNonce, t.acceptanceDeadline, t.termsDocumentHash
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", wrongDomainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(clientAddr);
        vm.expectRevert(Err.InvalidSignature.selector);
        factory.createAgreement(t, sig);
    }

    // ── T011-G: Cross-factory replay (different factory address) ─────────────

    function test_T011_G_cross_factory_replay_rejected() external {
        // Deploy a second factory
        NoticeVaultFactory factory2 = new NoticeVaultFactory(
            guardian, address(usdc), FACTORY_CAP, AGREEMENT_CAP
        );
        usdc.mint(clientAddr, 1_000_000_000_000);
        vm.prank(clientAddr);
        usdc.approve(address(factory2), type(uint256).max);

        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        // Sign for factory1
        bytes memory sig = _signTerms(t); // uses factory.DOMAIN_SEPARATOR

        // Submit to factory2 (different domain verifyingContract)
        vm.prank(clientAddr);
        vm.expectRevert(Err.InvalidSignature.selector);
        factory2.createAgreement(t, sig);
    }

    // ── T011-H: Deadline equality = expired ───────────────────────────────────

    function test_T011_H_deadline_equality_expired() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        t.acceptanceDeadline = uint64(block.timestamp); // exactly now = expired
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert(Err.AcceptanceExpired.selector);
        factory.createAgreement(t, sig);
    }

    // ── T011-I: Invalidated nonce rejected ────────────────────────────────────

    function test_T011_I_invalidated_nonce_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);

        // Client invalidates their nonce 0
        vm.prank(clientAddr);
        factory.invalidateNonce(0);

        vm.prank(clientAddr);
        vm.expectRevert(abi.encodeWithSelector(Err.NonceUnavailable.selector, clientAddr, uint256(0)));
        factory.createAgreement(t, sig);
    }

    // ── T011-J: ERC-1271 smart wallet provider ────────────────────────────────

    function test_T011_J_erc1271_provider() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);

        // Deploy mock ERC-1271 wallet as provider
        MockERC1271Wallet wallet = new MockERC1271Wallet();
        t.provider = address(wallet);

        bytes32 digest = factory.termsDigest(
            t.schemaVersion, t.client, t.provider, t.token,
            t.amountPerPeriod, t.periodSeconds, t.noticeSeconds,
            t.startAt, t.clientNonce, t.acceptanceDeadline, t.termsDocumentHash
        );
        bytes memory sig = abi.encode(digest); // wallet echoes digest as magic

        wallet.setValid(digest, true);

        vm.prank(clientAddr);
        address agr = factory.createAgreement(t, sig);
        assertTrue(factory.registeredAgreement(agr));
    }

    // ── T011-K: ERC-1271 wallet rejects invalid sig ───────────────────────────

    function test_T011_K_erc1271_invalid_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);

        MockERC1271Wallet wallet = new MockERC1271Wallet();
        t.provider = address(wallet);
        // wallet will return 0x (invalid magic)

        bytes memory sig = abi.encode(bytes32(0));
        vm.prank(clientAddr);
        vm.expectRevert(Err.InvalidSignature.selector);
        factory.createAgreement(t, sig);
    }

    // ── T011-L: Non-client caller rejected ────────────────────────────────────

    function test_T011_L_non_client_caller_rejected() external {
        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Err.UnauthorizedClient.selector, stranger, clientAddr));
        factory.createAgreement(t, sig);
    }

    // ── T011-M: Creation paused → rejected ───────────────────────────────────

    function test_T011_M_creation_paused_rejected() external {
        vm.prank(guardian);
        factory.setCreationPaused(true);

        uint64 t0 = uint64(block.timestamp) + 600;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);

        vm.prank(clientAddr);
        vm.expectRevert(Err.CreationPaused.selector);
        factory.createAgreement(t, sig);
    }

    // ── T011-N: Creation pause does NOT affect agreement operations ───────────

    function test_T011_N_pause_does_not_affect_existing_agreement() external {
        NoticeVaultAgreement agr = _createAgreement(600);

        vm.prank(guardian);
        factory.setCreationPaused(true);

        // Renewal still works (before D)
        _warpTo(agr, uint64(P) - 1 * DAYS); // day 29 — before D1
        uint64 D1 = _D(agr);
        vm.prank(clientAddr);
        agr.fundNextPeriod(D1); // must not revert despite creation paused

        // After renewal, D2 = t0 + 2P
        // materializeNotice works after we pass D2
        uint64 D2 = agr.startAt() + 2 * uint64(P);
        vm.warp(D2 + 1); // past new D
        agr.materializeNotice(); // must not revert
        assertTrue(agr.hasStoredNotice(), "notice materialized despite creation pause");
    }
}

// ── Mock ERC-1271 wallet ──────────────────────────────────────────────────────

contract MockERC1271Wallet is IERC1271 {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    mapping(bytes32 => bool) public valid;

    function setValid(bytes32 digest, bool v) external {
        valid[digest] = v;
    }

    function isValidSignature(bytes32 hash, bytes calldata) external view override returns (bytes4) {
        if (valid[hash]) return MAGIC;
        return bytes4(0);
    }
}
