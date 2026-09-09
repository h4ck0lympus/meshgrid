import { api, esc, fillIcons, icon, money, patch, statusLabel, time } from './ui.js';
import './components/topology.js';
import './components/providers.js';
import './components/astra.js';

const $ = selector => document.querySelector(selector);
const dialog = $('#drawer');
const form = $('#deploy-form');
const computeForm = $('#compute-form');
let snapshot;
let connected = false;
let busy = false;
let drawer = '';
let inspectedProvider = '';
let formJobId = '';
let computeResult;
let toastTimer;

fillIcons();

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').className = 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, 3800);
}

function isHealthy(job, provider) {
  return job?.status === 'healthy' && provider?.emitting && provider.status === 'online' && provider.latency <= job.spec.maxLatency;
}

function render() {
  if (!snapshot) return;
  const job = snapshot.job;
  const provider = snapshot.providers.find(item => item.id === job?.providerId);
  const active = job && !['stopped', 'completed'].includes(job.status);
  const healthy = isHealthy(job, provider);
  const interrupted = job?.status === 'healthy' && (!provider?.emitting || provider?.status === 'offline');
  const recovering = interrupted || ['failing-over', 'rescheduling'].includes(job?.status);

  document.body.classList.toggle('state-recovering', Boolean(recovering));
  $('#node-count').textContent = String(snapshot.stats.online).padStart(2, '0');
  $('#vram-count').textContent = `${snapshot.stats.vram}GB`;
  $('#workload-count').textContent = healthy ? '01' : '00';
  $('#provider-total').textContent = String(snapshot.stats.total).padStart(2, '0');
  $('#network-health-label').textContent = recovering ? 'Network rearranging around a failure' : 'Community network operational';
  $('#connection').innerHTML = `<span class="dot ${connected ? 'mint' : 'red'}"></span> ${connected ? 'Control plane online' : 'Reconnecting to control plane'}`;

  $('#deploy-fields').disabled = Boolean(active || busy || !connected);
  $('#deploy-label').textContent = active ? 'Workload active' : busy ? 'Astra is inspecting…' : 'Deploy with Astra';
  $('#form-message').textContent = active ? `${job.spec.name} is active. Stop it to submit another workload.` : 'Astra chooses infrastructure from your intent.';

  if (job && job.id !== formJobId) {
    formJobId = job.id;
    for (const [name, value] of Object.entries(job.spec)) {
      const field = form.elements.namedItem(name);
      if (!field) continue;
      if (field instanceof RadioNodeList) {
        const radio = [...field].find(item => item.value === value);
        if (radio) radio.checked = true;
      } else field.value = value;
    }
  }

  $('#topology').state = snapshot;
  $('#astra-panel').state = snapshot;
  $('#providers').state = snapshot;

  const stateText = interrupted ? 'Heartbeat delayed' : job ? statusLabel(job.status) : 'Awaiting intent';
  $('#workload-status').innerHTML = `<i class="dot ${recovering ? 'red' : healthy ? 'mint' : 'violet'}"></i> ${esc(stateText)}`;
  $('#metered-seconds').textContent = ((job?.verifiedMs ?? 0) / 1000).toFixed(1);
  $('#provider-rate').textContent = provider ? `$${provider.price.toFixed(2)}/hr` : '—';
  $('#recovery-time').textContent = job?.lastRecoveryMs ? `${(job.lastRecoveryMs / 1000).toFixed(1)} sec` : recovering ? 'In progress' : 'Ready';

  $('#route-status').textContent = healthy ? `READY · ${provider.name}` : recovering ? 'ROUTING…' : 'WAITING FOR WORKLOAD';
  $('#route-status').className = healthy ? 'ready' : recovering ? 'routing' : '';
  $('#run-compute').disabled = !healthy || busy;
  $('#compute-command').disabled = !healthy || busy;
  renderComputeResult(provider, healthy, recovering);

  if (dialog.open && drawer) renderDrawer();
}

