import { esc, icon, patch, statusLabel, time } from '../ui.js';
class AstraPanel extends HTMLElement {
  set state(s) {
    const j=s.job, p=s.providers.find(n=>n.id===j?.providerId);
    const recovery=j && ['failing-over','rescheduling'].includes(j.status);
    const phase=j?.status ?? 'idle';
    const step=({idle:0,inspecting:1,scheduling:2,rescheduling:2,deploying:3,healthy:5,'failing-over':1,blocked:2,stopped:0})[phase];
    const steps=recovery ? ['Revoke lost provider lease','Find compatible standby','Restart isolated workload','Verify workload health','Resume receipt-based billing'] : ['Inspect workload manifest','Match compatible providers','Provision isolated runtime','Verify workload health','Meter healthy compute'];
    const active=recovery ? 'Autonomous recovery' : j?.status==='healthy' ? 'Mission in progress' : j?.status==='blocked' ? 'Placement needs attention' : 'Intelligence, in motion.';
    const decisionMode = j?.decision?.mode;
    const modelStatus = s.mode !== 'openai' ? 'SIMULATED' : ['scheduling', 'rescheduling'].includes(phase) ? 'SELECTING' : decisionMode === 'openai' ? 'LIVE MODEL' : decisionMode === 'fallback' ? 'FALLBACK' : 'NOT CALLED';
    const recent=s.events.slice(0,5);
    const signature=[modelStatus,s.mode,s.scheduler.model,j?.id,j?.status,j?.phase,j?.decision?.summary,p?.id,p?.emitting,j?.failures,s.demo.running,s.demo.step,s.demo.completed,...recent.map(e=>e.id)].join('|');
    if (this._sig===signature) return; this._sig=signature;
    patch(this, `<div class="astra-heading"><span class="astra-avatar"><img src="/mark.svg" alt="" width="25" height="25"></span><div><h2>Astra orchestration</h2><p>${s.mode==='openai' ? esc(s.scheduler.model ?? 'Model not configured') : 'GPT-6 Astra'} <span class="ai-mode">${modelStatus}</span></p></div><span class="dot ${recovery?'red':'violet'}"></span></div>
      <div class="astra-body"><div class="agent-label">YOUR AUTONOMOUS COMPUTE AGENT</div><h3>${active}</h3><p class="agent-description">${recovery?'A node went dark. Your workload doesn’t have to. Astra is securing your balance and finding a new home.':j?.decision?.summary ? esc(j.decision.summary) : 'Tell Astra what you need. It finds the right machine, watches every heartbeat, and keeps your workload moving.'}</p>
      <div class="agent-steps">${steps.map((label,i)=>`<div class="agent-step ${step>i+1 || phase==='healthy' ? 'complete' : step===i+1?'current':''}"><span class="step-icon">${step>i+1 || phase==='healthy' ? icon('check') : `<span>${String(i+1).padStart(2,'0')}</span>`}</span><span>${label}</span>${step===i+1 && phase!=='healthy' ? '<i class="working-dot"></i>':''}</div>`).join('')}</div>
      ${j ? `<div class="agent-assignment ${recovery?'recovery-assignment':''}"><div><span class="dot ${recovery?'red':j.status==='healthy'?'mint':'violet'}"></span>${esc(statusLabel(j.status))}</div><strong>${esc(p?.name ?? (recovery?'Searching the grid…':j.spec.name))}</strong><span>${p ? `${p.latency} ms p95 <i>·</i> $${p.price.toFixed(2)}/hr` : esc(j.phase)}</span></div>` : `<div class="agent-promise">${icon('shield')}<span>Resilience is built in.<br><small>Not bolted on.</small></span><span class="promise-dot"></span></div>`}
      <div class="astra-stream"><div class="stream-title"><span>ASTRA ACTIVITY</span><i>${recovery?'REORCHESTRATING':'LIVE'}</i></div>${recent.map((event,index)=>`<div class="stream-event ${index===0?'latest':''}"><time>${time(event.at)}</time><span>${esc(event.title)}</span></div>`).join('')}</div>
      </div><div class="astra-bottom"><button class="button demo-button" data-action="demo" ${s.demo.running?'disabled':''}>${icon(s.demo.running?'activity':s.demo.completed?'refresh':'play')} ${s.demo.running?'Demo in progress':s.demo.completed?'Replay the experience':'Run the live demo'} <span class="demo-time">${s.demo.running?String(s.demo.step).padStart(2,'0')+'/06':'↗'}</span></button><p>${s.demo.running?esc(s.demo.label):'One workload. One failure. Zero guesswork.'}</p></div>`);
  }
}
customElements.define('astra-panel', AstraPanel);
