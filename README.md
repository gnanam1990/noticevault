# NoticeVault

**USDC retainers with a funded notice period, explicit terms, and on-chain settlement.**

NoticeVault is built for a client and service provider who want a predictable way to fund ongoing work and end an engagement. Instead of relying only on an invoice or an informal cancellation promise, an agreement records the payment period, notice period, recipient and document hash, and escrows the funds that support those terms.

This is a hackathon project built in [Arc Studio](https://studio.arc.io/app/8b22b71c-4375-4068-b54a-81efc5fa6c4f). An original factory is deployed on Arc Mainnet. Revised contract source exists and an updated read-only application is deployed; neither establishes a completed real-USDC application flow or changes the original contract bytecode.

## Project links

| Resource | Link and meaning |
| --- | --- |
| Public application | [NoticeVault](https://noticevault.gnanasekaran-sekareee.workers.dev) — updated read-only release, with live mainnet reads verified in Chrome |
| Source | [gnanam1990/noticevault](https://github.com/gnanam1990/noticevault) |
| Canonical Studio project | [Open Arc Studio project](https://studio.arc.io/app/8b22b71c-4375-4068-b54a-81efc5fa6c4f) — access depends on Studio sharing permissions |
| Original factory | [View contract address](https://explorer.arc.io/address/0x801c366eb4e07162fca1f260d78338a3433d81e2) |
| Original deployment | [View transaction](https://explorer.arc.io/tx/0x62848dfbdb4fe5ff6c4e0dfbc0ae94fd29808489dcf9aa48377784568cb6c0c3) |
| Public verification record | [Original factory evidence](implementation-records/mainnet-factory-20261029.json) |
| Publication boundaries | [Public export scope](https://github.com/gnanam1990/noticevault/blob/79be61a15be6b85a80558ee2da201aa18d1d7885/PUBLIC-EXPORT-SCOPE.md) |
| Walkthrough video | Not yet published; no completed financial-flow video is claimed |

## Verified status — 30 October 2026

| Layer | What is established | What remains |
| --- | --- | --- |
| Original mainnet factory | Deployment receipt, creation data, runtime bytecode and constructor values were checked on 29 October | This address does not contain later contract source revisions |
| Public source | Latest verified published baseline: [79be61a](https://github.com/gnanam1990/noticevault/commit/79be61a15be6b85a80558ee2da201aa18d1d7885) | Subsequent canonical changes, including this README and release profile, await the next source publication |
| Updated application | Read-only mainnet release built, checked and deployed from Studio | Cloudflare version 89563a24-ccfa-4423-ad44-106ac1974004 deployed successfully; Chrome loaded the expected assets and live mainnet data; direct HTTP hash verification remains blocked by 403 responses |
| Wallet / workspace | Live Workspace reports Arc Mainnet (5042) and the recorded original factory; account connection and draft/review paths exist in source | Public-site wallet warning remains unresolved; no warning bypass is permitted |
| Financial execution | Explicit execution and operator gates remain off | Corrected contract decision, owner-signed deployment if required, configured runtime and a limited real-USDC acceptance flow |
| Indexing / scheduling | Source includes bounded indexing work | Hosted indexing and cron remain off; production catch-up is not claimed |

A deployed factory proves deployment. It does not prove that the latest website is served, that revised source matches that factory, or that a client/provider transaction flow has completed. The read-only release is an intermediate milestone toward a working mainnet submission.

## Why this exists

Freelancers, maintainers and other recurring service providers need clarity about two things: whether the next period is funded, and what happens when the client ends the engagement. Clients also need transparent terms, a defined cancellation process and a way to recover amounts that are refundable under those terms.

NoticeVault combines a prefunded period with a notice reserve. Both parties can inspect the same immutable agreement terms and on-chain accounting. The contract handles the agreed payment mechanics; it does not determine whether off-chain work was satisfactory, resolve disputes, or make a document hash a legal ruling.

### Example model

Let **A** be the payment per period, **P** the period duration, and **N** the notice duration. The notice reserve is **R = ceil(A × N / P)**, calculated in integer token units. Initial funding is **A + R**; a renewal funds the next **A**, subject to the agreement state and capacity checks.

USDC uses six decimal places in this deployment. Amounts are represented as integer base units, not floating-point currency values. For illustration, A = 0.10 USDC, P = 30 days and N = 7 days gives R = 0.023334 USDC and initial funding of 0.123334 USDC. This arithmetic example is not a recorded transaction or an invitation to deposit.

## Deployed read-only application release

Cloudflare deployment on 30 October 2026 completed as version **89563a24-ccfa-4423-ad44-106ac1974004**. The existing Worker, API/indexer Durable Object bindings and asset binding were retained. Runtime identity is ARC_MAINNET; INDEXER_ENABLED remains false and no cron was activated. This deployment did not deploy a contract or enable financial execution.

Chrome loaded `app-DlDWRmZO.js` and `app-_cVZjNTH.css` from the public site. At 13:20:57 UTC, its mainnet view reported matching contract code/identity, factory liability 0 USDC, caps 10/1 USDC, and block 28,652,814. The Workspace subsequently reported Arc Mainnet (5042), deployment recorded and gates closed. These are timestamped observations, not permanent balance claims. No wallet connection, authentication signature or transaction was requested during this check.

The prepared Worker SHA256 is `217be4b78318cdf0bf8b2a4d334369bf431748a358bde66c3a32962444f34c38`; the asset-manifest SHA256 is `91212696e416c7341bdee168b3065343e25c948ca2199b4ef30c91dc5b7824e7`. Build and upload checks passed. Direct HTTP requests from both Studio and the local command-line client returned 403 for the three public assets, so a complete independent served-byte comparison is not claimed. Browser rendering success does not erase that limitation.

## User journeys

### Inspect without a wallet

The mainnet overview is the default entry in the deployed read-only release. It shows the original factory and verification evidence. Public reads do not request a signature or authorize a transaction. Missing or unavailable data is reported as unavailable rather than replaced by sample balances.

The synthetic demo is a separate, explicitly labelled simulation. Its accrual, renewal, notice and settlement examples use the domain model without real funds or blockchain calls. The Workspace offers account access, separate backend sign-in, and agreement draft/review screens. Advanced contains deployment and readiness details.

### Create and fund an agreement

The following diagram describes the implemented source workflow and intended enabled product path. The public release currently stops before financial execution.

~~~mermaid
flowchart LR
  A[Connect selected wallet] --> B[Sign in to workspace]
  B --> C[Draft client, provider, amount and timing]
  C --> D[Review document hash and exact terms]
  D --> E[Provider accepts bound terms]
  E --> F[Client reviews exact token approval and funding]
  F --> G[Owner-controlled wallet confirmation]
  G --> H[Verify receipt and indexed agreement]
~~~

Connecting an account, signing an authentication message, approving tokens and funding a contract are separate actions. The review path binds token approval to the authenticated draft and its exact required funding. A changed account, network, provider or draft requires renewed validation. An unresolved or submitted transaction is reconciled before another attempt; an uncertain outcome is not treated as permission to send again.

### Maintain or end an agreement

~~~mermaid
flowchart TD
  A[Funded agreement] --> B{Continue service?}
  B -->|Renew before deadline| C[Review and fund next period]
  C --> A
  B -->|Client gives notice| D[Notice period]
  B -->|Funding deadline passes| E[Derived overdue notice]
  E --> D
  A --> F[Claim earned amount to fixed provider]
  D --> G[End and settle under agreement terms]
  G --> H[Provider claims earned amount]
  G --> I[Client claims refundable amount]
~~~

The source exposes separate renewal, start-notice, provider-claim and client-refund operations. Permissionless settlement calls pay the immutable beneficiary; callers do not choose a replacement payout recipient. Renewal eligibility and claim/refund amounts come from the agreement state, not a UI promise.

## Architecture

~~~mermaid
flowchart TB
  UI[React / Vite application] --> DOMAIN[Bigint domain calculations]
  UI --> SDK[SDK identity checks and transaction preparation]
  UI --> API[Authenticated Fastify API]
  UI --> WALLET[Selected EIP-6963 wallet provider]
  WALLET --> CHAIN[Arc contracts]
  SDK --> READ[Read-only chain verification]
  READ --> CHAIN
  API --> DB[PostgreSQL drafts, sessions and attempts]
  INDEX[Indexer source - hosted scheduling disabled] --> CHAIN
  INDEX --> DB
  CF[Cloudflare Worker / Durable Objects / static assets] --> API
  CF --> UI
~~~

| Path | Responsibility |
| --- | --- |
| `src/` | Application, mainnet evidence, workspace and explicitly simulated views |
| `packages/domain/` | Integer money calculations and lifecycle model |
| `packages/sdk/` | Deployment identity pins, reads, verification and transaction preparation |
| `packages/db/` | PostgreSQL schema, persisted state and attempt coordination |
| `apps/api/` | Authentication, draft/review endpoints and execution boundaries |
| `apps/cloudflare/` | Hosted Worker composition and release configuration |
| `contracts/src/` | Factory, agreement and Solidity math source |
| `contracts/test/` | Available contract tests |
| `implementation-records/` | Historical implementation records and public deployment evidence |

The frontend uses React 18, TypeScript, Vite and Tailwind CSS. The SDK uses viem. The backend uses Fastify and PostgreSQL; contracts use Solidity 0.8.28 and Foundry. Wallet discovery uses EIP-6963 injected providers. No wallet seed or private key is required by the frontend setup.

## Original mainnet deployment

| Item | Verified original deployment |
| --- | --- |
| Chain | Arc Mainnet, chain ID **5042** |
| Factory | ``0x801c366eb4e07162fca1f260d78338a3433d81e2`` |
| Token | [USDC, 0x3600000000000000000000000000000000000000](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) |
| Token decimals | 6 |
| Guardian | ``0xFf525D6940Ad0e308ed6eda443c792694353F9Da`` |
| Inclusion block / sender nonce | 28,477,599 / 47 |
| Factory cap | 10,000,000 base units = **10 USDC** |
| Agreement cap | 1,000,000 base units = **1 USDC** |
| Factory runtime code hash | ``0x2bf50890f25141984a000a767b15b665cad108a64416422a2de3179d976b1006`` |
| Token runtime code hash | ``0xc9987bd3af6b26a030951faa7eacc017b68343aeedf3ce5fe68f821c4b93939d`` |

The recorded verification used one read-only RPC provider. It is not a claim of paired-provider runtime activation or explorer source verification. [SDK deployment pins](packages/sdk/src/deployments.ts) continue to identify this original artifact.

Agreement participants, token and economic terms are immutable. The guardian can pause new agreement creation; the source does not give the guardian a general right to redirect payouts. The existing contracts have no upgrade path that installs repository changes into the deployed address. A revised contract needs a separately reviewed deployment, a fresh owner-signed transaction, receipt/runtime verification and an explicit application pin update.

The low caps are deliberate pilot bounds on outstanding liabilities, not a statement of production throughput or a deposit recommendation. Capacity can constrain renewals. The choice between a restricted pilot and revised renewal-capacity semantics is still pending; caps have not been silently increased.

## Run the public source locally

Use [Bun](https://bun.sh) **1.3.14** (see [.bun-version](.bun-version)). Contract work additionally uses [Foundry](https://getfoundry.sh) **v1.7.1** (see [.foundry-version](.foundry-version)). PostgreSQL and Docker are only needed for backend/database integration work. Install tools from their official distributions.

~~~bash
git clone https://github.com/gnanam1990/noticevault.git
cd noticevault
bun install --frozen-lockfile
bun run dev
~~~

Open the Vite URL printed by the command. This starts the frontend, not a mainnet deployment or an enabled transaction service. The read-only mainnet view may depend on available public RPC access; workspace calls require a separately configured API. Synthetic mode remains labelled.

~~~bash
# Frontend typecheck and production bundle
bun run typecheck
bunx vite build

# Available unit suites
bun run domain:test
bun run demo:test
bun run sdk:test
bun run db:test

# Solidity compilation and tests, with Foundry installed
bun run contracts:build
bun run contracts:test
~~~

For API integration, inspect [the runtime configuration parser](apps/api/src/config.ts) and [Docker Compose](docker-compose.yml) before starting a dedicated development database. Local startup requires explicit database, session, origin and network settings. Use your own local values; never reuse hosted secrets or put credentials in frontend VITE variables. [env.example.txt](env.example.txt) is reference documentation, not a complete production configuration or authorization switch.

~~~bash
# Check the explicitly configured local workspace environment
bun run dev:check
# After configuring the dedicated local database and API prerequisites
bun run dev:workspace
# API suite requires its documented local PostgreSQL prerequisites
bun run api:test
~~~

The workspace helper currently restricts authenticated local startup to ARC_TESTNET and a designated local development database. It does not enable a mainnet runtime. Its configuration check does not prove database connectivity, migrations or browser acceptance. For public code review, frontend builds and unit suites are the first reproducible entry points.

The public repository is a scoped export of the canonical project. Private environment files, operational helpers, reports and certain regressions are intentionally excluded. Some historical package scripts therefore reference unavailable tools: do not use `deploy:self` or `fetch:abi` as public setup steps. Consult the linked public export scope; do not fetch private material to make an omitted operational command work.

## Validation already recorded

These are existing canonical-source results, reused rather than rerun for this documentation edit:

| Scope | Recorded result |
| --- | --- |
| Previous affected application group | 475 frontend, 253 SDK, 471 API and 12 Cloudflare tests passed; associated typechecks/build passed |
| Contract source revisions | 90 Solidity tests passed, including 19 consent tests |
| Prepared read-only release | Five focused real-data UI checks, root and Cloudflare typechecks, Vite release build and Wrangler dry run passed |
| Release content | Credential scan of the selected release files passed; owner deployment page excluded from public assets; source/deployment distinction and execution-disabled copy retained |

These totals are not an assertion that every test is included in the public export or that the latest public checkout has undergone a new complete test run. There is no configured GitHub CI run to cite. Native Windows validation, production PostgreSQL concurrency proof, public served-byte verification and an owner-signed real-USDC end-to-end flow are not claimed.

Known source improvements cover draft-bound approvals, selected-wallet continuity, request validation/error handling, normalized attempt resources, deployment identity checks and trusted hosted rate-limit boundaries. This is a description of source work, not public audit certification. Private review material and exploit-specific regression details are not part of this README.

## Judge evaluation path

1. Inspect the original factory transaction and public verification record. Check chain, token, caps and the distinction between original bytecode and revised source.
2. Open the public app and inspect Mainnet overview. The verified browser session loaded the expected release assets and read chain data; full independent served-byte hashing remains unconfirmed.
3. Build the public source and inspect its default mainnet overview. Explore the separately labelled simulation to understand the lifecycle without funds.
4. Review the Workspace flow: account access, separate authentication, draft terms and explicit financial review. Execution is unavailable until the runtime prerequisites are satisfied.
5. Follow the factory/agreement source and SDK pins. Read the test results with the public-export limitations above.
6. After the final release, use the recorded served-version evidence and owner-approved low-value transaction receipts to evaluate the real flow. Those receipts and the walkthrough video are still pending; none are fabricated here.

If a wallet or browser flags the site, stop. Do not bypass its warning. Account connection alone does not sign a message, grant token allowance or transfer USDC.

## Remaining release work

- Complete independent served-byte verification when direct public asset reads are available; do not treat the recorded 403 responses as resolved.
- Resolve the renewal-capacity design choice and finish the corresponding finite contract work before any corrected-factory deployment.
- Have the owner review and sign any new deployment; verify the new receipt and runtime before changing application pins.
- Complete required runtime/data integration and a deliberately limited owner-signed USDC flow, with current warnings and transaction outcomes handled truthfully.
- Publish the final canonical source delta, update this status/evidence section, add the walkthrough video and run one final integrated acceptance check.

The goal is a demonstrable mainnet hackathon product. This document does not present the intermediate read-only release as that completed product.
