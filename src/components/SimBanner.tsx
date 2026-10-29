/**
 * Persistent SIMULATION banner — never hidden.
 */
import React from "react";
import { AlertTriangle } from "lucide-react";

export function SimBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center gap-2 text-sm text-yellow-800 font-medium"
      style={{ minHeight: 40 }}
    >
      <AlertTriangle size={15} className="shrink-0 text-yellow-600" aria-hidden="true" />
      <span>Synthetic demo — no real funds or blockchain transactions. All values are <strong>SIMULATION</strong>.</span>
    </div>
  );
}
