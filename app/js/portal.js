// ============================================================
//  KE – Colcci On The Move  |  Portal B2B – logic
// ============================================================

let loginRole = 'master';

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  getProducts();
  await probeOnline();

  // Páginas dedicadas (representante.html/fabricante.html) travam o
  // perfil via window.FORCED_ROLE — sem abas, sem risco de logar no
  // perfil errado. portal.html (sem FORCED_ROLE) mantém o comportamento
  // original com abas, preservando os links já enviados aos lojistas.
  const forcedRole = window.FORCED_ROLE || null;
  selectRole(forcedRole || 'master');

  const s = portalSession();
  if (s && ONLINE && getToken()) {
    // restaura sessão buscando dados do servidor
    try { await loadMe(); showShell(s); return; }
    catch { portalLogout(); clearToken(); }
  }
  if (!ONLINE) {
    // modo offline (arquivo aberto direto / sem servidor): usa dados locais
    ensurePortalSeed();
    if (s) { showShell(s); return; }
  }

  // Link individual do lojista (portal.html?loja=CNPJ): pré-preenche
  // CNPJ + senha (senha = 5 primeiros dígitos do próprio CNPJ) e entra sozinho.
  // Só se aplica em páginas sem perfil travado, ou já travadas em lojista.
  const cnpjLink = new URLSearchParams(location.search).get('loja');
  if (cnpjLink && (!forcedRole || forcedRole === 'lojista')) {
    const cnpjDigits = onlyDigits(cnpjLink);
    selectRole('lojista');
    document.getElementById('l-cnpj').value = fmtCnpj(cnpjDigits);
    document.getElementById('l-senha').value = cnpjDigits.slice(0, 5);
    document.getElementById('login-hint').textContent = 'Entrando automaticamente pelo seu link de acesso...';
    doLogin(new Event('submit'));
  }
  // senão, permanece na tela de login
}

// Recarrega os dados do servidor (botão 🔄)
async function recarregar() {
  if (!ONLINE) { refresh(); return; }
  try { await loadMe(); toast('Dados atualizados.', 'success'); }
  catch (e) {
    if (e.status === 401) { toast('Sessão expirada. Entre novamente.', 'error'); return sair(); }
    toast('Falha ao atualizar.', 'error');
  }
  refresh();
}

