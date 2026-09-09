import assert from 'node:assert/strict';
import test from 'node:test';
import { GridEngine } from '../server/engine.mjs';
import { createGridServer } from '../server/index.mjs';
import { compatibility } from '../server/scheduler.mjs';
import { validateWorkload } from '../server/validation.mjs';
import { solveChallenge } from '../shared/challenge.mjs';

function setup() {
  let now = 100_000;
  let elapsed = 0;
  const engine = new GridEngine({ clock: () => now, measure: () => elapsed });
  const { provider, heartbeatToken } = engine.register({
    name: 'CPU worker', accelerator: 'cpu', gpu: 'CPU', vram: 0,
  }, 'agent');
  const challenge = engine.issueChallenge(provider.id, heartbeatToken);
  return { engine, provider: engine.getNode(provider.id), token: heartbeatToken, challenge,
    advance(milliseconds) { now += milliseconds; elapsed += milliseconds; },
    shiftWallClock(milliseconds) { now += milliseconds; },
    async pass() {
      elapsed += 120;
      return engine.verifyChallenge(provider.id, heartbeatToken, {
        challengeId: challenge.id, digest: await solveChallenge(challenge), roundTripMs: 0,
      });
    },
  };
}

test('agents cannot become verified by waiting or sending heartbeats', () => {
  const { engine, provider, token, advance } = setup();
  advance(2000);
  engine.heartbeat(provider.id, token);
  engine.tick();
  assert.equal(provider.status, 'verifying');
  assert.equal(provider.verification.status, 'pending');
  assert.ok(compatibility(provider, validateWorkload({ accelerator: 'cpu', minVram: 0 }), 102_000).length);
});

test('correct result records server timing and freshness without a hardware score', async () => {
  const { engine, provider, pass } = setup();
  const evidence = await pass();
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.roundTripMs, 120);
  assert.equal(evidence.validUntil - evidence.checkedAt, 60_000);
  assert.equal(evidence.score, undefined);
  assert.equal(evidence.attestation, false);
  assert.equal(evidence.hardware, 'self-reported');
  assert.deepEqual(compatibility(provider, validateWorkload({ accelerator: 'cpu', minVram: 0 }), engine.clock()), []);
});

test('credentials and challenge inputs never appear in public snapshots', () => {
  const { engine, token, challenge } = setup();
  const snapshot = JSON.stringify(engine.snapshot());
  for (const secret of [token, challenge.nonce, challenge.salt, challenge.id]) assert.ok(!snapshot.includes(secret));
});

test('wrong credentials and cross-provider answers cannot consume another challenge', async () => {
  const { engine, provider, challenge, token } = setup();
  assert.throws(() => engine.issueChallenge(provider.id, 'wrong'), { status: 401 });
  await assert.rejects(engine.verifyChallenge(provider.id, 'wrong', {}), { status: 401 });
  const other = engine.register({ name: 'Other' }, 'agent');
  const otherChallenge = engine.issueChallenge(other.provider.id, other.heartbeatToken);
  await assert.rejects(engine.verifyChallenge(other.provider.id, other.heartbeatToken, {
    challengeId: challenge.id, digest: await solveChallenge(challenge),
  }), { status: 409 });
  assert.equal(engine.issueChallenge(other.provider.id, other.heartbeatToken).id, otherChallenge.id);
  assert.equal(engine.issueChallenge(provider.id, token).id, challenge.id);
});

test('incorrect and malformed results exclude the provider', async () => {
  for (const digest of ['0'.repeat(64), 'invalid']) {
    const { engine, provider, token, challenge } = setup();
    await assert.rejects(engine.verifyChallenge(provider.id, token, { challengeId: challenge.id, digest }), { status: 422 });
    assert.equal(provider.verification.status, 'rejected');
    assert.equal(provider.status, 'verifying');
    assert.equal(provider.verification.validUntil, null);
  }
});

test('consumed challenge answers cannot be replayed', async () => {
  const { engine, provider, token, challenge, pass } = setup();
  await pass();
  await assert.rejects(engine.verifyChallenge(provider.id, token, {
    challengeId: challenge.id, digest: await solveChallenge(challenge),
  }), { status: 409 });
});

