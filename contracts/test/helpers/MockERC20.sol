// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Minimal 6-decimal test token. NOT Arc USDC; test-only, clearly labelled.
 * LOCAL_FIXTURE — do not use on any live network.
 */
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint tokens for test setup. No access control — test fixture only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Force-transfer for reentrancy test helpers.
    function forceTransfer(address from, address to, uint256 amount) external {
        _transfer(from, to, amount);
    }

    // ── Reentrancy test hook ──────────────────────────────────────────────────

    /// @dev When set, _update calls recipient.onTokenReceived() after each transfer
    ///      to any non-zero address.  Used ONLY by reentrancy tests; never set in
    ///      normal test setUp.
    address public transferHookTarget;
    bytes4  public transferHookSelector;

    function setTransferHook(address hookTarget, bytes4 selector) external {
        transferHookTarget = hookTarget;
        transferHookSelector = selector;
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        super._update(from, to, value);
        if (transferHookTarget != address(0) && to != address(0) && to == transferHookTarget) {
            // Low-level call: ignore return value; test checks reentrySucceeded flag
            (bool ok,) = transferHookTarget.call(abi.encodeWithSelector(transferHookSelector));
            // Suppress unused warning; result observed by the test helper contract
            (ok);
        }
    }
}
