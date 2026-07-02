// ============================================================
//  KE – On The Move  |  Admin panel logic
// ============================================================

const ADMIN_PASS_KEY = 'ke_admin_auth';

// ── Auth ──────────────────────────────────────────────────
function isLoggedIn() {
  return sessionStorage.getItem(ADMIN_PASS_KEY) === 'yes';
}
async function tryLogin() {
  const pw = document.getElementById('admin-password').value;
  let ok = false;
  if (typeof ONLINE !== 'undefined' && ONLINE && typeof authLogin === 'function') {
    try { await authLogin('master', { senha: pw }); ok = true; } catch { ok = false; }
  } else {
    ok = (pw === getSettings().adminPass);
  }
  if (ok) {
    sessionStorage.setItem(ADMIN_PASS_KEY, 'yes');
    showPanel();
  } else {
    document.getElementById('login-error').textContent = 'Senha incorreta.';
  }
}
function logout() {
  sessionStorage.removeItem(ADMIN_PASS_KEY);
  if (typeof clearToken === 'function') clearToken();
  location.reload();
}

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof probeOnline === 'function') await probeOnline();
  if (isLoggedIn()) { showPanel(); return; }

  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault(); tryLogin();
  });

  document.getElementById('admin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') tryLogin();
  });
});

async function showPanel() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-panel').style.display  = 'block';
  // puxa pedidos/configurações do servidor antes de exibir
  if (typeof pullOrders === 'function') {
    try { await pullSettings(); await pullOrders(); } catch {}
  }
  switchTab('products');
}

// ── Tabs ──────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p =>
    p.style.display = p.id === `tab-${tab}` ? 'block' : 'none');
  if (tab === 'products')  renderAdminProducts();
  if (tab === 'inventory') renderInventory();
  if (tab === 'orders')    renderOrders();
  if (tab === 'settings')  renderSettings();
}

// ── Products tab ──────────────────────────────────────────
let editingId = null;

function renderAdminProducts() {
  const list = getProducts();
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = list.map(p => `
    <tr class="${p.active ? '' : 'inactive-row'}">
      <td><strong>${p.code}</strong></td>
      <td>
        ${p.image ? `<img src="${p.image}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;margin-right:8px;vertical-align:middle">` : ''}
        ${p.name}
      </td>
      <td>${p.category || '—'}</td>
      <td>${fmt(p.price)}</td>
      <td>
        <span class="stock-badge ${p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : 'ok'}" style="position:static">
          ${p.stock}
        </span>
      </td>
      <td>${(p.colors || []).join(', ') || '—'}</td>
      <td>${p.active ? '✅' : '❌'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-outline" onclick="openEdit('${p.id}')">✏️ Editar</button>
        <button class="btn btn-sm btn-danger"  onclick="confirmDelete('${p.id}','${p.name.replace(/'/g,"\\'")}')">🗑</button>
      </td>
    </tr>`).join('');
}

function openNew() {
  editingId = null;
  document.getElementById('product-form-title').textContent = 'Novo Produto';
  clearForm();
  document.getElementById('product-modal').classList.add('open');
}

function openEdit(id) {
  const p = getProducts().find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('product-form-title').textContent = 'Editar Produto';
  document.getElementById('f-code').value        = p.code        || '';
  document.getElementById('f-name').value        = p.name        || '';
  document.getElementById('f-category').value    = p.category    || '';
  document.getElementById('f-price').value       = p.price       || '';
  document.getElementById('f-stock').value       = p.stock       || 0;
  document.getElementById('f-colors').value      = (p.colors || []).join(', ');
  document.getElementById('f-description').value = p.description || '';
  document.getElementById('f-active').checked    = p.active !== false;
  document.getElementById('f-img-preview').src   = p.image || '';
  document.getElementById('f-img-preview').style.display = p.image ? 'block' : 'none';
  document.getElementById('product-modal').classList.add('open');
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  editingId = null;
}

