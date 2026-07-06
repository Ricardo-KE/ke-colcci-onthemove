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
    minOrder:    3500,
  };
  const saved = JSON.parse(localStorage.getItem(DB.SETTINGS) || '{}');
  return { ...defaults, ...saved };
}
function saveSettings(data) {
  localStorage.setItem(DB.SETTINGS, JSON.stringify(data));
  if (typeof schedulePushEntities === 'function') schedulePushEntities();
}

// ── Products ──────────────────────────────────────────────
const CATALOG_VERSION = 'colcci-onthemove-v3';

// Preço sugerido de VAREJO (PDV) por SKU — do catálogo oficial
// "CATÁLOGO OTM PDV - VERÃO 27" (mesmo padrão do projeto Verão 27).
const RETAIL_PRICES = {
  '090.01.12562': 279.00,  // Bolsa Colcci Beach Bag On The Move
  '130.01.00003': 179.00,  // Toalha Colcci Stripes On The Move
  '090.01.12563': 229.00,  // Bolsa Colcci Shop Mesh On The Move
  '825.01.00010': 129.00,  // Necessaire Colcci Mesh On The Move
  '090.01.12567': 279.00,  // Cooler Colcci On The Move
  '083.01.00176': 369.00,  // Bolsa Colcci Fem Bucket On The Move
  '602.01.00001': 179.00,  // Copo Térmico Colcci 591ml com Canudo
  '083.01.00175': 229.00,  // Bolsa Colcci Fem Crossbody On The Move
  '826.01.00002': 139.00,  // Traveseiro Colcci On The Move
  '083.01.00163': 399.00,  // Bolsa Colcci Fem Weekend Bag
  '090.01.12570': 249.00,  // Bolsa Colcci Fem Crossbody On The Move
  '117.01.00020': 369.00,  // Mochila Colcci Basic On The Move
  '090.01.12568': 349.00,  // Bolsa Colcci Shop Puffer On The Move
  '825.01.00012': 139.00,  // Necessaire Colcci Puffer Plus On The Move
  '045.01.00014': 89.00,   // Chaveiro Colcci Digby On The Move
  '045.01.00015': 89.00,   // Chaveiro Colcci Scarf On The Move
  '045.01.00017': 89.00,   // Chaveiro Colcci Ted On The Move
  '045.01.00018': 89.00,   // Chaveiro Colcci Mirror On The Move
  '117.01.00019': 199.00,  // Mochila Colcci Bucket On The Move
  '083.01.00162': 179.00,  // Bolsa Festival
  '083.01.00155': 89.00,   // Bolsa Dobrável Colcci Nylon
  '824.01.00002': 199.00,  // Garrafa Colcci 750ml
  '825.01.00005': 119.00,  // Necessaire Colcci Essence On The Move
  '083.01.00177': 399.00,  // Bolsa Colcci Fem Weekend On The Move
  '602.01.00003': 179.00,  // Copo Térmico Colcci 887ml On The Move
  '090.01.12569': 219.00,  // Bolsa Colcci Cross Franzida On The Move
  '083.01.00160': 189.00,  // Bolsa Colcci Fem Crossbody On The Move
  '083.01.00164': 319.00,  // Bolsa Colcci Fem Shop Bag On The Move
  '602.01.00002': 149.00,  // Copo Térmico Colcci 550ml On The Move
  '825.01.00003': 129.00,  // Necessaire Colcci Plus On The Move
  '083.01.00170': 329.00,  // Bolsa Colcci Fem Hobo On The Move
  '083.01.00171': 329.00,  // Bolsa Colcci Fem Shop Bag Dupla Face
  '824.01.00001': 179.00,  // Garrafa Colcci 500ml
  '092.01.60456': 459.00,  // Mochila Colcci Nylon On The Move
  '825.01.00006': 139.00,  // Necessaire Colcci Box On The Move
  '083.01.00172': 319.00,  // Bolsa Colcci Fem Shop Bag Mesh On The Move
  '092.01.60454': 359.00,  // Mochila Colcci Bucket On The Move
  '083.01.00179': 189.00,  // Bolsa Colcci Fem Festival On The Move
  '825.01.00011': 129.00,  // Necessaire Colcci Puffer On The Move
  // 045.01.00016 (Chaveiro Headphone Case) está no PDV mas não existe
  // ainda no catálogo do site — sem foto/dados de estoque cadastrados.
};

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
function rateOrder(id, rating, comment) {
  const ratedAt = new Date().toISOString();
  saveOrders(getOrders().map(o => o.id === id ? { ...o, rating, comment: comment || '', ratedAt } : o));
  if (typeof pushOrderRating === 'function') pushOrderRating(id, rating, comment);
}

