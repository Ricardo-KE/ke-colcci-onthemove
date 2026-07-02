// ============================================================
//  KE – Colcci On The Move  |  Data layer (localStorage)
// ============================================================

const DB = {
  PRODUCTS: 'ke_products',
  ORDERS:   'ke_orders',
  SETTINGS: 'ke_settings',
};

// ── Settings ──────────────────────────────────────────────
function getSettings() {
  const defaults = {
    whatsapp:    '5541992218663',
    email:       'pedidos@ke.com.br',
    collection:  'On The Move',
    brand:       'Colcci',
    adminEmail:  'contato@ke.com.br',
    adminPass:   'ke2027',
    minOrder:    4500,
  };
  const saved = JSON.parse(localStorage.getItem(DB.SETTINGS) || '{}');
  return { ...defaults, ...saved };
}
function saveSettings(data) {
  localStorage.setItem(DB.SETTINGS, JSON.stringify(data));
  if (typeof schedulePushEntities === 'function') schedulePushEntities();
}

// ── Products ──────────────────────────────────────────────
const CATALOG_VERSION = 'colcci-onthemove-v2';

// Preço sugerido de VAREJO (PDV) por SKU. Preencher quando o catálogo
// oficial do Colcci On The Move chegar (mesmo padrão do projeto Verão 27).
const RETAIL_PRICES = {};

// Ranking de vendas — preencher com dados reais quando houver histórico
// de vendas desta linha (rank = posição por quantidade vendida).
const RANKING = {};
const TOP_SELLER_RANK = 10;   // rank <= 10 recebe selo "Mais vendido"

function withRetail(list) {
  return list.map(p => {
    const rk = RANKING[p.code];
    const badge = p.badge || (rk && rk.rank <= TOP_SELLER_RANK ? 'top' : null);
    return {
      ...p,
      retail: (p.retail != null ? p.retail : (RETAIL_PRICES[p.code] ?? null)),
      rank: rk ? rk.rank : null,
      soldQty: rk ? rk.qtd : null,
      badge,
    };
  });
}

function getProducts() {
  const savedVersion = localStorage.getItem('ke_catalog_version');
  const stored = localStorage.getItem(DB.PRODUCTS);
  if (stored && savedVersion === CATALOG_VERSION) return withRetail(JSON.parse(stored));
  // First load or version change: load seed
  saveProducts(SEED_PRODUCTS);
  localStorage.setItem('ke_catalog_version', CATALOG_VERSION);
  return withRetail(SEED_PRODUCTS);
}
function saveProducts(list) {
  localStorage.setItem(DB.PRODUCTS, JSON.stringify(list));
}
function addProduct(p) {
  const list = getProducts();
  p.id = uuid();
  list.push(p);
  saveProducts(list);
  return p;
}
function updateProduct(id, changes) {
  const list = getProducts().map(p => p.id === id ? { ...p, ...changes } : p);
  saveProducts(list);
}
function deleteProduct(id) {
  saveProducts(getProducts().filter(p => p.id !== id));
}

// ── Orders ────────────────────────────────────────────────
function getOrders() {
  return JSON.parse(localStorage.getItem(DB.ORDERS) || '[]');
}
function saveOrders(list) {
  localStorage.setItem(DB.ORDERS, JSON.stringify(list));
}
function addOrder(order) {
  const list = getOrders();
  order.id = uuid();
  order.date = new Date().toISOString();
  order.status = 'pending';
  list.unshift(order);
  saveOrders(list);
  if (typeof pushOrderAppend === 'function') pushOrderAppend(order);
  return order;
}
function updateOrderStatus(id, status) {
  saveOrders(getOrders().map(o => o.id === id ? { ...o, status } : o));
  if (typeof pushOrderStatus === 'function') pushOrderStatus(id, status);
}

// ── Helpers ───────────────────────────────────────────────
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function fmt(n) {
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ── Catalog seed data ──────────────────────────────────────
// SEED_PRODUCTS vem de js/seed-products.js (gerado a partir dos PDFs
// "DISPONÍVEL" e "COLEÇÃO VERÃO 27" do Colcci On The Move).
// Cada produto tem `sections`: ['disponivel'] (pronta entrega),
// ['colecao'] (programação) ou ambos; `colorSections` detalha por cor.
