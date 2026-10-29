// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITarget {
    function claimProvider() external;
    function claimClientRefund() external;
    function fundNextPeriod(uint64 expectedFundedThrough) external;
}

/**
 * @title ReentrantCaller
 * @notice Attempts reentrancy on claim functions. LOCAL_FIXTURE only.
 * The token calls transferFrom to this contract, which then re-enters.
 */
contract ReentrantCaller {
    ITarget public target;
    uint8 public mode; // 1=claimProvider 2=claimClientRefund 3=fundNextPeriod
    uint64 public expectedD;
    bool public entered;
    bool public reentrySucceeded;

    function setup(address target_, uint8 mode_, uint64 expectedD_) external {
        target = ITarget(target_);
        mode = mode_;
        expectedD = expectedD_;
    }

    /// @notice ERC20 transfer hook - called when tokens arrive (simulated via Mock).
    /// In tests, MockERC20.forceTransfer to this address triggers this.
    function onTokenReceived() external {
        if (entered) return;
        entered = true;
        try this.reenter() {
            reentrySucceeded = true;
        } catch {}
    }

    function reenter() external {
        if (mode == 1) target.claimProvider();
        else if (mode == 2) target.claimClientRefund();
        else target.fundNextPeriod(expectedD);
    }
}