function renderComputeResult(provider, healthy, recovering) {
  if (computeResult) {
    patch($('#compute-result'), `<div class="result-meta"><span>200 OK</span><span>${computeResult.latency_ms} ms · simulated</span><span>${esc(computeResult.provider.name)}</span></div><p>${esc(computeResult.result.summary)}</p><code>${esc(computeResult.command)}</code>`);
    return;
  }
  patch($('#compute-result'), recovering
    ? '<div class="routing-state"><i></i><span>Same route. New provider being selected.</span></div>'
    : healthy
      ? `<div class="result-meta"><span>READY</span><span>stable control-plane route</span><span>${esc(provider.name)}</span></div><p>Send a compute task to the selected machine.</p>`
      : '<span>—</span><p>Your task will be routed to the selected provider.</p>');
}

function providerRows() {
  return snapshot.providers.map(provider => `<button class="drawer-provider" data-action="node" data-id="${esc(provider.id)}"><span class="provider-glyph">${icon('cpu')}</span><span><strong>${esc(provider.name)}</strong><small>${esc(provider.gpu)} · ${provider.vram} GB · ${esc(provider.region)}</small></span><span class="provider-price"><i class="dot ${!provider.emitting || provider.status === 'offline' ? 'red' : 'mint'}"></i>$${provider.price.toFixed(2)}/hr</span></button>`).join('');
}

