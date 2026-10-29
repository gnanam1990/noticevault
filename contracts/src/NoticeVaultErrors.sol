// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title NoticeVaultErrors — all custom errors for NoticeVault contracts
library NoticeVaultErrors {
    // ── Term validation ──────────────────────────────────────────────────────
    error InvalidTerms(string reason);
    error InvalidToken(address token);
    error AcceptanceExpired();
    error InvalidSignature();
    error NonceUnavailable(address client, uint256 nonce);

    // ── Access control ───────────────────────────────────────────────────────
    error UnauthorizedClient(address caller, address client);
    error UnregisteredAgreement(address agreement);
    error CreationPaused();

    // ── Capacity ─────────────────────────────────────────────────────────────
    error AgreementCapExceeded(uint256 newLiability, uint256 cap);
    error FactoryCapExceeded(uint256 newLiability, uint256 cap);
    error InvalidCapacityRelease(address caller, uint256 amount);

    // ── State machine ────────────────────────────────────────────────────────
    error CheckpointMismatch(uint64 expected, uint64 actual);
    error FundingWindowClosed();
    error NoticeAlreadyStarted();

    // ── Transfer ─────────────────────────────────────────────────────────────
    error TransferAmountMismatch(uint256 expected, uint256 actual);
    error TransferFailed();
}
