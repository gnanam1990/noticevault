// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "./MockERC20.sol";
import {NoticeVaultFactory} from "../../src/NoticeVaultFactory.sol";
import {NoticeVaultAgreement} from "../../src/NoticeVaultAgreement.sol";

/**
 * @title TestBase
 * @notice Shared fixtures for NoticeVault tests.
 * LOCAL_FIXTURE — test-only token, no real funds. Clearly labelled.
 */
abstract contract TestBase is Test {
    // ── Actors ────────────────────────────────────────────────────────────────
    address internal guardian    = makeAddr("guardian");
    address internal clientAddr  = makeAddr("client");
    address internal providerAddr = makeAddr("provider");
    address internal stranger    = makeAddr("stranger");

    // Provider EOA private key for signing
    uint256 internal providerKey = 0xDEADBEEF1234567890ABCDEF;

    // ── Token (LOCAL_FIXTURE — 6 decimals, test only) ─────────────────────────
    MockERC20 internal usdc; // "LOCAL_FIXTURE USDC" — not Arc USDC

    // ── Factory ───────────────────────────────────────────────────────────────
    NoticeVaultFactory internal factory;

    // ── Caps ──────────────────────────────────────────────────────────────────
    uint256 internal constant FACTORY_CAP   = 1_000_000_000_000e6; // 1T USDC
    uint256 internal constant AGREEMENT_CAP = 100_000_000e6;       // 100M USDC

    // ── Standard term values ──────────────────────────────────────────────────
    uint256 internal constant A = 3_000_000_000; // 3000 USDC (6 dec)
    uint64  internal constant P = 2_592_000;     // 30 days
    uint64  internal constant N = 2_592_000;     // 30 days
    // R = ceil(3000e6 * 30d / 30d) = 3000e6
    uint256 internal constant R = 3_000_000_000;
    uint64  internal constant DAYS = 86_400;

    // ── Setup ─────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        // Derive provider address from key
        providerAddr = vm.addr(providerKey);

        // Deploy LOCAL_FIXTURE token
        usdc = new MockERC20("LOCAL_FIXTURE USDC", "USDC.TEST", 6);

        // Deploy factory
        factory = new NoticeVaultFactory(
            guardian,
            address(usdc),
            FACTORY_CAP,
            AGREEMENT_CAP
        );

        // Fund client
        usdc.mint(clientAddr, 1_000_000_000_000);

        // Approve factory for large amount
        vm.prank(clientAddr);
        usdc.approve(address(factory), type(uint256).max);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _defaultTerms(uint64 t0) internal view returns (NoticeVaultFactory.TermsInput memory) {
        return NoticeVaultFactory.TermsInput({
            schemaVersion:      1,
            client:             clientAddr,
            provider:           providerAddr,
            token:              address(usdc),
            amountPerPeriod:    A,
            periodSeconds:      P,
            noticeSeconds:      N,
            startAt:            t0,
            clientNonce:        0,
            acceptanceDeadline: t0 + 7 * DAYS,
            termsDocumentHash:  bytes32(uint256(0xABCD1234))
        });
    }

    /// @notice Sign terms with providerKey (EOA).
    function _signTerms(NoticeVaultFactory.TermsInput memory t) internal view returns (bytes memory) {
        bytes32 digest = factory.termsDigest(
            t.schemaVersion, t.client, t.provider, t.token,
            t.amountPerPeriod, t.periodSeconds, t.noticeSeconds,
            t.startAt, t.clientNonce, t.acceptanceDeadline, t.termsDocumentHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @notice Deploy a standard agreement and return it. t0 relative to now.
    function _createAgreement(uint64 nowRelativeT0Offset) internal returns (NoticeVaultAgreement agr) {
        uint64 now_ = uint64(block.timestamp);
        uint64 t0 = now_ + nowRelativeT0Offset;
        NoticeVaultFactory.TermsInput memory t = _defaultTerms(t0);
        bytes memory sig = _signTerms(t);
        vm.prank(clientAddr);
        address a = factory.createAgreement(t, sig);
        agr = NoticeVaultAgreement(a);
        // Agreement now holds A+R
        vm.prank(clientAddr);
        usdc.approve(address(agr), type(uint256).max); // for renewals
    }

    /// @notice Warp to offset seconds after t0 of the agreement.
    function _warpTo(NoticeVaultAgreement agr, uint64 offsetFromT0) internal {
        vm.warp(agr.startAt() + offsetFromT0);
    }

    /// @notice Compute D for current state.
    function _D(NoticeVaultAgreement agr) internal view returns (uint64) {
        uint256 F = agr.regularFunded();
        uint256 Av = agr.amountPerPeriod();
        uint64 P_ = agr.periodSeconds();
        uint64 t0_ = agr.startAt();
        return uint64(uint256(t0_) + (F / Av) * uint256(P_));
    }

    function _R(NoticeVaultAgreement agr) internal view returns (uint256) {
        return agr.noticeReserve();
    }
}
