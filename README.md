# Meshwork

Independent compute, coordinated by Astra.

Submit a workload and constraints. Astra selects an eligible provider; the control plane manages placement, health, routing, and recovery.

This prototype has a working control plane and measured CPU verification for real provider agents. OCI execution, compute-task results, GPU performance, and payments remain simulated.

## Run

```sh
npm start
```

Open http://127.0.0.1:3000. No dependencies or build step.

Node 22 is recommended. Node 18 can run the application with shell environment variables; loading a local `.env` requires Node's native `process.loadEnvFile` support.

In another terminal:

```sh
npm run provider
```

The agent registers OS and optional NVIDIA telemetry, solves a fresh computation challenge, and sends heartbeats. Select its card to inspect the measured round trip, result status, and expiry. Stop the agent to observe heartbeat loss.

`MESHWORK_URL` selects the control-plane URL. The previous `ASTRAGRID_URL` variable remains accepted for existing setups. The workspace directory has not been renamed.

## Provider verification

Real agents receive an authenticated PBKDF2-SHA256 challenge with a random nonce and salt, 120,000 iterations, and a five-second deadline.

The control plane independently computes the expected result and records elapsed time using a monotonic clock. Timing covers challenge delivery, provider execution, and return transport; it is not GPU latency or workload throughput. Provider-supplied timing is ignored.

- Challenges are bound to a provider and consumed once.
- Invalid answers, missed deadlines, stale evidence, and missing credentials fail closed.
- Fetching the same pending challenge does not restart its deadline.
- Agents receive a new challenge after 30 seconds; successful evidence expires after 60 seconds.
- Verification failure revokes an active lease and invokes the existing recovery path.
- Nonces, salts, and authentication tokens are omitted from public snapshots and exports.
- There are no generated trust percentages.

A passing challenge establishes a correct response to fresh computation within an observed interval. It does **not** prove CPU/GPU identity, available VRAM, execution location, workload performance, or confidentiality. A provider may forward the work elsewhere.

GPU workloads on real agents remain ineligible until a separate GPU workload benchmark is implemented. A CPU challenge cannot qualify a claimed RTX 5090. Hardware descriptions remain self-reported.

The built-in providers are explicitly marked **SIMULATED** and have no measured verification results. They exist to exercise the original deployment/failover scenario; they are not real offers of capacity.

## Scheduling and Astra

Hard constraints enforce heartbeat freshness, verification state, architecture, accelerator, declared memory/CUDA requirements, and price/latency ceilings. Real CPU agents require unexpired computation evidence. GPU agents require additional workload evidence that this version does not yet provide.

Eligible candidates are ranked by price and synthetic latency:

| Objective | Price | Latency |
|---|---:|---:|
| Balanced | 50% | 50% |
| Lowest cost | 90% | 10% |
| Lowest latency | 10% | 90% |

The optional Astra adapter receives evidence labels alongside candidates. Its choice is revalidated before placement. The UI distinguishes a successful model decision from deterministic fallback.

To configure the existing adapter on Node 22, copy `.env.example` to `.env` and set `SCHEDULER_MODE=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL` to the model available to your account. Credentials stay on the server. This adapter targets the OpenAI Responses endpoint; a live model call has not been verified in this workspace.

## Checks

```sh
npm test
npm run verify:smoke
```

The verification smoke check starts an isolated HTTP server and a real provider process, verifies its computation, submits an incorrect answer from another provider, stops the real agent, and checks heartbeat expiry. It closes its server and child process afterward.

The test suite covers challenge replay, wrong answers, cross-provider submissions, deadlines, expiry, reset races, credentials, GPU eligibility, scheduling, accounting, HTTP, and SSE.

With the application running, `npm run smoke` runs the original guided simulation over HTTP. **It resets that server's current demo.** Use an isolated server when preserving another session.

Historical browser and test reports in `qa/` describe the earlier prototype. They are not evidence of current visual verification.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state` | Public network snapshot |
| GET | `/api/events` | Live SSE snapshots |
| GET | `/api/export` | Audit and demo-ledger export |
| POST | `/api/providers` | Register an agent or simulated provider |
| POST | `/api/providers/:id/heartbeat` | Authenticated telemetry; returns a challenge when due |
| POST | `/api/providers/:id/challenge` | Obtain the pending challenge with provider credentials |
| POST | `/api/providers/:id/verify` | Submit `challengeId` and hexadecimal `digest` |
| POST | `/api/workloads` | Submit a declared workload manifest |
| POST | `/api/compute` | Run a canned compute task while the simulated runtime is healthy |
| POST | `/api/workload/stop` | Stop the workload |
| POST | `/api/workload/retry` | Retry blocked placement |
| POST | `/api/demo/start` | Reset and run the guided simulation |
| POST | `/api/demo/reset` | Clear in-memory state |

Provider challenge, verification, and heartbeat requests require the registration token as a bearer credential. The remaining control-plane writes do not have user authentication. Run locally; this is not a public marketplace deployment.

## Implementation boundaries

- One active workload, one control-plane process, in-memory state.
- OCI image references are validated but never pulled or executed.
- Provider agents execute only the fixed computation challenge; they do not accept remote commands.
- Compute tasks return a server fixture, including when a real agent is selected.
- Runtime health and accounting receipts remain simulated. Heartbeats do not prove useful GPU service.
- Failover restarts the simulated service. In-flight requests are not replayed.
- Accounting uses integer demo balances; no actual escrow, payout, or payment integration.
- `examples/sandbox-profile.json` describes future isolation policy; it is not enforced.

## Source

`server/engine.mjs` owns provider state, verification lifecycle, leases, and recovery. `server/scheduler.mjs` validates eligibility and contains the optional Astra adapter. `shared/challenge.mjs` defines the fixed challenge supported by both server and agent. `scripts/provider-agent.mjs` collects telemetry and performs challenges. `public/` contains the dependency-free UI.

The next core milestone is actual provider-side container execution, workload-specific benchmarks, and Astra-directed recovery between running services.
