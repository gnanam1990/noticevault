import React from "react";
import { CheckCircle, XCircle, AlertCircle, Clock } from "lucide-react";

type Status = "HISTORICAL" | "VERIFIED" | "PARTIALLY_VERIFIED" | "BLOCKED" | "BLOCKED_INTEGRATION" | "NOT_RUN";

interface Item {
  label: string;
  status: Status;
  detail: string;
  evidence?: string;
}

const ITEMS: Item[] = [
  {
    "label": "Hosted application release",
    "status": "VERIFIED",
    "detail": "Verified on 27 October 2026: Cloudflare version 519e4895-7cfe-4433-a27f-98e75b2124d3 was 100% Ready at noticevault.gnanasekaran-sekareee.workers.dev. This dated checkpoint is not a live health monitor.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/release-c-checkpoint.json"
  },
  {
    "label": "Synthetic browser lifecycle",
    "status": "VERIFIED",
    "detail": "The hosted demo completed provider claim, client refund and Closed state with zero outstanding liability and conservation accounting. Closed state persisted after reload. All amounts and actions were simulated.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/release-c-checkpoint.json"
  },
  {
    "label": "Authenticated workspace and documents",
    "status": "VERIFIED",
    "detail": "19 hosted assertions passed using synthetic test identities: authentication, nonce replay rejection, session restoration, workspace and immutable document creation, private access, interrupted requests, idempotent retries and user isolation. Browser sign-out also succeeded. This does not verify the owner wallet.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/release-c-checkpoint.json"
  },
  {
    "label": "Maintained application code checks",
    "status": "VERIFIED",
    "detail": "The 27 October release passed standard and type-aware lint, affected TypeScript checks, focused regressions, frontend build and Cloudflare bundle validation. Synthetic tests do not prove deployed financial contracts.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/"
  },
  {
    "label": "Deployed contracts and live operator configuration",
    "status": "BLOCKED",
    "detail": "The Arc Mainnet factory was verified on 29 October 2026 at 0x801c366eb4e07162fca1f260d78338a3433d81e2. Reviewed live operator configuration is still pending. Financial execution remains disabled, indexing is disabled, and hosted readiness returned 503 as expected. Adding an RPC credential does not establish deployment readiness.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/release-c-checkpoint.json"
  },
  {
    "label": "Owner wallet sign-in on the hosted origin",
    "status": "NOT_RUN",
    "detail": "No owner wallet signature has been requested on this workers.dev origin. The current hosted sign-in configuration is Arc Testnet (chain 5042002). Synthetic authentication checks are separate from owner-wallet acceptance.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/release-c-checkpoint.json"
  },
  {
    "label": "Mainnet financial acceptance",
    "status": "NOT_RUN",
    "detail": "No real mainnet agreement, payment, claim, refund or indexed transaction has been verified. This requires legitimate deployment evidence, reviewed configuration and separately authorized owner actions.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/release-c-checkpoint.json"
  },
  {
    "label": "Independent security review",
    "status": "NOT_RUN",
    "detail": "An independent security audit has not been completed. Code and synthetic regression checks are not an audit.",
    "evidence": "implementation-records/evidence/release-hygiene-2026-10-27/release-c-checkpoint.json"
  }
];

const STATUS_CONFIG: Record<Status, { icon: React.ReactNode; bg: string; text: string; label: string }> = {
  HISTORICAL: { icon: <Clock size={16}/>, bg: "bg-slate-50", text: "text-slate-600", label: "Historical only" },
  VERIFIED:             { icon: <CheckCircle size={16} className="text-green-600" />,  bg: "bg-green-50",  text: "text-green-700",  label: "Verified" },
  PARTIALLY_VERIFIED:   { icon: <AlertCircle size={16} className="text-blue-600" />,   bg: "bg-blue-50",   text: "text-blue-700",   label: "Partially verified" },
  BLOCKED:              { icon: <XCircle size={16} className="text-red-600" />,         bg: "bg-red-50",    text: "text-red-700",    label: "Blocked" },
  BLOCKED_INTEGRATION:  { icon: <XCircle size={16} className="text-orange-600" />,      bg: "bg-orange-50", text: "text-orange-700", label: "Blocked (integration)" },
  NOT_RUN:              { icon: <Clock size={16} className="text-slate-400" />,          bg: "bg-slate-50",  text: "text-slate-600",  label: "Not run" },
};

export function ReadinessChecklist({onOwner}:{onOwner:()=>void}) {
  const verified = ITEMS.filter(i => i.status === "VERIFIED").length;
  const blocked  = ITEMS.filter(i => i.status === "BLOCKED" || i.status === "BLOCKED_INTEGRATION").length;
  const notRun   = ITEMS.filter(i => i.status === "NOT_RUN").length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Release verification and live readiness</h1>
      <p className="text-sm text-slate-500 mb-6">
        Recorded checkpoint: 27 October 2026. Verified items describe the hosted demo and synthetic checks for the release below, not current uptime or live financial readiness. Real-chain blockers remain explicit.
      </p>

      <p className="mb-6"><button type="button" onClick={onOwner} className="inline-flex min-h-11 items-center rounded-lg border border-slate-500 px-4 py-2 font-semibold text-slate-900 underline focus-visible:outline focus-visible:outline-2">View deployment & readiness</button><span className="mt-2 block text-sm text-slate-600">Verified factory evidence and remaining activation requirements. No wallet connects automatically.</span></p>
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{verified}</div>
          <div className="text-xs text-green-600 font-medium mt-1">Verified</div>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
          <div className="text-2xl font-bold text-red-700">{blocked}</div>
          <div className="text-xs text-red-600 font-medium mt-1">Blocked</div>
        </div>
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-2xl font-bold text-slate-500">{notRun}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Not run</div>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-3">
        {ITEMS.map((item, i) => {
          const cfg = STATUS_CONFIG[item.status];
          return (
            <div key={i} className={`rounded-xl border p-4 ${cfg.bg}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{cfg.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-sm">{item.label}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white border ${cfg.text}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{item.detail}</p>
                  {item.evidence && (
                    <p className="text-xs text-slate-400 font-mono mt-1">{item.evidence}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
        <strong>Live financial execution remains disabled.</strong> The hosted demo and authenticated workspace are available for evaluation. Real funds require verified deployments, reviewed configuration, owner acceptance and independent security review.
      </div>
    </div>
  );
}

