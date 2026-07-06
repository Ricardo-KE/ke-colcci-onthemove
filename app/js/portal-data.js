// ============================================================
//  KE – Colcci On The Move  |  Portal B2B – Data layer
//  Espelha o schema Supabase (masters → representantes →
//  clientes → metas) em localStorage. Depende de data.js
//  (uuid, fmt, getOrders, getSettings).
// ============================================================

const PDB = {
  MASTERS: 'ke_masters',
  REPS:    'ke_representantes',
  CLIENTS: 'ke_clientes',
  METAS:   'ke_metas',
  AUTH:    'ke_portal_auth',
};

const PORTAL_SEED_VERSION = 'portal-v1';

// ── Helpers ───────────────────────────────────────────────
function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }

function readArr(key)  { return JSON.parse(localStorage.getItem(key) || '[]'); }
function writeArr(key, list) { localStorage.setItem(key, JSON.stringify(list)); }

// dispara sincronização das entidades (se api.js estiver presente)
function syncEntities() { if (typeof schedulePushEntities === 'function') schedulePushEntities(); }

// ── Masters ───────────────────────────────────────────────
function getMasters() { return readArr(PDB.MASTERS); }
function saveMasters(l) { writeArr(PDB.MASTERS, l); syncEntities(); }

// ── Representantes ────────────────────────────────────────
function getReps() { return readArr(PDB.REPS); }
function saveReps(l) { writeArr(PDB.REPS, l); syncEntities(); }
function addRep(r) {
  const list = getReps();
  r.id = uuid();
  r.criado_em = new Date().toISOString();
  if (r.ativo === undefined) r.ativo = true;
  list.push(r);
  saveReps(list);
  return r;
}
function updateRep(id, changes) {
  saveReps(getReps().map(r => r.id === id ? { ...r, ...changes } : r));
}
function deleteRep(id) {
  // desvincula clientes deste rep
  saveClients(getClients().map(c => c.representante_id === id ? { ...c, representante_id: null } : c));
  saveReps(getReps().filter(r => r.id !== id));
}
function repById(id) { return getReps().find(r => r.id === id) || null; }

// ── Clientes (lojistas) ───────────────────────────────────
function getClients() { return readArr(PDB.CLIENTS); }
function saveClients(l) { writeArr(PDB.CLIENTS, l); syncEntities(); }
function addClient(c) {
  const list = getClients();
  c.id = uuid();
  c.cnpj = onlyDigits(c.cnpj);
  c.criado_em = new Date().toISOString();
  if (c.ativo === undefined) c.ativo = true;
  list.push(c);
  saveClients(list);
  return c;
}
function updateClient(id, changes) {
  if (changes.cnpj) changes.cnpj = onlyDigits(changes.cnpj);
  saveClients(getClients().map(c => c.id === id ? { ...c, ...changes } : c));
}
function deleteClient(id) {
  saveMetas(getMetas().filter(m => m.cliente_id !== id));
  saveClients(getClients().filter(c => c.id !== id));
}
function clientById(id) { return getClients().find(c => c.id === id) || null; }
function clientByCnpj(cnpj) {
  const d = onlyDigits(cnpj);
  return getClients().find(c => onlyDigits(c.cnpj) === d) || null;
}

// ── Metas ─────────────────────────────────────────────────
// uma meta por cliente para a coleção ativa (settings.collection)
function getMetas() { return readArr(PDB.METAS); }
function saveMetas(l) { writeArr(PDB.METAS, l); syncEntities(); }
function colecaoAtiva() { return getSettings().collection; }

function getMeta(clienteId, colecao = colecaoAtiva()) {
  return getMetas().find(m => m.cliente_id === clienteId && m.colecao === colecao) || null;
}
function setMeta(clienteId, valor, colecao = colecaoAtiva()) {
  const list = getMetas();
  const existing = list.find(m => m.cliente_id === clienteId && m.colecao === colecao);
  if (existing) {
    existing.valor_meta = valor;
  } else {
    list.push({ id: uuid(), cliente_id: clienteId, colecao, valor_meta: valor });
  }
  saveMetas(list);
}
function deleteMeta(clienteId, colecao = colecaoAtiva()) {
  saveMetas(getMetas().filter(m => !(m.cliente_id === clienteId && m.colecao === colecao)));
}

// ── Progresso (vincula pedidos existentes por CNPJ) ───────
function vendidoPorCnpj(cnpj) {
  const d = onlyDigits(cnpj);
  if (!d) return 0;
  return getOrders()
    .filter(o => o.status !== 'cancelled' && onlyDigits(o.buyer && o.buyer.cnpj) === d)
    .reduce((s, o) => s + (o.totalValue || 0), 0);
}

// Retorna { meta, vendido, pct, restante } para um cliente
function progressoCliente(cliente) {
  const meta = getMeta(cliente.id);
  const valorMeta = meta ? meta.valor_meta : 0;
  const vendido = vendidoPorCnpj(cliente.cnpj);
  const pct = valorMeta > 0 ? Math.round((vendido / valorMeta) * 1000) / 10 : 0;
  return { valorMeta, vendido, pct, restante: Math.max(0, valorMeta - vendido), temMeta: !!meta };
}

