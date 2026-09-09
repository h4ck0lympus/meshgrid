# Copy-paste prompt for GPT Astra or a video editor

Attach the AstraGrid screen recording or supplied screenshots, then paste everything below.

```text
You are a senior product-film editor, motion designer, and voice director.

Create an EXACTLY 60-second, 1920×1080, 30 fps hackathon product video for AstraGrid using only the screen recordings, logo, screenshots, and test footage I attach.

Do not invent product screens, terminal output, hardware footage, or functionality absent from the assets. You may add restrained typography, crops, highlights, transitions, sound design, and a clean branded end card.

PRODUCT
AstraGrid accepts a Docker/OCI workload plus an objective or desired SLO, finds compatible independent compute, monitors the provider through a centralized control plane, and reroutes after failure. It is a compute orchestration platform for models and other compute-intensive jobs—not an inference playground and not merely a GPU marketplace.

STORY
00:00–00:06 — Hero: “Compute that finds itself.” Slow push toward the workload card.
00:06–00:11 — Show OCI image and Cheapest / Balanced / Fastest choices.
00:11–00:14 — Show the click on “Run the live demo.”
00:14–00:19 — Show inspection, compatibility filtering, and provider matching.
00:19–00:24 — Show Placement race and both viable and rejected machines.
00:24–00:29 — Show the selected provider, healthy route, and moving traffic.
00:29–00:34 — Show the active provider turn red with SIGNAL LOST.
00:34–00:39 — Hold on REORCHESTRATING, the broken connection, and Astra activity.
00:39–00:44 — Show a different provider become SERVING and the route return to healthy.
00:44–00:49 — Show Compute task, click Run, and keep SIMULATED RESULT readable.
00:49–00:57 — Open Simulation boundaries and show WORKING NOW beside SIMULATED.
00:57–01:00 — End on the AstraGrid logo with “COMPUTE THAT FINDS ITSELF.”

TRUTH LOCK
Working in the prototype:
- Control-plane API and state
- Workload compatibility filters and deterministic placement
- Provider heartbeats and heartbeat-driven failure detection
- Fenced leases, failover, and recovery
- Demo accounting invariants and reserve return
- Fresh CPU computation challenges for provider agents

Simulated or planned:
- OCI/container execution
- gVisor isolation
- GPU identity and performance
- Physical model/workload migration
- Compute-task results
- Provider pricing and payments
- Zero-downtime streaming

Never imply that an arbitrary container or GPU workload actually ran. Never claim real GPU benchmarks, payments, implemented gVisor isolation, uninterrupted inference, or live state migration. Keep every SIMULATED disclosure visible. Describe the event as rerouting/restarting after recovery.

VOICEOVER — USE THESE WORDS EXACTLY
“There’s useful compute sitting idle everywhere. AstraGrid turns workload intent into resilient, budget-aware compute.

Give it an OCI image and an objective: cheapest, balanced, or fastest.

The control plane reads declared requirements, filters the network, and ranks compatible providers. In this offline recording, the scheduler is deterministic, and every choice is backend-validated.

A fenced lease activates. The route becomes healthy.

Now the active provider disappears. The heartbeat expires; billing pauses; the stale lease is revoked; unused demo reserve is returned.

Same intent. Same endpoint. New compatible provider. Healthy again.

The compute response shown is simulated, but the recovery path is real.

Today’s prototype implements placement, heartbeat failover, accounting invariants, and fresh CPU computation challenges. OCI execution, gVisor, GPU proof, and payments remain simulated.

AstraGrid: compute that finds itself.”

VOICE
Generate an original, natural human-sounding English voice: warm, intelligent, conversational, and quietly excited. Do not imitate a known person. Use varied cadence and tiny breaths. Pause after “disappears,” “same endpoint,” and “real.” Emphasize “control plane,” “heartbeat,” “new compatible provider,” and “recovery path is real.”

VISUAL STYLE
- Premium dark interface with one violet accent, soft glow, and subtle grain
- Slow intentional motion; tasteful punch-ins that direct attention
- Linear/Vercel/Raycast-level restraint, not neon cyberpunk
- Keep meaningful cursor actions; no generic stock footage or 3D globe

AUDIO
- Minimal electronic pulse beneath narration
- Soft discovery chime when a provider joins
- Muted heartbeat drop at SIGNAL LOST
- Gentle resolving tone when healthy returns
- Music at least 12 dB beneath speech
- Final mix near -14 LUFS integrated and -1 dBTP

CAPTIONS
Create accurate burned-in captions plus an SRT. Use at most two lines and roughly 42 characters per line. Move captions away from the UI region being highlighted.

DELIVERABLES
1. Final 60-second H.264/AAC MP4
2. Narration-only WAV
3. Music-and-effects mix WAV
4. SRT captions
5. Timecoded edit decision list
6. A list of any missing source shots

If you cannot actually render/export video, say so plainly and return the complete edit decision list, voice-generation prompt, captions, and exact CapCut/Premiere/DaVinci assembly steps instead.
```