// ── Rastreamento (acesso ao catálogo + carrinho em andamento) ─
// Preenchidos via /api/me (loadMe), escopados por representante no servidor.
function getAccess() {
  return JSON.parse(localStorage.getItem('ke_access') || '{}');
}
function getCarts() {
  return JSON.parse(localStorage.getItem('ke_carts') || '{}');
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

// ── PDF do pedido (com foto de cada item) ─────────────────
// Compartilhado entre catálogo (index.html) e portal (portal.html) —
// usado pelo lojista ao finalizar, e por lojista/representante/master
// pra baixar de novo a qualquer momento a partir do histórico.
async function imagemParaBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('imagem indisponível');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function formatoImagem(dataUrl) {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

async function gerarPdfPedido(order, repInfo) {
  if (!window.jspdf) { if (typeof toast === 'function') toast('PDF indisponível neste navegador.', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 14;
  const rightX = 196;
  let y = 20;

  // Cabeçalho
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text('KE PORTAL', marginX, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.setTextColor(160, 125, 40);
  doc.text(`Colcci On The Move · Pedido #${order.id.slice(-6).toUpperCase()}`, marginX, y + 6);
  doc.setDrawColor(200, 165, 70); doc.setLineWidth(0.6);
  doc.line(marginX, y + 10, rightX, y + 10);
  y += 20;

  // Dados do comprador
  doc.setFontSize(10.5);
  const infoLinhas = [
    ['Razão Social', order.buyer.razao],
    ['CNPJ', order.buyer.cnpj],
    ['Comprador', order.buyer.name],
    ['WhatsApp', order.buyer.phone],
    ['Data do pedido', fmtDate(order.date)],
  ];
  if (repInfo && repInfo.nome) infoLinhas.push(['Representante', repInfo.nome]);
  infoLinhas.forEach(([label, val]) => {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(60, 60, 60);
    doc.text(label + ':', marginX, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20);
    doc.text(String(val || '—'), marginX + 34, y);
    y += 6;
  });

  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 20);
  doc.text(`Itens do pedido (${order.items.length})`, marginX, y);
  y += 7;

  const boxH = 24;
  for (const item of order.items) {
    if (y + boxH > 280) { doc.addPage(); y = 20; }

    // Prioriza a imagem gravada no próprio pedido (fiel ao que foi comprado);
    // cai pro catálogo atual só em pedidos antigos sem esse campo.
    let imgSrc = item.image || null;
    if (!imgSrc && typeof getProducts === 'function' && typeof productImage === 'function') {
      const prod = getProducts().find(p => p.id === item.productId);
      imgSrc = prod ? productImage(prod, item.color) : null;
    }
    let imgData = null;
    if (imgSrc) { try { imgData = await imagemParaBase64(imgSrc); } catch { imgData = null; } }

    doc.setDrawColor(225, 225, 225); doc.setLineWidth(0.3);
    doc.roundedRect(marginX, y, rightX - marginX, boxH, 1.5, 1.5);
    if (imgData) {
      try { doc.addImage(imgData, formatoImagem(imgData), marginX + 2, y + 2, boxH - 4, boxH - 4); }
      catch { /* segue sem a foto se o formato não for suportado */ }
    }

    const textX = marginX + boxH + 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20, 20, 20);
    doc.text(item.productName, textX, y + 8, { maxWidth: 105 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
    doc.text(`${item.productCode}${item.color ? ' · ' + item.color : ''}`, textX, y + 14);
    doc.text(`${item.qty} un. × ${fmt(item.unitPrice)}`, textX, y + 19);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
    doc.text(fmt(item.total), rightX - 3, y + 14, { align: 'right' });

    y += boxH + 3;
  }

  y += 3;
  doc.setDrawColor(200, 165, 70); doc.setLineWidth(0.6);
  doc.line(marginX, y, rightX, y);
  y += 9;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
  doc.text('TOTAL', marginX, y);
  doc.text(fmt(order.totalValue), rightX - 3, y, { align: 'right' });

  if (order.notes) {
    y += 9;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90, 90, 90);
    doc.text(`Obs.: ${order.notes}`, marginX, y, { maxWidth: rightX - marginX });
  }

  doc.save(`pedido-${order.id.slice(-6).toUpperCase()}.pdf`);
}

// ── Catalog seed data ──────────────────────────────────────
// SEED_PRODUCTS vem de js/seed-products.js (gerado a partir dos PDFs
// "DISPONÍVEL" e "COLEÇÃO VERÃO 27" do Colcci On The Move).
// Cada produto tem `sections`: ['disponivel'] (pronta entrega),
// ['colecao'] (programação) ou ambos; `colorSections` detalha por cor.
