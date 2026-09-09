import test from 'node:test';
import assert from 'node:assert/strict';
import { GridEngine, NANO } from '../server/engine.mjs';
import { rankProviders } from '../server/scheduler.mjs';
import { validateWorkload, validateProvider } from '../server/validation.mjs';

function fixture(options = {}) {
  let now = 100_000;
  const e = new GridEngine({ clock: () => now, ...options });
  function advance(ms) { for (let t = 0; t < ms; t += 250) { now += Math.min(250, ms - t); e.tick(); } }
  function healthy() { e.submit(); advance(6000); assert.equal(e.job.status, 'healthy'); }
  return { e, advance, healthy, now: () => now };
}
const conservation = j => assert.equal(j.ledger.depositNanos, j.ledger.availableNanos + j.ledger.heldNanos + j.ledger.settledNanos);

test('default grid exposes six simulated providers, no heartbeat credentials', () => {
  const { e } = fixture(); assert.equal(e.snapshot().providers.length, 6);
  assert.ok(e.snapshot().providers.every(p => !('token' in p) && p.verification.attestation === false));
});
test('simulated provider becomes ready without claiming measured verification', () => {
  const { e, advance } = fixture(); const { provider } = e.register({ name: 'CUSTOM-01' });
  assert.equal(e.getNode(provider.id).status, 'verifying'); advance(2000);
  assert.equal(e.getNode(provider.id).status, 'online');
  assert.equal(e.getNode(provider.id).verification.status, 'simulated');
  assert.equal(e.getNode(provider.id).verification.benchmark, 'not measured');
  assert.equal(e.getNode(provider.id).verification.score, undefined);
});
test('workload inspection → placement → healthy → fixture compute task', () => {
  const { e, healthy } = fixture(); healthy(); assert.equal(e.job.status, 'healthy');
  const r = e.execute('python task.py'); assert.equal(r.simulated, true); assert.equal(r.provider.id, e.job.providerId);
  assert.ok(e.job.lease); conservation(e.job);
});
test('GPU memory, architecture, runtime, price, latency hard filters', () => {
  const { e, now } = fixture(); const spec = validateWorkload();
  const ranked = rankProviders(e.providers, spec, now());
  assert.equal(ranked.find(p => p.name === 'SOL-05').compatible, false);
  assert.equal(ranked.find(p => p.name === 'PULSAR-06').compatible, false);
  assert.ok(ranked.find(p => p.name === 'PULSAR-06').reasons.includes('Needs 16 GB VRAM'));
});
test('impossible workload blocks without reserving or charging', () => {
  const { e, advance } = fixture(); e.submit({ minVram: 192 }); advance(5000);
  assert.equal(e.job.status, 'blocked'); assert.equal(e.job.ledger.heldNanos, 0); assert.equal(e.job.ledger.settledNanos, 0);
  conservation(e.job);
});
test('price objective influences valid ranking', () => {
  const { e, now } = fixture();
  const cheap = rankProviders(e.providers, validateWorkload({ objective: 'lowest-cost' }), now()).find(c => c.compatible);
  const fast = rankProviders(e.providers, validateWorkload({ objective: 'lowest-latency' }), now()).find(c => c.compatible);
  assert.notEqual(cheap.id, fast.id); assert.ok(cheap.price < fast.price);
});
test('no billing during startup; settled usage starts only after healthy', () => {
  const { e, advance } = fixture(); e.submit(); advance(4500); assert.equal(e.job.ledger.settledNanos, 0);
  advance(3500); assert.ok(e.job.ledger.settledNanos > 0); conservation(e.job);
});
test('provider death freezes charges, refunds unused hold and selects backup', () => {
  const { e, advance, healthy } = fixture(); healthy(); advance(3000);
  const old = e.job.providerId, generation = e.job.generation, settled = e.job.ledger.settledNanos;
  e.kill(old); advance(3000); assert.equal(e.job.ledger.settledNanos, settled);
  assert.throws(() => e.execute('python task.py'), { status: 503 });
  advance(2500); assert.equal(e.job.ledger.settledNanos, settled);
  assert.ok(e.job.ledger.refundedNanos > 0); conservation(e.job);
  advance(6500); assert.equal(e.job.status, 'healthy'); assert.notEqual(e.job.providerId, old);
  assert.ok(e.job.generation > generation); assert.equal(e.job.failures, 1); conservation(e.job);
});
test('stale and duplicate usage receipts cannot settle', () => {
  const { e, advance, healthy } = fixture(); healthy(); advance(2000);
  const oldReceipt = { ...e.receipts[0] }; const charged = e.job.ledger.settledNanos;
  assert.equal(e.acceptReceipt(oldReceipt), false); assert.equal(e.job.ledger.settledNanos, charged);
  e.kill(e.job.providerId); advance(11000);
  const newCharged = e.job.ledger.settledNanos;
  assert.equal(e.acceptReceipt({ ...oldReceipt, sequence: oldReceipt.sequence + 1 }), false);
  assert.equal(e.job.ledger.settledNanos, newCharged);
});
test('future, overlapping, and out-of-order receipt intervals are rejected', () => {
  const { e, advance, healthy, now } = fixture(); healthy(); advance(1000);
  const lease = e.job.lease;
  const base = { leaseId: lease.id, providerId: e.job.providerId, sequence: lease.sequence + 1,
    start: lease.lastMeterAt, end: now() + 1000, latency: 10 };
  assert.equal(e.acceptReceipt(base), false);
  assert.equal(e.acceptReceipt({ ...base, start: base.start - 2000, end: now() }), false);
  assert.equal(e.acceptReceipt({ ...base, sequence: 999 }), false);
});
test('all providers unavailable: failover blocks rather than lying about recovery', () => {
  const { e, advance, healthy } = fixture(); healthy();
  for (const p of e.providers) e.kill(p.id); advance(10000);
  assert.equal(e.job.status, 'blocked'); assert.equal(e.job.lease, null); conservation(e.job);
});
test('three SLO breaches pause billing and initiate failover', () => {
  const { e, advance, healthy } = fixture(); healthy(); advance(2000);
  const old = e.job.providerId, billed = e.job.ledger.settledNanos;
  e.degrade(old); advance(3000); assert.ok(e.job.failures > 0); assert.equal(e.job.ledger.settledNanos, billed);
  advance(7000); assert.equal(e.job.status, 'healthy'); assert.notEqual(e.job.providerId, old);
});
test('budget exhaustion never charges beyond the deposit', () => {
  const { e, advance } = fixture(); e.submit({ budget: 0.001 }); advance(30000);
  assert.equal(e.job.status, 'stopped'); assert.equal(e.job.ledger.settledNanos, Math.round(0.001 * NANO));
  conservation(e.job);
});
test('consumer stop returns reserve and fences lease', () => {
  const { e, healthy } = fixture(); healthy(); e.stop();
  assert.equal(e.job.status, 'stopped'); assert.equal(e.job.ledger.heldNanos, 0); assert.equal(e.job.lease, null); conservation(e.job);
});
test('only one concurrent workload is accepted', () => {
  const { e } = fixture(); e.submit(); assert.throws(() => e.submit(), { status: 409 });
});
test('agent heartbeat requires a token and validates local telemetry', () => {
  const { e } = fixture(); const a = e.register({ name: 'Local' }, 'agent');
  assert.throws(() => e.heartbeat(a.provider.id, 'wrong'), { status: 401 });
  e.heartbeat(a.provider.id, a.heartbeatToken, { utilization: 20 });
  assert.equal(e.getNode(a.provider.id).telemetry.utilization, 20);
  assert.throws(() => e.heartbeat(a.provider.id, a.heartbeatToken, { utilization: -5 }), { status: 400 });
});
test('recovering node cannot reclaim an active backup lease', () => {
  const { e, healthy, advance } = fixture(); healthy(); const old = e.job.providerId;
  e.kill(old); advance(11000); const backup = e.job.providerId; e.revive(old); advance(2000);
  assert.equal(e.job.providerId, backup); assert.notEqual(backup, old);
});
test('blocked placement can retry after compatible capacity joins', () => {
  const { e, advance } = fixture(); e.submit({ minVram: 48 }); advance(6000); assert.equal(e.job.status, 'blocked');
  e.register({ name: 'New-48', vram: 48, price: 0.40, latency: 30 }); advance(2000); e.retry(); advance(5000);
  assert.equal(e.job.status, 'healthy');
});
test('complete server-side demo follows the happy path and recovers', () => {
  const { e, advance } = fixture(); e.startDemo(); advance(30000);
  assert.equal(e.demo.completed, true); assert.equal(e.job.status, 'healthy'); assert.equal(e.job.failures, 1);
  assert.ok(e.events.some(v => v.kind === 'refund')); assert.ok(e.job.lastResponse.simulated); conservation(e.job);
});
test('reset clears workload and ledger state', () => {
  const { e, healthy } = fixture(); healthy(); e.reset(); assert.equal(e.job, null); assert.equal(e.receipts.length, 0);
});
test('invalid numbers, shell strings and impossible provider fields fail validation', () => {
  for (const bad of [NaN, Infinity, -1, '0.2']) assert.throws(() => validateWorkload({ maxPrice: bad }));
  assert.throws(() => validateWorkload({ image: 'foo; curl evil' }));
  assert.throws(() => validateWorkload({ image: 'https://example.com/a' }));
  assert.throws(() => validateProvider({ vram: -10 }));
  assert.equal(validateWorkload({ image: 'ghcr.io/team/image@sha256:' + 'a'.repeat(64) }).image.length, 90);
});
test('model-picked invalid node cannot bypass compatibility', () => {
  const { e, advance } = fixture(); e.submit(); advance(1500);
  e.commitPlacement({ providerId: 'invented', mode: 'openai', summary: 'Pick an invalid provider.' });
  advance(3000); assert.equal(e.job.status, 'healthy'); assert.equal(e.job.decision.mode, 'fallback');
});
test('late model completion after reset is ignored', async () => {
  let resolveChoice;
  const chooser = () => new Promise(resolve => { resolveChoice = resolve; });
  const { e, advance } = fixture({ mode: 'openai', chooser }); e.submit(); advance(3500); e.reset();
  resolveChoice({ providerId: 'old', summary: 'late', mode: 'openai' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(e.job, null);
});