function renderDrawer() {
  const job = snapshot?.job;
  let title = '';
  let content = '';
  if (drawer === 'guide') {
    title = 'What this prototype proves';
    content = `<p class="dialog-copy">AstraGrid turns a declared OCI workload and desired SLO into a placement decision, then watches provider heartbeats and reroutes after failure.</p><div class="truth-grid"><div><strong>WORKING NOW</strong><p>Control-plane state, compatibility filters, placement, heartbeat loss, fenced leases, recovery, demo accounting, and fresh CPU challenges.</p></div><div><strong>SIMULATED</strong><p>OCI execution, gVisor isolation, GPU identity and performance, workload migration, compute results, pricing, and payments.</p></div></div><div class="architecture-flow"><span>CONSUMER<br><small>OCI + SLO</small></span><i>→</i><span>ASTRA<br><small>planner</small></span><i>→</i><span>CONTROL PLANE<br><small>route + recover</small></span><i>→</i><span>PROVIDER<br><small>GPU capacity</small></span></div>`;
  }
  if (drawer === 'network') {
    title = 'The provider network';
    content = `<p class="dialog-copy">${snapshot.stats.online} machines are reporting. Hardware and pricing on built-in nodes are demo fixtures.</p><div class="drawer-provider-list">${providerRows()}</div><div class="dialog-actions"><button class="button primary" data-action="register">Add a simulated provider</button></div>`;
  }
  if (drawer === 'node') {
    const provider = snapshot.providers.find(item => item.id === inspectedProvider);
    title = provider?.name ?? 'Provider evidence';
    if (!provider) content = '<p class="dialog-copy">This provider is no longer registered.</p>';
    else {
      const active = job?.providerId === provider.id;
      content = `<div class="node-hero"><span>${icon('cpu')}</span><div><small>${esc(provider.region.toUpperCase())}</small><h3>${esc(provider.gpu.replace('NVIDIA ', ''))}</h3><p>${provider.vram} GB VRAM · ${provider.ram} GB RAM · $${provider.price.toFixed(2)}/hr</p></div><span class="status-chip ${!provider.emitting ? 'danger' : active ? 'assigned' : ''}">${!provider.emitting ? 'OFFLINE' : active ? 'ASSIGNED' : 'AVAILABLE'}</span></div><div class="evidence-list">${[['Hardware identity', 'Self-reported'], ['Node source', provider.source], ['CPU challenge', provider.verification.status], ['Observed latency', `${provider.latency} ms · synthetic`], ['GPU benchmark', 'Not performed'], ['Runtime isolation', 'Planned, not executed']].map(([label, value]) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div><div class="dialog-actions">${provider.source === 'simulation' ? `<button class="button ${provider.emitting ? 'danger' : ''}" data-action="${provider.emitting ? 'kill' : 'revive'}" data-id="${esc(provider.id)}">${provider.emitting ? 'Disconnect provider' : 'Reconnect provider'}</button>` : '<p class="dialog-copy">Stop the provider process to interrupt its heartbeat.</p>'}</div>`;
    }
  }
  if (drawer === 'trace') {
    title = 'Astra placement race';
    const candidates = job?.candidates ?? [];
    content = job ? `<p class="dialog-copy">Goal: <strong>${esc(job.spec.objective.replaceAll('-', ' '))}</strong>. Hard constraints gate the field before Astra ranks the viable shortlist.</p><div class="race-list">${candidates.map((candidate, index) => `<div class="race-row ${candidate.compatible ? '' : 'rejected'}"><div><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(candidate.name)}</strong><small>${candidate.compatible ? `$${candidate.price.toFixed(2)}/hr · ${candidate.latency} ms` : esc(candidate.reasons.join(' · '))}</small></div><div class="race-track"><i style="width:${candidate.compatible ? Math.max(8, candidate.score) : 4}%"></i></div><b>${candidate.compatible ? Math.round(candidate.score) : '×'}</b></div>`).join('')}</div><div class="astra-quote"><span>ASTRA</span><p>${esc(job.decision?.summary ?? job.phase)}</p></div>` : '<div class="empty-drawer"><span class="orbit-loader"></span><h3>No decision yet</h3><p>Deploy a workload to watch compatible providers race for placement.</p></div>';
  }
  if (drawer === 'ledger') {
    title = 'Protected demo balance';
    content = job ? `<p class="dialog-copy">Charges pause during recovery. Unused reserve returns to the available demo balance.</p><div class="ledger-grid">${[['Budget', job.ledger.depositNanos], ['Available', job.ledger.availableNanos], ['Reserve held', job.ledger.heldNanos], ['Settled usage', job.ledger.settledNanos], ['Returned', job.ledger.refundedNanos]].map(([label, value]) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('')}</div><p class="ledger-proof">Budget = available + reserve + settled. Demo credits only; no money moves.</p>` : '<div class="empty-drawer"><h3>No balance reserved</h3><p>Deploy a workload to see receipt-based demo accounting.</p></div>';
  }
  if (drawer === 'register') {
    title = 'Join the living grid';
    content = `<p class="dialog-copy">For the hackathon demo, add a simulated provider or run the local provider agent on another machine.</p><pre class="command-block">$ npm run provider</pre><form id="provider-form" class="provider-form"><label>Node name<input name="name" value="NOVA-${snapshot.providers.length + 1}" maxlength="40" required></label><div class="form-pair"><label>GPU<input name="gpu" value="NVIDIA RTX 4090" maxlength="80" required></label><label>VRAM · GB<input name="vram" type="number" value="24" min="0" max="192" required></label></div><div class="form-pair"><label>Price · $/hr<input name="price" type="number" value="0.30" min="0.01" max="20" step="0.01" required></label><label>Latency · ms<input name="latency" type="number" value="42" min="5" max="2000" required></label></div><button class="button primary" type="submit">Discover simulated node →</button></form>`;
  }
  if (drawer === 'workload') {
    title = 'Active workload';
    content = job ? `<div class="workload-detail"><span class="status-chip ${job.status === 'healthy' ? 'healthy' : ''}">${esc(statusLabel(job.status).toUpperCase())}</span><h3>${esc(job.spec.name)}</h3><code>${esc(job.spec.image)}</code><div class="evidence-list">${[['Objective', job.spec.objective], ['SLO', `p95 ≤ ${job.spec.maxLatency} ms`], ['Rate ceiling', `$${job.spec.maxPrice.toFixed(2)}/hr`], ['Accelerator', job.spec.accelerator.toUpperCase()], ['Provider', snapshot.providers.find(item => item.id === job.providerId)?.name ?? 'Searching']].map(([label, value]) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div><div class="dialog-actions"><button class="button danger" data-action="stop">Stop workload</button></div></div>` : '<p class="dialog-copy">No workload is active.</p>';
  }
  $('#drawer-title').textContent = title;
  patch($('#drawer-body'), content);
}

