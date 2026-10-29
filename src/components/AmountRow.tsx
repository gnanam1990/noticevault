/**
 * AmountRow — tabular label + USDC amount display.
 * Amounts are bigint, formatted for display only. Never used in calculations.
 */
import React from "react";
import { formatUsdcShort } from "../demo/projector.js";

interface Props {
  label: string;
  amount: bigint;
  highlight?: "blue" | "gold" | "red" | "green" | "none";
  small?: boolean;
  tooltip?: string;
}

const HIGHLIGHT: Record<string, string> = {
  blue:  "text-blue-700 font-semibold",
  gold:  "text-yellow-700 font-semibold",
  red:   "text-red-700 font-semibold",
  green: "text-green-700 font-semibold",
  none:  "text-slate-700",
};

export function AmountRow({ label, amount, highlight = "none", small = false, tooltip }: Props) {
  const textClass = HIGHLIGHT[highlight] ?? HIGHLIGHT["none"];
  return (
    <div className={`flex justify-between items-baseline gap-4 ${small ? "py-1" : "py-1.5"}`}>
      <span className={`text-slate-500 ${small ? "text-xs" : "text-sm"}`} title={tooltip}>
        {label}
      </span>
      <span className={`font-mono tabular-nums ${small ? "text-sm" : "text-base"} ${textClass}`}>
        ${formatUsdcShort(amount)}
      </span>
    </div>
  );
}
