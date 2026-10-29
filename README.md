# NoticeVault

A notice-period payment escrow system with a synthetic demo, backend workspace, and owner deployment preparation panel.

Built with [Arc Studio](https://studio.arc.io)

---

## What this app does

NoticeVault manages fixed-period service agreements with cryptographic payment escrow. It has three distinct panels:

- **Synthetic demo** — exercises the full domain model (accrual, cancellation, renewal, claims) with no real funds, no wallet, and no blockchain calls. All financial values are computed by `@noticevault/domain`.
- **Workspace (testnet)** — backend sign-in on Arc Testnet (chain 5042002). Requires an injected wallet. Supports draft authoring and review. Contract deployment and financial execution gates are closed until a factory is deployed.
- **Owner deployment** — deployment bundle preparation for Arc Mainnet (chain 5042). Separate configuration from the testnet workspace; testnet authentication does not imply mainnet readiness.

## Tech stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Domain logic: `@noticevault/domain` (TypeScript, bigint-safe money model)
- Wallet: injected providers (MetaMask etc.), EIP-6963 discovery, no WalletConnect
- Authentication: SIWE-style message signing, HttpOnly session cookie
- Contracts: Solidity 0.8.28, Foundry (`contracts/`)
- Chains: Arc Testnet (5042002) for workspace auth; Arc Mainnet (5042) for owner deployment preparation

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