function openDrawer(kind, providerId = '') {
  if (!snapshot && kind !== 'guide') return toast('Waiting for the control plane.');
  drawer = kind;
  inspectedProvider = providerId;
  renderDrawer();
  if (!dialog.open) dialog.showModal();
}

async function performAction(action, id) {
  if (action === 'close') return dialog.close();
  if (action === 'home') return window.scrollTo({ top: 0, behavior: 'smooth' });
  if (action === 'deploy') { window.scrollTo({ top: 0, behavior: 'smooth' }); return setTimeout(() => $('#image-input').focus(), 450); }
  if (action === 'network') return openDrawer('network');
  if (action === 'trace') return openDrawer('trace');
  if (action === 'ledger') return openDrawer('ledger');
  if (action === 'guide') return openDrawer('guide');
  if (action === 'register') return openDrawer('register');
  if (action === 'node') return openDrawer('node', id);
  if (action === 'workload') return openDrawer('workload');
  if (action === 'zoom-in') return $('#topology').zoomBy(.12);
  if (action === 'zoom-out') return $('#topology').zoomBy(-.12);
  if (action === 'fit') return $('#topology').fit();
  if (action === 'copy') {
    await navigator.clipboard.writeText(`curl -X POST http://localhost:3000/api/compute -H 'Content-Type: application/json' -d '{"command":"python /workspace/run.py --batch 20"}'`);
    return toast('Compute request copied.');
  }
  if (busy || !connected) return;
  if (action === 'demo' && snapshot.job && !confirm('Start a fresh failover demo? This replaces the active workload and demo balance.')) return;
  busy = true; render();
  try {
    if (action === 'demo') { computeResult = null; await api('/api/demo/start', {}); }
    if (action === 'kill') { await api(`/api/providers/${id}/offline`, {}); toast('Heartbeat interrupted. Astra is watching.'); }
    if (action === 'revive') await api(`/api/providers/${id}/online`, {});
    if (action === 'stop') await api('/api/workload/stop', {});
    snapshot = await api('/api/state');
    if (dialog.open && ['kill', 'revive', 'stop'].includes(action)) dialog.close();
  } finally { busy = false; render(); }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  performAction(button.dataset.action, button.dataset.id).catch(error => toast(error.message));
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !connected) return;
  const specification = Object.fromEntries(new FormData(form));
  for (const name of ['minVram', 'minRam', 'minCuda', 'maxLatency', 'maxPrice', 'budget']) specification[name] = Number(specification[name]);
  busy = true; computeResult = null; $('#form-error').textContent = ''; render();
  try {
    await api('/api/workloads', specification);
    snapshot = await api('/api/state');
    setTimeout(() => document.querySelector('.network-layout').scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { busy = false; render(); }
});

computeForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !connected) return;
  const command = new FormData(computeForm).get('command');
  busy = true; render();
  try {
    computeResult = await api('/api/compute', { command });
    snapshot = await api('/api/state');
  } catch (error) { computeResult = null; toast(error.message); }
  finally { busy = false; render(); }
});

dialog.addEventListener('submit', async event => {
  if (event.target.id !== 'provider-form') return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  for (const name of ['vram', 'price', 'latency']) data[name] = Number(data[name]);
  busy = true;
  try { await api('/api/providers', data); snapshot = await api('/api/state'); dialog.close(); toast(`${data.name} discovered on the grid.`); }
  finally { busy = false; render(); }
});

dialog.addEventListener('close', () => { drawer = ''; });
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'd' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) performAction('deploy');
  if (event.key === 'Escape' && dialog.open) dialog.close();
});

async function connect() {
  try { snapshot = await api('/api/state'); connected = true; render(); }
  catch { connected = false; $('#connection').innerHTML = '<span class="dot red"></span> Control plane unavailable'; }
  const stream = new EventSource('/api/events');
  stream.onmessage = event => { snapshot = JSON.parse(event.data); connected = true; render(); };
  stream.onerror = () => { connected = false; render(); };
}

connect();
