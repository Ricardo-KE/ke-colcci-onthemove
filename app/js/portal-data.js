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

// ============================================================
//  POLÍTICA COMERCIAL — Colcci On The Move · Verão 27
//  Fonte: "OTM_VER27_Política Comercial.pdf" (documento oficial).
//  Todo número aqui vem literal do PDF — nada foi estimado.
// ============================================================
const POLITICA = {
  periodo: { inicio: '2026-06-11', fim: '2026-08-02' },

  pedidoMinimo: 3500,
  pedidoMinimoNovoCliente: 3500, // OTM não diferencia cliente novo

  prontaEntrega: { minimo: 2500 },

  // "Prazo Estendido" (28/56/84/112 — prazo médio 70 dias)
  acao28Dias: {
    periodoInicio: '2026-06-11', periodoFim: '2026-06-21',
    pedidoMinimo: 4000, crescimentoMinimo: 0,
  },
  cashback: {
    periodoInicio: '2026-06-11', periodoFim: '2026-06-21',
    pedidoMinimo: 4000, crescimentoMinimo: 0.15, percentual: 0.05,
  },
  live: { data: '2026-06-16T20:30:00' },

  // Cluster do representante — pela meta da coleção (valor).
  clusters: [
    { id: 'A', min: 300000 },
    { id: 'B', min: 150000 },
    { id: 'C', min: 0 },
  ],

  // Comissão por % da meta (em valor) atingida.
  comissao: [
    { max: 0.90, pct: 7.0 },
    { max: 1.00, pct: 8.0 },
    { max: 1.20, pct: 8.5 },
    { max: Infinity, pct: 9.0 },
  ],

  premiacaoGestorCorridaSemana1: {
    periodoInicio: '2026-06-11', periodoFim: '2026-06-21',
    minMetaGeralPeriodo: 0.25, minMetaFinal: 0.80,
    premios: [1000, 500, 300],
  },
  // "Premiação Equipe % Meta" por cluster e faixa de atingimento
  premiacaoGestorCluster: {
    faixas: [
      { min: 0.90, max: 1.00, idx: 0 },
      { min: 1.00, max: 1.20, idx: 1 },
      { min: 1.20, max: Infinity, idx: 2 },
    ],
    valores: {
      A: [1000, 3000, 5000],
      B: [700, 2000, 3000],
      C: [500, 1500, 2000],
    },
  },
  corridaDeVendasGestor: {
    periodoInicio: '2026-06-11', periodoFim: '2026-07-05',
    objetivoPct: 0.70, metaFinalPct: 1.00,
    valores: { A: 3000, B: 2000, C: 1500 },
  },
  // Abertura e retenção de novos clientes (sem histórico de Bolsas e
  // Roupas): R$ 250 por cliente, pago na retenção.
  aberturaNovoCliente: { valor: 250 },
};