// Lista de clientes (opcionalmente filtrada por rep) já com progresso
function clientesComProgresso(repId = null) {
  let list = getClients();
  if (repId) list = list.filter(c => c.representante_id === repId);
  return list.map(c => ({
    ...c,
    rep: repById(c.representante_id),
    progresso: progressoCliente(c),
  }));
}

// Agrupa a carteira de cada representante ativo (meta/vendido somados)
function carteiraPorRepresentante() {
  const clientes = clientesComProgresso().filter(c => c.ativo);
  return getReps().filter(r => r.ativo).map(r => {
    const seus = clientes.filter(c => c.representante_id === r.id);
    const valorMeta = seus.reduce((s, c) => s + c.progresso.valorMeta, 0);
    const vendido   = seus.reduce((s, c) => s + c.progresso.vendido, 0);
    const pct = valorMeta > 0 ? Math.round(vendido / valorMeta * 1000) / 10 : 0;
    return { rep: r, lojistas: seus.length, progresso: { valorMeta, vendido, pct, temMeta: valorMeta > 0 } };
  }).sort((a, b) => b.progresso.pct - a.progresso.pct);
}

// Soma de vendas por período: 'semana' | 'quinzena' | 'mes', mais recentes primeiro
function vendasPorPeriodo(periodo, limite = 12, cnpjs = null) {
  let orders = getOrders().filter(o => o.status !== 'cancelled' && o.date);
  if (cnpjs) orders = orders.filter(o => cnpjs.has(onlyDigits(o.buyer && o.buyer.cnpj)));
  const passoMs = { semana: 7, quinzena: 14 }[periodo] * 24 * 3600 * 1000;
  const buckets = new Map();
  orders.forEach(o => {
    const d = new Date(o.date);
    let key, label;
    if (periodo === 'mes') {
      key = d.getFullYear() * 100 + (d.getMonth() + 1);
      label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
    } else {
      const inicio = Math.floor(d.getTime() / passoMs) * passoMs;
      key = inicio;
      label = new Date(inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
    if (!buckets.has(key)) buckets.set(key, { key, label, total: 0 });
    buckets.get(key).total += o.totalValue || 0;
  });
  return [...buckets.values()].sort((a, b) => a.key - b.key).slice(-limite);
}

// ── Auth do portal ────────────────────────────────────────
// session: { role: 'master'|'rep'|'lojista', id, nome }
function portalSession() {
  try { return JSON.parse(sessionStorage.getItem(PDB.AUTH) || 'null'); }
  catch { return null; }
}
function setPortalSession(s) { sessionStorage.setItem(PDB.AUTH, JSON.stringify(s)); }
function portalLogout() { sessionStorage.removeItem(PDB.AUTH); }

function loginMaster(email, senha) {
  const e = (email || '').trim().toLowerCase();
  const s = getSettings();
  if (e === (s.adminEmail || '').toLowerCase() && senha === s.adminPass) {
    const m = getMasters()[0];
    return { role: 'master', id: m ? m.id : 'master', nome: m ? m.nome : 'KE LTDA' };
  }
  const m = getMasters().find(x => x.senha && x.senha === senha && (x.email || '').toLowerCase() === e);
  return m ? { role: 'master', id: m.id, nome: m.nome } : null;
}
function loginRep(email, senha) {
  const e = (email || '').trim().toLowerCase();
  const r = getReps().find(x => x.ativo && (x.email || '').toLowerCase() === e && x.senha === senha);
  return r ? { role: 'rep', id: r.id, nome: r.nome } : null;
}
function loginLojista(cnpj, senha) {
  const c = clientByCnpj(cnpj);
  if (c && c.ativo && c.senha === senha) {
    return { role: 'lojista', id: c.id, nome: c.razao_social };
  }
  return null;
}

// ── Seed inicial ──────────────────────────────────────────
function ensurePortalSeed() {
  if (localStorage.getItem('ke_portal_version') === PORTAL_SEED_VERSION) return;

  if (!getMasters().length) {
    saveMasters([{
      id: uuid(), nome: 'Ricardo (KE)', email: 'ricardo@ke.com.br',
      senha: getSettings().adminPass, criado_em: new Date().toISOString(),
    }]);
  }

  // Exemplos só na primeira carga (o usuário pode excluir)
  if (!getReps().length && !getClients().length) {
    const rep1 = addRep({ nome: 'Ana Souza',  email: 'ana@ke.com.br',   whatsapp: '5541999990001', senha: 'rep123' });
    const rep2 = addRep({ nome: 'Carlos Lima', email: 'carlos@ke.com.br', whatsapp: '5541999990002', senha: 'rep123' });

    const c1 = addClient({ cnpj: '11444777000161', razao_social: 'Boutique Maré Ltda',  representante_id: rep1.id, cidade: 'Florianópolis', estado: 'SC', senha: 'loja123' });
    const c2 = addClient({ cnpj: '19131243000197', razao_social: 'Loja Areia Fina ME',   representante_id: rep1.id, cidade: 'Balneário Camboriú', estado: 'SC', senha: 'loja123' });
    const c3 = addClient({ cnpj: '04252011000110', razao_social: 'Estilo & Cia Comércio', representante_id: rep2.id, cidade: 'Curitiba', estado: 'PR', senha: 'loja123' });

    setMeta(c1.id, 30000);
    setMeta(c2.id, 18000);
    setMeta(c3.id, 25000);
  }

  localStorage.setItem('ke_portal_version', PORTAL_SEED_VERSION);
}
