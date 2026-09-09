import { api, esc, icon, money, patch, time } from './ui.js';

const select = selector => document.querySelector(selector);
const dialog = select('#drawer');
const form = select('#deploy-form');
let snapshot;
let connected = false;
let busy = false;
let drawer = '';
let inspectedProvider = '';
let formJobId;
let toastTimer;
let endpointResult;

function toast(message) {
  select('#toast').textContent = message;
  select('#toast').className = 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { select('#toast').className = ''; }, 4500);
}

function modelLabel() {
  if (snapshot.mode !== 'openai') return 'Offline scheduler';
  if (snapshot.job?.decision?.mode === 'fallback') return 'Astra unavailable · rules fallback';
  if (snapshot.job?.decision?.mode === 'openai') return 'Astra · live model decision';
  return 'Astra configured · awaiting a decision';
}

function render() {
  if (!snapshot) return;
  const workload = snapshot.job;
  const provider = snapshot.providers.find(node => node.id === workload?.providerId);
  const previous = snapshot.providers.find(node => node.id === workload?.previousProviderId);
  const active = workload && !['stopped', 'completed'].includes(workload.status);
  const interrupted = workload?.status === 'healthy' && (!provider?.emitting || provider.status === 'offline');
  const recovering = workload && (['failing-over', 'rescheduling'].includes(workload.status) || workload.failoverStartedAt != null);
  const healthy = workload?.status === 'healthy' && !interrupted && provider.latency <= workload.spec.maxLatency;
  const status = interrupted ? 'Provider disconnected' : ({
    inspecting: 'Checking requirements', scheduling: 'Choosing a provider', deploying: recovering ? 'Starting the replacement' : 'Starting the workload',
    healthy: healthy ? 'Workload is running' : 'Performance limit exceeded', 'failing-over': 'Recovering your workload',
    rescheduling: 'Finding a replacement', blocked: 'No eligible provider', stopped: 'Workload stopped',
  })[workload?.status];

  select('#node-count').textContent = snapshot.stats.online;
  select('#connection').textContent = connected ? '● Connected' : '○ Reconnecting';
  select('#connection').className = connected ? 'connected' : '';
  select('#mode-label').textContent = modelLabel();
  select('#deploy-fields').disabled = Boolean(active || busy || !connected);
  select('#demo-button').disabled = busy || !connected || snapshot.demo.running;
  select('#form-message').textContent = active ? 'One workload is active. Stop it to change these settings.' : 'An eligible node must meet your price and hardware limits.';
  if (workload && workload.id !== formJobId) {
    formJobId = workload.id;
    for (const [name, value] of Object.entries(workload.spec)) {
      const field = form.elements.namedItem(name);
      if (field) field.value = value;
    }
  }

  if (!workload) {
    patch(select('#execution-content'), `<div class="empty-state"><div class="empty-mark"><img src="/mark.svg" width="46" height="46" alt=""></div><h2 id="execution-heading">A home for your workload.</h2><p>Deploy to see the selected provider.<br>Or watch the automatic failover demo.</p></div>`);
    patch(select('#execution-actions'), '');
  } else {
    const tone = interrupted || recovering || workload.status === 'blocked' ? 'warning' : healthy ? 'good' : '';
    const planner = workload.decision?.mode === 'openai' ? 'ASTRA DECISION' : 'SCHEDULER DECISION';
    const explanation = recovering ? 'The previous provider is unavailable. Selecting a replacement within the same hardware and price limits.'
      : workload.rejection || workload.decision?.summary || 'Checking the declared workload against the available network.';
    patch(select('#execution-content'), `<div class="state-heading"><div><h2 id="execution-heading">${esc(status)}</h2><p>${esc(workload.spec.name)}</p></div><span class="status ${tone}">${healthy ? 'HEALTHY' : interrupted ? 'OFFLINE' : recovering ? 'RECOVERING' : esc(workload.status.toUpperCase())}</span></div>
      ${workload.lastRecoveryMs && healthy ? `<div class="recovery-note">${icon('check')} Recovered on ${esc(provider.name)} · ${(workload.lastRecoveryMs / 1000).toFixed(1)}s after detection</div>` : ''}
      <div class="placement ${healthy ? 'running' : recovering ? 'recovering' : ''}"><div class="placement-card">${icon('box')}<small>YOUR WORKLOAD</small><strong>${esc(workload.spec.name)}</strong><small>${esc(workload.spec.architecture)} · ${esc(workload.spec.accelerator.toUpperCase())}</small></div><div class="placement-wire" aria-hidden="true"></div><div class="placement-card ${healthy ? 'active' : ''}">${icon('server')}<small>${recovering ? 'REPLACEMENT PROVIDER' : 'ASSIGNED PROVIDER'}</small><strong>${esc(provider?.name || (recovering ? 'Finding a node…' : 'Not assigned'))}</strong><small>${esc(provider?.gpu.replace('NVIDIA ', '') || (previous && recovering ? 'Previously ' + previous.name : 'Awaiting placement'))}</small></div></div>
      <div class="decision"><small>${planner}</small>${esc(explanation)}</div>
      ${workload.status === 'blocked' ? '<p class="notice warning">Nothing is running. Update your limits or add compatible capacity, then retry.</p>' : ''}
      <div class="limits"><div><small>PROVIDER RATE</small>${provider ? '$' + provider.price.toFixed(2) + '/hr' : '—'}</div><div><small>YOUR RATE LIMIT</small>$${workload.spec.maxPrice.toFixed(2)}/hr</div><div><small>BUDGET CAP</small>$${workload.spec.budget.toFixed(3).replace(/0$/, '')}</div></div>`);
    patch(select('#execution-actions'), `${healthy ? '<button class="button" data-action="endpoint">Run compute task ↗</button>' : ''}${healthy && provider.source === 'simulation' && !snapshot.demo.running ? `<button class="button danger" data-action="kill" data-id="${esc(provider.id)}">Disconnect provider</button>` : ''}${workload.status === 'blocked' ? '<button class="button" data-action="retry">Retry placement</button><button class="button" data-action="edit">Edit limits</button>' : ''}${active ? '<button class="quiet" data-action="stop">Stop workload</button>' : ''}`);
    select('#execution-actions').querySelectorAll('button').forEach(button => { button.disabled = busy || !connected; });
  }

  if (select('#technical').open) renderActivity();
  if (dialog.open && ['network', 'provider', 'trace', 'ledger'].includes(drawer)) renderDrawer();
}

