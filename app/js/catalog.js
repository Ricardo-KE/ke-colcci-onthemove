// ============================================================
//  KE – On The Move  |  Catalog & Cart logic
// ============================================================

let cart = [];          // [{ product, color, qty }]
let currentFilter = 'Todos';
let currentSection = 'disponivel';   // 'disponivel' (pronta entrega) | 'colecao' (programação)
let searchQuery = '';

// Produto pertence à seção atual? (produtos sem `sections` aparecem sempre)
function inSection(p) {
  return !p.sections || p.sections.includes(currentSection);
}
// Cores do produto disponíveis na seção atual
function sectionColors(p) {
  const all = p.colors || [];
  if (!p.colorSections) return all;
  const f = all.filter(c => (p.colorSections[c] || []).includes(currentSection));
  return f.length ? f : all;
}

// Foto da cor escolhida (cai para a foto padrão se a cor não tiver foto própria)
function productImage(p, color) {
  return (p.colorImages && p.colorImages[color]) || p.image;
}

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCart();
  renderSectionToggle();
  renderFilters();
  renderProducts();
  bindEvents();
  // sincroniza configurações (WhatsApp/coleção) do servidor, sem bloquear
  if (typeof pullSettings === 'function') pullSettings().catch(() => {});
});

// ── Persistência do carrinho (localStorage) ───────────────
function saveCart() {
  localStorage.setItem('ke_cart', JSON.stringify(
    cart.map(i => ({ id: i.product.id, color: i.color, qty: i.qty }))));
}
function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem('ke_cart') || '[]');
    const prods = getProducts();
    cart = raw.map(it => {
      const product = prods.find(p => p.id === it.id);
      return product ? { product, color: it.color, qty: it.qty } : null;
    }).filter(Boolean);
  } catch { cart = []; }
}

// ── Markup / varejo ───────────────────────────────────────
// Markup = quanto o preço de venda excede o custo, em % do custo.
// (Diferente de margem, que é % sobre o preço de venda.)
function markupPct(p) {
  if (!p.retail || !p.price || p.price <= 0) return null;
  return Math.round((p.retail / p.price - 1) * 100);
}

// Selos curados (estrutura pronta; dados reais definidos pela KE via campo `badge`)
function badgeLabel(b) {
  return { lancamento: '✨ Lançamento', top: '🔥 Mais vendido', reposicao: '⭐ Alta reposição' }[b] || b;
}
function topLabel(p) {
  if (p.rank === 1) return '🔥 Nº1 em vendas';
  if (p.rank <= 3)  return `🔥 Top ${p.rank} vendas`;
  return '🔥 Mais vendido';
}

// Adiciona 1 unidade de cada produto (com estoque) da família — ticket médio
function addFamilyGrade(cat) {
  const list = getProducts().filter(p => p.active && inSection(p) && p.category === cat && (p.stock || 0) > 0);
  let n = 0;
  list.forEach(p => { addToCart(p, sectionColors(p)[0] || '', 1); n++; });
  if (n) { toast(`${n} modelo(s) da família ${cat} adicionados!`, 'success'); openCart(); }
  else { toast('Nenhum item disponível nessa família.', 'error'); }
}

// ── Seções (Disponível / Coleção) ─────────────────────────
function renderSectionToggle() {
  const el = document.getElementById('section-toggle');
  if (!el) return;
  const secs = [
    { key: 'disponivel', label: '✅ Disponível', sub: 'pronta entrega' },
    { key: 'colecao',    label: '🗓️ Coleção Verão 27', sub: 'programação' },
  ];
  el.innerHTML = secs.map(s =>
    `<button class="section-btn${s.key === currentSection ? ' active' : ''}" data-sec="${s.key}">
       ${s.label}<span class="section-sub">${s.sub}</span>
     </button>`).join('');
  el.querySelectorAll('.section-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSection = btn.dataset.sec;
      currentFilter = 'Todos';
      renderSectionToggle();
      renderFilters();
      renderProducts();
    });
  });
}

// ── Filters ───────────────────────────────────────────────
function renderFilters() {
  const products = getProducts().filter(p => p.active && inSection(p));
  const cats = ['Todos', ...new Set(products.map(p => p.category).filter(Boolean))];
  const container = document.getElementById('filters');
  const topChip = products.some(p => p.rank)
    ? `<button class="filter-btn filter-top${currentFilter === '__top__' ? ' active' : ''}" data-cat="__top__">🔥 Mais Vendidos</button>`
    : '';
  container.innerHTML = topChip + cats.map(c =>
    `<button class="filter-btn${c === currentFilter ? ' active' : ''}" data-cat="${c}">${c}</button>`
  ).join('');
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.cat;
      renderFilters();
      renderProducts();
    });
  });
}

