export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (nanos = 0, digits = 6) => '$' + (nanos / 1e9).toFixed(digits);
export const time = ms => new Date(ms).toLocaleTimeString([], { hour12: false });
export const statusLabel = s => ({ 'failing-over': 'Failing over', 'rescheduling': 'Finding backup', 'inspecting': 'Inspecting', 'scheduling': 'Matching', 'deploying': 'Starting runtime', 'healthy': 'Healthy', 'blocked': 'No compatible capacity', 'stopped': 'Stopped' }[s] ?? s);
const icons = {
  network: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><path d="m6 7 4 3m4 0 4-3M7 18l3-4m4 0 4 4"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M12 7h5m-5 11h5"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v12H5a3 3 0 0 1-3-3V6"/><path d="M21 12h-6v6h6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><circle cx="12" cy="12" r="3"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M3 3l6 6m6 6 6 6M21 3l-6 6M9 15l-6 6"/>',
  terminal: '<path d="m4 5 6 7-6 7m9 0h7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7Zm0 0L11 13"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  power: '<path d="M12 2v10M6 5a9 9 0 1 0 12 0"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="m12 3 10 18H2L12 3ZM12 9v5m0 3v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
export function icon(name, cls = '') { return `<svg class="icon ${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.box}</svg>`; }
export function fillIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon); }); }
export function patch(el, html) { if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }
export async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
  return result;
}
