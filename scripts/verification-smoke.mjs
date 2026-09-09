import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createGridServer } from '../server/index.mjs';

const app = createGridServer();
let agent;
let agentExit;
let agentOutput = '';

async function waitFor(predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`Provider check timed out. ${agentOutput}`);
}

try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  agent = spawn(process.execPath, [fileURLToPath(new URL('./provider-agent.mjs', import.meta.url))], {
    env: { ...process.env, MESHWORK_URL: baseUrl, NODE_NAME: 'Verification smoke worker' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agentExit = once(agent, 'exit');
  agent.stdout.on('data', chunk => { agentOutput += chunk.toString(); });
  agent.stderr.on('data', chunk => { agentOutput += chunk.toString(); });
  const provider = await waitFor(() => app.engine.providers.find(candidate =>
    candidate.source === 'agent' && candidate.verification.status === 'passed'));
  assert.ok(provider.verification.roundTripMs > 0);
  assert.equal(provider.verification.attestation, false);
  const response = await fetch(baseUrl + '/api/state');
  const snapshot = await response.json();
  assert.ok(!JSON.stringify(snapshot).includes(provider.token));

  const rejected = app.engine.register({ name: 'Incorrect challenge worker', gpu: 'Claimed RTX 5090' }, 'agent');
  const challenge = app.engine.issueChallenge(rejected.provider.id, rejected.heartbeatToken);
  const rejection = await fetch(`${baseUrl}/api/providers/${rejected.provider.id}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rejected.heartbeatToken}` },
    body: JSON.stringify({ challengeId: challenge.id, digest: '0'.repeat(64) }),
  });
  assert.equal(rejection.status, 422);
  assert.equal(app.engine.getNode(rejected.provider.id).verification.status, 'rejected');

  agent.kill('SIGTERM');
  await agentExit;
  await waitFor(() => provider.status === 'offline', 6000);
  console.log(JSON.stringify({ pass: true, provider: provider.name,
    serverObservedRoundTripMs: provider.verification.roundTripMs,
    incorrectAnswerRejected: true, processExitDetected: true, hardwareIdentity: 'self-reported' }, null, 2));
} finally {
  if (agent && agent.exitCode === null && agent.signalCode === null) {
    agent.kill('SIGTERM');
    await agentExit;
  }
  await app.close();
}