// ── Products grid ─────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('product-grid');
  let products = getProducts().filter(p => p.active && inSection(p));

  const topView = currentFilter === '__top__';
  if (topView) {
    products = products.filter(p => p.rank).sort((a, b) => a.rank - b.rank);
  } else if (currentFilter !== 'Todos') {
    products = products.filter(p => p.category === currentFilter);
  }

  if (searchQuery)
    products = products.filter(p =>
      p.name.toLowerCase().includes(searchQuery) ||
      p.code.toLowerCase().includes(searchQuery) ||
      (p.description || '').toLowerCase().includes(searchQuery)
    );

  if (!products.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon">👜</div>
        <h3>Nenhum produto encontrado</h3>
        <p>Tente outro filtro ou termo de busca.</p>
      </div>`;
    return;
  }

  let familyBar = '';
  if (topView) {
    familyBar = `<div class="family-bar family-bar-top">
         <div>🔥 <strong>Mais vendidos do On The Move</strong> — campeões de venda da coleção, ordenados por procura</div>
       </div>`;
  } else if (currentFilter !== 'Todos') {
    familyBar = `<div class="family-bar">
         <div><strong>${currentFilter}</strong> · ${products.length} modelo(s) — monte a vitrine completa</div>
         <button class="btn btn-gold btn-sm" onclick="addFamilyGrade('${currentFilter.replace(/'/g, "\\'")}')">➕ Adicionar grade (1 de cada)</button>
       </div>`;
  }

  grid.innerHTML = familyBar + products.map(p => {
    const stock = p.stock || 0;
    const badgeClass = stock === 0 ? 'out' : stock <= 5 ? 'low' : 'ok';
    const badgeText = stock === 0 ? 'Esgotado'
      : stock <= 5 ? `Últimas ${stock}`
      : stock >= 9999 ? (currentSection === 'disponivel' ? 'Pronta entrega' : 'Programação')
      : `${stock} un.`;
    const cores = sectionColors(p);
    const corInicial = cores[0] || '';
    const imgHtml = p.image
      ? `<img class="product-photo" src="${productImage(p, corInicial)}" alt="${p.name}" loading="lazy">`
      : `<div class="placeholder-icon">👜</div>`;
    // Clicar numa cor troca a foto do card para a foto real daquela cor (se houver)
    const colorsHtml = cores.map(c =>
      `<span class="color-chip${c === corInicial ? ' selected' : ''}" data-color="${c}" data-id="${p.id}">${c}</span>`).join('');

    return `
      <div class="product-card" data-id="${p.id}">
        <div class="product-img">
          ${imgHtml}
          <span class="stock-badge ${badgeClass}">${badgeText}</span>
          ${p.badge ? `<span class="curated-badge${p.badge === 'top' ? ' badge-top' : ''}">${p.badge === 'top' ? topLabel(p) : badgeLabel(p.badge)}</span>` : ''}
        </div>
        <div class="product-info">
          <span class="product-code">${p.code}</span>
          <span class="product-name">${p.name}</span>
          <div class="price-block">
            <div class="price-atacado"><span class="pa-val">${fmt(p.price)}</span><span class="pa-tag">atacado</span></div>
            ${p.retail ? `<div class="price-varejo">Sugerido varejo <strong>${fmt(p.retail)}</strong><span class="margin-badge">markup ${markupPct(p)}%</span></div>` : ''}
          </div>
          ${p.description ? `<span style="font-size:.78rem;color:#777;margin-top:4px">${p.description}</span>` : ''}
          <div class="product-colors">${colorsHtml}</div>
        </div>
        <div class="card-actions">
          <button class="add-btn" data-id="${p.id}" ${stock === 0 ? 'disabled' : ''}>
            ${stock === 0 ? 'Esgotado' : '+ Adicionar ao Pedido'}
          </button>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.add-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => openAddModal(btn.dataset.id));
  });

  // Clicar num chip de cor troca a foto do card para a foto real daquela cor
  grid.querySelectorAll('.color-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = getProducts().find(x => x.id === chip.dataset.id);
      if (!p) return;
      const card = chip.closest('.product-card');
      const img = card.querySelector('.product-photo');
      if (img) img.src = productImage(p, chip.dataset.color);
      card.querySelectorAll('.color-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });
}

// ── Add to cart modal (color + qty selection) ─────────────
function openAddModal(productId) {
  const p = getProducts().find(x => x.id === productId);
  if (!p) return;
  const colors = sectionColors(p);
  let selectedColor = colors[0] || '';
  let qty = 1;

  const backdrop = document.getElementById('add-modal');
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Adicionar ao Pedido</h2>
        <button class="drawer-close" onclick="document.getElementById('add-modal').classList.remove('open')">×</button>
      </div>
      <div class="modal-body">
        ${p.image ? `<img id="modal-img" src="${productImage(p, selectedColor)}" alt="${p.name}" style="width:100%;max-height:220px;object-fit:contain;border-radius:8px;margin-bottom:12px;background:#f6f5f3">` : ''}
        <p style="font-weight:700;font-size:1rem">${p.name}</p>
        <p style="color:#777;font-size:.85rem;margin-bottom:14px">${p.code} · ${fmt(p.price)}</p>
        ${colors.length > 1 ? `
          <div class="form-group">
            <label>Cor</label>
            <div class="color-select" id="color-opts">
              ${colors.map(c => `<span class="color-opt${c === selectedColor ? ' selected' : ''}" data-color="${c}">${c}</span>`).join('')}
            </div>
          </div>` : ''}
        <div class="form-group">
          <label>Quantidade</label>
          <div class="qty-control">
            <button class="qty-btn" id="qty-minus">−</button>
            <span class="qty-val" id="qty-display">1</span>
            <button class="qty-btn" id="qty-plus">+</button>
          </div>
        </div>
        ${p.stock < 9999 ? `<p style="font-size:.82rem;color:#777">Estoque disponível: <strong>${p.stock}</strong></p>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('add-modal').classList.remove('open')">Cancelar</button>
        <button class="btn btn-gold" id="confirm-add">Adicionar</button>
      </div>
    </div>`;

  backdrop.classList.add('open');

  backdrop.querySelectorAll('.color-opt').forEach(el => {
    el.addEventListener('click', () => {
      backdrop.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      selectedColor = el.dataset.color;
      const modalImg = document.getElementById('modal-img');
      if (modalImg) modalImg.src = productImage(p, selectedColor);
    });
  });

  document.getElementById('qty-minus').addEventListener('click', () => {
    if (qty > 1) { qty--; document.getElementById('qty-display').textContent = qty; }
  });
  document.getElementById('qty-plus').addEventListener('click', () => {
    if (qty < p.stock) { qty++; document.getElementById('qty-display').textContent = qty; }
  });
  document.getElementById('confirm-add').addEventListener('click', () => {
    addToCart(p, selectedColor, qty);
    backdrop.classList.remove('open');
    toast(`${p.name} adicionada ao pedido!`, 'success');
    openCart();
  });

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('open'); });
}