function clearForm() {
  ['f-code','f-name','f-category','f-price','f-stock','f-colors','f-description'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-active').checked = true;
  document.getElementById('f-stock').value = 0;
  document.getElementById('f-img-preview').style.display = 'none';
}

function saveProductForm() {
  const code  = document.getElementById('f-code').value.trim();
  const name  = document.getElementById('f-name').value.trim();
  const price = parseFloat(document.getElementById('f-price').value);
  const stock = parseInt(document.getElementById('f-stock').value, 10);

  if (!code || !name || isNaN(price)) {
    adminToast('Preencha Código, Nome e Preço.', 'error'); return;
  }

  const data = {
    code,
    name,
    category:    document.getElementById('f-category').value.trim(),
    price,
    stock:       isNaN(stock) ? 0 : stock,
    colors:      document.getElementById('f-colors').value.split(',').map(s => s.trim()).filter(Boolean),
    description: document.getElementById('f-description').value.trim(),
    active:      document.getElementById('f-active').checked,
    image:       document.getElementById('f-img-preview').src || null,
  };

  if (editingId) {
    updateProduct(editingId, data);
    adminToast('Produto atualizado!', 'success');
  } else {
    addProduct(data);
    adminToast('Produto criado!', 'success');
  }
  closeProductModal();
  renderAdminProducts();
}

function confirmDelete(id, name) {
  if (!confirm(`Excluir "${name}"?`)) return;
  deleteProduct(id);
  renderAdminProducts();
  adminToast('Produto excluído.', 'info');
}

// Image upload
function handleImageUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('f-img-preview').src = e.target.result;
    document.getElementById('f-img-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ── Inventory tab ─────────────────────────────────────────
function renderInventory() {
  const list = getProducts().filter(p => p.active);
  document.getElementById('inventory-list').innerHTML = list.map(p => `
    <div class="inv-row">
      <div class="inv-info">
        <span class="product-code">${p.code}</span>
        <span class="product-name" style="font-size:.95rem">${p.name}</span>
      </div>
      <div class="inv-control">
        <button class="qty-btn" onclick="adjustStock('${p.id}', -1)">−</button>
        <input type="number" value="${p.stock}" min="0"
          onchange="setStock('${p.id}', this.value)"
          style="width:70px;text-align:center;padding:6px;border:1.5px solid #ddd;border-radius:8px;font-weight:700">
        <button class="qty-btn" onclick="adjustStock('${p.id}', 1)">+</button>
        <span class="stock-badge ${p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : 'ok'}" style="position:static;margin-left:8px">
          ${p.stock === 0 ? 'Esgotado' : p.stock <= 5 ? 'Baixo' : 'OK'}
        </span>
      </div>
    </div>`).join('');
}

function adjustStock(id, delta) {
  const p = getProducts().find(x => x.id === id);
  if (!p) return;
  const newStock = Math.max(0, (p.stock || 0) + delta);
  updateProduct(id, { stock: newStock });
  renderInventory();
}
function setStock(id, val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 0) return;
  updateProduct(id, { stock: n });
  renderInventory();
}

// ── Orders tab ────────────────────────────────────────────
function renderOrders() {
  const orders = getOrders();
  const container = document.getElementById('orders-list');
  if (!orders.length) {
    container.innerHTML = '<p style="text-align:center;color:#aaa;padding:40px">Nenhum pedido ainda.</p>';
    return;
  }
  container.innerHTML = orders.map(o => `
    <div class="order-card">
      <div class="order-card-header">
        <div>
          <strong>#${o.id.slice(-6).toUpperCase()}</strong>
          <span style="color:#777;font-size:.82rem;margin-left:10px">${fmtDate(o.date)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <select class="status-select" onchange="updateOrderStatus('${o.id}', this.value)">
            ${['pending','confirmed','shipped','cancelled'].map(s =>
              `<option value="${s}" ${o.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`
            ).join('')}
          </select>
          <button class="btn btn-sm btn-gold" onclick="resendWhatsApp('${o.id}')">📱 Reenviar</button>
        </div>
      </div>
      <div class="order-buyer">
        🏢 <strong>${o.buyer.razao || o.buyer.store || ''}</strong>
        ${o.buyer.cnpj ? `<span style="color:#aaa"> · CNPJ: ${o.buyer.cnpj}</span>` : ''}
        <br>👤 ${o.buyer.name} &nbsp;·&nbsp; 📱 ${o.buyer.phone}
      </div>
      <div class="order-items">
        ${o.items.map(i => `
          <div class="order-item-row">
            <span>${i.productCode} – ${i.productName}${i.color ? ' (' + i.color + ')' : ''} × ${i.qty}</span>
            <span>${fmt(i.total)}</span>
          </div>`).join('')}
      </div>
      <div class="order-total">
        Total: <strong>${fmt(o.totalValue)}</strong>
      </div>
      ${o.notes ? `<div style="font-size:.8rem;color:#777;margin-top:6px">📝 ${o.notes}</div>` : ''}
    </div>`).join('');
}

function statusLabel(s) {
  return { pending: '⏳ Pendente', confirmed: '✅ Confirmado', shipped: '🚚 Enviado', cancelled: '❌ Cancelado' }[s] || s;
}

function resendWhatsApp(orderId) {
  const o = getOrders().find(x => x.id === orderId);
  if (!o) return;
  const settings = getSettings();
  const lines = [
    `🛍️ *PEDIDO Colcci On The Move – #${o.id.slice(-6).toUpperCase()}*`,
    ``,
    `🏢 ${o.buyer.razao || o.buyer.store || ''} | CNPJ: ${o.buyer.cnpj || ''}`,
    `👤 ${o.buyer.name} | 📱 ${o.buyer.phone}`,
    ``,
    ...o.items.map(i => `• ${i.productCode} – ${i.productName}${i.color ? ' (' + i.color + ')' : ''} × ${i.qty} = ${fmt(i.total)}`),
    ``,
    `💰 *TOTAL: ${fmt(o.totalValue)}*`,
  ];
  window.open(`https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
}

// ── Settings tab ──────────────────────────────────────────
function renderSettings() {
  const s = getSettings();
  document.getElementById('s-whatsapp').value    = s.whatsapp;
  document.getElementById('s-email').value       = s.email;
  document.getElementById('s-collection').value  = s.collection;
  document.getElementById('s-admin-email').value = s.adminEmail;
  document.getElementById('s-pass').value        = s.adminPass;
  document.getElementById('s-min-order').value   = s.minOrder;
}
function saveSettings_() {
  const current = getSettings();
  saveSettings({
    ...current,
    whatsapp:   document.getElementById('s-whatsapp').value.trim(),
    email:      document.getElementById('s-email').value.trim(),
    collection: document.getElementById('s-collection').value.trim(),
    adminEmail: document.getElementById('s-admin-email').value.trim() || current.adminEmail,
    adminPass:  document.getElementById('s-pass').value.trim() || current.adminPass,
    minOrder:   parseFloat(document.getElementById('s-min-order').value) || 0,
  });
  adminToast('Configurações salvas!', 'success');
}

// ── Toast ─────────────────────────────────────────────────
function adminToast(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  document.getElementById('admin-toast').appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
