import { EventEmitter } from 'node:events';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CHALLENGE_ITERATIONS, CHALLENGE_TIMEOUT_MS, VERIFICATION_REFRESH_MS, VERIFICATION_VALID_MS, solveChallenge } from '../shared/challenge.mjs';
import { HttpError, validateProvider, validateWorkload, number } from './validation.mjs';
import { rankProviders, compatibility, chooseWithOpenAI } from './scheduler.mjs';

export const NANO = 1_000_000_000;
export const HEARTBEAT_TTL = 3200;
const HEARTBEAT_EVERY = 1000;
const uid = prefix => `${prefix}_${randomUUID().slice(0, 8)}`;
const TERMINAL = ['stopped', 'completed'];

const seedNodes = [
  ['NIMBUS-01', 'US West', 'NVIDIA RTX 4090', 24, 64, 0.42, 38, 'cuda', 'amd64'],
  ['ORBIT-02', 'US Central', 'NVIDIA RTX 3090', 24, 64, 0.32, 64, 'cuda', 'amd64'],
  ['KEPLER-03', 'EU West', 'NVIDIA RTX 4090', 24, 96, 0.48, 74, 'cuda', 'amd64'],
  ['VEGA-04', 'US East', 'NVIDIA RTX 4080', 16, 32, 0.28, 91, 'cuda', 'amd64'],
  ['SOL-05', 'EU North', 'Apple M3 Pro', 18, 36, 0.18, 104, 'metal', 'arm64'],
  ['PULSAR-06', 'AP Southeast', 'NVIDIA RTX 4070', 12, 32, 0.22, 138, 'cuda', 'amd64'],
];

/** Single-process control plane. Every action is observable through snapshots + events.
 * No Docker execution, real transfers, attestation, or distributed consensus is implied.
 */