function renderActivity() {
  if (!snapshot) return;
  patch(select('#activity-list'), snapshot.events.slice(0, 12).map(event => `<div class="event"><time>${time(event.at)}</time><div>${esc(event.title)}<p>${esc(event.detail)}</p></div></div>`).join(''));
}

function renderDrawer() {
  const workload = snapshot?.job;
  let content = '';
  if (drawer === 'guide') content = `<p class="dialog-copy">The demo follows one OCI workload through placement, provider loss, and recovery. It takes about 25 seconds with the offline scheduler.</p><ol class="guide-steps"><li><strong>A node joins the network.</strong><p>A simulated provider advertises its hardware and rate.</p></li><li><strong>The workload gets a provider.</strong><p>Astra checks the declared SLO, budget, and hardware requirements, then selects an eligible node.</p></li><li><strong>The provider disconnects.</strong><p>The demo stops its heartbeat automatically. You can also disconnect a provider manually after deploying a workload.</p></li><li><strong>The workload recovers elsewhere.</strong><p>The watchdog detects the loss, revokes the old assignment, and restarts the simulated workload on a compatible backup.</p></li></ol><div class="notice"><strong>What’s real?</strong><p>The backend state, eligibility checks, watchdog, recovery, and agent CPU challenges. OCI execution, GPU performance, and payments are simulated. Tasks fail during recovery; subsequent tasks use the same control-plane route.</p></div><p class="dialog-copy">${snapshot ? esc(modelLabel()) + '.' : ''} The optional Astra adapter makes live placement decisions when configured successfully.</p>`;
  if (drawer === 'network') content = `<p class="dialog-copy">${snapshot.stats.online} nodes online. Select a node to inspect its evidence. Built-in nodes are simulated.</p>${snapshot.providers.map(provider => `<div class="provider-row"><div class="provider-heading"><button data-action="provider" data-id="${esc(provider.id)}"><strong>${esc(provider.name)}</strong></button><span class="status ${provider.status === 'online' && provider.emitting ? 'good' : ''}">${esc(!provider.emitting ? 'offline' : provider.status)}</span></div><p>${esc(provider.gpu)} · ${provider.vram} GB VRAM · $${provider.price.toFixed(2)}/hr</p><small>${provider.source === 'simulation' ? 'Simulated node' : 'Local agent · CPU challenge ' + esc(provider.verification.status)}</small></div>`).join('')}<div class="dialog-actions"><button class="button" data-action="register">Add simulated node</button></div><p class="field-note">For real local telemetry and CPU challenges, run <code>npm run provider</code> in another terminal.</p>`;
  if (drawer === 'provider') {
    const provider = snapshot.providers.find(node => node.id === inspectedProvider);
    if (!provider) content = '<p class="dialog-copy">This node is no longer registered.</p>';
    else {
      const verification = provider.verification;
      const evidence = [['Hardware', provider.gpu + ' · self-reported'], ['Memory', `${provider.vram} GB VRAM / ${provider.ram} GB RAM · reported`], ['Source', provider.source], ['CPU challenge', verification.status], ['Measured round trip', verification.roundTripMs == null ? 'Not measured' : verification.roundTripMs + ' ms'], ['Last successful check', verification.checkedAt == null ? 'Never' : time(verification.checkedAt)], ['Valid until', verification.validUntil == null ? 'No measured evidence' : time(verification.validUntil)], ['GPU benchmark', 'Not performed']];
      content = `<p class="dialog-copy">${esc(provider.name)} · ${esc(provider.region)}</p>${evidence.map(([label, value]) => `<div class="evidence-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}<p class="notice">${esc(verification.reason || verification.note)}</p><div class="dialog-actions">${provider.source === 'simulation' ? `<button class="button ${provider.emitting ? 'danger' : ''}" data-action="${provider.emitting ? 'kill' : 'revive'}" data-id="${esc(provider.id)}">${provider.emitting ? 'Disconnect provider' : 'Reconnect provider'}</button>` : '<p class="field-note">Stop the provider process to interrupt its heartbeat.</p>'}</div>`;
    }
  }
  if (drawer === 'trace') content = workload ? `<p class="dialog-copy">${esc(workload.decision?.summary || workload.rejection || 'Evaluating the network…')}</p><p class="field-note">${esc(modelLabel())}. Candidate rates and latency are demo values.</p>${(workload.candidates || []).map(candidate => `<div class="candidate"><strong>${esc(candidate.name)}</strong> · ${candidate.compatible ? 'Eligible' : 'Excluded'}<p>${candidate.compatible ? '$' + candidate.price.toFixed(2) + '/hr · ' + candidate.latency + ' ms synthetic latency' : esc(candidate.reasons.join(' · '))}</p></div>`).join('')}` : '<p class="dialog-copy">Deploy a workload to see its placement decision.</p>';
  if (drawer === 'ledger') content = workload ? `<p class="dialog-copy">Demo balances. Charges pause during recovery; unused reserve returns to the available balance.</p>${[['Budget', workload.ledger.depositNanos], ['Available', workload.ledger.availableNanos], ['Reserved', workload.ledger.heldNanos], ['Settled usage', workload.ledger.settledNanos], ['Cumulative reserve returned', workload.ledger.refundedNanos]].map(([label, amount]) => `<div class="evidence-row"><span>${label}</span><strong>${money(amount)}</strong></div>`).join('')}<p class="field-note">Budget = available + reserved + settled. Returned reserve is already included in those balances.</p>` : '<p class="dialog-copy">No budget is reserved.</p>';
  if (drawer === 'endpoint') content = `<p class="dialog-copy">Submit a task to the active OCI workload. Astra keeps it within the declared SLO and budget, and the control-plane route stays stable after failover.</p><pre>POST /api/compute</pre><form id="compute-form" class="endpoint-form"><label>Workload command<input id="compute-command" name="command" value="python /workspace/task.py --input demo" maxlength="2000" required spellcheck="false"></label><button class="button" id="run-compute" type="submit">Run task</button></form><div id="endpoint-result">${endpointResult ? `<pre>${esc(endpointResult)}</pre>` : ''}</div><p class="field-note">Simulation only. No OCI image or consumer command is executed in this demo.</p>`;
  patch(select('#drawer-body'), content);
  select('#drawer-body').querySelectorAll('button[data-action]').forEach(button => { button.disabled = busy || !connected; });
}

