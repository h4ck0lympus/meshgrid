import { esc, icon, patch } from '../ui.js';
const positions = [[230,83],[740,85],[825,257],[665,392],[295,393],[115,260],[490,420]];
const core = { x: 475, y: 237 };
const point = i => positions[i] ?? [475 + 365 * Math.cos((i - 6) * 0.62), 237 + 182 * Math.sin((i - 6) * 0.62)];

class GridTopology extends HTMLElement {
  constructor() { super(); this.zoom = 1; }
  set state(s) { this._state = s; this.render(); }
  zoomBy(amount) { this.zoom = Math.min(1.35, Math.max(0.75, this.zoom + amount)); this.applyZoom(); }
  fit() { this.zoom = 1; this.applyZoom(); }
  applyZoom() { if (this.firstElementChild) this.firstElementChild.style.transform = `scale(${this.zoom})`; }
  render() {
    const s = this._state; if (!s) return;
    const j = s.job, failed = j && ['failing-over','rescheduling'].includes(j.status);
    const active = j?.providerId;
    const current = s.providers.find(p => p.id === active);
    const interrupted = current && !current.emitting;
    const paths = s.providers.map((p, i) => {
      const [x,y] = point(i), selected = p.id === active, dead = p.status === 'offline' || !p.emitting;
      const d = `M ${core.x} ${core.y} Q ${(core.x+x)/2 + (i%2 ? 30 : -25)} ${(core.y+y)/2 - 25} ${x} ${y}`;
      return `<path class="network-link ${dead ? 'link-dead' : selected ? 'link-active' : failed ? 'link-scanning' : ''}" d="${d}"/>${selected && !dead ? `<path class="packet-line" d="${d}"/>` : ''}`;
    }).join('');
    const nodes = s.providers.map((p,i) => {
      const [x,y] = point(i), selected = p.id === active, dead = p.status === 'offline' || !p.emitting;
      const candidate = j?.candidates?.find(c => c.id === p.id);
      const tag = dead ? 'SIGNAL LOST' : p.status === 'verifying' ? 'VERIFYING' : selected ? (j.status === 'healthy' ? 'SERVING' : 'DEPLOYING') : candidate && !candidate.compatible ? 'NOT COMPATIBLE' : 'AVAILABLE';
      return `<button class="map-node ${selected ? 'assigned' : ''} ${dead ? 'offline' : ''} ${p.status === 'verifying' ? 'verifying' : ''} ${candidate && !candidate.compatible && !dead ? 'incompatible' : ''}" data-action="node" data-id="${esc(p.id)}" style="left:${x/9.5}%;top:${y/4.8}%" aria-label="Inspect ${esc(p.name)}, ${tag}">
        <span class="node-status"><span class="dot ${dead ? 'red' : selected ? 'violet' : 'mint'}"></span>${tag}</span>
        <span class="node-face"><span class="node-chip">${icon('cpu')}</span><span><b>${esc(p.name)}</b><small>${esc(p.gpu.replace('NVIDIA ',''))} <i>·</i> ${p.vram} GB</small></span></span>
        <span class="node-coordinates">${esc(p.region.toUpperCase())} <span>${p.latency} ms</span></span>
      </button>`;
    }).join('');
    const label = failed ? 'REORCHESTRATING' : interrupted ? 'SIGNAL INTERRUPTED' : j?.status === 'healthy' ? 'WORKLOAD ROUTED' : j && !['stopped','blocked'].includes(j.status) ? 'ORCHESTRATING' : 'INTELLIGENCE AT THE CORE';
    patch(this, `<div class="topology-content ${failed ? 'is-failing' : ''}">
      <svg class="topology-svg" viewBox="0 0 950 480" preserveAspectRatio="none" aria-hidden="true"><defs><radialGradient id="aura"><stop stop-color="#8570e2" stop-opacity="0.13"/><stop offset="1" stop-color="#8570e2" stop-opacity="0"/></radialGradient><pattern id="dots" width="23" height="23" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#34343e"/></pattern></defs>
      <rect width="950" height="480" fill="url(#dots)"/><ellipse cx="475" cy="237" rx="250" ry="214" fill="url(#aura)"/>
      <ellipse class="orbit-line" cx="475" cy="237" rx="170" ry="115"/><ellipse class="orbit-line outer" cx="475" cy="237" rx="310" ry="187"/>
      <path class="axis-line" d="M0 237h950M475 0v480"/>${paths}
      <g class="ambient-stars" fill="#8d83b8"><circle cx="355" cy="64" r="1.5"/><circle cx="593" cy="127" r="1.5"/><circle cx="737" cy="324" r="1.5"/><circle cx="194" cy="183" r="1.5"/><circle cx="360" cy="314" r="2"/><circle cx="535" cy="345" r="1.5"/></g></svg>
      <div class="core-anchor"><div class="core-eyebrow">${label}</div><div class="core-orbit"><span class="core-orbit-dot"></span></div><div class="core-orbit second"></div><button class="astra-core ${failed ? 'core-recovering' : ''}" data-action="trace" aria-label="Inspect Astra scheduling decisions"><img src="/mark.svg" alt="" width="55" height="55"></button><div class="core-label">ASTRA<span>THE ORCHESTRATION ENGINE</span></div></div>
      ${nodes}
    </div>`);
    this.applyZoom();
  }
}
customElements.define('grid-topology', GridTopology);
