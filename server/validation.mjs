/** Input boundaries are enforced outside the model. All prices are demo USD. */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function text(value, name, max = 100, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value))
    throw new HttpError(400, `${name} must be 1–${max} printable characters.`);
  return value.trim();
}
export function number(value, name, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new HttpError(400, `${name} must be a number from ${min} to ${max}.`);
  return value;
}
export function choice(value, name, options, fallback) {
  const v = value ?? fallback;
  if (!options.includes(v)) throw new HttpError(400, `${name} must be ${options.join(', ')}.`);
  return v;
}
export function validateWorkload(input = {}) {
  const image = text(input.image, 'OCI image', 240, 'ghcr.io/meshwork/compute-demo:1.0');
  // Conservative distribution-reference subset. A ref is data, never a shell command.
  if (!/^(?:[a-z0-9.-]+(?::\d{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[\w][\w.-]{0,127}|@sha256:[a-f0-9]{64})?$/.test(image))
    throw new HttpError(400, 'Enter an OCI reference such as ghcr.io/team/image:tag, not a URL or shell command.');
  return {
    name: text(input.name, 'Workload name', 60, 'batch-compute'), image,
    architecture: choice(input.architecture, 'Architecture', ['amd64', 'arm64'], 'amd64'),
    accelerator: choice(input.accelerator, 'Accelerator', ['cuda', 'cpu', 'metal'], 'cuda'),
    minVram: number(input.minVram, 'VRAM (GB)', 0, 192, 16),
    minRam: number(input.minRam, 'RAM (GB)', 1, 512, 16),
    minCuda: number(input.minCuda, 'CUDA version', 11, 14, 12),
    maxLatency: number(input.maxLatency, 'p95 latency (ms)', 10, 2000, 120),
    maxPrice: number(input.maxPrice, 'Maximum hourly rate', 0.01, 20, 0.60),
    budget: number(input.budget, 'Demo deposit', 0.001, 100, 1),
    objective: choice(input.objective, 'Objective', ['balanced', 'lowest-cost', 'lowest-latency'], 'balanced'),
    runtime: 'sandbox-simulator', stateless: true,
  };
}
export function validateProvider(input = {}) {
  return {
    name: text(input.name, 'Node name', 40, 'LUMEN-07'),
    region: text(input.region, 'Region', 40, 'US West'),
    gpu: text(input.gpu, 'GPU description', 80, 'NVIDIA RTX 4090'),
    architecture: choice(input.architecture, 'Architecture', ['amd64', 'arm64'], 'amd64'),
    accelerator: choice(input.accelerator, 'Accelerator', ['cuda', 'cpu', 'metal'], 'cuda'),
    vram: number(input.vram, 'VRAM (GB)', 0, 192, 24),
    ram: number(input.ram, 'RAM (GB)', 1, 512, 64),
    cuda: number(input.cuda, 'CUDA version', 0, 14, 12.4),
    price: number(input.price, 'Hourly rate', 0.01, 20, 0.38),
    latency: number(input.latency, 'Simulated p95 (ms)', 5, 2000, 45),
  };
}