test('simultaneous submissions only verify once', async () => {
  const { engine, provider, token, challenge } = setup();
  const result = { challengeId: challenge.id, digest: await solveChallenge(challenge) };
  const first = engine.verifyChallenge(provider.id, token, result);
  await assert.rejects(engine.verifyChallenge(provider.id, token, result), { status: 409 });
  assert.equal((await first).status, 'passed');
});

test('deadline cannot be extended by fetching again or rolling the wall clock back', async () => {
  const { engine, provider, token, challenge, advance, shiftWallClock } = setup();
  advance(5001);
  shiftWallClock(-5001);
  assert.equal(engine.issueChallenge(provider.id, token).id, challenge.id);
  await assert.rejects(engine.verifyChallenge(provider.id, token, {
    challengeId: challenge.id, digest: await solveChallenge(challenge),
  }), { status: 408 });
  assert.equal(provider.verification.status, 'expired');
});

test('ignored challenges expire and a retry uses new randomness', () => {
  const { engine, provider, token, challenge, advance } = setup();
  advance(6000);
  engine.tick();
  assert.equal(provider.verification.status, 'expired');
  assert.equal(engine.issueChallenge(provider.id, token), null);
  advance(5000);
  const retry = engine.issueChallenge(provider.id, token);
  assert.notEqual(retry.id, challenge.id);
  assert.notEqual(retry.nonce, challenge.nonce);
});

test('CPU evidence cannot qualify a self-reported RTX 5090 for GPU scheduling', async () => {
  const { engine, provider, pass } = setup();
  await pass();
  Object.assign(provider, { accelerator: 'cuda', gpu: 'NVIDIA RTX 5090', vram: 32, cuda: 12.4 });
  const reasons = compatibility(provider, validateWorkload(), engine.clock());
  assert.ok(reasons.some(reason => reason.includes('GPU workload benchmark required')));
});

test('expired evidence revokes an active lease even when heartbeats continue', async () => {
  const { engine, provider, token, pass, advance } = setup();
  await pass();
  engine.submit({ accelerator: 'cpu', minVram: 0 });
  advance(1500); engine.heartbeat(provider.id, token); engine.tick();
  advance(1500); engine.heartbeat(provider.id, token); engine.tick();
  advance(2500); engine.heartbeat(provider.id, token); engine.tick();
  assert.equal(engine.job.status, 'healthy');
  const settled = engine.job.ledger.settledNanos;
  advance(60_000);
  engine.heartbeat(provider.id, token);
  engine.tick();
  assert.equal(provider.verification.status, 'expired');
  assert.equal(engine.job.status, 'failing-over');
  assert.equal(engine.job.lease, null);
  assert.equal(engine.job.ledger.settledNanos, settled);
});

test('reset fences verification already in progress', async () => {
  const { engine, provider, token, challenge } = setup();
  const pending = engine.verifyChallenge(provider.id, token, {
    challengeId: challenge.id, digest: await solveChallenge(challenge),
  });
  engine.reset();
  await assert.rejects(pending, { status: 409 });
  assert.ok(!engine.snapshot().providers.some(candidate => candidate.id === provider.id));
});

test('agent refuses arbitrary challenge algorithms or excessive work', async () => {
  const { challenge } = setup();
  await assert.rejects(solveChallenge({ ...challenge, iterations: 1e12 }), /Unsupported/);
  await assert.rejects(solveChallenge({ ...challenge, algorithm: 'shell' }), /Unsupported/);
});

test('HTTP challenge flow authenticates, verifies, hides secrets and rejects replay', async t => {
  const app = createGridServer({ autoTick: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const registration = app.engine.register({ accelerator: 'cpu', vram: 0 }, 'agent');
  const providerPath = `/api/providers/${registration.provider.id}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${registration.heartbeatToken}` };
  const post = (path, payload, requestHeaders = headers) => fetch(baseUrl + path, {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(payload),
  });
  assert.equal((await post(providerPath + '/challenge', {}, { 'Content-Type': 'application/json' })).status, 401);
  const { challenge } = await (await post(providerPath + '/challenge', {})).json();
  const payload = { challengeId: challenge.id, digest: await solveChallenge(challenge) };
  const response = await post(providerPath + '/verify', payload);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verification.status, 'passed');
  assert.equal((await post(providerPath + '/verify', payload)).status, 409);
  const exported = await (await fetch(baseUrl + '/api/export')).text();
  assert.ok(!exported.includes(challenge.nonce));
  assert.ok(!exported.includes(registration.heartbeatToken));
});