// ── Cart ──────────────────────────────────────────────────
function addToCart(product, color, qty) {
  const key = `${product.id}|${color}`;
  const existing = cart.find(i => `${i.product.id}|${i.color}` === key);
  if (existing) { existing.qty = Math.min(existing.qty + qty, product.stock); }
  else { cart.push({ product, color, qty }); }
  updateCartBadge();
  saveCart();
  renderCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  updateCartBadge();
  saveCart();
  renderCart();
}

function changeQty(index, delta) {
  const item = cart[index];
  const newQty = item.qty + delta;
  if (newQty < 1) { removeFromCart(index); return; }
  if (newQty > item.product.stock) return;
  item.qty = newQty;
  updateCartBadge();
  saveCart();
  renderCart();
}

function updateCartBadge() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  const badge = document.getElementById('cart-badge');
  badge.textContent = total;
  badge.style.display = total ? 'flex' : 'none';
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const totalEl   = document.getElementById('cart-total-val');
  const checkoutBtn = document.getElementById('checkout-btn');

  if (!cart.length) {
    container.innerHTML = `
      <div class="cart-empty">
        <div class="icon">🛍️</div>
        <p>Seu pedido está vazio.</p>
        <p style="font-size:.8rem;color:#bbb;margin-top:6px">Adicione bolsas do catálogo.</p>
      </div>`;
    totalEl.textContent = 'R$ 0,00';
    checkoutBtn.disabled = true;
    document.getElementById('smart-panel').innerHTML = '';
    document.getElementById('min-order-note').innerHTML = '';
    return;
  }

  const total  = cart.reduce((s, i) => s + i.product.price * i.qty, 0);
  const pieces = cart.reduce((s, i) => s + i.qty, 0);
  const refs   = cart.length;
  const varejo = cart.reduce((s, i) => s + ((i.product.retail || i.product.price) * i.qty), 0);
  const lucro  = varejo - total;
  const markup = total > 0 ? Math.round(lucro / total * 100) : 0;
  totalEl.textContent = fmt(total);

  const min = getSettings().minOrder || 0;
  const atingiu = total >= min;
  checkoutBtn.disabled = !atingiu;

  document.getElementById('smart-panel').innerHTML = `
    <div class="sp-grid">
      <div class="sp-item"><span>Referências</span><strong>${refs}</strong></div>
      <div class="sp-item"><span>Peças</span><strong>${pieces}</strong></div>
      <div class="sp-item"><span>Ticket médio</span><strong>${fmt(total / refs)}</strong></div>
    </div>
    <div class="sp-profit">
      <div class="sp-profit-row"><span>Faturamento no varejo</span><strong>${fmt(varejo)}</strong></div>
      <div class="sp-profit-row big"><span>💰 Lucro potencial</span><strong>${fmt(lucro)} · ${markup}% markup</strong></div>
    </div>`;

  document.getElementById('min-order-note').innerHTML = atingiu
    ? `<span class="mo-ok">✓ Pedido mínimo de ${fmt(min)} atingido</span>`
    : `<span class="mo-warn">Faltam <strong>${fmt(min - total)}</strong> para o pedido mínimo de ${fmt(min)}</span>`;

  container.innerHTML = cart.map((item, idx) => `
    <div class="cart-item">
      <div class="cart-item-img">
        ${item.product.image ? `<img src="${productImage(item.product, item.color)}" alt="">` : '👜'}
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.product.name}</div>
        <div class="cart-item-meta">${item.product.code}${item.color ? ' · ' + item.color : ''}</div>
        <div class="cart-item-price">${fmt(item.product.price * item.qty)}</div>
        <div class="qty-control">
          <button class="qty-btn" data-action="minus" data-idx="${idx}">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" data-action="plus"  data-idx="${idx}">+</button>
        </div>
      </div>
      <button class="cart-item-remove" data-idx="${idx}" title="Remover">✕</button>
    </div>`
  ).join('');

  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      changeQty(idx, btn.dataset.action === 'plus' ? 1 : -1);
    });
  });
  container.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(+btn.dataset.idx));
  });
}

