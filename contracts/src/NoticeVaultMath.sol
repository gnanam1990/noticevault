// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title NoticeVaultMath
 * @notice Pure math helpers for NoticeVault financial calculations.
 *
 * All money as uint256 (micro-token / 6 decimals).
 * All time as uint64 (Unix seconds), stored/returned as such.
 * Full-precision intermediate arithmetic via uint256; Solidity mul never overflows uint256
 * for values fitting uint64*uint256, but callers must validate final results fit bounds.
 *
 * Normative rules: specs/CORE-CONTRACT-M01.md (same model as domain package).
 */
library NoticeVaultMath {
    int64 internal constant INT64_MAX = type(int64).max; // 9223372036854775807

    /// @notice R = ceil(A * N / P)
    function computeR(uint256 A, uint64 N, uint64 P) internal pure returns (uint256) {
        // ceil(A*N/P) = (A*N + P - 1) / P
        // A*N can be up to ~2^256-1 * 2^63 which overflows — but A is bounded to
        // satisfy F+R <= uint256 in validation, so A*N fits uint256 in practice.
        // Forge checks: A*N safe given A <= uint256 max / N.
        uint256 num = A * uint256(N) + uint256(P) - 1;
        return num / uint256(P);
    }

    /// @notice D = t0 + (F / A) * P.  F must be positive multiple of A.
    function computeD(uint256 F, uint256 A, uint64 P, uint64 t0) internal pure returns (uint64) {
        uint256 periods = F / A;
        uint256 d = uint256(t0) + periods * uint256(P);
        assertInt64(d, "fundedThrough");
        return uint64(d);
    }

    /// @notice V = floor(A * elapsed / P), capped at F.
    ///         elapsed = max(0, regularStop - t0); regularStop = min(now, D, S if present).
    function computeV(
        uint256 A,
        uint64 P,
        uint64 t0,
        uint64 D,
        uint64 now_,
        bool hasNotice,
        uint64 S
    ) internal pure returns (uint256) {
        uint64 stop = now_ < D ? now_ : D;
        if (hasNotice && S < stop) stop = S;
        if (stop <= t0) return 0;
        uint64 elapsed = stop - t0;
        uint256 raw = (A * uint256(elapsed)) / uint256(P);
        return raw < A ? raw : A; // cap at F=A (per-period; caller handles multi-period F)
    }

    /// @notice V for multi-period state: cap at regularFunded F.
    function computeVCapped(
        uint256 A,
        uint256 F,
        uint64 P,
        uint64 t0,
        uint64 D,
        uint64 now_,
        bool hasNotice,
        uint64 S
    ) internal pure returns (uint256) {
        uint64 stop = now_ < D ? now_ : D;
        if (hasNotice && S < stop) stop = S;
        if (stop <= t0) return 0;
        uint64 elapsed = stop - t0;
        uint256 raw = (A * uint256(elapsed)) / uint256(P);
        return raw < F ? raw : F;
    }

    /// @notice W = floor(R * clamp(now-S, 0, N) / N); W = R exactly at/after E = S+N.
    function computeW(uint256 R, uint64 N, uint64 S, uint64 now_) internal pure returns (uint256) {
        if (now_ <= S) return 0;
        uint64 E;
        unchecked { E = S + N; } // overflow checked at creation; S+N <= int64 max
        if (now_ >= E) return R;
        uint64 elapsed = now_ - S;
        return (R * uint256(elapsed)) / uint256(N);
    }

    /// @notice V_S = floor(A * max(0, min(S,D) - t0) / P), capped at F.
    function computeVS(
        uint256 A,
        uint256 F,
        uint64 P,
        uint64 t0,
        uint64 D,
        uint64 S
    ) internal pure returns (uint256) {
        uint64 noticeStop = S < D ? S : D;
        if (noticeStop <= t0) return 0;
        uint64 elapsed = noticeStop - t0;
        uint256 raw = (A * uint256(elapsed)) / uint256(P);
        return raw < F ? raw : F;
    }

    /// @notice Safe add, reverts on uint256 overflow.
    function safeAdd(uint256 a, uint256 b) internal pure returns (uint256 c) {
        unchecked { c = a + b; }
        require(c >= a, "NVM: add overflow");
    }

    /// @notice Assert value fits int64 (signed). Used for timestamps.
    function assertInt64(uint256 v, string memory label) internal pure {
        require(v <= uint256(uint64(INT64_MAX)), string.concat("NVM: int64 overflow: ", label));
    }
}
