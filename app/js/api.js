// ============================================================
//  KE – Portal B2B  |  Camada de sincronização + autenticação
//  Servidor (Netlify Functions + Blobs) é a fonte de verdade e
//  exige login (token). localStorage é só cache da sessão.
//  Se o servidor não responder (abrir arquivo direto), cai para
//  modo offline (localStorage) automaticamente.
// ============================================================

const API = '';                       // mesmo domínio
const TOKEN_KEY = 'ke_portal_token';
let ONLINE = false;                    // definido por probeOnline()

const LSK = {
  masters:        'ke_masters',
  representantes: 'ke_representantes',
  clientes:       'ke_clientes',
  metas:          'ke_metas',
  settings:       'ke_settings',
  orders:         'ke_orders',
};

function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { if (t) sessionStorage.setItem(TOKEN_KEY, t); }
function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

// ── HTTP ──────────────────────────────────────────────────
async function _fetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  const headers = { ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) headers['authorization'] = 'Bearer ' + tok;
  try {
    const r = await fetch(url, { ...opts, headers, signal: ctrl.signal, cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

// ── Online probe (endpoint aberto: settings) ──────────────
async function probeOnline() {
  try { await _fetch(`${API}/api/store?key=settings`); ONLINE = true; }
  catch { ONLINE = false; }
  return ONLINE;
}
async function pullSettings() {
  try {
    const s = await _fetch(`${API}/api/store?key=settings`);
    if (s && typeof s === 'object') {
      const cur = JSON.parse(localStorage.getItem(LSK.settings) || '{}');
      localStorage.setItem(LSK.settings, JSON.stringify({ ...cur, ...s }));
    }
    ONLINE = true;
  } catch { ONLINE = false; }
}

// ── Login + carga de dados com escopo ─────────────────────
async function authLogin(role, creds) {
  const res = await _fetch(`${API}/api/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, ...creds }),
  });
  setToken(res.token);
  return { role: res.role, id: res.id, nome: res.nome };
}

// Carrega /api/me e popula o cache local (chaves do portal)
async function loadMe() {
  const d = await _fetch(`${API}/api/me`);
  localStorage.setItem(LSK.masters,        JSON.stringify(d.masters || []));
  localStorage.setItem(LSK.representantes, JSON.stringify(d.representantes || []));
  localStorage.setItem(LSK.clientes,       JSON.stringify(d.clientes || []));
  localStorage.setItem(LSK.metas,          JSON.stringify(d.metas || []));
  localStorage.setItem(LSK.orders,         JSON.stringify(d.orders || []));
  if (d.settings) {
    const cur = JSON.parse(localStorage.getItem(LSK.settings) || '{}');
    localStorage.setItem(LSK.settings, JSON.stringify({ ...cur, ...d.settings }));
  }
  return d;
}

// ── Escrita (master) ──────────────────────────────────────
function entitiesDoc() {
  const J = (k, def) => JSON.parse(localStorage.getItem(k) || def);
  return {
    masters:        J(LSK.masters, '[]'),
    representantes: J(LSK.representantes, '[]'),
    clientes:       J(LSK.clientes, '[]'),
    metas:          J(LSK.metas, '[]'),
    settings:       J(LSK.settings, '{}'),
  };
}
async function pushEntities() {
  if (!ONLINE || !getToken()) return;
  try {
    await _fetch(`${API}/api/store?key=entities`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entitiesDoc()),
    });
  } catch (e) { console.warn('pushEntities falhou:', e.message); }
}
let _pushTimer = null;
function schedulePushEntities() {
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => pushEntities(), 350);
}

// ── Pedidos ───────────────────────────────────────────────
async function pushOrderAppend(order) {
  try {
    await _fetch(`${API}/api/store?key=orders&action=append`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
  } catch (e) { console.warn('pushOrderAppend falhou:', e.message); }
}
async function pushOrderStatus(id, status) {
  try {
    await _fetch(`${API}/api/store?key=orders&action=update`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
  } catch (e) { console.warn('pushOrderStatus falhou:', e.message); }
}

// orders (master): leitura completa, usada pelo admin
async function pullOrders() {
  try {
    const list = await _fetch(`${API}/api/store?key=orders`);
    if (Array.isArray(list)) localStorage.setItem(LSK.orders, JSON.stringify(list));
    return list;
  } catch (e) { return null; }
}
