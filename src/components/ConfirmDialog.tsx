/**
 * Confirmation dialog — semantic <dialog>, focus trap, Escape closes.
 * Cancel = NO state change.
 */
import React, { useEffect, useRef, useCallback } from "react";
import { formatUsdcShort } from "../demo/projector.js";

export interface DialogAction {
  title: string;
  amount: bigint;
  from: string;
  to: string;
  description: string;
  consequences: string;
}

interface Props {
  action: DialogAction | null;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
}

export function ConfirmDialog({ action, onConfirm, onCancel, confirming = false }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (action) {
      el.showModal?.();
      confirmRef.current?.focus();
    } else {
      el.close?.();
    }
  }, [action]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  }, [onCancel]);

  if (!action) return null;

  return (
    <dialog
      ref={dialogRef}
      className="rounded-xl shadow-xl p-0 w-full max-w-md border border-slate-200 backdrop:bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      onKeyDown={handleKeyDown}
    >
      <div className="p-6">
        <h2 id="dialog-title" className="text-lg font-bold text-slate-900 mb-1">
          {action.title}
        </h2>
        <p className="text-sm text-slate-500 mb-4">{action.description}</p>

        {action.amount > 0n && (
          <div className="bg-slate-50 rounded-lg p-4 mb-4 border border-slate-200">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-500">Amount</span>
              <span className="font-mono font-semibold text-slate-900">${formatUsdcShort(action.amount)} USDC</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-500">From</span>
              <span className="font-mono text-slate-600 text-xs">{action.from}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">To</span>
              <span className="font-mono text-slate-600 text-xs">{action.to}</span>
            </div>
          </div>
        )}

        <p className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded p-3 mb-6">
          {action.consequences}
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={confirming}
            className="px-4 py-2 text-sm font-medium border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={confirming}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {confirming ? "Confirming…" : "Confirm"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