function openDrawer(kind, providerId) {
  drawer = kind;
  inspectedProvider = providerId || '';
  select('#drawer-title').textContent = ({ guide: 'How the demo works', network: 'Compute network', provider: 'Provider evidence', trace: 'Placement decision', ledger: 'Demo accounting', endpoint: 'Compute task console' })[kind];
  renderDrawer();
  if (!dialog.open) dialog.showModal();
}

async function performAction(action, providerId) {
  if (action === 'close') { dialog.close(); return; }
  if (['guide', 'network', 'provider', 'trace', 'ledger', 'endpoint'].includes(action)) {
    if (!snapshot && action !== 'guide') { toast('Waiting for the local server.'); return; }
    openDrawer(action, providerId); return;
  }
  if (busy || !connected) return;
  if (action === 'demo' && snapshot.job && !confirm('Start a fresh demo? This replaces the current workload and demo balance.')) return;
  busy = true; render();
  try {
    if (action === 'demo') await api('/api/demo/start', {});
    if (action === 'kill') { await api(`/api/providers/${providerId}/offline`, {}); toast('Provider disconnected. Waiting for the watchdog.'); }
    if (action === 'revive') await api(`/api/providers/${providerId}/online`, {});
    if (action === 'stop' || action === 'edit') await api('/api/workload/stop', {});
    if (action === 'retry') await api('/api/workload/retry', {});
    if (action === 'register') { await api('/api/providers', { name: `NODE-${snapshot.providers.length + 1}` }); toast('Simulated node added.'); }
    snapshot = await api('/api/state');
    if (dialog.open && action !== 'register') dialog.close();
  } finally {
    busy = false; render();
    if (action === 'edit') form.elements.maxPrice.focus();
  }
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
  busy = true; select('#form-error').textContent = ''; render();
  try {
    await api('/api/workloads', specification);
    snapshot = await api('/api/state');
  } catch (error) { select('#form-error').textContent = error.message; }
  finally { busy = false; render(); }
});

dialog.addEventListener('submit', async event => {
  if (event.target.id !== 'compute-form') return;
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const response = await api('/api/compute', { command: new FormData(event.target).get('command') });
    endpointResult = `200 OK · ${response.provider.name}\n\n${response.result.summary}\n${response.command}\n\nSimulated task`;
  } catch (error) { endpointResult = error.message; }
  finally {
    button.disabled = false;
    if (drawer === 'endpoint' && dialog.open) patch(select('#endpoint-result'), `<pre>${esc(endpointResult)}</pre>`);
  }
});
dialog.addEventListener('close', () => { drawer = ''; });
select('#technical').addEventListener('toggle', renderActivity);

async function connect() {
  try { snapshot = await api('/api/state'); connected = true; render(); }
  catch { select('#connection').textContent = 'Server unavailable'; select('#deploy-fields').disabled = true; select('#demo-button').disabled = true; }
  const stream = new EventSource('/api/events');
  stream.onmessage = event => { snapshot = JSON.parse(event.data); connected = true; render(); };
  stream.onerror = () => { connected = false; render(); };
}
connect();
