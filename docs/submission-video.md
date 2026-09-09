# AstraGrid · one-minute hackathon demo

## The sentence to land

> A consumer submits a compute-intensive OCI workload, AstraGrid finds affordable compatible capacity, and when that machine disappears, the control plane safely reroutes the workload.

Call it a compute network or compute orchestration platform—not an inference playground and not merely a GPU marketplace.

## Exact 60-second cut

Record the story as short clips so a missed click cannot ruin the whole take.

| Time | Screen and operator action | Voiceover cue |
|---|---|---|
| 00:00–00:06 | Hero: **Compute that finds itself.** Slow push toward the OCI card. | Idle compute becomes one resilient, budget-aware network. |
| 00:06–00:11 | Show the image field and Cheapest / Balanced / Fastest. | One image, one objective—no infrastructure shopping list. |
| 00:11–00:14 | Click **Run the live demo**. | The planner reads the declared workload. |
| 00:14–00:19 | Hold on Inspecting and Matching. | It filters incompatible machines and ranks viable providers. |
| 00:19–00:24 | Briefly open **Placement race**, then close it. | The backend validates the deterministic decision. |
| 00:24–00:29 | Show the healthy route and moving packet lights. | A fenced lease activates and the route is healthy. |
| 00:29–00:34 | Active node turns red: **SIGNAL LOST**. | The provider disappears. |
| 00:34–00:39 | Show **REORCHESTRATING** and the broken edge. | Heartbeat expires, billing pauses, and the stale lease is revoked. |
| 00:39–00:44 | Candidates light up; replacement becomes **SERVING**. | Same intent and endpoint, new compatible provider. |
| 00:44–00:49 | Click **Run** in Compute task. Keep **SIMULATED RESULT** visible. | The result is simulated; the recovery path is real. |
| 00:49–00:57 | Open **Simulation boundaries**. | Name exactly what works and what remains simulated. |
| 00:57–01:00 | Clean logo card: **COMPUTE THAT FINDS ITSELF.** | Say the product name and tagline. |

## Voiceover

Use the exact text in [voiceover.txt](./voiceover.txt). It is intentionally honest about the current build and leaves room for natural pauses.

## Fast live-demo runbook

1. Start the app with `npm start` and open `http://localhost:3000/`.
2. Refresh once so the hero is visible and the state is clean.
3. Say: “One OCI image. One objective.” Point to **Balanced**.
4. Click **Run the live demo**. Do not touch anything while inspection and placement animate.
5. When the route is healthy, click **Placement race** for two seconds, then close it.
6. Let the guided demo disconnect the active provider. Stop speaking briefly when the node turns red.
7. When the replacement node becomes healthy, scroll to **Compute task** and click **Run**.
8. Finish on **Simulation boundaries**, then say the tagline.

The guided backend sequence takes about 23 seconds after the click: initial placement is healthy around 7–8 seconds, failure begins roughly 7 seconds later, and recovery completes about 5–6 seconds after detection.

## Judge-safe claims

Working now:

- Control-plane APIs and state transitions
- Compatibility filtering and deterministic placement
- Heartbeat-driven failure detection
- Fenced leases, failover, and recovery
- Demo accounting invariants and reserve return
- Fresh CPU computation challenges for provider agents

Simulated or planned:

- OCI/container execution and gVisor isolation
- GPU identity and performance proof
- Physical model or workload migration
- Compute-task output, provider prices, and payments
- Zero-downtime streaming

Say “reroutes and restarts” rather than “live-migrates.” Say “same endpoint after recovery” rather than “zero downtime.”

## Backup if the live click fails

- Refresh the page and click **Replay the experience**.
- Keep the pre-rendered video open in a second tab.
- If the UI is unavailable, run `npm test` and state that 47 backend tests cover placement, heartbeat failure, lease fencing, accounting, and verification.
- Never hide the **SIMULATED** labels for the recording.

## Capture checklist

- Browser zoom at 100%; notifications and unrelated tabs closed
- 1920×1080 canvas, 30 or 60 fps
- Cursor visible only for meaningful actions
- Voice around -16 LUFS, music at least 12 dB quieter
- Export H.264/AAC with web fast-start enabled
- Watch the final export once with sound before upload
