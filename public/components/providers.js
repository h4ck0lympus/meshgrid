import { esc, icon, patch } from '../ui.js';
class ProviderList extends HTMLElement {
  set state(s) {
    const j = s.job;
    // Patch each card separately so the scroll container and keyboard focus are stable.
    for (const p of s.providers) {
      let card = this.querySelector(`[data-provider="${p.id}"]`);
      if (!card) { card = document.createElement('div'); card.dataset.provider = p.id; this.append(card); }
      const active = j?.providerId === p.id, offline = p.status === 'offline' || !p.emitting;
      const signature = [p.name,p.status,p.emitting,active,p.verification.status,p.price,p.gpu,p.source].join('|');
      if (card._sig === signature) continue;
      card._sig = signature;
      patch(card, `<button class="provider-card ${active ? 'selected' : ''} ${offline ? 'off' : ''}" data-action="node" data-id="${esc(p.id)}"><div class="provider-card-top"><span class="gpu-icon">${icon('cpu')}</span><span class="provider-tag ${active ? 'selected-tag' : ''}">${offline ? '<i class="dot red"></i> OFFLINE' : active ? '<i class="dot violet"></i> ASSIGNED' : p.status === 'verifying' ? 'VERIFYING' : '<i class="dot mint"></i> AVAILABLE'}</span></div><h3>${esc(p.gpu.replace('NVIDIA ',''))}</h3><div class="provider-ident">${esc(p.name)} <span>· ${p.vram} GB</span></div><div class="provider-card-bottom"><span>${icon('shield')} ${esc(p.source === 'simulation' ? 'SIMULATED' : p.verification.status === 'passed' ? 'CPU CHECK PASSED' : p.verification.status.toUpperCase())}</span><b>$${p.price.toFixed(2)}<small>/hr</small></b></div></button>`);
    }
    for (const card of this.children) if (!s.providers.some(p => p.id === card.dataset.provider)) card.remove();
  }
}
customElements.define('provider-list', ProviderList);
