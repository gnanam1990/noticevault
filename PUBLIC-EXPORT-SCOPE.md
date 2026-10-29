# Public export scope

This repository is a scoped publication of the Arc Studio canonical source. Product source is preserved; this note describes export omissions, not changes to application behavior.

## Included

Application, contracts, SDK, required shared API preflight/handoff modules, integrated wallet/deployment/recovery source, tests, and public deployment evidence. Publishing transaction-capable source does not execute transactions or enable disabled operator, execution, or indexer configuration. Existing simulation and wallet-warning labels remain truthful and unchanged.

## Omitted intentionally

Private environment files, credentials and private artifacts are not part of this export. The following canonical paths are also excluded by owner-approved publication scope:

- `AGENTS.md`
- `apps/cloudflare/README.md`
- `apps/cloudflare/SETUP-APPROVAL.md`
- `apps/cloudflare/deploy-hosted.ts`
- `apps/recovery/README.md`
- `contracts/script/DeployCreate2.s.sol`
- `contracts/script/DeployNoticeVaultLocal.s.sol`
- `docs/ARC-SUBMISSION-WALKTHROUGH.md`
- `docs/COMPLETION-INVENTORY-2026-10-23.md`
- `docs/COMPLETION-REPORT-2026-10-23.md`
- `docs/DEPLOYMENT-MANIFEST.md`
- `docs/DEV-STARTUP.md`
- `docs/HANDOFF.md`
- `docs/OPERATIONS.md`
- `docs/OPERATOR-APPROVAL-STARTUP.md`
- `docs/OPERATOR-RPC-ENDPOINTS.md`
- `docs/ORIGINAL-SPEC-COMPLETION-AUDIT-2026-10-24.md`
- `docs/RECOVERED-SPEC-INVENTORY-2026-10-24.md`
- `docs/RELEASE-PLAN.md`
- `docs/V1-COMPATIBILITY.md`
- `docs/WORKER-STARTUP.md`
- `docs/security-review.md`
- `scripts/fetch-abi.ts`
- `scripts/ops/backup.mjs`
- `scripts/ops/deployment-plan.template.json`
- `scripts/ops/diagnostics.mjs`
- `scripts/ops/operations.test.mjs`
- `scripts/ops/stage-public.mjs`
- `scripts/owner-deploy/README.md`
- `scripts/owner-deploy/app.mjs`
- `scripts/owner-deploy/artifact.json`
- `scripts/owner-deploy/build.mjs`
- `scripts/owner-deploy/core.mjs`
- `scripts/owner-deploy/core.test.mjs`
- `scripts/owner-deploy/index.html`
- `scripts/owner-deploy/style.css`
- `scripts/self-deploy.ts`
- `specs/prompts/00-intake.md`
- `specs/prompts/01-money-model.md`
- `specs/prompts/02-contracts.md`
- `specs/prompts/03-sdk-verifier.md`
- `specs/prompts/04-api-db.md`
- `tests/integration/operations-postgres.ts`

## Unavailable commands and references

- `bun run fetch:abi` is unavailable because the standalone ABI retrieval helper is omitted. Internal operational, release, setup, recovery-procedure and agent/prompt documentation is omitted; historical cross-references may therefore point to unavailable documents.

- `bun run deploy:self` remains in the canonical package scripts but its standalone implementation is intentionally absent; it is unavailable in this public export.
- Private operational documentation (`docs/OPERATIONS.md`), backup, restore and diagnostics tooling are omitted and unavailable here.
- Standalone hosted secret-upload/deployment and Foundry deployment helper commands are not supplied. Integrated app source is retained for review and build dependency integrity; it is not authorization to execute a deployment.
- References in README, AGENTS, release planning and historical audits to the internal security dossier or omitted deployment fixtures are historical references. The private dossier is not included and is not an independent public audit.

## Validation limits

Historical test totals in canonical documentation are not a claim that this scoped export has passed a fresh complete test run. Hash verification establishes source integrity, not security certification, successful deployment, live USDC execution, or production readiness. Removed operational-tool tests are intentionally absent with their implementations. Reviewers should run the available build and tests and record their own results.
