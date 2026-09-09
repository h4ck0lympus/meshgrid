import { execFile } from 'node:child_process';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { solveChallenge } from '../shared/challenge.mjs';

const executeFile = promisify(execFile);
const baseUrl = process.env.MESHWORK_URL ?? process.env.ASTRAGRID_URL ?? 'http://127.0.0.1:3000';
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; });

async function readGpuTelemetry() {
  try {
    const { stdout } = await executeFile('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 1800, maxBuffer: 8192 });
    const [name, total, used, utilization, temperature] = stdout.trim().split('\n')[0].split(',').map(value => value.trim());
    const measurements = [total, used, utilization, temperature].map(Number);
    if (measurements.some(value => !Number.isFinite(value))) return null;
    return { name, vram: Math.round(measurements[0] / 1024), memoryUsed: measurements[1] / 1024,
      utilization: measurements[2], temperature: measurements[3] };
  } catch {
    return null;
  }
}

async function post(path, payload, token) {
  const response = await fetch(baseUrl + path, {
    method: 'POST', signal: AbortSignal.timeout(4000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

try {
  const gpu = await readGpuTelemetry();
  const manifest = {
    source: 'agent', name: (process.env.NODE_NAME ?? os.hostname()).slice(0, 40), region: 'Local machine',
    gpu: gpu?.name ?? `${os.cpus()[0]?.model ?? 'CPU'} (CPU telemetry)`.slice(0, 80),
    accelerator: gpu ? 'cuda' : 'cpu', architecture: os.arch() === 'arm64' ? 'arm64' : 'amd64',
    vram: gpu?.vram ?? 0, ram: Math.min(512, Math.round(os.totalmem() / 1024 ** 3)),
    cuda: gpu ? Number(process.env.CUDA_VERSION ?? 0) : 0,
    price: Number(process.env.HOURLY_PRICE ?? (gpu ? 0.35 : 0.08)),
    latency: Number(process.env.MOCK_LATENCY_MS ?? 50),
  };
  const { provider, heartbeatToken } = await post('/api/providers', manifest);
  console.log(`Meshwork provider ${provider.name} registered (${provider.id}).`);
  console.log('Hardware is self-reported. CPU challenges are measured; workload execution remains simulated.');
  if (gpu) console.log('CPU verification does not qualify this node for GPU workloads. GPU benchmarking is required.');

  while (!stopped) {
    try {
      const gpuSample = await readGpuTelemetry();
      const telemetry = { cpuLoad: Math.max(0, Math.min(100, os.loadavg()[0] / Math.max(1, os.cpus().length) * 100)) };
      if (gpuSample) Object.assign(telemetry, {
        utilization: gpuSample.utilization, temperature: gpuSample.temperature, memoryUsed: gpuSample.memoryUsed,
      });
      const heartbeat = await post(`/api/providers/${provider.id}/heartbeat`, { telemetry }, heartbeatToken);
      if (heartbeat.challenge) {
        const digest = await solveChallenge(heartbeat.challenge);
        const { verification } = await post(`/api/providers/${provider.id}/verify`, {
          challengeId: heartbeat.challenge.id, digest,
        }, heartbeatToken);
        console.log(`CPU challenge passed: ${verification.roundTripMs} ms round trip; valid until ${new Date(verification.validUntil).toISOString()}.`);
      }
    } catch (error) {
      console.error(error.message);
    }
    await sleep(1000);
  }
} catch (error) {
  console.error(`Provider registration failed: ${error.message}`);
  process.exitCode = 1;
}
