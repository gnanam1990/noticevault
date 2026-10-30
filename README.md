# NoticeVault

A notice-period payment escrow system with a read-only mainnet overview, an explicit synthetic demo, and an authenticated workspace.

Built with [Arc Studio](https://studio.arc.io)

---

## What this app does

NoticeVault manages fixed-period service agreements with cryptographic payment escrow. It has four views:

- **Mainnet overview** — the default read-only view of the deployed Arc Mainnet factory. Public chain reads do not require a wallet and do not authorize transactions.
- **Synthetic demo** — an explicitly labelled simulation of accrual, cancellation, renewal and claims, with no real funds, wallet or blockchain calls. Financial values are computed by `@noticevault/domain`.
- **Workspace** — wallet account access, separate backend sign-in, draft authoring and review. Its network comes from validated backend configuration; connecting an account does not enable financial execution.
- **Advanced** — read-only deployment evidence and readiness requirements. This view does not submit deployments or enable transactions.

## Deployment versus source

Factory `0x801c366eb4e07162fca1f260d78338a3433d81e2` was deployed on Arc Mainnet (chain 5042) on 29 October 2026. The [deployment record](implementation-records/mainnet-factory-20261029.json) and [SDK deployment pins](packages/sdk/src/deployments.ts) describe the original deployed artifact.

Repository contract source includes post-deployment revisions. Compiling the current source does **not** establish that its bytecode matches the existing factory. No replacement contract has been deployed; using revised contracts requires separate review and an owner-authorized deployment. Financial execution and indexing remain disabled.

## Tech stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Domain logic: `@noticevault/domain` (TypeScript, bigint-safe money model)
- Wallet: injected providers (MetaMask etc.), EIP-6963 discovery, no WalletConnect
- Authentication: SIWE-style message signing, HttpOnly session cookie
- Contracts: Solidity 0.8.28, Foundry (`contracts/`)
- Chains: Arc Mainnet (5042) for public factory reads; the workspace network comes from validated backend configuration.

## Development

### Prerequisites

- Bun (see `.bun-version`)
- Foundry (see `.foundry-version`) for contract work

### Install

```bash
bun install
```

### Run

```bash
bun run dev
```

### Test

```bash
# Frontend (vitest — demo + backend unit tests)
bun run demo:test

# Domain model
bun run domain:test

# SDK
bun run sdk:test

# DB (requires Postgres — see docker-compose.yml)
bun run db:test

# API (requires Postgres — see docker-compose.yml)
bun run api:test

# Contracts (Foundry)
bun run contracts:test
```

### Build

```bash
bunx vite build
```

### Typecheck + lint

```bash
bun run check
```

## Environment variables

The code reads no user-supplied environment variables for the frontend. Backend configuration (database, API keys) is handled by `apps/api`; see `apps/api/src/config.ts`.

The following are provisioned by Arc Studio and are optional outside it:

- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` — RPC proxy for backend/indexer use (optional outside Arc Studio)

## Security

A security review dossier is at `docs/security-review.md`. Key open items:

- The workers.dev MetaMask phishing warning is **unresolved**. Do not deploy publicly until resolved.
- The served bytes at the workers.dev URL are not verified from this environment (403 from sandbox).
- `@noticevault/worker` is built and deployed externally; its deployed state is not audited here.

Public deployment is a separate, pending step requiring independent review.
