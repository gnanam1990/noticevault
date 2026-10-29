/**
 * SIMULATION badge — shown on every financial value card.
 */
import React from "react";

export function SimBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-yellow-100 text-yellow-800 border border-yellow-300 ${className}`}
      title="This value is from a synthetic simulation — not live blockchain data"
    >
      SIM
    </span>
  );
}