function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  renderCart();
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// ── Order modal ───────────────────────────────────────────
function openOrderModal() {
  const modal = document.getElementById('order-modal');
  modal.classList.add('open');
  closeCart();
}
function closeOrderModal() {
  document.getElementById('order-modal').classList.remove('open');
}

// Busca o representante do lojista pelo CNPJ (dado público mínimo: nome + whatsapp).
// Se o servidor não responder (offline/timeout), cai para o WhatsApp geral da KE.
async function buscarRepresentantePorCnpj(cnpj) {
  try {
    return await _fetch(`${API}/api/store?key=rep-by-cnpj&cnpj=${encodeURIComponent(onlyDigits(cnpj))}`);
  } catch { return { representante_id: null, whatsapp: null, nome: null }; }
}

async function submitOrder() {
  const razao = document.getElementById('o-razao').value.trim();
  const cnpj  = document.getElementById('o-cnpj').value.trim();
  const name  = document.getElementById('o-name').value.trim();
  const phone = document.getElementById('o-phone').value.trim();
  const notes = document.getElementById('o-notes').value.trim();

  if (!razao || !cnpj || !name || !phone) {
    toast('Preencha todos os campos obrigatórios (*).', 'error');
    return;
  }
  if (!validaCNPJ(cnpj)) {
    toast('CNPJ inválido. Verifique o número.', 'error');
    return;
  }
  const minOrder = getSettings().minOrder || 0;
  const cartTotal = cart.reduce((s, i) => s + i.product.price * i.qty, 0);
  if (cartTotal < minOrder) {
    toast(`Pedido mínimo de ${fmt(minOrder)}. Faltam ${fmt(minOrder - cartTotal)}.`, 'error');
    return;
  }

  const confirmBtn = document.getElementById('order-submit');
  const btnLabelOriginal = confirmBtn ? confirmBtn.innerHTML : '';
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Enviando...'; }
  const rep = await buscarRepresentantePorCnpj(cnpj);
  if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerHTML = btnLabelOriginal; }

  const order = addOrder({
    buyer: { razao, cnpj, name, phone },
    notes,
    representante_id: rep.representante_id,
    items: cart.map(i => ({
      productId:   i.product.id,
      productCode: i.product.code,
      productName: i.product.name,
      color:       i.color,
      qty:         i.qty,
      unitPrice:   i.product.price,
      total:       i.product.price * i.qty,
    })),
    totalValue: cart.reduce((s, i) => s + i.product.price * i.qty, 0),
  });

  // Decrement stock
  cart.forEach(i => {
    const p = getProducts().find(x => x.id === i.product.id);
    if (p) updateProduct(p.id, { stock: Math.max(0, p.stock - i.qty) });
  });

  sendWhatsApp(order, rep.whatsapp);

  cart = [];
  saveCart();
  updateCartBadge();
  renderCart();
  renderProducts();
  closeOrderModal();
  toast(rep.whatsapp ? `Pedido enviado para ${rep.nome}! 🎉` : 'Pedido enviado com sucesso! 🎉', 'success');
}

