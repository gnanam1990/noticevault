// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {NoticeVaultMath as M} from "../src/NoticeVaultMath.sol";
contract MathBoundsHarness {
    function fundedThrough(uint256 F, uint256 A, uint64 P, uint64 t0) external pure returns (uint64) { return M.computeD(F,A,P,t0); }
}
contract T017_MathBounds is Test {
    MathBoundsHarness private h = new MathBoundsHarness();
    function testExactInt64MaximumAccepted() public view { assertEq(h.fundedThrough(uint256(uint64(type(int64).max)),1,1,0),uint64(type(int64).max)); }
    function testAboveInt64MaximumRejected() public { vm.expectRevert(bytes("NVM: int64 overflow: fundedThrough")); h.fundedThrough(uint256(uint64(type(int64).max))+1,1,1,0); }
    function testUint64WraparoundRejected() public { vm.expectRevert(bytes("NVM: int64 overflow: fundedThrough")); h.fundedThrough((uint256(1)<<64)+7,1,1,0); }
    function testOrdinaryMultiplePeriodsUnchanged() public view { assertEq(h.fundedThrough(30000,10000,3600,1000),11800); }
}