// ── Login ─────────────────────────────────────────────────
function selectRole(role) {
  loginRole = role;
  document.querySelectorAll('.role-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.role === role));
  document.querySelectorAll('.role-fields').forEach(f =>
    f.style.display = f.dataset.role === role ? 'block' : 'none');
  document.getElementById('login-error').textContent = '';

  const hints = {
    master:  'Acesso total KE LTDA: cadastra metas, lojistas e representantes.',
    rep:     'Use o e-mail e a senha fornecidos pela KE.',
    lojista: 'Use o CNPJ da sua loja. A senha são os 5 primeiros números do CNPJ.',
  };
  document.getElementById('login-hint').innerHTML = hints[role];
}

async function doLogin(e) {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.textContent = '';
  const btn = document.querySelector('#login-form button[type=submit]');

  const creds = {
    master:  () => ({ email: document.getElementById('m-email').value, senha: document.getElementById('m-senha').value }),
    rep:     () => ({ email: document.getElementById('r-email').value, senha: document.getElementById('r-senha').value }),
    lojista: () => ({ cnpj:  document.getElementById('l-cnpj').value,  senha: document.getElementById('l-senha').value }),
  }[loginRole]();

  if (ONLINE) {
    if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
    try {
      const session = await authLogin(loginRole, creds);
      await loadMe();
      setPortalSession(session);
      showShell(session);
    } catch (ex) {
      err.textContent = ex.status === 401
        ? (loginRole === 'lojista' ? 'CNPJ ou senha inválidos.' : 'E-mail ou senha inválidos.')
        : 'Falha ao conectar. Tente novamente.';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Entrar →'; }
    }
    return false;
  }

  // ── Offline (sem servidor): valida no localStorage ──
  let session = null;
  if (loginRole === 'master')  { session = loginMaster(creds.email, creds.senha); if (!session) err.textContent = 'E-mail ou senha inválidos.'; }
  else if (loginRole === 'rep'){ session = loginRep(creds.email, creds.senha); if (!session) err.textContent = 'E-mail ou senha inválidos.'; }
  else                         { session = loginLojista(creds.cnpj, creds.senha); if (!session) err.textContent = 'CNPJ ou senha inválidos.'; }
  if (session) { setPortalSession(session); showShell(session); }
  return false;
}

function sair() {
  portalLogout(); clearToken();
  // Remove o ?loja=CNPJ do link individual antes de recarregar — senão o
  // boot() detecta o parâmetro de novo e faz login automático na hora,
  // sem dar chance de escolher outro perfil (rep/master) na tela de login.
  location.href = location.pathname;
}

// ── Shell ─────────────────────────────────────────────────
const TABS = {
  master: [
    { id: 'overview', label: '📊 Visão Geral' },
    { id: 'metas',    label: '🎯 Metas & Progresso' },
    { id: 'lojistas', label: '🏪 Lojistas' },
    { id: 'reps',     label: '🧑‍💼 Representantes' },
    { id: 'acessos',  label: '👀 Acessos & Carrinhos' },
    { id: 'config',   label: '⚙️ Configurações' },
  ],
  rep:     [{ id: 'carteira', label: '🎯 Minha Carteira' }],
  lojista: [
    { id: 'minhameta',  label: '🎯 Minha Meta' },
    { id: 'pedidos',    label: '📋 Meus Dados & Pedidos' },
    { id: 'sugestoes',  label: '✨ Minhas Sugestões' },
  ],
};

let session = null;
let activeTab = null;

function showShell(s) {
  session = s;
  document.getElementById('login').style.display = 'none';
  document.getElementById('shell').style.display = 'block';

  const ctxName = { master: 'Usuário Máximo', rep: 'Representante', lojista: 'Lojista' }[s.role];
  document.getElementById('nav-ctx').textContent = `${ctxName} · ${colecaoAtiva()}`;
  document.getElementById('nav-who').innerHTML = `Olá, <b>${esc(s.nome)}</b>`;

  const tabs = TABS[s.role];
  document.getElementById('tabs-bar').innerHTML = tabs.map(t =>
    `<button class="tab-btn" data-tab="${t.id}" onclick="switchTab('${t.id}')">${t.label}</button>`
  ).join('');

  switchTab(tabs[0].id);
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  const c = document.getElementById('portal-content');

  const render = {
    overview:  renderOverview,
    metas:     renderMetas,
    lojistas:  renderLojistas,
    reps:      renderReps,
    acessos:   renderAcessosMaster,
    config:    renderConfig,
    carteira:  renderCarteira,
    minhameta: renderMinhaMeta,
    pedidos:   renderPedidosLojista,
    sugestoes: renderSugestoesLojista,
  }[tab];
  c.innerHTML = render ? render() : '';
}

function refresh() { switchTab(activeTab); }

// ── Render helpers ────────────────────────────────────────
function progressBar(prog) {
  if (!prog.temMeta) {
    return `<div class="muted" style="font-size:.8rem">Sem meta definida</div>`;
  }
  const p = prog.pct;
  const cls = p >= 100 ? 'done' : p >= 70 ? 'high' : p >= 40 ? 'mid' : 'low';
  return `
    <div class="meta-cell">
      <div class="progress"><div class="progress-fill ${cls}" style="width:${Math.min(100, p)}%"></div></div>
      <div class="progress-meta">
        <span>${fmt(prog.vendido)} / ${fmt(prog.valorMeta)}</span>
        <span class="progress-pct">${p}%</span>
      </div>
    </div>`;
}

function statusPill(prog) {
  if (!prog.temMeta) return `<span class="pill none">Sem meta</span>`;
  if (prog.pct >= 100) return `<span class="pill ok">✓ Batida</span>`;
  if (prog.pct >= 50)  return `<span class="pill warn">Em rota</span>`;
  return `<span class="pill bad">Atenção</span>`;
}

// ── MASTER: Visão Geral ───────────────────────────────────
let overviewPeriodo = 'semana';

function renderOverview() {
  const clientes = clientesComProgresso();
  const ativos = clientes.filter(c => c.ativo);
  const metaTotal = ativos.reduce((s, c) => s + c.progresso.valorMeta, 0);
  const vendidoTotal = ativos.reduce((s, c) => s + c.progresso.vendido, 0);
  const pctGeral = metaTotal > 0 ? Math.round(vendidoTotal / metaTotal * 1000) / 10 : 0;
  const batidas = ativos.filter(c => c.progresso.temMeta && c.progresso.pct >= 100).length;
  const semMeta = ativos.filter(c => !c.progresso.temMeta).length;
  const reps = getReps().filter(r => r.ativo).length;

  // Comparativo vs Verão 26 (histórico real importado por CNPJ)
  const histVer26 = ativos.reduce((s, c) => s + (c.hist_ver26 || 0), 0);
  const cresc = histVer26 > 0 ? Math.round((metaTotal - histVer26) / histVer26 * 1000) / 10 : null;
  const metaSub = histVer26 > 0
    ? `${cresc >= 0 ? '↑' : '↓'} ${cresc >= 0 ? '+' : ''}${cresc}% vs Verão 26 (${fmt(histVer26)})`
    : 'sem histórico de Verão 26';

  const rankingAll = [...ativos].filter(c => c.progresso.temMeta)
    .sort((a, b) => b.progresso.pct - a.progresso.pct);
  const ranking = rankingAll.slice(0, 20);

  const carteiras = carteiraPorRepresentante();

  return `
    <div class="section-header"><h2>Visão Geral · ${esc(colecaoAtiva())}</h2></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">Lojistas ativos</div><div class="value">${ativos.length}</div><div class="sub">${reps} representantes</div></div>
      <div class="kpi"><div class="label">Meta total</div><div class="value gold">${fmt(metaTotal)}</div><div class="sub">${metaSub}</div></div>
      <div class="kpi"><div class="label">Vendido</div><div class="value">${fmt(vendidoTotal)}</div><div class="sub">via pedidos por CNPJ</div></div>
      <div class="kpi"><div class="label">% atingido</div><div class="value gold">${pctGeral}%</div></div>
      <div class="kpi"><div class="label">Metas batidas</div><div class="value">${batidas}/${ativos.filter(c=>c.progresso.temMeta).length}</div><div class="sub">${semMeta} sem meta</div></div>
    </div>

    <div class="section-header">
      <h2>Tendência de vendas</h2>
      <div class="period-toggle" id="period-toggle">
        ${['semana', 'quinzena', 'mes'].map(p => `<button class="ptg-btn${p === overviewPeriodo ? ' active' : ''}" data-p="${p}" onclick="trocarPeriodoOverview('${p}')">${{semana:'Semana', quinzena:'Quinzena', mes:'Mês'}[p]}</button>`).join('')}
      </div>
    </div>
    <div class="card chart-card" id="tendencia-wrap">${renderTendenciaChart()}</div>

    <div class="section-header"><h2>Ranking de representantes</h2></div>
    ${carteiras.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Representante</th><th>Carteira</th><th class="meta-cell">Progresso</th></tr></thead>
        <tbody>
          ${carteiras.map((r, i) => `
            <tr>
              <td><strong>${i + 1}º</strong></td>
              <td>${esc(r.rep.nome)}</td>
              <td>${r.lojistas} lojista${r.lojistas === 1 ? '' : 's'}</td>
              <td>${progressBar(r.progresso)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="empty-block"><div class="icon">🧑‍💼</div><p>Nenhum representante ativo com carteira ainda.</p></div>`}

    <div class="section-header"><h2>Ranking de lojistas (top 20)</h2></div>
    ${ranking.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Lojista</th><th>Representante</th><th class="meta-cell">Progresso</th><th>Status</th></tr></thead>
        <tbody>
          ${ranking.map((c, i) => `
            <tr>
              <td><strong>${i + 1}º</strong></td>
              <td>${esc(c.razao_social)}<br><span class="muted" style="font-size:.76rem">${c.cidade ? esc(c.cidade) + '/' + esc(c.estado || '') : ''}</span></td>
              <td>${c.rep ? esc(c.rep.nome) : '<span class="muted">—</span>'}</td>
              <td>${progressBar(c.progresso)}</td>
              <td>${statusPill(c.progresso)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="empty-block"><div class="icon">🎯</div><p>Nenhuma meta cadastrada ainda. Vá em <strong>Metas &amp; Progresso</strong>.</p></div>`}
  `;
}

function trocarPeriodoOverview(p) {
  overviewPeriodo = p;
  document.querySelectorAll('.ptg-btn').forEach(b => b.classList.toggle('active', b.dataset.p === p));
  document.getElementById('tendencia-wrap').innerHTML = renderTendenciaChart();
}

// Gráfico de barras (SVG) com o total vendido por período
function renderTendenciaChart() {
  const buckets = vendasPorPeriodo(overviewPeriodo);
  if (!buckets.length) {
    return `<div class="empty-chart"><div class="ic">📈</div>
      <p>Sem pedidos suficientes pra desenhar a tendência ainda. Assim que os lojistas comprarem, este gráfico se preenche sozinho.</p></div>`;
  }
  const W = 760, H = 190, padL = 8, padR = 8, padB = 26, padT = 16;
  const max = Math.max(...buckets.map(b => b.total), 1);
  const bw = (W - padL - padR) / buckets.length;
  const bars = buckets.map((b, i) => {
    const h = Math.max(2, (b.total / max) * (H - padT - padB));
    const x = padL + i * bw + bw * 0.15;
    const w = bw * 0.7;
    const y = H - padB - h;
    const isLast = i === buckets.length - 1;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3"
        fill="${isLast ? 'var(--gold)' : '#E8D5A3'}"></rect>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--mid)">${esc(b.label)}</text>
      ${isLast ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--dark)">${fmt(b.total)}</text>` : ''}
    `;
  }).join('');
  return `
    <div class="cardsub">Total vendido por ${{semana:'semana', quinzena:'quinzena', mes:'mês'}[overviewPeriodo]}, com base na data de cada pedido</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      <line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" stroke="#EDE7D8"></line>
      ${bars}
    </svg>`;
}

// ── MASTER: Metas & Progresso (dashboard analítico) ────────
const ROW_CAP = 400;
let fMetas = { q: '', rep: '', estado: '', bucket: '' };
let metasPage = 1;
let metasPerPage = 10;

function filtrarClientes(f) {
  let list = clientesComProgresso();
  if (f.rep) list = list.filter(c => c.representante_id === f.rep);
  if (f.estado) list = list.filter(c => (c.estado || '') === f.estado);
  if (f.bucket) list = list.filter(c => metaStatusInfo(c.progresso).bucket === f.bucket);
  const q = f.q.trim().toLowerCase();
  const dq = onlyDigits(q);
  if (q) list = list.filter(c =>
    (c.razao_social || '').toLowerCase().includes(q) || (dq && onlyDigits(c.cnpj).includes(dq)));
  return list.sort((a, b) => a.razao_social.localeCompare(b.razao_social));
}

function repFilterOptions(selected) {
  return ['<option value="">Todos os representantes</option>',
    ...getReps().sort((a, b) => a.nome.localeCompare(b.nome))
      .map(r => `<option value="${r.id}" ${selected === r.id ? 'selected' : ''}>${esc(r.nome)}</option>`)].join('');
}
function estadoFilterOptions(selected) {
  const estados = [...new Set(getClients().map(c => c.estado).filter(Boolean))].sort();
  return ['<option value="">Todos os estados</option>',
    ...estados.map(uf => `<option value="${esc(uf)}" ${selected === uf ? 'selected' : ''}>${esc(uf)}</option>`)].join('');
}

// Classifica o lojista pro dashboard: Em dia (≥80%), Atenção (50–79%), Risco (<50%)
function metaStatusInfo(prog) {
  if (!prog.temMeta) return { label: 'Sem meta', cls: 'none', bucket: 'sem-meta' };
  if (prog.pct >= 80) return { label: 'Em dia', cls: 'ok', bucket: 'em-dia' };
  if (prog.pct >= 50) return { label: 'Atenção', cls: 'warn', bucket: 'atencao' };
  return { label: 'Risco', cls: 'bad', bucket: 'risco' };
}

function pedidosDoCnpjMaster(cnpj) {
  const d = onlyDigits(cnpj);
  return getOrders().filter(o => o.status !== 'cancelled' && onlyDigits(o.buyer && o.buyer.cnpj) === d);
}
function ticketMedioCnpj(cnpj) {
  const pedidos = pedidosDoCnpjMaster(cnpj);
  return pedidos.length ? pedidos.reduce((s, o) => s + (o.totalValue || 0), 0) / pedidos.length : 0;
}
function ultimoPedidoCnpj(cnpj) {
  const pedidos = pedidosDoCnpjMaster(cnpj).sort((a, b) => new Date(b.date) - new Date(a.date));
  return pedidos.length ? pedidos[0].date : null;
}

// Donut genérico via SVG (stroke-dasharray por segmento)
function donutSvg(segments, size = 108, thickness = 14) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  const rings = segments.filter(s => s.value > 0).map(seg => {
    const len = (seg.value / total) * c;
    const dash = `${len} ${c - len}`;
    const rot = (offset / total) * 360 - 90;
    offset += seg.value;
    return `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${thickness}" stroke-dasharray="${dash}" transform="rotate(${rot} ${size/2} ${size/2})"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#EFE8D8" stroke-width="${thickness}"/>
    ${rings}
  </svg>`;
}

function renderMetas() {
  if (!getClients().length) {
    return `<div class="empty-block"><div class="icon">🏪</div><p>Cadastre lojistas primeiro na aba <strong>Lojistas</strong>.</p></div>`;
  }
  return `
    <div class="section-header">
      <h2>Metas &amp; Progresso · ${esc(colecaoAtiva())}</h2>
      <span class="hint">Acompanhe as metas dos lojistas e o progresso da coleção em tempo real.</span>
    </div>
    <div class="toolbar">
      <input type="search" id="metas-q" placeholder="Buscar por razão social ou CNPJ..."
        value="${esc(fMetas.q)}" oninput="fMetas.q=this.value; metasPage=1; metasRefresh()">
      <select id="metas-rep" onchange="fMetas.rep=this.value; metasPage=1; metasRefresh()">${repFilterOptions(fMetas.rep)}</select>
      <select id="metas-estado" onchange="fMetas.estado=this.value; metasPage=1; metasRefresh()">${estadoFilterOptions(fMetas.estado)}</select>
      <button class="btn btn-outline btn-sm" onclick="exportarMetasCSV()">⬇ Exportar CSV</button>
    </div>
    <div id="metas-kpis-wrap">${metasKpisHTML()}</div>
    <div id="metas-panels-wrap">${metasPanelsHTML()}</div>
    <div id="metas-note" class="list-note">${metasNote()}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Lojista</th><th>Representante</th><th>Meta (R$)</th><th class="meta-cell">Progresso</th><th>Faltam (R$)</th><th>Ticket médio</th><th>Último pedido</th><th>Status</th><th>Acesso</th></tr></thead>
        <tbody id="metas-tbody">${metasRowsHTML()}</tbody>
      </table>
    </div>
    <div id="metas-pagination">${metasPaginationHTML()}</div>`;
}

function metasKpisHTML() {
  const list = filtrarClientes(fMetas);
  const comMeta = list.filter(c => c.progresso.temMeta);
  const metaTotal = comMeta.reduce((s, c) => s + c.progresso.valorMeta, 0);
  const vendidoTotal = comMeta.reduce((s, c) => s + c.progresso.vendido, 0);
  const faltam = Math.max(0, metaTotal - vendidoTotal);
  const pctMedio = metaTotal > 0 ? Math.round(vendidoTotal / metaTotal * 1000) / 10 : 0;
  return `
    <div class="kpi-grid">
      <div class="kpi"><div class="label">🏪 Lojistas na lista</div><div class="value">${list.length}</div><div class="sub">${list.length - comMeta.length} sem meta</div></div>
      <div class="kpi"><div class="label">🎯 Meta total</div><div class="value gold">${fmt(metaTotal)}</div></div>
      <div class="kpi"><div class="label">📈 Progresso total</div><div class="value">${fmt(vendidoTotal)}</div><div class="sub">${pctMedio}% da meta</div></div>
      <div class="kpi"><div class="label">⏳ Faltam para a meta</div><div class="value" style="color:#a06f14">${fmt(faltam)}</div></div>
      <div class="kpi"><div class="label">✓ % de atingimento</div><div class="value gold">${pctMedio}%</div></div>
    </div>`;
}

function metasPanelsHTML() {
  const list = filtrarClientes(fMetas);
  const comMeta = list.filter(c => c.progresso.temMeta);
  const metaTotal = comMeta.reduce((s, c) => s + c.progresso.valorMeta, 0);
  const vendidoTotal = comMeta.reduce((s, c) => s + c.progresso.vendido, 0);
  const pctMedio = metaTotal > 0 ? Math.round(vendidoTotal / metaTotal * 1000) / 10 : 0;

  // Comparativo com histórico real da coleção anterior (Verão 26), quando existir
  const histVer26 = list.reduce((s, c) => s + (c.hist_ver26 || 0), 0);
  const cresc = histVer26 > 0 ? Math.round((metaTotal - histVer26) / histVer26 * 1000) / 10 : null;

  const buckets = { 'em-dia': [], 'atencao': [], 'risco': [] };
  comMeta.forEach(c => { const b = metaStatusInfo(c.progresso).bucket; if (buckets[b]) buckets[b].push(c); });

  const top5 = [...comMeta].sort((a, b) => b.progresso.vendido - a.progresso.vendido).slice(0, 5);

  const porRegiao = {};
  list.forEach(c => {
    const uf = c.estado || 'Não informado';
    porRegiao[uf] = porRegiao[uf] || { vendido: 0, count: 0 };
    porRegiao[uf].vendido += c.progresso.vendido;
    porRegiao[uf].count++;
  });
  const regioes = Object.entries(porRegiao).sort((a, b) => b[1].vendido - a[1].vendido).slice(0, 6);
  const maxRegiao = Math.max(...regioes.map(([, v]) => v.vendido), 1);

  return `
    <div class="metas-panels">
      <div class="metas-panel">
        <h4>Progresso Geral</h4>
        <div class="donut-wrap">
          ${donutSvg([{ value: vendidoTotal, color: 'var(--gold, #C9A84C)' }, { value: Math.max(0, metaTotal - vendidoTotal), color: '#EFE8D8' }])}
          <div class="donut-center"><strong>${pctMedio}%</strong><span>Atingido</span></div>
        </div>
        <div class="donut-figs">
          <div><span>${fmt(vendidoTotal)}</span><small>Atingido</small></div>
          <div style="text-align:right"><span>${fmt(metaTotal)}</span><small>Meta total</small></div>
        </div>
        ${cresc !== null ? `<div class="donut-compare ${cresc >= 0 ? 'up' : 'down'}">${cresc >= 0 ? '↑' : '↓'} ${cresc >= 0 ? '+' : ''}${cresc}% vs Verão 26</div>` : ''}
      </div>

      <div class="metas-panel">
        <h4>Distribuição por Status</h4>
        <div class="donut-wrap">
          ${donutSvg([
            { value: buckets['em-dia'].length, color: 'var(--success)' },
            { value: buckets['atencao'].length, color: '#d9a441' },
            { value: buckets['risco'].length, color: 'var(--danger)' },
          ])}
        </div>
        <div class="status-legend">
          <div><span class="dot" style="background:var(--success)"></span>Em dia (≥ 80%)<strong>${buckets['em-dia'].length}</strong></div>
          <div><span class="dot" style="background:#d9a441"></span>Atenção (50–79%)<strong>${buckets['atencao'].length}</strong></div>
          <div><span class="dot" style="background:var(--danger)"></span>Risco (&lt; 50%)<strong>${buckets['risco'].length}</strong></div>
        </div>
        <button class="btn-link" onclick="fMetas.bucket='risco'; metasPage=1; metasRefresh()">Ver lojistas em risco</button>
      </div>

      <div class="metas-panel">
        <h4>Top 5 Maiores Progressos (R$)</h4>
        ${top5.length ? `<ol class="top5-list">
          ${top5.map(c => `<li><span class="top5-rank">${c.progresso.pct}%</span><span class="top5-name">${esc(c.razao_social)}</span><strong>${fmt(c.progresso.vendido)}</strong></li>`).join('')}
        </ol>` : `<p class="muted" style="font-size:.82rem">Nenhum lojista com meta ainda.</p>`}
        <button class="btn-link" onclick="switchTab('overview')">Ver ranking completo</button>
      </div>

      <div class="metas-panel">
        <h4>Desempenho por Região</h4>
        ${regioes.length ? `<div class="regiao-list">
          ${regioes.map(([uf, v]) => `
            <div class="regiao-row">
              <span class="regiao-uf">${esc(uf)}</span>
              <div class="regiao-bar"><div class="regiao-bar-fill" style="width:${Math.round(v.vendido / maxRegiao * 100)}%"></div></div>
              <span class="regiao-val">${fmt(v.vendido)}</span>
            </div>`).join('')}
        </div>` : `<p class="muted" style="font-size:.82rem">Sem dados de região ainda.</p>`}
      </div>
    </div>`;
}

function metasRowsHTML() {
  const full = filtrarClientes(fMetas);
  const start = (metasPage - 1) * metasPerPage;
  const list = full.slice(start, start + metasPerPage);
  return list.map((c, i) => {
    const st = metaStatusInfo(c.progresso);
    const ultimo = ultimoPedidoCnpj(c.cnpj);
    const ticket = ticketMedioCnpj(c.cnpj);
    return `
    <tr class="${c.ativo ? '' : 'inactive-row'}">
      <td><span class="rank-badge">${start + i + 1}</span></td>
      <td>${esc(c.razao_social)}<br><span class="muted" style="font-size:.76rem">${fmtCnpj(c.cnpj)}</span></td>
      <td>${c.rep ? esc(c.rep.nome) : '<span class="muted">—</span>'}${c.estado ? `<br><span class="muted" style="font-size:.74rem">${esc(c.estado)}</span>` : ''}</td>
      <td style="white-space:nowrap">
        <div class="meta-edit">
          <input type="number" class="meta-input" id="meta-${c.id}" min="0" step="500"
            value="${c.progresso.valorMeta || ''}" placeholder="0"
            onkeydown="if(event.key==='Enter') salvarMeta('${c.id}')">
          <button class="meta-save" onclick="salvarMeta('${c.id}')" title="Salvar meta">✓</button>
        </div>
      </td>
      <td>${progressBar(c.progresso)}</td>
      <td>${c.progresso.temMeta ? fmt(c.progresso.restante) : '<span class="muted">—</span>'}</td>
      <td>${ticket > 0 ? fmt(ticket) : '<span class="muted">—</span>'}</td>
      <td>${ultimo ? fmtRelative(ultimo) : '<span class="muted">—</span>'}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
      <td><button class="btn btn-sm btn-outline" onclick="copiarLinkLojista('${c.cnpj}','${esc(c.razao_social).replace(/'/g, "\\'")}')" title="Copiar mensagem de acesso pronta pro WhatsApp">💬</button></td>
    </tr>`;
  }).join('');
}

function metasNote() {
  const total = filtrarClientes(fMetas).length;
  return `${total} lojista(s) encontrado(s).`;
}

function metasPaginationHTML() {
  const total = filtrarClientes(fMetas).length;
  const pages = Math.max(1, Math.ceil(total / metasPerPage));
  if (metasPage > pages) metasPage = pages;
  const start = total ? (metasPage - 1) * metasPerPage + 1 : 0;
  const end = Math.min(total, metasPage * metasPerPage);

  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - metasPage) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  return `
    <div class="pagination">
      <span class="pagination-info">Mostrando ${start} a ${end} de ${total} lojista(s)</span>
      <div class="pagination-controls">
        <button class="page-btn" ${metasPage <= 1 ? 'disabled' : ''} onclick="metasGoPage(${metasPage - 1})">‹</button>
        ${nums.map(p => p === '…'
          ? `<span class="page-ellipsis">…</span>`
          : `<button class="page-btn ${p === metasPage ? 'active' : ''}" onclick="metasGoPage(${p})">${p}</button>`).join('')}
        <button class="page-btn" ${metasPage >= pages ? 'disabled' : ''} onclick="metasGoPage(${metasPage + 1})">›</button>
      </div>
      <select class="page-size" onchange="metasPerPage=parseInt(this.value); metasPage=1; metasRefresh()">
        ${[10, 25, 50].map(n => `<option value="${n}" ${metasPerPage === n ? 'selected' : ''}>${n} por página</option>`).join('')}
      </select>
    </div>`;
}

function metasGoPage(p) { metasPage = p; metasRefresh(); }

function metasRefresh() {
  const kpis = document.getElementById('metas-kpis-wrap');
  if (kpis) kpis.innerHTML = metasKpisHTML();
  const panels = document.getElementById('metas-panels-wrap');
  if (panels) panels.innerHTML = metasPanelsHTML();
  const tb = document.getElementById('metas-tbody');
  if (tb) tb.innerHTML = metasRowsHTML();
  const note = document.getElementById('metas-note');
  if (note) note.textContent = metasNote();
  const pag = document.getElementById('metas-pagination');
  if (pag) pag.innerHTML = metasPaginationHTML();
}

function exportarMetasCSV() {
  const list = filtrarClientes(fMetas);
  const linhas = [['Lojista', 'CNPJ', 'Representante', 'Estado', 'Meta (R$)', 'Vendido (R$)', '% Atingido', 'Faltam (R$)', 'Status'].join(';')];
  list.forEach(c => {
    const st = metaStatusInfo(c.progresso);
    linhas.push([
      c.razao_social, fmtCnpj(c.cnpj), c.rep ? c.rep.nome : '', c.estado || '',
      c.progresso.valorMeta.toFixed(2).replace('.', ','),
      c.progresso.vendido.toFixed(2).replace('.', ','),
      c.progresso.pct + '%',
      c.progresso.restante.toFixed(2).replace('.', ','),
      st.label,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  });
  const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `metas-${colecaoAtiva().replace(/\s+/g, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado!', 'success');
}

function salvarMeta(clienteId) {
  const val = parseFloat(document.getElementById('meta-' + clienteId).value);
  if (isNaN(val) || val < 0) { toast('Informe um valor de meta válido.', 'error'); return; }
  if (val === 0) { deleteMeta(clienteId); toast('Meta removida.', 'info'); }
  else { setMeta(clienteId, val); toast('Meta salva!', 'success'); }
  metasRefresh();
}

// ── MASTER: Lojistas (CRUD) ───────────────────────────────
let fLoj = { q: '', rep: '' };

// ── Link + mensagem de acesso individual do lojista ───────
// A senha do lojista é sempre os 5 primeiros dígitos do próprio CNPJ,
// então o link já leva tudo que precisa: o lojista só confirma "Entrar".
function linkAcessoLojista(cnpj) {
  return `${location.origin}/portal.html?loja=${onlyDigits(cnpj)}`;
}
// Mensagem pronta pra colar no WhatsApp — nome do lojista + link, personalizada.
function mensagemAcessoLojista(cnpj, nome) {
  return [
    `Olá, ${nome}! 🛍️`,
    ``,
    `Seu acesso ao Portal B2B KE — Coleção ${colecaoAtiva()} já está pronto.`,
    `É só clicar no link abaixo pra entrar direto no seu painel de pedidos e meta:`,
    ``,
    linkAcessoLojista(cnpj),
    ``,
    `Qualquer dúvida, é só chamar seu representante. 🤝`,
  ].join('\n');
}
async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch { prompt('Copie o texto abaixo:', texto); return false; }
}
function copiarLinkLojista(cnpj, nome) {
  copiarTexto(mensagemAcessoLojista(cnpj, nome))
    .then(ok => { if (ok) toast(`Mensagem de acesso de ${nome} copiada!`, 'success'); });
}
// Copia as mensagens de todos os lojistas de uma lista, uma após a outra
// (separadas por divisor), pra colar e enviar um por um no WhatsApp.
function copiarMensagensEmLote(lista) {
  if (!lista.length) { toast('Nenhum lojista nessa lista.', 'info'); return; }
  if (lista.length > 150 && !confirm(`Isso vai copiar ${lista.length} mensagens de uma vez — melhor filtrar por representante primeiro. Copiar mesmo assim?`)) return;
  const bloco = lista.map(c => `— ${c.razao_social} (${fmtCnpj(c.cnpj)}) —\n${mensagemAcessoLojista(c.cnpj, c.razao_social)}`)
    .join('\n\n────────────────────\n\n');
  copiarTexto(bloco).then(ok => {
    if (ok) toast(`${lista.length} mensagens copiadas! Cole num bloco de notas e envie uma a uma.`, 'success');
  });
}

function renderLojistas() {
  return `
    <div class="section-header">
      <h2>Lojistas (clientes)</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" onclick="copiarMensagensEmLote(lojFiltered())" title="Usa o filtro de busca/representante ao lado">💬 Copiar mensagens (filtrados)</button>
        <button class="btn btn-gold" onclick="formLojista()">+ Novo Lojista</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="loj-q" placeholder="Buscar por razão social ou CNPJ..."
        value="${esc(fLoj.q)}" oninput="fLoj.q=this.value; lojRows()">
      <select id="loj-rep" onchange="fLoj.rep=this.value; lojRows()">${repFilterOptions(fLoj.rep)}</select>
    </div>
    <div id="loj-note" class="list-note">${lojNote()}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Razão Social</th><th>CNPJ</th><th>Cidade/UF</th><th>Representante</th><th>Senha</th><th>Ativo</th><th>Ações</th></tr></thead>
        <tbody id="loj-tbody">${lojRowsHTML()}</tbody>
      </table>
    </div>`;
}

function lojFiltered() {
  let list = getClients().slice();
  if (fLoj.rep) list = list.filter(c => c.representante_id === fLoj.rep);
  const q = fLoj.q.trim().toLowerCase();
  const dq = onlyDigits(q);
  if (q) list = list.filter(c =>
    (c.razao_social || '').toLowerCase().includes(q) || (dq && onlyDigits(c.cnpj).includes(dq)));
  return list.sort((a, b) => a.razao_social.localeCompare(b.razao_social));
}

function lojRowsHTML() {
  const list = lojFiltered().slice(0, ROW_CAP);
  if (!getClients().length) return `<tr><td colspan="7" style="text-align:center;color:#aaa;padding:30px">Nenhum lojista cadastrado.</td></tr>`;
  return list.map(c => {
    const rep = repById(c.representante_id);
    return `
    <tr class="${c.ativo ? '' : 'inactive-row'}">
      <td><strong>${esc(c.razao_social)}</strong></td>
      <td>${fmtCnpj(c.cnpj)}</td>
      <td>${c.cidade ? esc(c.cidade) + '/' + esc(c.estado || '') : '<span class="muted">—</span>'}</td>
      <td>${rep ? esc(rep.nome) : '<span class="muted">—</span>'}</td>
      <td><span class="muted">${esc(c.senha || '—')}</span></td>
      <td>${c.ativo ? '✅' : '❌'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-outline" onclick="formLojista('${c.id}')">✏️</button>
        <button class="btn btn-sm btn-outline" onclick="copiarLinkLojista('${c.cnpj}','${esc(c.razao_social).replace(/'/g, "\\'")}')" title="Copiar mensagem de acesso pronta pro WhatsApp">💬</button>
        <button class="btn btn-sm btn-danger" onclick="excluirLojista('${c.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

function lojNote() {
  const total = lojFiltered().length;
  if (total > ROW_CAP) return `Mostrando ${ROW_CAP} de ${total}. Use a busca ou filtre por representante.`;
  return `${total} lojista(s).`;
}

function lojRows() {
  const tb = document.getElementById('loj-tbody');
  if (tb) tb.innerHTML = lojRowsHTML();
  const note = document.getElementById('loj-note');
  if (note) note.textContent = lojNote();
}

function formLojista(id) {
  const c = id ? clientById(id) : null;
  const reps = getReps();
  const repOpts = ['<option value="">— Sem representante —</option>',
    ...reps.map(r => `<option value="${r.id}" ${c && c.representante_id === r.id ? 'selected' : ''}>${esc(r.nome)}</option>`)].join('');

  openModal(id ? 'Editar Lojista' : 'Novo Lojista', `
    <div class="form-group"><label>Razão Social *</label><input id="cl-razao" value="${c ? esc(c.razao_social) : ''}" placeholder="Nome conforme CNPJ"></div>
    <div class="form-group"><label>CNPJ *</label><input id="cl-cnpj" value="${c ? fmtCnpj(c.cnpj) : ''}" placeholder="00.000.000/0000-00" maxlength="18" oninput="this.value=maskCNPJ(this.value)"></div>
    <div class="form-row">
      <div class="form-group"><label>Cidade</label><input id="cl-cidade" value="${c ? esc(c.cidade || '') : ''}"></div>
      <div class="form-group"><label>UF</label><input id="cl-estado" maxlength="2" value="${c ? esc(c.estado || '') : ''}" placeholder="SC"></div>
    </div>
    <div class="form-group"><label>Representante</label><select id="cl-rep">${repOpts}</select></div>
    <div class="form-group"><label>Senha de acesso *</label><input id="cl-senha" value="${c ? esc(c.senha || '') : 'loja123'}" placeholder="Senha do lojista"></div>
    <div class="form-group" style="display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="cl-ativo" ${!c || c.ativo ? 'checked' : ''} style="width:auto">
      <label for="cl-ativo" style="margin:0;text-transform:none">Lojista ativo</label>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-gold" onclick="salvarLojista(${id ? `'${id}'` : 'null'})">💾 Salvar</button>
  `);
}

function salvarLojista(id) {
  const razao = val('cl-razao'), cnpj = onlyDigits(val('cl-cnpj')), senha = val('cl-senha');
  if (!razao || !cnpj || !senha) { toast('Preencha Razão Social, CNPJ e Senha.', 'error'); return; }
  if (cnpj.length !== 14) { toast('CNPJ deve ter 14 dígitos.', 'error'); return; }
  const dup = clientByCnpj(cnpj);
  if (dup && dup.id !== id) { toast('Já existe um lojista com esse CNPJ.', 'error'); return; }

  const data = {
    razao_social: razao, cnpj,
    cidade: val('cl-cidade'), estado: val('cl-estado').toUpperCase(),
    representante_id: val('cl-rep') || null,
    senha,
    ativo: document.getElementById('cl-ativo').checked,
  };
  if (id) { updateClient(id, data); toast('Lojista atualizado!', 'success'); }
  else    { addClient(data);        toast('Lojista cadastrado!', 'success'); }
  closeModal(); refresh();
}

function excluirLojista(id) {
  const c = clientById(id);
  if (!confirm(`Excluir "${c.razao_social}"? A meta dele também será removida.`)) return;
  deleteClient(id); toast('Lojista excluído.', 'info'); refresh();
}

// ── MASTER: Representantes (CRUD) ─────────────────────────
function renderReps() {
  const reps = getReps();
  const counts = {};
  getClients().forEach(c => { if (c.representante_id) counts[c.representante_id] = (counts[c.representante_id] || 0) + 1; });
  return `
    <div class="section-header">
      <h2>Representantes</h2>
      <button class="btn btn-gold" onclick="formRep()">+ Novo Representante</button>
    </div>
    ${reps.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>WhatsApp</th><th>Senha</th><th>Lojistas</th><th>Ativo</th><th>Ações</th></tr></thead>
        <tbody>
          ${reps.map(r => `
            <tr class="${r.ativo ? '' : 'inactive-row'}">
              <td><strong>${esc(r.nome)}</strong></td>
              <td>${esc(r.email)}</td>
              <td>${esc(r.whatsapp || '—')}</td>
              <td><span class="muted">${esc(r.senha || '—')}</span></td>
              <td>${counts[r.id] || 0}</td>
              <td>${r.ativo ? '✅' : '❌'}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-outline" onclick="formRep('${r.id}')">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="excluirRep('${r.id}')">🗑</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="empty-block"><div class="icon">🧑‍💼</div><p>Nenhum representante cadastrado.</p></div>`}`;
}

function formRep(id) {
  const r = id ? repById(id) : null;
  openModal(id ? 'Editar Representante' : 'Novo Representante', `
    <div class="form-group"><label>Nome *</label><input id="rp-nome" value="${r ? esc(r.nome) : ''}"></div>
    <div class="form-group"><label>E-mail *</label><input id="rp-email" value="${r ? esc(r.email) : ''}" placeholder="rep@email.com"></div>
    <div class="form-group"><label>WhatsApp</label><input id="rp-wpp" value="${r ? esc(r.whatsapp || '') : ''}" placeholder="5541999999999"></div>
    <div class="form-group"><label>Senha de acesso *</label><input id="rp-senha" value="${r ? esc(r.senha || '') : 'rep123'}"></div>
    <div class="form-group" style="display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="rp-ativo" ${!r || r.ativo ? 'checked' : ''} style="width:auto">
      <label for="rp-ativo" style="margin:0;text-transform:none">Representante ativo</label>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-gold" onclick="salvarRep(${id ? `'${id}'` : 'null'})">💾 Salvar</button>
  `);
}

function salvarRep(id) {
  const nome = val('rp-nome'), email = val('rp-email').toLowerCase(), senha = val('rp-senha');
  if (!nome || !email || !senha) { toast('Preencha Nome, E-mail e Senha.', 'error'); return; }
  const dup = getReps().find(r => (r.email || '').toLowerCase() === email && r.id !== id);
  if (dup) { toast('Já existe um representante com esse e-mail.', 'error'); return; }

  const data = { nome, email, whatsapp: val('rp-wpp'), senha, ativo: document.getElementById('rp-ativo').checked };
  if (id) { updateRep(id, data); toast('Representante atualizado!', 'success'); }
  else    { addRep(data);        toast('Representante cadastrado!', 'success'); }
  closeModal(); refresh();
}

function excluirRep(id) {
  const r = repById(id);
  if (!confirm(`Excluir "${r.nome}"? Os lojistas dele ficarão sem representante.`)) return;
  deleteRep(id); toast('Representante excluído.', 'info'); refresh();
}

// ── MASTER: Configurações ─────────────────────────────────
function renderConfig() {
  const s = getSettings();
  return `
    <div class="section-header"><h2>Configurações</h2></div>
    <div class="settings-card">
      <h3>Coleção & Acesso</h3>
      <div class="form-group"><label>Nome da Coleção (usada nas metas)</label><input id="cfg-col" value="${esc(s.collection)}"></div>
      <div class="form-group"><label>Senha do Usuário Máximo</label><input id="cfg-pass" value="${esc(s.adminPass)}"></div>
      <div class="form-group"><label>WhatsApp de pedidos</label><input id="cfg-wpp" value="${esc(s.whatsapp)}"></div>
      <button class="btn btn-gold" onclick="salvarConfig()">💾 Salvar</button>
      <p style="font-size:.78rem;color:#999;margin-top:14px">A senha do Usuário Máximo é a mesma do painel <a href="admin.html">Admin</a> do catálogo.</p>
    </div>`;
}
function salvarConfig() {
  const cur = getSettings();
  saveSettings({ ...cur, collection: val('cfg-col') || cur.collection, adminPass: val('cfg-pass') || cur.adminPass, whatsapp: onlyDigits(val('cfg-wpp')) || cur.whatsapp });
  toast('Configurações salvas!', 'success');
  document.getElementById('nav-ctx').textContent = `Usuário Máximo · ${colecaoAtiva()}`;
  refresh();
}

// ── MASTER: Acessos & Carrinhos (visão global, todos os lojistas) ─
let filtroAcessosMaster = 'todos';

function statusInfoLojistaGlobal(c) {
  const d = onlyDigits(c.cnpj);
  const pendente = getOrders().find(o => o.status === 'pending' && onlyDigits(o.buyer && o.buyer.cnpj) === d);
  const cart = getCarts()[d];
  const lastAccess = getAccess()[d];
  const diasSemAcesso = lastAccess ? (Date.now() - new Date(lastAccess).getTime()) / 86400000 : Infinity;

  if (pendente) return { bucket: 'pedido', label: '⏳ Para confirmar', cls: 'badge-info' };
  if (cart && cart.totalValue > 0) return { bucket: 'carrinho', label: '🟡 Carrinho abandonado', cls: 'badge-warn' };
  if (diasSemAcesso > 30) return { bucket: 'inativo', label: '🔴 Inativo', cls: 'badge-danger' };
  const confirmados = getOrders().filter(o => o.status === 'confirmed' && onlyDigits(o.buyer && o.buyer.cnpj) === d);
  if (confirmados.length) return { bucket: 'confirmado', label: '🟢 Pedido confirmado', cls: 'badge-success' };
  return { bucket: 'ativo', label: lastAccess ? '⚪ Navegando' : '— Sem atividade', cls: 'badge-muted' };
}
function toggleFiltroAcessosMaster(f) { filtroAcessosMaster = f; refresh(); }
function recuperarVendaGlobal(cnpj) {
  const c = getClients().find(x => onlyDigits(x.cnpj) === onlyDigits(cnpj));
  const cart = getCarts()[onlyDigits(cnpj)];
  if (!c || !cart) return;
  const msg = mensagemRecuperarCarrinho(c, cart);
  const fone = onlyDigits(telefoneDoLojista(cnpj) || '');
  if (fone) window.open(`https://wa.me/${fone}?text=${encodeURIComponent(msg)}`, '_blank');
  else copiarTexto(msg).then(ok => toast(ok ? 'Mensagem copiada! Cole no WhatsApp do lojista.' : 'Copie a mensagem manualmente.', ok ? 'success' : 'info'));
}
function chamarLojistaGlobal(cnpj) {
  const c = getClients().find(x => onlyDigits(x.cnpj) === onlyDigits(cnpj));
  if (!c) return;
  const msg = `Olá, ${c.razao_social}! 👋\n\nVi que você deu uma olhada no catálogo da coleção ${colecaoAtiva()}. Posso te ajudar a montar o pedido? 🛍️`;
  const fone = onlyDigits(telefoneDoLojista(cnpj) || '');
  if (fone) window.open(`https://wa.me/${fone}?text=${encodeURIComponent(msg)}`, '_blank');
  else copiarTexto(msg).then(ok => toast(ok ? 'Mensagem copiada! Cole no WhatsApp do lojista.' : 'Copie a mensagem manualmente.', ok ? 'success' : 'info'));
}

function renderAcessosMaster() {
  const todos = getClients().filter(c => c.ativo);
  const carts = getCarts();
  const access = getAccess();
  const todosCnpjs = todos.map(c => onlyDigits(c.cnpj));

  const carrinhosAtivos = todosCnpjs.map(d => ({ cnpj: d, cart: carts[d] })).filter(x => x.cart && x.cart.totalValue > 0);
  const valorEmCarrinho = carrinhosAtivos.reduce((s, x) => s + x.cart.totalValue, 0);
  const ativos7d = todosCnpjs.filter(d => access[d] && (Date.now() - new Date(access[d]).getTime()) / 86400000 <= 7).length;
  const ativosHoje = todosCnpjs.filter(d => access[d] && (Date.now() - new Date(access[d]).getTime()) / 3600000 <= 24).length;

  const oportunidadesCarrinho = carrinhosAtivos
    .map(x => ({ ...x, cliente: todos.find(c => onlyDigits(c.cnpj) === x.cnpj) }))
    .filter(x => x.cliente)
    .sort((a, b) => b.cart.totalValue - a.cart.totalValue);
  const oportunidadesNavegacao = todosCnpjs
    .filter(d => !carts[d] && access[d] && (Date.now() - new Date(access[d]).getTime()) / 3600000 <= 48)
    .map(d => ({ cnpj: d, cliente: todos.find(c => onlyDigits(c.cnpj) === d), access: access[d] }))
    .filter(x => x.cliente)
    .sort((a, b) => new Date(b.access) - new Date(a.access));

  const clientesFiltrados = todos.filter(c => {
    if (filtroAcessosMaster === 'todos') return true;
    return statusInfoLojistaGlobal(c).bucket === filtroAcessosMaster;
  }).sort((a, b) => {
    const da = access[onlyDigits(a.cnpj)], db = access[onlyDigits(b.cnpj)];
    if (da && db) return new Date(db) - new Date(da);
    return da ? -1 : db ? 1 : a.razao_social.localeCompare(b.razao_social);
  });
  const countBucket = (b) => todos.filter(c => statusInfoLojistaGlobal(c).bucket === b).length;

  return `
    <div class="section-header"><h2>👀 Acessos & Carrinhos · ${esc(colecaoAtiva())}</h2></div>
    <p style="font-size:.82rem;color:#999;margin-top:-14px;margin-bottom:22px">Quem acessou o catálogo e o que está parado no carrinho, em toda a base — visão que o representante vê só da própria carteira, aqui é de todos os ${todos.length} lojistas ativos.</p>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">Lojistas ativos</div><div class="value">${todos.length}</div></div>
      <div class="kpi"><div class="label">Acessaram hoje</div><div class="value" style="color:var(--success)">${ativosHoje}</div></div>
      <div class="kpi"><div class="label">Ativos (7 dias)</div><div class="value" style="color:var(--success)">${ativos7d}/${todos.length}</div></div>
      <div class="kpi"><div class="label">Em carrinho</div><div class="value" style="color:#b9760a">${fmt(valorEmCarrinho)}</div><div class="sub">${carrinhosAtivos.length} lojista${carrinhosAtivos.length === 1 ? '' : 's'}</div></div>
    </div>

    <div class="section-header">
      <h2>🔥 Oportunidades Quentes</h2>
      ${(oportunidadesCarrinho.length + oportunidadesNavegacao.length) ? `<span class="hint">${oportunidadesCarrinho.length + oportunidadesNavegacao.length} lojista${(oportunidadesCarrinho.length + oportunidadesNavegacao.length) === 1 ? '' : 's'} precisam de atenção</span>` : ''}
    </div>
    ${(oportunidadesCarrinho.length || oportunidadesNavegacao.length) ? `
    <div class="opp-list" style="margin-bottom:26px">
      ${oportunidadesCarrinho.map(x => `
        <div class="opp-card opp-warn">
          <div class="opp-main">
            <strong>🛒 ${esc(x.cliente.razao_social)}</strong>
            <span class="opp-sub">${fmt(x.cart.totalValue)} no carrinho · ${(x.cart.items || []).length} ite${(x.cart.items || []).length === 1 ? 'm' : 'ns'} parado${(x.cart.items || []).length === 1 ? '' : 's'}</span>
          </div>
          <div class="opp-time">${fmtRelative(x.cart.updatedAt)}</div>
          <button class="btn btn-sm btn-gold" onclick="recuperarVendaGlobal('${x.cnpj}')">💬 Recuperar Venda</button>
        </div>`).join('')}
      ${oportunidadesNavegacao.map(x => `
        <div class="opp-card opp-info">
          <div class="opp-main">
            <strong>👀 ${esc(x.cliente.razao_social)}</strong>
            <span class="opp-sub">Acessou o catálogo, carrinho ainda vazio</span>
          </div>
          <div class="opp-time">${fmtRelative(x.access)}</div>
          <button class="btn btn-sm btn-outline" onclick="chamarLojistaGlobal('${x.cnpj}')">💬 Chamar Lojista</button>
        </div>`).join('')}
    </div>` : `<div class="empty-block" style="padding:24px;margin-bottom:26px"><div class="icon" style="font-size:2rem">✨</div><p>Nenhuma oportunidade quente agora — base em dia.</p></div>`}

    <div class="section-header"><h2>Todos os lojistas</h2></div>
    <div class="filter-chips" style="margin-bottom:14px">
      <button class="chip ${filtroAcessosMaster === 'todos' ? 'active' : ''}" onclick="toggleFiltroAcessosMaster('todos')">Todos ${todos.length}</button>
      <button class="chip ${filtroAcessosMaster === 'carrinho' ? 'active' : ''}" onclick="toggleFiltroAcessosMaster('carrinho')">🛒 Montando pedido ${countBucket('carrinho')}</button>
      <button class="chip ${filtroAcessosMaster === 'pedido' ? 'active' : ''}" onclick="toggleFiltroAcessosMaster('pedido')">⏳ Para confirmar ${countBucket('pedido')}</button>
      <button class="chip ${filtroAcessosMaster === 'inativo' ? 'active' : ''}" onclick="toggleFiltroAcessosMaster('inativo')">🔴 Inativos ${countBucket('inativo')}</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Lojista</th><th>Representante</th><th>Último acesso</th><th>Carrinho</th><th>Status</th></tr></thead>
        <tbody>
          ${clientesFiltrados.slice(0, 400).map(c => {
            const d = onlyDigits(c.cnpj);
            const info = statusInfoLojistaGlobal(c);
            const cart = carts[d];
            const rep = repById(c.representante_id);
            return `
            <tr>
              <td><strong>${esc(c.razao_social)}</strong><br><span class="muted" style="font-size:.76rem">${fmtCnpj(c.cnpj)}</span></td>
              <td>${rep ? esc(rep.nome) : '<span class="muted">—</span>'}</td>
              <td>${access[d] ? fmtRelative(access[d]) : '<span class="muted">—</span>'}</td>
              <td>${cart && cart.totalValue > 0 ? fmt(cart.totalValue) : '<span class="muted">—</span>'}</td>
              <td><span class="status-badge ${info.cls}">${info.label}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${clientesFiltrados.length > 400 ? `<p style="font-size:.8rem;color:#999;margin-top:10px">Mostrando 400 de ${clientesFiltrados.length}. Use os filtros pra ver o restante.</p>` : ''}`;
}

// ── REP: pedidos da carteira (mesmo CNPJ dos seus lojistas) ─
function statusLabelRep(s) {
  return { pending: '⏳ Pendente', confirmed: '✅ Confirmado', shipped: '🚚 Enviado', cancelled: '❌ Recusado' }[s] || s;
}
function pedidosDaCarteira() {
  const meusCnpjs = new Set(getClients().filter(c => c.representante_id === session.id).map(c => onlyDigits(c.cnpj)));
  return getOrders().filter(o => meusCnpjs.has(onlyDigits(o.buyer && o.buyer.cnpj)))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}
function confirmarPedido(id, status) {
  updateOrderStatus(id, status);
  toast(status === 'confirmed' ? 'Pedido confirmado!' : 'Pedido recusado.', status === 'confirmed' ? 'success' : 'info');
  refresh();
}

// ── REP: rastreamento — carrinho/acesso por CNPJ da carteira ─
function fmtRelative(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Agora mesmo';
  if (min < 60) return `Há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Há ${h} hora${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `Há ${d} dia${d === 1 ? '' : 's'}`;
}
function telefoneDoLojista(cnpj) {
  const d = onlyDigits(cnpj);
  const pedido = getOrders().filter(o => onlyDigits(o.buyer && o.buyer.cnpj) === d)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return pedido ? pedido.buyer.phone : null;
}
// Classifica o lojista pra badge de status + filtro rápido.
// Prioridade: pedido pendente > carrinho ativo > inativo (30+ dias) > em dia.
function statusInfoLojista(c) {
  const d = onlyDigits(c.cnpj);
  const pendente = pedidosDaCarteira().find(o => o.status === 'pending' && onlyDigits(o.buyer.cnpj) === d);
  const cart = getCarts()[d];
  const lastAccess = getAccess()[d];
  const diasSemAcesso = lastAccess ? (Date.now() - new Date(lastAccess).getTime()) / 86400000 : Infinity;

  if (pendente) return { bucket: 'pedido', label: '⏳ Para confirmar', cls: 'badge-info' };
  if (cart && cart.totalValue > 0) return { bucket: 'carrinho', label: '🟡 Carrinho abandonado', cls: 'badge-warn' };
  if (diasSemAcesso > 30) return { bucket: 'inativo', label: '🔴 Inativo', cls: 'badge-danger' };
  const confirmados = pedidosDaCarteira().filter(o => o.status === 'confirmed' && onlyDigits(o.buyer.cnpj) === d);
  if (confirmados.length) return { bucket: 'confirmado', label: '🟢 Pedido confirmado', cls: 'badge-success' };
  return { bucket: 'ativo', label: lastAccess ? '⚪ Navegando' : '— Sem atividade', cls: 'badge-muted' };
}
function mensagemRecuperarCarrinho(c, cart) {
  const itens = (cart.items || []).map(i => `• ${i.productName}${i.color ? ' (' + i.color + ')' : ''} × ${i.qty}`).join('\n');
  return [
    `Olá, ${c.razao_social}! 👋`,
    ``,
    `Vi que você separou alguns itens no carrinho da coleção ${colecaoAtiva()} e não finalizou o pedido:`,
    ``,
    itens,
    ``,
    `💰 Total: ${fmt(cart.totalValue)}`,
    ``,
    `Posso te ajudar a fechar? Qualquer dúvida sobre tamanho, cor ou prazo é só me chamar. 🤝`,
  ].join('\n');
}
function recuperarVenda(cnpj) {
  const c = clientById2(cnpj);
  const cart = getCarts()[onlyDigits(cnpj)];
  if (!c || !cart) return;
  const msg = mensagemRecuperarCarrinho(c, cart);
  const fone = onlyDigits(telefoneDoLojista(cnpj) || '');
  if (fone) {
    window.open(`https://wa.me/${fone}?text=${encodeURIComponent(msg)}`, '_blank');
  } else {
    copiarTexto(msg).then(ok => toast(ok ? 'Mensagem copiada! Cole no WhatsApp do lojista.' : 'Copie a mensagem manualmente.', ok ? 'success' : 'info'));
  }
}
function chamarLojista(cnpj) {
  const c = clientById2(cnpj);
  if (!c) return;
  const msg = `Olá, ${c.razao_social}! 👋\n\nVi que você deu uma olhada no catálogo da coleção ${colecaoAtiva()}. Posso te ajudar a montar o pedido? 🛍️`;
  const fone = onlyDigits(telefoneDoLojista(cnpj) || '');
  if (fone) window.open(`https://wa.me/${fone}?text=${encodeURIComponent(msg)}`, '_blank');
  else copiarTexto(msg).then(ok => toast(ok ? 'Mensagem copiada! Cole no WhatsApp do lojista.' : 'Copie a mensagem manualmente.', ok ? 'success' : 'info'));
}
// clientById já existe pra uso geral (master); aqui buscamos só na própria carteira.
function clientById2(cnpj) {
  const d = onlyDigits(cnpj);
  return clientesComProgresso(session.id).find(c => onlyDigits(c.cnpj) === d);
}

// ── REP: Minha Carteira ───────────────────────────────────
let filtroCarteira = 'todos';
let selecionadosCarteira = new Set();

function toggleFiltroCarteira(f) { filtroCarteira = f; selecionadosCarteira.clear(); refresh(); }
function toggleSelecaoLojista(cnpj) {
  const d = onlyDigits(cnpj);
  if (selecionadosCarteira.has(d)) selecionadosCarteira.delete(d); else selecionadosCarteira.add(d);
  refresh();
}
function enviarMensagemSelecionados() {
  const clientes = clientesComProgresso(session.id).filter(c => selecionadosCarteira.has(onlyDigits(c.cnpj)));
  copiarMensagensEmLote(clientes);
}

let carteiraPeriodo = 'semana';
function trocarPeriodoCarteira(p) {
  carteiraPeriodo = p;
  document.querySelectorAll('#carteira-period-toggle .ptg-btn').forEach(b => b.classList.toggle('active', b.dataset.p === p));
  const wrap = document.getElementById('carteira-tendencia-wrap');
  if (wrap) wrap.innerHTML = renderCarteiraTendenciaChart();
}
function renderCarteiraTendenciaChart() {
  const meusCnpjs = new Set(clientesComProgresso(session.id).map(c => onlyDigits(c.cnpj)));
  const buckets = vendasPorPeriodo(carteiraPeriodo, 12, meusCnpjs);
  if (!buckets.length) {
    return `<div class="empty-chart"><div class="ic">📈</div>
      <p>Sem pedidos suficientes pra desenhar a evolução ainda.</p></div>`;
  }
  const W = 480, H = 170, padL = 8, padR = 8, padB = 24, padT = 14;
  const max = Math.max(...buckets.map(b => b.total), 1);
  const bw = (W - padL - padR) / buckets.length;
  const bars = buckets.map((b, i) => {
    const h = Math.max(2, (b.total / max) * (H - padT - padB));
    const x = padL + i * bw + bw * 0.15;
    const w = bw * 0.7;
    const y = H - padB - h;
    const isLast = i === buckets.length - 1;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3"
        fill="${isLast ? 'var(--gold)' : '#E8D5A3'}"></rect>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--mid)">${esc(b.label)}</text>
      ${isLast ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--dark)">${fmt(b.total)}</text>` : ''}
    `;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      <line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" stroke="#EDE7D8"></line>
      ${bars}
    </svg>`;
}

function renderCarteira() {
  const todos = clientesComProgresso(session.id).sort((a, b) => a.razao_social.localeCompare(b.razao_social));
  const metaTotal = todos.reduce((s, c) => s + c.progresso.valorMeta, 0);
  const vendidoTotal = todos.reduce((s, c) => s + c.progresso.vendido, 0);
  const pct = metaTotal > 0 ? Math.round(vendidoTotal / metaTotal * 1000) / 10 : 0;
  const pedidos = pedidosDaCarteira();
  const pendentes = pedidos.filter(o => o.status === 'pending');

  const carts = getCarts();
  const access = getAccess();
  const meusCnpjs = todos.map(c => onlyDigits(c.cnpj));
  const carrinhosAtivos = meusCnpjs.map(d => ({ cnpj: d, cart: carts[d] })).filter(x => x.cart && x.cart.totalValue > 0);
  const valorEmCarrinho = carrinhosAtivos.reduce((s, x) => s + x.cart.totalValue, 0);
  const diasDesdeAcesso = (d) => access[d] ? (Date.now() - new Date(access[d]).getTime()) / 86400000 : Infinity;
  const ativos7d = meusCnpjs.filter(d => diasDesdeAcesso(d) <= 7).length;
  const inativos30 = meusCnpjs.filter(d => diasDesdeAcesso(d) > 7 && diasDesdeAcesso(d) <= 30).length;
  const inativosMais30 = meusCnpjs.filter(d => diasDesdeAcesso(d) > 30).length;

  const porRegiao = {};
  todos.forEach(c => {
    const uf = c.estado || 'Não informado';
    porRegiao[uf] = (porRegiao[uf] || 0) + c.progresso.vendido;
  });
  const topRegioes = Object.entries(porRegiao).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxRegiao = Math.max(...topRegioes.map(([, v]) => v), 1);

  // ── Oportunidades quentes: carrinho abandonado (ordenado por valor) +
  //    acesso recente sem nada no carrinho (navegou mas não comprou) ──
  const oportunidadesCarrinho = carrinhosAtivos
    .map(x => ({ ...x, cliente: todos.find(c => onlyDigits(c.cnpj) === x.cnpj) }))
    .filter(x => x.cliente)
    .sort((a, b) => b.cart.totalValue - a.cart.totalValue);
  const oportunidadesNavegacao = meusCnpjs
    .filter(d => !carts[d] && access[d] && (Date.now() - new Date(access[d]).getTime()) / 3600000 <= 48)
    .map(d => ({ cnpj: d, cliente: todos.find(c => onlyDigits(c.cnpj) === d), access: access[d] }))
    .filter(x => x.cliente)
    .sort((a, b) => new Date(b.access) - new Date(a.access));

  const clientesFiltrados = todos.filter(c => {
    if (filtroCarteira === 'todos') return true;
    return statusInfoLojista(c).bucket === filtroCarteira;
  });
  const countBucket = (b) => todos.filter(c => statusInfoLojista(c).bucket === b).length;

  return `
    <div class="section-header"><h2>Minha Carteira · ${esc(colecaoAtiva())}</h2></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">🏪 Meus lojistas</div><div class="value">${todos.length}</div></div>
      <div class="kpi"><div class="label">🎯 Meta total</div><div class="value gold">${fmt(metaTotal)}</div></div>
      <div class="kpi"><div class="label">💰 Vendido</div><div class="value">${fmt(vendidoTotal)}</div></div>
      <div class="kpi"><div class="label">✓ % atingido</div><div class="value gold">${pct}%</div></div>
      <div class="kpi"><div class="label">🛒 Em carrinho</div><div class="value" style="color:#b9760a">${fmt(valorEmCarrinho)}</div><div class="sub">${carrinhosAtivos.length} lojista${carrinhosAtivos.length === 1 ? '' : 's'}</div></div>
      <div class="kpi"><div class="label">🟢 Ativos (7 dias)</div><div class="value" style="color:var(--success)">${ativos7d}/${todos.length}</div></div>
    </div>

    <div class="metas-panels" style="grid-template-columns:minmax(220px,1fr) minmax(280px,2fr)">
      <div class="metas-panel">
        <h4>Desempenho da Carteira</h4>
        <div class="donut-wrap">
          ${donutSvg([{ value: vendidoTotal, color: 'var(--gold, #C9A84C)' }, { value: Math.max(0, metaTotal - vendidoTotal), color: '#EFE8D8' }])}
          <div class="donut-center"><strong>${pct}%</strong><span>Atingido</span></div>
        </div>
        <div class="donut-figs">
          <div><span>${fmt(vendidoTotal)}</span><small>Vendido</small></div>
          <div style="text-align:right"><span>${fmt(metaTotal)}</span><small>Meta</small></div>
        </div>
      </div>
      <div class="metas-panel">
        <div class="section-header" style="margin-bottom:6px">
          <h4 style="margin-bottom:0">Evolução de Vendas</h4>
          <div class="period-toggle" id="carteira-period-toggle">
            ${['semana', 'quinzena', 'mes'].map(p => `<button class="ptg-btn${p === carteiraPeriodo ? ' active' : ''}" data-p="${p}" onclick="trocarPeriodoCarteira('${p}')">${{semana:'Semana', quinzena:'Quinzena', mes:'Mês'}[p]}</button>`).join('')}
          </div>
        </div>
        <div id="carteira-tendencia-wrap">${renderCarteiraTendenciaChart()}</div>
      </div>
    </div>

    <div class="section-header">
      <h2>🔥 Oportunidades Quentes</h2>
      ${(oportunidadesCarrinho.length + oportunidadesNavegacao.length) ? `<span class="hint">${oportunidadesCarrinho.length + oportunidadesNavegacao.length} lojista${(oportunidadesCarrinho.length + oportunidadesNavegacao.length) === 1 ? '' : 's'} precisam de atenção</span>` : ''}
    </div>
    ${(oportunidadesCarrinho.length || oportunidadesNavegacao.length) ? `
    <div class="opp-list" style="margin-bottom:26px">
      ${oportunidadesCarrinho.map(x => `
        <div class="opp-card opp-warn">
          <div class="opp-main">
            <strong>🛒 ${esc(x.cliente.razao_social)}</strong>
            <span class="opp-sub">${fmt(x.cart.totalValue)} no carrinho · ${(x.cart.items || []).length} ite${(x.cart.items || []).length === 1 ? 'm' : 'ns'} parado${(x.cart.items || []).length === 1 ? '' : 's'}</span>
          </div>
          <div class="opp-time">${fmtRelative(x.cart.updatedAt)}</div>
          <button class="btn btn-sm btn-gold" onclick="recuperarVenda('${x.cnpj}')">💬 Recuperar Venda</button>
        </div>`).join('')}
      ${oportunidadesNavegacao.map(x => `
        <div class="opp-card opp-info">
          <div class="opp-main">
            <strong>👀 ${esc(x.cliente.razao_social)}</strong>
            <span class="opp-sub">Acessou o catálogo, carrinho ainda vazio</span>
          </div>
          <div class="opp-time">${fmtRelative(x.access)}</div>
          <button class="btn btn-sm btn-outline" onclick="chamarLojista('${x.cnpj}')">💬 Chamar Lojista</button>
        </div>`).join('')}
    </div>` : `<div class="empty-block" style="padding:24px;margin-bottom:26px"><div class="icon" style="font-size:2rem">✨</div><p>Nenhuma oportunidade quente agora — carteira em dia.</p></div>`}

    <div class="section-header">
      <h2>Pedidos para confirmar</h2>
      ${pendentes.length ? `<span class="hint">${pendentes.length} aguardando sua confirmação</span>` : ''}
    </div>
    ${pedidos.length ? `
    <div class="table-wrap" style="margin-bottom:26px">
      <table>
        <thead><tr><th>Pedido</th><th>Lojista</th><th>Itens</th><th>Total</th><th>Data</th><th>Status</th><th>Avaliação</th><th>Ações</th></tr></thead>
        <tbody>
          ${pedidos.map(o => `
            <tr>
              <td><strong>#${o.id.slice(-6).toUpperCase()}</strong></td>
              <td>${esc(o.buyer.razao)}<br><span class="muted" style="font-size:.76rem">${fmtCnpj(o.buyer.cnpj)}</span></td>
              <td>${o.items.length} ref. · ${o.items.reduce((s,i)=>s+i.qty,0)} peças</td>
              <td>${fmt(o.totalValue)}</td>
              <td>${fmtDate(o.date)}</td>
              <td>${statusLabelRep(o.status)}</td>
              <td>${o.rating ? `<span class="rating-stars filled" title="${o.comment ? esc(o.comment) : ''}">${starsHtml(o.rating)}</span>` : '<span class="muted">—</span>'}</td>
              <td style="white-space:nowrap">
                ${o.status === 'pending' ? `
                  <button class="btn btn-sm btn-gold" onclick="confirmarPedido('${o.id}','confirmed')">✅ Confirmar</button>
                  <button class="btn btn-sm btn-outline" onclick="confirmarPedido('${o.id}','cancelled')">❌ Recusar</button>
                ` : ''}
                <button class="btn btn-sm btn-outline" onclick="baixarPdfPedido('${o.id}', this)">📄 PDF</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="empty-block" style="padding:30px;margin-bottom:26px"><div class="icon" style="font-size:2rem">📦</div><p>Nenhum pedido da sua carteira ainda.</p></div>`}

    <div class="metas-panels">
      <div class="metas-panel">
        <h4>Distribuição dos Lojistas</h4>
        <div class="donut-wrap">
          ${donutSvg([
            { value: ativos7d, color: 'var(--success)' },
            { value: inativos30, color: '#d9a441' },
            { value: inativosMais30, color: 'var(--danger)' },
          ])}
        </div>
        <div class="status-legend">
          <div><span class="dot" style="background:var(--success)"></span>Ativos (7 dias)<strong>${ativos7d}</strong></div>
          <div><span class="dot" style="background:#d9a441"></span>Inativos (7–30 dias)<strong>${inativos30}</strong></div>
          <div><span class="dot" style="background:var(--danger)"></span>Inativos (&gt;30 dias)<strong>${inativosMais30}</strong></div>
        </div>
      </div>
      <div class="metas-panel">
        <h4>Top Regiões (Vendido)</h4>
        ${topRegioes.length ? `<div class="regiao-list">
          ${topRegioes.map(([uf, v], i) => `
            <div class="regiao-row">
              <span class="regiao-uf">${i + 1}. ${esc(uf)}</span>
              <div class="regiao-bar"><div class="regiao-bar-fill" style="width:${Math.round(v / maxRegiao * 100)}%"></div></div>
              <span class="regiao-val">${fmt(v)}</span>
            </div>`).join('')}
        </div>` : `<p class="muted" style="font-size:.82rem">Sem dados de região ainda.</p>`}
      </div>
    </div>

    ${todos.length ? `
    <div class="section-header">
      <h2>Meus lojistas</h2>
      ${selecionadosCarteira.size
        ? `<button class="btn btn-gold btn-sm" onclick="enviarMensagemSelecionados()">💬 Enviar mensagem para os ${selecionadosCarteira.size} selecionados</button>`
        : `<button class="btn btn-outline btn-sm" onclick="copiarMensagensEmLote(clientesComProgresso(session.id))">💬 Copiar mensagens de todos (${todos.length})</button>`}
    </div>
    <div class="filter-chips" style="margin-bottom:14px">
      <button class="chip ${filtroCarteira === 'todos' ? 'active' : ''}" onclick="toggleFiltroCarteira('todos')">Todos ${todos.length}</button>
      <button class="chip ${filtroCarteira === 'carrinho' ? 'active' : ''}" onclick="toggleFiltroCarteira('carrinho')">🛒 Montando pedido ${countBucket('carrinho')}</button>
      <button class="chip ${filtroCarteira === 'pedido' ? 'active' : ''}" onclick="toggleFiltroCarteira('pedido')">⏳ Para confirmar ${countBucket('pedido')}</button>
      <button class="chip ${filtroCarteira === 'inativo' ? 'active' : ''}" onclick="toggleFiltroCarteira('inativo')">🔴 Inativos ${countBucket('inativo')}</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th></th><th>Lojista</th><th>Cidade/UF</th><th class="meta-cell">Progresso</th><th>Último acesso</th><th>Carrinho</th><th>Status</th><th>Acesso</th></tr></thead>
        <tbody>
          ${clientesFiltrados.map(c => {
            const d = onlyDigits(c.cnpj);
            const info = statusInfoLojista(c);
            const cart = carts[d];
            return `
            <tr class="${c.ativo ? '' : 'inactive-row'}">
              <td><input type="checkbox" ${selecionadosCarteira.has(d) ? 'checked' : ''} onchange="toggleSelecaoLojista('${c.cnpj}')"></td>
              <td><strong>${esc(c.razao_social)}</strong><br><span class="muted" style="font-size:.76rem">${fmtCnpj(c.cnpj)}</span></td>
              <td>${c.cidade ? esc(c.cidade) + '/' + esc(c.estado || '') : '<span class="muted">—</span>'}</td>
              <td>${progressBar(c.progresso)}</td>
              <td>${access[d] ? fmtRelative(access[d]) : '<span class="muted">—</span>'}</td>
              <td>${cart && cart.totalValue > 0 ? fmt(cart.totalValue) : '<span class="muted">—</span>'}</td>
              <td><span class="status-badge ${info.cls}">${info.label}</span></td>
              <td><button class="btn btn-sm btn-outline" onclick="copiarLinkLojista('${c.cnpj}','${esc(c.razao_social).replace(/'/g, "\\'")}')" title="Copiar mensagem de acesso pronta pro WhatsApp">💬 Mensagem</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:.82rem;color:#999;margin-top:14px">As metas são definidas pelo Usuário Máximo. Para registrar pedidos, use o <a href="index.html" target="_blank">Catálogo</a>.</p>
    ` : `<div class="empty-block"><div class="icon">🏪</div><p>Você ainda não tem lojistas vinculados.</p></div>`}`;
}

// ── LOJISTA: Minha Meta ───────────────────────────────────
function renderMinhaMeta() {
  const c = clientById(session.id);
  if (!c) return `<div class="empty-block"><div class="icon">⚠️</div><p>Cadastro não encontrado.</p></div>`;
  const prog = progressoCliente(c);
  const rep = repById(c.representante_id);
  const cls = !prog.temMeta ? 'none' : prog.pct >= 100 ? 'done' : prog.pct >= 70 ? 'high' : prog.pct >= 40 ? 'mid' : 'low';

  return `
    <div class="section-header"><h2>Minha Meta · ${esc(colecaoAtiva())}</h2></div>
    <div class="meta-hero">
      <h3>${esc(c.razao_social)}</h3>
      <span class="muted" style="font-size:.8rem">${fmtCnpj(c.cnpj)}${rep ? ' · Rep: ' + esc(rep.nome) : ''}</span>
      ${prog.temMeta ? `
        <div class="big-pct">${prog.pct}%</div>
        <div class="progress"><div class="progress-fill ${cls}" style="width:${Math.min(100, prog.pct)}%"></div></div>
        <div class="meta-figs">
          <div class="meta-fig"><div class="l">Meta</div><div class="v">${fmt(prog.valorMeta)}</div></div>
          <div class="meta-fig"><div class="l">Comprado</div><div class="v">${fmt(prog.vendido)}</div></div>
          <div class="meta-fig"><div class="l">Falta</div><div class="v">${fmt(prog.restante)}</div></div>
        </div>
        ${prog.pct >= 100
          ? `<p style="color:var(--success);font-weight:700;margin-top:16px">🎉 Parabéns! Meta atingida.</p>`
          : `<p style="color:var(--mid);margin-top:16px">Faltam <strong>${fmt(prog.restante)}</strong> para bater sua meta.</p>`}
      ` : `<p style="color:#999;margin-top:18px">Sua meta ainda não foi definida pelo representante.</p>`}
      <a href="index.html?loja=${onlyDigits(c.cnpj)}" class="btn btn-gold btn-full" style="margin-top:20px" target="_blank">👜 Fazer pedido no catálogo</a>
    </div>
    <p style="font-size:.78rem;color:#999;text-align:center">O progresso considera seus pedidos (não cancelados) feitos pelo catálogo com este CNPJ.</p>`;
}

// ── LOJISTA: Meus Dados & Histórico de Pedidos ────────────
function pedidosDoLojista() {
  const c = clientById(session.id);
  if (!c) return [];
  const meuCnpj = onlyDigits(c.cnpj);
  return getOrders().filter(o => onlyDigits(o.buyer && o.buyer.cnpj) === meuCnpj)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}
function statusBadgeLojista(s) {
  const map = {
    pending:   { label: '⏳ Em processamento', cls: 'badge-info' },
    confirmed: { label: '✅ Confirmado', cls: 'badge-success' },
    shipped:   { label: '🚚 Enviado', cls: 'badge-success' },
    cancelled: { label: '❌ Recusado', cls: 'badge-danger' },
  };
  return map[s] || { label: s, cls: 'badge-muted' };
}
// Estoque atual do produto (não o do momento da compra) — ajuda o lojista
// a saber se dá pra repetir o item num próximo pedido.
function estoqueAtualBadge(productId) {
  if (typeof getProducts !== 'function') return '';
  const p = getProducts().find(x => x.id === productId);
  if (!p) return '<span class="order-item-stock muted">Produto descontinuado</span>';
  const s = p.stock || 0;
  const cls = s === 0 ? 'out' : s <= 5 ? 'low' : 'ok';
  const label = s === 0 ? 'Esgotado agora' : s <= 5 ? `Últimas ${s} em estoque` : `${s} em estoque`;
  return `<span class="order-item-stock ${cls}">${label}</span>`;
}
// PDF do pedido a partir do histórico — disponível pro lojista, pro
// representante (na carteira) e pro master, reaproveitando gerarPdfPedido
// (data.js) com a imagem gravada em cada item no momento da compra.
async function baixarPdfPedido(orderId, btn) {
  const order = getOrders().find(o => o.id === orderId);
  if (!order) { toast('Pedido não encontrado.', 'error'); return; }
  const rep = repById(order.representante_id);
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando...'; }
  try { await gerarPdfPedido(order, rep); }
  catch (e) { toast('Falha ao gerar o PDF.', 'error'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = original; } }
}
function renderPedidosLojista() {
  const c = clientById(session.id);
  if (!c) return `<div class="empty-block"><div class="icon">⚠️</div><p>Cadastro não encontrado.</p></div>`;
  const rep = repById(c.representante_id);
  const pedidos = pedidosDoLojista();

  return `
    <div class="section-header"><h2>Meus Dados & Pedidos · ${esc(colecaoAtiva())}</h2></div>

    <div class="dados-card" style="margin-bottom:30px">
      <div class="dados-field"><span class="dados-label">Razão Social</span><span class="dados-value">${esc(c.razao_social)}</span></div>
      <div class="dados-field"><span class="dados-label">CNPJ</span><span class="dados-value">${fmtCnpj(c.cnpj)}</span></div>
      <div class="dados-field"><span class="dados-label">Cidade/UF</span><span class="dados-value">${c.cidade ? esc(c.cidade) + '/' + esc(c.estado || '') : '—'}</span></div>
      <div class="dados-field"><span class="dados-label">Representante</span><span class="dados-value">${rep ? esc(rep.nome) : '—'}</span></div>
    </div>

    <div class="section-header"><h3 style="font-weight:600;letter-spacing:.04em;color:var(--mid);text-transform:uppercase;font-size:.82rem">Histórico de Pedidos</h3></div>
    ${pedidos.length ? `
    <div class="order-history">
      ${pedidos.map(o => {
        const st = statusBadgeLojista(o.status);
        return `
        <div class="order-card">
          <div class="order-card-header">
            <div>
              <span class="order-num">Pedido #${o.id.slice(-6).toUpperCase()}</span>
              <span class="order-date">${fmtDate(o.date)}</span>
            </div>
            <div class="order-head-right">
              <span class="status-badge ${st.cls}">${st.label}</span>
              <span class="order-total">${fmt(o.totalValue)}</span>
              <button class="btn btn-sm btn-outline" onclick="baixarPdfPedido('${o.id}', this)">📄 PDF</button>
            </div>
          </div>
          <div class="order-items">
            ${o.items.map(i => `
              <div class="order-item">
                <div class="order-item-img">${i.image ? `<img src="${i.image}" alt="${esc(i.productName)}" onerror="this.parentElement.innerHTML='🛍️'">` : '🛍️'}</div>
                <div class="order-item-info">
                  <span class="order-item-name">${esc(i.productName)}</span>
                  <span class="order-item-code">Ref. ${esc(i.productCode || '—')}</span>
                  <span class="order-item-meta">${i.color ? esc(i.color) + ' · ' : ''}Qtd. ${i.qty}</span>
                  ${estoqueAtualBadge(i.productId)}
                </div>
              </div>`).join('')}
          </div>
          ${['confirmed', 'shipped'].includes(o.status) ? `<div class="order-rating">${avaliacaoWidget(o)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <p style="font-size:.78rem;color:#999;margin-top:14px">O status é atualizado pelo seu representante assim que o pedido é confirmado.</p>
    ` : `<div class="empty-block"><div class="icon">📦</div><p>Você ainda não fez nenhum pedido.</p><a href="index.html?loja=${onlyDigits(c.cnpj)}" class="btn btn-gold btn-sm" style="margin-top:10px" target="_blank">👜 Ir para o catálogo</a></div>`}`;
}

// ── Avaliar pedido (lojista) ───────────────────────────────
function starsHtml(rating) {
  return Array.from({ length: 5 }, (_, i) => i < rating ? '★' : '☆').join('');
}
function avaliacaoWidget(o) {
  if (o.rating) {
    return `<span class="rating-label">Sua avaliação:</span> <span class="rating-stars filled">${starsHtml(o.rating)}</span>${o.comment ? `<span class="rating-comment">"${esc(o.comment)}"</span>` : ''}`;
  }
  return `<span class="rating-label">Avalie este pedido:</span> ${[1, 2, 3, 4, 5].map(n =>
    `<button class="rating-star" onclick="avaliarPedido('${o.id}',${n})" title="${n} estrela${n === 1 ? '' : 's'}">☆</button>`
  ).join('')}`;
}
function avaliarPedido(orderId, rating) {
  const comment = prompt(`Nota ${rating}/5 — quer deixar um comentário? (opcional)`, '') || '';
  rateOrder(orderId, rating, comment.trim());
  toast('Obrigado pela avaliação!', 'success');
  refresh();
}

// ── LOJISTA: Minhas Sugestões ──────────────────────────────
function sugestoesParaLojista() {
  const pedidos = pedidosDoLojista().filter(o => o.status !== 'cancelled');
  const categoriasCompradas = new Set();
  const codigosComprados = new Set();
  pedidos.forEach(o => o.items.forEach(i => {
    codigosComprados.add(i.productCode);
    const p = getProducts().find(x => x.id === i.productId);
    if (p) categoriasCompradas.add(p.category);
  }));
  const disponiveis = getProducts().filter(p => p.active && (p.stock || 0) > 0);
  if (!categoriasCompradas.size) {
    return disponiveis.filter(p => p.rank).sort((a, b) => a.rank - b.rank).slice(0, 8);
  }
  return disponiveis
    .filter(p => categoriasCompradas.has(p.category) && !codigosComprados.has(p.code))
    .slice(0, 12);
}
function renderSugestoesLojista() {
  const c = clientById(session.id);
  const temHistorico = pedidosDoLojista().filter(o => o.status !== 'cancelled').length > 0;
  const sugestoes = sugestoesParaLojista();

  return `
    <div class="section-header"><h2>Minhas Sugestões · ${esc(colecaoAtiva())}</h2></div>
    <p style="font-size:.82rem;color:#999;margin-top:-14px;margin-bottom:22px">
      ${temHistorico
        ? 'Com base no que você já comprou — itens das mesmas famílias que ainda não estão no seu pedido.'
        : 'Você ainda não tem pedidos — aqui vão os campeões de venda da coleção pra começar.'}
    </p>
    ${sugestoes.length ? `
    <div class="sugestoes-grid">
      ${sugestoes.map(p => `
        <div class="sugestao-card">
          <div class="sugestao-img">${p.image ? `<img src="${p.image}" alt="${esc(p.name)}" onerror="this.parentElement.innerHTML='🛍️'">` : '🛍️'}</div>
          <div class="sugestao-info">
            <span class="sugestao-name">${esc(p.name)}</span>
            <span class="sugestao-code">Ref. ${esc(p.code)}</span>
            ${p.retail ? `<span class="sugestao-price">${fmt(p.retail)} <small>varejo sugerido</small></span>` : `<span class="sugestao-price">${fmt(p.price)}</span>`}
          </div>
        </div>`).join('')}
    </div>
    <a href="index.html?loja=${onlyDigits(c.cnpj)}" class="btn btn-gold btn-full" style="margin-top:22px" target="_blank">👜 Montar pedido no catálogo</a>
    ` : `<div class="empty-block"><div class="icon">✨</div><p>Nenhuma sugestão nova por enquanto — você já pediu de tudo que temos pras suas famílias favoritas!</p></div>`}`;
}

// ── Modal / utils ─────────────────────────────────────────
function openModal(title, body, footer) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }

function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

function maskCNPJ(v) {
  v = v.replace(/\D/g, '').slice(0, 14);
  return v
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function fmtCnpj(cnpj) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return d || '—';
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function toast(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  document.getElementById('toast-container').appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