export class GridEngine extends EventEmitter {
  constructor({ clock = Date.now, measure = () => performance.now(), mode = 'simulation', env = process.env, chooser = chooseWithOpenAI } = {}) {
    super(); this.clock = clock; this.measure = measure; this.mode = mode; this.env = env; this.chooser = chooser;
    this.epoch = 0; this.reset();
  }
  reset() {
    this.epoch++; this.pendingChoice = null; this.providers = []; this.events = []; this.job = null;
    this.challenges = new Map();
    this.receipts = []; this.decisions = []; this.demo = { running: false, step: 0, label: 'Ready for launch', completed: false };
    this.startedAt = this.clock(); this.revision = 0;
    for (const [name, region, gpu, vram, ram, price, latency, accelerator, architecture] of seedNodes) {
      const node = this.makeProvider({ name, region, gpu, vram, ram, price, latency, accelerator, architecture });
      this.completeSimulation(node); this.providers.push(node);
    }
    this.event('system', 'Grid initialized', 'Six simulated community nodes are reporting. No real GPU workload or payment will execute.');
    this.publish();
  }
  event(kind, title, detail = '', extra = {}) {
    const item = { id: uid('evt'), at: this.clock(), kind, title, detail, ...extra };
    this.events.unshift(item); this.events = this.events.slice(0, 120); return item;
  }
  publish() { this.revision++; this.emit('change', this.snapshot()); }
  makeProvider(input, source = 'simulation') {
    const p = validateProvider(input); const now = this.clock();
    return { ...p, id: uid('node'), source, status: 'verifying', emitting: true,
      token: randomBytes(24).toString('hex'), lastHeartbeat: now, nextHeartbeat: now + 1000,
      verifyAt: source === 'simulation' ? now + 1800 : null, nextChallengeAt: 0,
      joinedAt: now, baselineLatency: p.latency,
      telemetry: { source: source === 'agent' ? 'local agent (self-reported)' : 'simulated local agent',
        utilization: source === 'agent' ? null : 4, temperature: source === 'agent' ? null : 38,
        memoryUsed: source === 'agent' ? null : 1.2, cpuLoad: source === 'agent' ? null : 2 },
      verification: { status: 'pending', hardware: 'self-reported',
        benchmark: 'not measured', workload: 'not benchmarked', checkedAt: null, validUntil: null,
        roundTripMs: null, attestation: false,
        note: 'Computation checks do not prove GPU identity, memory capacity, or where execution occurred.' },
    };
  }
  completeSimulation(node) {
    node.verification = { ...node.verification, status: 'simulated', benchmark: 'not measured' };
    node.status = 'online'; node.verifyAt = null;
  }
  authenticateProvider(id, token) {
    const provider = this.getNode(id);
    if (provider.source !== 'agent' || token !== provider.token) throw new HttpError(401, 'Invalid provider credentials.');
    return provider;
  }
  issueChallenge(id, token) {
    const provider = this.authenticateProvider(id, token);
    const pending = this.challenges.get(id);
    if (pending) return pending.checking ? null : pending.challenge;
    if (this.clock() < provider.nextChallengeAt) return null;
    const challenge = { id: randomUUID(), algorithm: 'pbkdf2-sha256-v1',
      nonce: randomBytes(32).toString('hex'), salt: randomBytes(16).toString('hex'),
      iterations: CHALLENGE_ITERATIONS, expiresAt: this.clock() + CHALLENGE_TIMEOUT_MS };
    this.challenges.set(id, { challenge, startedAt: this.measure(), checking: false });
    provider.nextChallengeAt = this.clock() + 10_000;
    this.event('verification', `Computation challenge · ${provider.name}`, 'Fresh CPU key-derivation challenge issued. Deadline measured by the control plane; GPU identity remains self-reported.');
    return challenge;
  }
  rejectVerification(provider, status, reason) {
    this.challenges.delete(provider.id);
    provider.verification = { ...provider.verification, status, validUntil: null, reason };
    provider.status = 'verifying';
    this.event('warning', `Provider verification ${status} · ${provider.name}`, reason);
    if (this.job?.providerId === provider.id) this.failover(reason);
    this.publish();
  }
  async verifyChallenge(id, token, result) {
    const provider = this.authenticateProvider(id, token);
    const pending = this.challenges.get(id);
    if (!pending || pending.checking || result.challengeId !== pending.challenge.id)
      throw new HttpError(409, 'Challenge is missing, consumed, or belongs to another attempt.');
    const roundTripMs = this.measure() - pending.startedAt;
    if (roundTripMs > CHALLENGE_TIMEOUT_MS || this.clock() > pending.challenge.expiresAt) {
      this.rejectVerification(provider, 'expired', 'Computation challenge exceeded its deadline.');
      throw new HttpError(408, 'Challenge expired.');
    }
    if (typeof result.digest !== 'string' || !/^[a-f0-9]{64}$/.test(result.digest)) {
      this.rejectVerification(provider, 'rejected', 'Malformed computation result.');
      throw new HttpError(422, 'Expected a 32-byte hexadecimal digest.');
    }
    pending.checking = true;
    const expected = await solveChallenge(pending.challenge);
    // A reset, expiry, or replacement challenge invalidates an outstanding verification.
    if (this.challenges.get(id) !== pending || !this.providers.includes(provider))
      throw new HttpError(409, 'Provider state changed during verification.');
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(result.digest, 'hex'))) {
      this.rejectVerification(provider, 'rejected', 'Computation result did not match the fresh challenge.');
      throw new HttpError(422, 'Incorrect computation result.');
    }
    this.challenges.delete(id);
    provider.nextChallengeAt = this.clock() + VERIFICATION_REFRESH_MS;
    provider.verification = { ...provider.verification, status: 'passed', reason: null,
      benchmark: 'CPU computation challenge', checkedAt: this.clock(), validUntil: this.clock() + VERIFICATION_VALID_MS,
      roundTripMs: Math.round(roundTripMs * 100) / 100, iterations: CHALLENGE_ITERATIONS };
    provider.status = this.clock() - provider.lastHeartbeat <= HEARTBEAT_TTL ? 'online' : 'offline';
    this.event('verification', `CPU challenge passed · ${provider.name}`, `${provider.verification.roundTripMs} ms server-observed round trip. Result checked independently; hardware identity and workload performance are unverified.`);
    this.publish(); return provider.verification;
  }
  register(input = {}, source = 'simulation') {
    if (this.providers.length >= 18) throw new HttpError(409, 'Demo limit: 18 providers. Reset the grid to start again.');
    const node = this.makeProvider(input, source); this.providers.push(node);
    this.event('provider', `${node.name} joined the grid`, source === 'agent' ? 'Hardware is self-reported. A fresh computation challenge is required before eligibility.' : 'Simulated provider registered. No hardware verification is claimed.');
    this.publish(); return { provider: this.publicProvider(node), heartbeatToken: node.token };
  }
  publicProvider(p) { const { token, nextHeartbeat, verifyAt, nextChallengeAt, ...safe } = p; return safe; }
  getNode(id) { const p = this.providers.find(n => n.id === id); if (!p) throw new HttpError(404, 'Provider not found.'); return p; }
  heartbeat(id, token, telemetry = {}) {
    const p = this.authenticateProvider(id, token);
    const clean = { ...p.telemetry };
    for (const [key, min, max] of [['utilization', 0, 100], ['temperature', 0, 120], ['memoryUsed', 0, 192], ['cpuLoad', 0, 100]]) {
      if (telemetry[key] !== undefined) clean[key] = number(telemetry[key], key, min, max);
    }
    p.telemetry = clean; p.emitting = true;
    this.receiveHeartbeat(p);
    const challenge = this.issueChallenge(id, token);
    this.publish(); return { accepted: true, serverTime: this.clock(), runtime: 'simulated', challenge };
  }
  receiveHeartbeat(p) {
    const now = this.clock(); p.lastHeartbeat = now;
    if (p.status === 'offline') {
      p.status = p.verification.status === 'simulated' || (p.verification.status === 'passed' && p.verification.validUntil > now) ? 'online' : 'verifying';
      this.event('provider', `${p.name} reconnected`, 'A fresh heartbeat was accepted. Old deployment leases remain fenced.');
    }
    if (this.job?.status === 'healthy' && this.job.providerId === p.id && this.job.lease) {
      const lease = this.job.lease;
      this.acceptReceipt({ leaseId: lease.id, providerId: p.id, sequence: lease.sequence + 1,
        start: lease.lastMeterAt, end: now, latency: p.latency });
    }
  }
  kill(id) {
    const p = this.getNode(id);
    if (p.source !== 'simulation') throw new HttpError(409, 'Stop the local provider agent process to test its heartbeat loss.');
    if (!p.emitting) throw new HttpError(409, 'This provider is already disconnected.');
    p.emitting = false; p.killedAt = this.clock();
    this.event('warning', `Signal lost · ${p.name}`, 'Fault injected: the simulated provider process stopped. No more usage receipts can settle. Waiting for heartbeat timeout.');
    if (this.job?.providerId === id && this.job.status === 'healthy') this.job.billingStatus = 'awaiting receipts';
    this.publish();
  }
  revive(id) {
    const p = this.getNode(id);
    if (p.source !== 'simulation') throw new HttpError(409, 'Restart the local agent to reconnect.');
    p.emitting = true; p.killedAt = null; this.receiveHeartbeat(p); this.publish();
  }
  degrade(id) {
    const p = this.getNode(id); p.latency = Math.max((this.job?.spec.maxLatency ?? 120) * 1.5, p.baselineLatency * 2);
    this.event('warning', `SLO fault injected · ${p.name}`, 'Synthetic p95 latency increased. Three consecutive failing probes will trigger rescheduling.'); this.publish();
  }
  submit(input = {}) {
    if (this.job && !TERMINAL.includes(this.job.status)) throw new HttpError(409, 'Stop the active workload or reset before deploying another.');
    const spec = validateWorkload(input); const now = this.clock();
    this.job = { id: uid('job'), spec, status: 'inspecting', phase: 'Reading OCI workload manifest', createdAt: now,
      nextAction: now + 1300, providerId: null, previousProviderId: null, lease: null, generation: 0,
      excluded: [], failures: 0, failoverStartedAt: null, lastRecoveryMs: null, lastRecoveryAt: null,
      verifiedMs: 0, requests: 0, lastResponse: null, sloMisses: 0, receiptCount: 0,
      billingStatus: 'not started', rejection: null,
      ledger: { depositNanos: Math.round(spec.budget * NANO), availableNanos: Math.round(spec.budget * NANO),
        heldNanos: 0, settledNanos: 0, refundedNanos: 0 },
    };
    this.event('workload', `${spec.name} submitted`, `${spec.image} · ${spec.minVram} GB VRAM · p95 ≤ ${spec.maxLatency} ms · ≤ $${spec.maxPrice.toFixed(2)}/hr. Inspection uses the declared manifest; the image is not pulled.`);
    this.publish(); return this.job;
  }
  reserve(node) {
    const j = this.job, l = j.ledger;
    const amount = Math.min(l.availableNanos, Math.ceil(node.price * NANO / 60)); // 60-second rolling reserve.
    if (amount <= 0) return false;
    l.availableNanos -= amount; l.heldNanos += amount; return true;
  }
  releaseHold(reason) {
    const j = this.job; if (!j) return;
    const amount = j.ledger.heldNanos;
    j.ledger.availableNanos += amount; j.ledger.refundedNanos += amount; j.ledger.heldNanos = 0;
    j.lease = null; j.billingStatus = 'paused';
    if (amount) this.event('refund', 'Unused reserve returned', `$${(amount / NANO).toFixed(6)} returned to demo balance. ${reason}`, { amountNanos: amount });
  }
  beginScheduling() {
    const j = this.job; if (!j) return;
    j.status = j.failoverStartedAt ? 'rescheduling' : 'scheduling';
    j.phase = 'Matching compatible providers'; j.nextAction = this.clock() + 1500;
    const candidates = rankProviders(this.providers, j.spec, this.clock(), j.excluded, HEARTBEAT_TTL);
    j.candidates = candidates;
    this.event('astra', 'Astra inspected the requirements', `${candidates.filter(c => c.compatible).length} compatible nodes. Architecture, accelerator, VRAM, RAM, CUDA, heartbeat, latency and price are hard filters.`);
  }
  startChoice() {
    const j = this.job;
    if (!j || this.pendingChoice) return;
    const candidates = rankProviders(this.providers, j.spec, this.clock(), j.excluded, HEARTBEAT_TTL);
    j.candidates = candidates;
    const best = candidates.find(c => c.compatible);
    if (!best) { this.block('No provider meets all declared requirements. Adjust the workload or add a compatible node.'); return; }
    const fallback = { providerId: best.id, mode: 'simulation', model: null,
      summary: `${best.name} meets the declared constraints at $${best.price.toFixed(2)}/hr and ${best.latency} ms synthetic p95. Evidence: ${best.verification.status}; hardware identity is self-reported.`, };
    if (this.mode !== 'openai') { this.commitPlacement(fallback); return; }
    const epoch = this.epoch, jobId = j.id, generation = j.generation;
    this.pendingChoice = `${jobId}:${generation}`; j.phase = 'Astra is ranking the verified shortlist'; j.nextAction = Infinity;
    this.chooser(j.spec, candidates, this.env).then(result => {
      if (epoch === this.epoch && this.job?.id === jobId && this.job?.generation === generation) this.commitPlacement(result);
    }).catch(error => {
      if (epoch === this.epoch && this.job?.id === jobId && this.job?.generation === generation) {
        this.event('warning', 'Model unavailable · safe fallback', String(error.message).replace(/sk-[\w-]+/g, '[redacted]').slice(0, 180));
        this.commitPlacement({ ...fallback, mode: 'fallback' });
      }
    }).finally(() => { if (epoch === this.epoch && this.pendingChoice === `${jobId}:${generation}`) this.pendingChoice = null; this.publish(); });
  }
  commitPlacement(decision) {
    const j = this.job; if (!j || !['scheduling', 'rescheduling'].includes(j.status)) return;
    // Model outputs cannot override live compatibility, price or heartbeat constraints.
    let p = this.providers.find(n => n.id === decision.providerId);
    if (!p || compatibility(p, j.spec, this.clock(), HEARTBEAT_TTL).length || j.excluded.includes(p.id) || !p.emitting) {
      const candidate = rankProviders(this.providers.filter(n => n.emitting), j.spec, this.clock(), j.excluded, HEARTBEAT_TTL).find(c => c.compatible);
      if (!candidate) { this.block('The shortlist changed before lease acquisition; no safe placement is available.'); return; }
      p = this.getNode(candidate.id); decision = { providerId: p.id, mode: 'fallback', summary: 'Live revalidation changed the shortlist. Selected the highest-scoring currently compatible node.' };
    }
    if (!this.reserve(p)) { this.stop('Demo budget exhausted'); return; }
    j.providerId = p.id; j.generation++; j.status = 'deploying'; j.phase = 'Provisioning isolated runtime · simulated';
    j.nextAction = this.clock() + 2100; j.billingStatus = 'reserve held';
    j.lease = { id: uid('lease'), generation: j.generation, providerId: p.id, acquiredAt: this.clock(), sequence: 0, lastMeterAt: null };
    j.decision = { ...decision, providerId: p.id, at: this.clock() };
    this.decisions.unshift(j.decision); this.decisions = this.decisions.slice(0, 30);
    this.event('astra', `Astra selected ${p.name}`, decision.summary);
    this.event('escrow', 'Demo reserve locked', `$${(j.ledger.heldNanos / NANO).toFixed(6)} reserved for up to 60 seconds. Usage settles only from fresh simulated health/usage receipts.`);
    this.event('runtime', 'OCI package → sandbox adapter', 'SIMULATED: resolve package → enforce isolation profile → start service → health probe. OCI packaging is not the security boundary.');
  }
  block(reason) {
    if (!this.job) return;
    this.releaseHold('No compatible replacement.'); this.job.status = 'blocked'; this.job.phase = 'Waiting for compatible capacity';
    this.job.rejection = reason; this.job.nextAction = Infinity; this.event('warning', 'Placement blocked', reason);
    if (this.demo.running) { this.demo.running = false; this.demo.label = 'Demo paused · no compatible capacity'; }
  }
  retry() {
    if (this.job?.status !== 'blocked') throw new HttpError(409, 'Only a blocked workload can be retried.');
    this.job.rejection = null; this.beginScheduling(); this.publish();
  }
  markHealthy() {
    const j = this.job, p = this.providers.find(n => n.id === j?.providerId);
    if (!j || !p || !p.emitting || compatibility(p, j.spec, this.clock(), HEARTBEAT_TTL).length) {
      if (j) this.failover('Node disappeared or failed compatibility during startup'); return;
    }
    j.status = 'healthy'; j.phase = 'Ready for compute tasks'; j.nextAction = Infinity; j.healthyAt = this.clock();
    j.lease.lastMeterAt = this.clock(); j.sloMisses = 0; j.billingStatus = 'metering';
    if (j.failoverStartedAt !== null) {
      j.lastRecoveryMs = this.clock() - j.failoverStartedAt; j.lastRecoveryAt = this.clock(); j.failoverStartedAt = null;
      this.event('recovered', `Workload recovered on ${p.name}`, `${(j.lastRecoveryMs / 1000).toFixed(1)}s from failure detection to healthy. New fenced lease; stable API route; no double billing.`);
    } else this.event('healthy', 'Deployment is healthy', `${p.name} passed a simulated readiness probe. Metering begins now, not during image startup.`);
    this.execute('python /workspace/task.py --input demo');
  }
  failover(reason) {
    const j = this.job;
    if (!j || !['healthy', 'deploying'].includes(j.status)) return;
    const old = this.providers.find(n => n.id === j.providerId);
    j.generation++; // Fences stale receipts and asynchronous decisions.
    j.previousProviderId = j.providerId; j.excluded.push(j.providerId); j.excluded = [...new Set(j.excluded)];
    j.failures++; j.failoverStartedAt = this.clock(); j.status = 'failing-over';
    j.phase = 'Lease revoked. Securing your balance.'; j.nextAction = this.clock() + 1800;
    this.event('failure', `${old?.name ?? 'Provider'} lost · failover initiated`, `${reason}. Billing frozen; old lease revoked; standby selection will use the same hard constraints.`);
    this.releaseHold('Unserved compute is not charged.'); j.providerId = null;
  }
  /** Receipts are generated by the mock runtime. This validates lease, ordering, health,
   * interval and balance; it does NOT verify real GPU work or a malicious agent's truthfulness.
   */
  acceptReceipt(receipt) {
    const j = this.job, now = this.clock();
    if (!j || j.status !== 'healthy' || !j.lease || receipt.leaseId !== j.lease.id || receipt.providerId !== j.providerId) return false;
    const lease = j.lease, p = this.getNode(j.providerId);
    if (p.source === 'agent' && (p.verification.status !== 'passed' || p.verification.validUntil <= now)) return false;
    if (!Number.isInteger(receipt.sequence) || receipt.sequence !== lease.sequence + 1 ||
      !Number.isFinite(receipt.start) || !Number.isFinite(receipt.end) || receipt.start !== lease.lastMeterAt ||
      receipt.end <= receipt.start || receipt.end > now || now - p.lastHeartbeat > HEARTBEAT_TTL || !p.emitting) return false;
    const elapsed = Math.min(receipt.end - receipt.start, 1500); // Never bill a long, unobserved gap.
    lease.sequence = receipt.sequence; lease.lastMeterAt = receipt.end;
    if (!Number.isFinite(receipt.latency) || receipt.latency > j.spec.maxLatency) {
      j.sloMisses++; j.billingStatus = 'SLO paused';
      if (j.sloMisses >= 3) this.failover('Three consecutive p95 latency probes exceeded the SLO');
      return false;
    }
    j.sloMisses = 0; j.billingStatus = 'metering';
    let amount = Math.round(p.price * NANO * elapsed / 3_600_000);
    const ledger = j.ledger;
    if (ledger.heldNanos < amount && ledger.availableNanos > 0) this.reserve(p);
    amount = Math.min(amount, ledger.heldNanos);
    if (amount <= 0) { this.stop('Demo budget exhausted'); return false; }
    const billedMs = Math.min(elapsed, amount * 3_600_000 / (p.price * NANO));
    ledger.heldNanos -= amount; ledger.settledNanos += amount; j.verifiedMs += billedMs; j.receiptCount++;
    const record = { ...receipt, id: `${lease.id}:${receipt.sequence}`, amountNanos: amount, billedMs,
      evidence: 'simulated runtime health + usage interval; not proof of physical compute' };
    this.receipts.unshift(record); this.receipts = this.receipts.slice(0, 200);
    if (ledger.heldNanos === 0 && ledger.availableNanos === 0) this.stop('Demo budget exhausted');
    return true;
  }
  execute(command = 'python /workspace/task.py --input demo') {
    const j = this.job;
    if (typeof command !== 'string' || command.length > 2000 || !command.trim()) throw new HttpError(400, 'Command must contain 1–2000 characters.');
    const p = this.providers.find(n => n.id === j?.providerId);
    if (!j || j.status !== 'healthy' || !p?.emitting || compatibility(p, j.spec, this.clock(), HEARTBEAT_TTL).length)
      throw new HttpError(503, 'Compute unavailable while the control plane recovers. Retry the same route after the workload becomes healthy.');
    j.requests++;
    const response = { id: uid('task'), object: 'compute.task.result', simulated: true, command: command.trim(),
      result: { status: 'completed', summary: 'Task completed on the provider selected for this workload’s budget and SLO.' },
      provider: { id: p.id, name: p.name }, lease: j.lease.id, generation: j.generation,
      latency_ms: p.latency, usage: { command_characters: command.length },
      note: 'Canned demonstration result. No OCI image or consumer command was executed.' };
    j.lastResponse = { ...response, at: this.clock() };
    this.event('compute', `Task completed · ${p.name}`, `Simulated compute result · ${p.latency} ms fixture latency · lease generation ${j.generation}.`);
    this.publish(); return response;
  }
  stop(reason = 'Stopped by consumer') {
    const j = this.job; if (!j || TERMINAL.includes(j.status)) return;
    this.releaseHold(reason); j.generation++; j.status = 'stopped'; j.phase = reason; j.providerId = null; j.nextAction = Infinity;
    this.demo.running = false; this.pendingChoice = null;
    this.event('workload', 'Workload stopped', `${reason}. Remaining reserve returned to demo balance.`); this.publish();
  }
  startDemo() {
    this.reset(); this.demo = { running: true, completed: false, step: 1, label: '01 · A provider joins', nextAction: this.clock() + 2600 };
    const registered = this.register({ name: 'LUMEN-07', region: 'US West', gpu: 'NVIDIA RTX 4090', vram: 24, ram: 64, price: 0.38, latency: 35 });
    this.demo.providerId = registered.provider.id; this.publish();
  }
  tickDemo(now) {
    const d = this.demo; if (!d.running) return;
    if (d.step === 1 && now >= d.nextAction) { this.submit(); d.step = 2; d.label = '02 · Astra inspects & places'; }
    if (d.step === 2 && this.job?.status === 'healthy') { d.step = 3; d.label = '03 · Compute is ready'; d.nextAction = now + 7000; }
    if (d.step === 3 && now >= d.nextAction && this.job?.status === 'healthy') {
      this.kill(this.job.providerId); d.step = 4; d.label = '04 · Provider disappears';
    }
    if (d.step === 4 && this.job?.failures > 0) { d.step = 5; d.label = '05 · Refund, reroute, recover'; }
    if (d.step === 5 && this.job?.status === 'healthy') {
      d.step = 6; d.running = false; d.completed = true; d.label = '06 · Resilience demonstrated';
      this.event('system', 'End-to-end demo complete', 'Provider joined → manifest placed → API responded → provider lost → billing stopped → reserve returned → backup healthy.');
    }
  }
  tick() {
    const now = this.clock();
    for (const p of this.providers) {
      if (p.source === 'simulation' && p.emitting && now >= p.nextHeartbeat) {
        p.nextHeartbeat = now + HEARTBEAT_EVERY;
        const running = this.job?.status === 'healthy' && this.job.providerId === p.id;
        p.telemetry.utilization = Math.round((running ? 66 : 4) + (Math.sin(now / 1800 + p.price * 15) + 1) * (running ? 10 : 3));
        p.telemetry.temperature = Math.round((running ? 60 : 36) + (Math.sin(now / 3500) + 1) * 3);
        p.telemetry.memoryUsed = running ? Math.min(p.vram, (this.job?.spec.minVram ?? 8) * 0.82) : 1.2;
        this.receiveHeartbeat(p);
      }
      if (p.source === 'simulation' && p.verifyAt && now >= p.verifyAt && p.emitting && now - p.lastHeartbeat <= HEARTBEAT_TTL) {
        this.completeSimulation(p); this.event('verification', `${p.name} simulation ready`, 'Synthetic provider only. No benchmark or hardware authentication performed.');
      }
      const pending = this.challenges.get(p.id);
      if (pending && !pending.checking && (now > pending.challenge.expiresAt || this.measure() - pending.startedAt > CHALLENGE_TIMEOUT_MS)) {
        this.rejectVerification(p, 'expired', 'Provider did not answer its computation challenge before the deadline.');
      }
      if (p.source === 'agent' && p.verification.status === 'passed' && now >= p.verification.validUntil) {
        this.rejectVerification(p, 'expired', 'Computation evidence expired; provider must complete a new challenge.');
      }
      if (p.status !== 'offline' && now - p.lastHeartbeat > HEARTBEAT_TTL) {
        p.status = 'offline'; this.event('warning', `Heartbeat expired · ${p.name}`, 'Provider marked offline after 3.2 seconds without a heartbeat.');
        if (this.job?.providerId === p.id) this.failover('Heartbeat lease expired');
      }
    }
    const j = this.job;
    if (j && now >= j.nextAction) {
      if (j.status === 'inspecting' || j.status === 'failing-over') this.beginScheduling();
      else if (j.status === 'scheduling' || j.status === 'rescheduling') this.startChoice();
      else if (j.status === 'deploying') this.markHealthy();
    }
    this.tickDemo(now); this.publish();
  }
  snapshot() {
    const now = this.clock(), j = this.job;
    return { revision: this.revision, now, startedAt: this.startedAt, mode: this.mode,
      scheduler: { label: 'GPT-6 Astra', mode: this.mode, model: this.mode === 'openai' ? this.env.OPENAI_MODEL ?? null : null },
      providers: this.providers.map(p => this.publicProvider(p)), job: j,
      events: this.events, receipts: this.receipts, decisions: this.decisions, demo: this.demo,
      stats: { online: this.providers.filter(p => p.status === 'online').length,
        total: this.providers.length, vram: this.providers.filter(p => p.status === 'online').reduce((n, p) => n + p.vram, 0),
        simulated: this.providers.filter(p => p.source === 'simulation').length },
      disclosure: { runtime: 'simulated', accounting: 'demo balance only', verification: 'CPU challenge for agents; fixtures unverified; no GPU identity or workload attestation',
        workloadInspection: 'declared manifest only', persistence: 'in-memory; reset on server restart', heartbeatTtl: HEARTBEAT_TTL },
    };
  }
}
