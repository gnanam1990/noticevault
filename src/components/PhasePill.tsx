import React from "react";
import type { AgreementPhase } from "@noticevault/domain";
import { PHASE_STYLES } from "../demo/types.js";

interface Props {
  phase: AgreementPhase;
  className?: string;
}

export function PhasePill({ phase, className = "" }: Props) {
  const s = PHASE_STYLES[phase];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${s.bg} ${s.text} ${s.border} ${className}`}
    >
      {s.label}
    </span>
  );
}