function clusterDoRepresentante(rep) {
  const meta = (rep && rep.meta_verao27) || 0;
  return POLITICA.clusters.find(cl => meta >= cl.min) || POLITICA.clusters[POLITICA.clusters.length - 1];
}
function comissaoPorPct(pct) {
  const faixa = POLITICA.comissao.find(f => pct < f.max) || POLITICA.comissao[POLITICA.comissao.length - 1];
  const idx = POLITICA.comissao.indexOf(faixa);
  const proxima = POLITICA.comissao[idx + 1] || null;
  return { atual: faixa.pct, proxima: proxima ? proxima.pct : null, tetoFaixaAtual: faixa.max };
}
function premiacaoGestorClusterPorPct(clusterId, pct) {
  const faixa = POLITICA.premiacaoGestorCluster.faixas.find(f => pct >= f.min && pct < f.max);
  if (!faixa) return 0;
  return (POLITICA.premiacaoGestorCluster.valores[clusterId] || [0, 0, 0])[faixa.idx];
}
function diasEntre(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function dentroDoPeriodo(dataIso, inicio, fim) {
  const t = new Date(dataIso).getTime();
  return t >= new Date(inicio).getTime() && t <= new Date(fim + 'T23:59:59').getTime();
}

// Elegibilidade Prazo Estendido / Cashback: olha pedidos (não cancelados)
// do cliente dentro do período da ação, valor mínimo + crescimento sobre
// o histórico real (LY ou última coleção realizada, conforme a política).
function elegibilidadeAcaoCliente(cliente, acao) {
  const d = onlyDigits(cliente.cnpj);
  const pedidos = getOrders().filter(o =>
    o.status !== 'cancelled' &&
    onlyDigits(o.buyer && o.buyer.cnpj) === d &&
    dentroDoPeriodo(o.date, acao.periodoInicio, acao.periodoFim));
  const ver26 = cliente.hist_ver26 || 0;
  const maiorPedido = pedidos.reduce((max, o) => Math.max(max, o.totalValue || 0), 0);
  const cresc = ver26 > 0 ? (maiorPedido - ver26) / ver26 : (maiorPedido > 0 ? Infinity : 0);
  const elegivel = maiorPedido >= acao.pedidoMinimo && cresc >= acao.crescimentoMinimo;
  const faltamValor = Math.max(0, acao.pedidoMinimo - maiorPedido);
  const crescAtualPct = ver26 > 0 ? Math.round(cresc * 1000) / 10 : null;
  return { elegivel, maiorPedido, ver26, crescAtualPct, faltamValor };
}

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
  // soma o realizado fora do site (ERP/ficha, importado da planilha)
  const vendido = vendidoPorCnpj(cliente.cnpj) + (cliente.realizado_externo || 0);
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

// Agrupa a carteira de cada representante ativo (meta/vendido somados).
// Sem metas por lojista cadastradas, cai na meta oficial do rep
// (meta_verao27, importada da planilha da coleção).
function carteiraPorRepresentante() {
  const clientes = clientesComProgresso().filter(c => c.ativo);
  return getReps().filter(r => r.ativo).map(r => {
    const seus = clientes.filter(c => c.representante_id === r.id);
    const valorMeta = seus.reduce((s, c) => s + c.progresso.valorMeta, 0) || (r.meta_verao27 || 0);
    const vendido   = seus.reduce((s, c) => s + c.progresso.vendido, 0);
    const pct = valorMeta > 0 ? Math.round(vendido / valorMeta * 1000) / 10 : 0;
    return { rep: r, lojistas: seus.length, progresso: { valorMeta, vendido, pct, temMeta: valorMeta > 0 } };
  }).sort((a, b) => b.progresso.pct - a.progresso.pct);
}

// ── Centro de Comando (master): funil comercial agregado ──
// "CRM invisível": cada etapa é derivada de sinais reais já coletados
// (acesso ao catálogo, carrinho em andamento, pedidos, metas).
function funilComercial() {
  const clientes = clientesComProgresso().filter(c => c.ativo);
  const access = getAccess();
  const carts = getCarts();
  const cnpjs = clientes.map(c => onlyDigits(c.cnpj));
  const acessaram = cnpjs.filter(d => access[d]).length;
  const carrinho = cnpjs.filter(d => carts[d] && carts[d].totalValue > 0).length;
  const comPedido = clientes.filter(c => c.progresso.vendido > 0).length;
  const bateramMeta = clientes.filter(c => c.progresso.temMeta && c.progresso.pct >= 100).length;
  return [
    { label: 'Lojistas ativos', valor: clientes.length },
    { label: 'Acessaram a plataforma', valor: acessaram },
    { label: 'Colocaram no carrinho', valor: carrinho },
    { label: 'Fizeram pedido', valor: comPedido },
    { label: 'Bateram a meta', valor: bateramMeta },
  ];
}

// ── Heat map comercial por estado ─────────────────────────
function heatmapPorEstado() {
  const clientes = clientesComProgresso().filter(c => c.ativo);
  const porUf = {};
  clientes.forEach(c => {
    const uf = c.estado || '—';
    porUf[uf] = porUf[uf] || { uf, lojistas: 0, meta: 0, vendido: 0 };
    porUf[uf].lojistas++;
    porUf[uf].meta += c.progresso.valorMeta;
    porUf[uf].vendido += c.progresso.vendido;
  });
  return Object.values(porUf)
    .map(r => ({ ...r, pct: r.meta > 0 ? Math.round(r.vendido / r.meta * 1000) / 10 : 0 }))
    .sort((a, b) => b.vendido - a.vendido);
}

// ── Distribuição de representantes por cluster (A/B/C) ────
function distribuicaoClusters() {
  const carteiras = carteiraPorRepresentante();
  const base = Object.fromEntries(POLITICA.clusters.map(c => [c.id, { count: 0, meta: 0, vendido: 0 }]));
  carteiras.forEach(({ rep, progresso }) => {
    const cl = clusterDoRepresentante(rep).id;
    base[cl].count++;
    base[cl].meta += progresso.valorMeta;
    base[cl].vendido += progresso.vendido;
  });
  return POLITICA.clusters.map(c => ({
    id: c.id, ...base[c.id],
    pct: base[c.id].meta > 0 ? Math.round(base[c.id].vendido / base[c.id].meta * 1000) / 10 : 0,
  }));
}

// ── Segmentos inteligentes de clientes (regras sobre dados reais) ──
function segmentosClientes() {
  const clientes = clientesComProgresso().filter(c => c.ativo);
  const access = getAccess();
  const diasSemAcesso = (d) => access[d] ? (Date.now() - new Date(access[d]).getTime()) / 86400000 : Infinity;
  const vip = [...clientes].sort((a, b) => (b.hist_ver26 || b.progresso.vendido) - (a.hist_ver26 || a.progresso.vendido)).slice(0, 10);
  const risco = clientes.filter(c => c.progresso.temMeta && c.progresso.pct > 0 && c.progresso.pct < 50);
  const esquecidos = clientes.filter(c => diasSemAcesso(onlyDigits(c.cnpj)) > 30);
  const semPedido = clientes.filter(c => c.progresso.vendido === 0);
  return { vip, risco, esquecidos, semPedido };
}

// ── SCORES (0–100, heurísticos e transparentes) ───────────
// Regras declaradas, sem "caixa preta": cada componente tem peso
// fixo e vem de um sinal real (meta, acesso, carrinho, pedidos,
// crescimento vs histórico). Servem pra priorizar, não pra punir.
function scoreCliente(c) {
  const prog = c.progresso || progressoCliente(c);
  const d = onlyDigits(c.cnpj);
  const access = getAccess();
  const carts = getCarts();

  // 40 pts — atingimento da meta (proporcional, teto em 100%)
  const pMeta = prog.temMeta ? Math.min(1, prog.pct / 100) * 40 : 0;
  // 20 pts — recência de acesso (7d=20, 30d=10, mais=0)
  const dias = access[d] ? (Date.now() - new Date(access[d]).getTime()) / 86400000 : Infinity;
  const pAcesso = dias <= 7 ? 20 : dias <= 30 ? 10 : 0;
  // 10 pts — carrinho em andamento (interesse ativo)
  const pCarrinho = (carts[d] && carts[d].totalValue > 0) ? 10 : 0;
  // 15 pts — já comprou nesta coleção
  const pPedido = prog.vendido > 0 ? 15 : 0;
  // 15 pts — crescimento vs histórico (comprou mais que o histórico = 15)
  const pCresc = (c.hist_ver26 || 0) > 0
    ? Math.min(1, prog.vendido / c.hist_ver26) * 15
    : (prog.vendido > 0 ? 15 : 0);

  return Math.round(pMeta + pAcesso + pCarrinho + pPedido + pCresc);
}

function scoreCarteira(repId) {
  const clientes = clientesComProgresso(repId).filter(c => c.ativo);
  if (!clientes.length) return 0;
  return Math.round(clientes.reduce((s, c) => s + scoreCliente(c), 0) / clientes.length);
}

// ── RADAR COMERCIAL (representante): quem acionar hoje, por quê ──
// Prioriza por urgência (carrinho parado > elegível a ação > em risco
// > esquecido) e, dentro da mesma urgência, por valor envolvido.
function radarComercial(repId) {
  const clientes = clientesComProgresso(repId).filter(c => c.ativo);
  const carts = getCarts();
  const access = getAccess();
  const acoes = [];
  clientes.forEach(c => {
    const d = onlyDigits(c.cnpj);
    const cart = carts[d];
    const dias = access[d] ? (Date.now() - new Date(access[d]).getTime()) / 86400000 : Infinity;
    if (cart && cart.totalValue > 0) {
      const minimo = POLITICA.pedidoMinimo;
      const abaixoMinimo = cart.totalValue < minimo;
      acoes.push({ cliente: c, prioridade: 1, valor: cart.totalValue, icone: '🛒',
        motivo: abaixoMinimo
          ? `${fmt(cart.totalValue)} no carrinho — faltam ${fmt(minimo - cart.totalValue)} pro pedido mínimo`
          : `${fmt(cart.totalValue)} parados no carrinho`,
        acao: abaixoMinimo ? 'Ligar e completar até o mínimo' : 'Ligar hoje e fechar o pedido' });
      return;
    }
    const e28 = elegibilidadeAcaoCliente(c, POLITICA.acao28Dias);
    const ecb = elegibilidadeAcaoCliente(c, POLITICA.cashback);
    if (e28.elegivel || ecb.elegivel) {
      acoes.push({ cliente: c, prioridade: 2, valor: Math.max(e28.maiorPedido || 0, ecb.maiorPedido || 0), icone: '🎁',
        motivo: ecb.elegivel ? 'Elegível para cashback de 5%' : 'Elegível para o prazo estendido',
        acao: 'Avisar o benefício e sugerir complemento' });
      return;
    }
    if (c.progresso.temMeta && c.progresso.pct > 0 && c.progresso.pct < 50) {
      acoes.push({ cliente: c, prioridade: 3, valor: c.progresso.restante, icone: '⚠️',
        motivo: `Só ${c.progresso.pct}% da meta — faltam ${fmt(c.progresso.restante)}`, acao: 'Visitar ou ligar esta semana' });
      return;
    }
    if (dias > 30) {
      acoes.push({ cliente: c, prioridade: 4, valor: c.hist_ver26 || 0, icone: '💤',
        motivo: access[d] ? `Sem acessar há ${Math.round(dias)} dias` : 'Nunca acessou a plataforma',
        acao: 'Reenviar o link de acesso com uma mensagem' });
    }
  });
  return acoes.sort((a, b) => a.prioridade - b.prioridade || b.valor - a.valor);
}

// ── MISSÕES DO DIA (representante) ────────────────────────
// Derivadas do estado real da carteira — concluir a missão = resolver
// o problema que ela aponta, então o progresso é medido de verdade.
function missoesDoDia(repId) {
  const clientes = clientesComProgresso(repId).filter(c => c.ativo);
  const carts = getCarts();
  const access = getAccess();
  const cnpjs = clientes.map(c => onlyDigits(c.cnpj));
  const carrinhos = cnpjs.filter(d => carts[d] && carts[d].totalValue > 0).length;
  const esquecidos = cnpjs.filter(d => !access[d] || (Date.now() - new Date(access[d]).getTime()) / 86400000 > 30).length;
  const pendentes = getOrders().filter(o => o.status === 'pending' && cnpjs.includes(onlyDigits(o.buyer && o.buyer.cnpj))).length;
  const semPedido = clientes.filter(c => c.progresso.vendido === 0).length;

  const missoes = [];
  if (carrinhos) missoes.push({ icone: '🛒', titulo: `Recuperar ${carrinhos} carrinho${carrinhos > 1 ? 's' : ''} parado${carrinhos > 1 ? 's' : ''}`, done: false });
  if (pendentes) missoes.push({ icone: '📋', titulo: `Confirmar ${pendentes} pedido${pendentes > 1 ? 's' : ''} pendente${pendentes > 1 ? 's' : ''}`, done: false });
  if (esquecidos) missoes.push({ icone: '💤', titulo: `Reativar ${Math.min(3, esquecidos)} cliente${Math.min(3, esquecidos) > 1 ? 's' : ''} sem acesso (${esquecidos} no total)`, done: false });
  if (semPedido) missoes.push({ icone: '🎯', titulo: `Abrir a coleção com ${Math.min(2, semPedido)} cliente${Math.min(2, semPedido) > 1 ? 's' : ''} sem pedido (${semPedido} no total)`, done: false });
  if (!missoes.length) missoes.push({ icone: '🏆', titulo: 'Carteira em dia — aproveite pra prospectar novos clientes', done: true });
  return missoes;
}

// ── ASSISTENTE DE COMPRA (lojista) ────────────────────────
// Diagnóstico do pedido em relação à política comercial: pedido
// mínimo, cashback, prazo estendido e cobertura de mix por categoria.
function assistenteDeCompra(cliente) {
  const d = onlyDigits(cliente.cnpj);
  const cart = getCarts()[d] || null;
  const valorCarrinho = cart ? cart.totalValue : 0;
  const minimo = POLITICA.pedidoMinimo;
  const hoje = new Date().toISOString();
  const cashbackAtivo = dentroDoPeriodo(hoje, POLITICA.cashback.periodoInicio, POLITICA.cashback.periodoFim);
  const acao28Ativa = dentroDoPeriodo(hoje, POLITICA.acao28Dias.periodoInicio, POLITICA.acao28Dias.periodoFim);

  // Cobertura de mix: categorias da coleção × categorias já compradas/no carrinho
  const categorias = [...new Set(getProducts().map(p => p.category).filter(Boolean))];
  const compradas = new Set();
  getOrders()
    .filter(o => o.status !== 'cancelled' && onlyDigits(o.buyer && o.buyer.cnpj) === d)
    .forEach(o => (o.items || []).forEach(i => {
      const p = getProducts().find(x => x.id === i.productId);
      if (p && p.category) compradas.add(p.category);
    }));
  if (cart) (cart.items || []).forEach(i => {
    const p = getProducts().find(x => x.id === i.productId);
    if (p && p.category) compradas.add(p.category);
  });

  return {
    valorCarrinho, minimo,
    faltaMinimo: Math.max(0, minimo - valorCarrinho),
    cashback: { ativo: cashbackAtivo, minimo: POLITICA.cashback.pedidoMinimo, pct: POLITICA.cashback.percentual,
      falta: Math.max(0, POLITICA.cashback.pedidoMinimo - valorCarrinho) },
    acao28: { ativo: acao28Ativa, minimo: POLITICA.acao28Dias.pedidoMinimo,
      falta: Math.max(0, POLITICA.acao28Dias.pedidoMinimo - valorCarrinho) },
    mix: { total: categorias.length, cobertas: compradas.size, faltantes: categorias.filter(c => !compradas.has(c)) },
  };
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
