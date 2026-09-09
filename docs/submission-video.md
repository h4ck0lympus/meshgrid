# Meshwork · 60-second submission video

## Pitch

Meshwork turns independent compute into a usable service. Bring a workload and your constraints. Astra selects an eligible provider, Meshwork monitors availability, and when that provider disappears, the workload recovers elsewhere.

## Recording script — current build

| Time | Screen / action | Narration |
|---|---|---|
| 0–9s | Main screen. Keep the workload form and placement panel visible. | “Meshwork turns independent computers into a usable compute service. Bring a workload, set your limits, and let the network find it a home.” |
| 9–17s | Point to the image reference, maximum rate, and hardware requirements. | “This workload needs compatible hardware at an acceptable price. Meshwork checks those constraints before assigning a provider.” |
| 17–27s | Click **Watch failover demo**. Show the assignment and concise decision. | “One node joins. The scheduler selects an eligible provider, and the deployment becomes healthy. This is our running control plane, using simulated machines and execution.” |
| 27–37s | Leave the screen on the running placement. The demo disconnects its provider automatically. | “Now the provider disappears. Meshwork detects the missing heartbeat and revokes its old assignment.” |
| 37–47s | Show the recovery state, then the replacement node. | “It chooses another compatible node and restarts the workload. The endpoint stays the same. New requests work again after recovery.” |
| 47–55s | Open **Placement decision**. If configured, show a successful live model decision. | “Astra's placement adapter is integrated; this offline recording uses deterministic scheduling. Recovery and eligibility checks are enforced by the backend.” |
| 55–60s | Return to recovered placement; briefly show the repository or test output. | “Our goal: make independent compute dependable. The implementation and reproducible tests are in the repository.” |

Approximately 145 words. Rehearse against the actual transitions; the guided flow takes about 25 seconds in offline mode. Begin it near 17 seconds. Timing may vary with live model calls.

## If live Astra is configured and verified

Replace the 47–55s narration with: “Astra selected this provider from the eligible shortlist and explained the tradeoff. It makes another selection during recovery; the backend validates both decisions.”

Use this wording only when the recording shows a successful model decision, rather than fallback. Do not claim tool-driven decomposition, runtime conversion, measured GPU inference, or model execution on providers: those features are not implemented.

## Development criterion

Capture the actual Astra development session and the passing test command as supporting footage. A truthful alternative for the final segment is: “We used Astra to develop the control plane, verification checks, and recovery tests. The implementation is in our repository.” Use this only if the model used in those sessions is confirmed to be Astra.

## What the demo proves

One declared workload is assigned to one eligible provider. A server-owned watchdog detects failure, fences the previous lease, selects a replacement, and restores the simulated service. There is downtime during recovery; it does not continue an interrupted generation or split a task into parallel jobs.

Provider CPU computation challenges are real and separately testable with `npm run verify:smoke`. They do not authenticate an RTX model or establish GPU performance. Accounting remains secondary and uses demo balances.

## Before recording

- Refresh the local app and close unrelated windows.
- Use **How the demo works** to rehearse, then close the explanation.
- Keep advanced requirements and **Details & activity** collapsed until needed.
- Confirm whether the footer shows offline scheduling or a successful live Astra decision.
- Use the current build's disclosure language; avoid saying arbitrary Docker images execute today.
- Reserve time to upload the video and repository link. Do not fabricate or backdate commits.