function sendWhatsApp(order, repWhatsapp) {
  const settings = getSettings();
  const lines = [
    `🛍️ *NOVO PEDIDO – Colcci On The Move (KE)*`,
    ``,
    `🏢 *Razão Social:* ${order.buyer.razao}`,
    `📋 *CNPJ:* ${order.buyer.cnpj}`,
    `👤 *Comprador:* ${order.buyer.name}`,
    `📱 *WhatsApp:* ${order.buyer.phone}`,
    ``,
    `📦 *ITENS DO PEDIDO:*`,
    ...order.items.map(i =>
      `• ${i.productCode} – ${i.productName}${i.color ? ' (' + i.color + ')' : ''} × ${i.qty} = ${fmt(i.total)}`
    ),
    ``,
    `💰 *TOTAL: ${fmt(order.totalValue)}*`,
    order.notes ? `\n📝 *Obs:* ${order.notes}` : '',
    ``,
    `📅 ${fmtDate(order.date)}`,
    `🆔 Pedido #${order.id.slice(-6).toUpperCase()}`,
  ].filter(l => l !== null);

  const msg = encodeURIComponent(lines.join('\n'));
  const numero = onlyDigits(repWhatsapp) || settings.whatsapp;
  const url = `https://wa.me/${numero}?text=${msg}`;
  window.open(url, '_blank');
}

// ── Bindings ──────────────────────────────────────────────
function bindEvents() {
  document.getElementById('cart-btn').addEventListener('click', openCart);
  document.getElementById('overlay').addEventListener('click', closeCart);
  document.getElementById('cart-close').addEventListener('click', closeCart);
  document.getElementById('checkout-btn').addEventListener('click', openOrderModal);
  document.getElementById('order-close').addEventListener('click', closeOrderModal);
  document.getElementById('order-cancel').addEventListener('click', closeOrderModal);
  document.getElementById('order-submit').addEventListener('click', submitOrder);
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase();
    renderProducts();
  });

  // CNPJ mask
  document.getElementById('order-modal').addEventListener('input', e => {
    if (e.target.id === 'o-cnpj') {
      e.target.value = maskCNPJ(e.target.value);
    }
    if (e.target.id === 'o-phone') {
      e.target.value = maskPhone(e.target.value);
    }
  });

  updateCartBadge();
}

// ── CNPJ mask & validation ────────────────────────────────
function maskCNPJ(v) {
  v = v.replace(/\D/g, '').slice(0, 14);
  return v
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
function maskPhone(v) {
  v = v.replace(/\D/g, '').slice(0, 11);
  if (v.length <= 10)
    return v.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
  return v.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim().replace(/-$/, '');
}
function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }
function validaCNPJ(cnpj) {
  cnpj = cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  let t = cnpj.length - 2, d = cnpj.substring(0, t), dv = cnpj.substring(t);
  let sum = 0, pos = t - 7;
  for (let i = t; i >= 1; i--) { sum += parseInt(d.charAt(t - i)) * pos--; if (pos < 2) pos = 9; }
  let r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (r !== parseInt(dv.charAt(0))) return false;
  t++; d = cnpj.substring(0, t); sum = 0; pos = t - 7;
  for (let i = t; i >= 1; i--) { sum += parseInt(d.charAt(t - i)) * pos--; if (pos < 2) pos = 9; }
  r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return r === parseInt(dv.charAt(1));
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  document.getElementById('toast-container').appendChild(div);
  setTimeout(() => div.remove(), 3200);
}
