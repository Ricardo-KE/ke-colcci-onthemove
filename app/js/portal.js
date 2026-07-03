// ============================================================
//  KE – Colcci On The Move  |  Portal B2B – logic
// ============================================================

let loginRole = 'master';

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  getProducts();
  await probeOnline();

  selectRole('master');

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
  const cnpjLink = new URLSearchParams(location.search).get('loja');
  if (cnpjLink) {
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

function sair() { portalLogout(); clearToken(); location.reload(); }

// ── Shell ─────────────────────────────────────────────────
const TABS = {
  master: [
    { id: 'overview', label: '📊 Visão Geral' },
    { id: 'metas',    label: '🎯 Metas & Progresso' },
    { id: 'lojistas', label: '🏪 Lojistas' },
    { id: 'reps',     label: '🧑‍💼 Representantes' },
    { id: 'config',   label: '⚙️ Configurações' },
  ],
  rep:     [{ id: 'carteira', label: '🎯 Minha Carteira' }],
  lojista: [
    { id: 'minhameta', label: '🎯 Minha Meta' },
    { id: 'pedidos',   label: '📦 Meus Pedidos' },
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
    config:    renderConfig,
    carteira:  renderCarteira,
    minhameta: renderMinhaMeta,
    pedidos:   renderPedidosLojista,
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

// ── MASTER: Metas & Progresso (cadastro de meta individual) ─
const ROW_CAP = 400;
let fMetas = { q: '', rep: '' };

function filtrarClientes(f) {
  let list = clientesComProgresso();
  if (f.rep) list = list.filter(c => c.representante_id === f.rep);
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

function renderMetas() {
  if (!getClients().length) {
    return `<div class="empty-block"><div class="icon">🏪</div><p>Cadastre lojistas primeiro na aba <strong>Lojistas</strong>.</p></div>`;
  }
  return `
    <div class="section-header">
      <h2>Metas &amp; Progresso · ${esc(colecaoAtiva())}</h2>
      <span class="hint">Edite a meta e clique em 💾 para salvar.</span>
    </div>
    <div class="toolbar">
      <input type="search" id="metas-q" placeholder="Buscar por razão social ou CNPJ..."
        value="${esc(fMetas.q)}" oninput="fMetas.q=this.value; metasRows()">
      <select id="metas-rep" onchange="fMetas.rep=this.value; metasRows()">${repFilterOptions(fMetas.rep)}</select>
    </div>
    <div id="metas-note" class="list-note">${metasNote()}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Lojista</th><th>Representante</th><th>Meta (R$)</th><th class="meta-cell">Progresso</th><th>Status</th></tr></thead>
        <tbody id="metas-tbody">${metasRowsHTML()}</tbody>
      </table>
    </div>`;
}

function metasRowsHTML() {
  const list = filtrarClientes(fMetas).slice(0, ROW_CAP);
  return list.map(c => `
    <tr class="${c.ativo ? '' : 'inactive-row'}">
      <td>${esc(c.razao_social)}<br><span class="muted" style="font-size:.76rem">${fmtCnpj(c.cnpj)}</span></td>
      <td>${c.rep ? esc(c.rep.nome) : '<span class="muted">—</span>'}</td>
      <td style="white-space:nowrap">
        <input type="number" class="meta-input" id="meta-${c.id}" min="0" step="500"
          value="${c.progresso.valorMeta || ''}" placeholder="0">
        <button class="btn btn-sm btn-gold" onclick="salvarMeta('${c.id}')" title="Salvar meta">💾</button>
      </td>
      <td>${progressBar(c.progresso)}</td>
      <td>${statusPill(c.progresso)}</td>
    </tr>`).join('');
}

function metasNote() {
  const total = filtrarClientes(fMetas).length;
  if (total > ROW_CAP) return `Mostrando ${ROW_CAP} de ${total}. Use a busca ou filtre por representante para ver o restante.`;
  return `${total} lojista(s).`;
}

function metasRows() {
  const tb = document.getElementById('metas-tbody');
  if (tb) tb.innerHTML = metasRowsHTML();
  const note = document.getElementById('metas-note');
  if (note) note.textContent = metasNote();
}

function salvarMeta(clienteId) {
  const val = parseFloat(document.getElementById('meta-' + clienteId).value);
  if (isNaN(val) || val < 0) { toast('Informe um valor de meta válido.', 'error'); return; }
  if (val === 0) { deleteMeta(clienteId); toast('Meta removida.', 'info'); }
  else { setMeta(clienteId, val); toast('Meta salva!', 'success'); }
  metasRows();
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

// ── REP: Minha Carteira ───────────────────────────────────
function renderCarteira() {
  const clientes = clientesComProgresso(session.id).sort((a, b) => a.razao_social.localeCompare(b.razao_social));
  const metaTotal = clientes.reduce((s, c) => s + c.progresso.valorMeta, 0);
  const vendidoTotal = clientes.reduce((s, c) => s + c.progresso.vendido, 0);
  const pct = metaTotal > 0 ? Math.round(vendidoTotal / metaTotal * 1000) / 10 : 0;
  const pedidos = pedidosDaCarteira();
  const pendentes = pedidos.filter(o => o.status === 'pending');

  return `
    <div class="section-header"><h2>Minha Carteira · ${esc(colecaoAtiva())}</h2></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">Meus lojistas</div><div class="value">${clientes.length}</div></div>
      <div class="kpi"><div class="label">Meta total</div><div class="value gold">${fmt(metaTotal)}</div></div>
      <div class="kpi"><div class="label">Vendido</div><div class="value">${fmt(vendidoTotal)}</div></div>
      <div class="kpi"><div class="label">% atingido</div><div class="value gold">${pct}%</div></div>
    </div>

    <div class="section-header">
      <h2>Pedidos para confirmar</h2>
      ${pendentes.length ? `<span class="hint">${pendentes.length} aguardando sua confirmação</span>` : ''}
    </div>
    ${pedidos.length ? `
    <div class="table-wrap" style="margin-bottom:26px">
      <table>
        <thead><tr><th>Pedido</th><th>Lojista</th><th>Itens</th><th>Total</th><th>Data</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${pedidos.map(o => `
            <tr>
              <td><strong>#${o.id.slice(-6).toUpperCase()}</strong></td>
              <td>${esc(o.buyer.razao)}<br><span class="muted" style="font-size:.76rem">${fmtCnpj(o.buyer.cnpj)}</span></td>
              <td>${o.items.length} ref. · ${o.items.reduce((s,i)=>s+i.qty,0)} peças</td>
              <td>${fmt(o.totalValue)}</td>
              <td>${fmtDate(o.date)}</td>
              <td>${statusLabelRep(o.status)}</td>
              <td style="white-space:nowrap">
                ${o.status === 'pending' ? `
                  <button class="btn btn-sm btn-gold" onclick="confirmarPedido('${o.id}','confirmed')">✅ Confirmar</button>
                  <button class="btn btn-sm btn-outline" onclick="confirmarPedido('${o.id}','cancelled')">❌ Recusar</button>
                ` : '<span class="muted">—</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="empty-block" style="padding:30px;margin-bottom:26px"><div class="icon" style="font-size:2rem">📦</div><p>Nenhum pedido da sua carteira ainda.</p></div>`}

    ${clientes.length ? `
    <div class="section-header">
      <h2>Meus lojistas</h2>
      <button class="btn btn-outline btn-sm" onclick="copiarMensagensEmLote(clientesComProgresso(session.id))">💬 Copiar mensagens de todos (${clientes.length})</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Lojista</th><th>Cidade/UF</th><th class="meta-cell">Progresso</th><th>Status</th><th>Acesso</th></tr></thead>
        <tbody>
          ${clientes.map(c => `
            <tr class="${c.ativo ? '' : 'inactive-row'}">
              <td><strong>${esc(c.razao_social)}</strong><br><span class="muted" style="font-size:.76rem">${fmtCnpj(c.cnpj)}</span></td>
              <td>${c.cidade ? esc(c.cidade) + '/' + esc(c.estado || '') : '<span class="muted">—</span>'}</td>
              <td>${progressBar(c.progresso)}</td>
              <td>${statusPill(c.progresso)}</td>
              <td><button class="btn btn-sm btn-outline" onclick="copiarLinkLojista('${c.cnpj}','${esc(c.razao_social).replace(/'/g, "\\'")}')" title="Copiar mensagem de acesso pronta pro WhatsApp">💬 Mensagem</button></td>
            </tr>`).join('')}
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
      <a href="index.html" class="btn btn-gold btn-full" style="margin-top:20px" target="_blank">👜 Fazer pedido no catálogo</a>
    </div>
    <p style="font-size:.78rem;color:#999;text-align:center">O progresso considera seus pedidos (não cancelados) feitos pelo catálogo com este CNPJ.</p>`;
}

// ── LOJISTA: Meus Pedidos (histórico) ─────────────────────
function pedidosDoLojista() {
  const c = clientById(session.id);
  if (!c) return [];
  const meuCnpj = onlyDigits(c.cnpj);
  return getOrders().filter(o => onlyDigits(o.buyer && o.buyer.cnpj) === meuCnpj)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}
function renderPedidosLojista() {
  const pedidos = pedidosDoLojista();

  return `
    <div class="section-header"><h2>Meus Pedidos · ${esc(colecaoAtiva())}</h2></div>
    ${pedidos.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          ${pedidos.map(o => `
            <tr>
              <td><strong>#${o.id.slice(-6).toUpperCase()}</strong></td>
              <td>${fmtDate(o.date)}</td>
              <td>${o.items.length} ref. · ${o.items.reduce((s,i)=>s+i.qty,0)} peças</td>
              <td>${fmt(o.totalValue)}</td>
              <td>${statusLabelRep(o.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:.78rem;color:#999;margin-top:14px">O status é atualizado pelo seu representante assim que o pedido é confirmado.</p>
    ` : `<div class="empty-block"><div class="icon">📦</div><p>Você ainda não fez nenhum pedido.</p><a href="index.html" class="btn btn-gold btn-sm" style="margin-top:10px" target="_blank">👜 Ir para o catálogo</a></div>`}`;
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
