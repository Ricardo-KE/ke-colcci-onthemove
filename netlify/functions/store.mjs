// ============================================================
//  /api/store — escrita/leitura dos documentos do portal.
//  Regras de acesso:
//    GET  key=settings           → ABERTO (catálogo precisa do WhatsApp/coleção)
//    POST key=orders&action=append → ABERTO (envio de pedido pelo catálogo)
//    todo o resto (entities, orders read/update) → SÓ master autenticado
// ============================================================
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const SECRET = process.env.PORTAL_SECRET || 'dev-secret-change-me';
const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const store = () => getStore('portal-db');
const getDoc = async (k) => (await store().get(k, { type: 'json', consistency: 'strong' })) || (k === 'orders' ? [] : {});
const publicSettings = (s) => { const { adminPass, ...rest } = s || {}; return rest; };
const onlyd = (s) => String(s || '').replace(/\D/g, '');

function verify(t) {
  try {
    if (!t || !t.includes('.')) return null;
    const [b, s] = t.split('.');
    const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
    if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}
function bearer(req) {
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return new URL(req.url).searchParams.get('token');
}

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const action = url.searchParams.get('action');

  // ── Endpoints abertos ──────────────────────────────────
  if (req.method === 'GET' && key === 'settings') {
    const ent = await getDoc('entities');
    return j(publicSettings(ent.settings));
  }
  if (req.method === 'POST' && key === 'orders' && action === 'append') {
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== 'object') return j({ error: 'bad body' }, 400);
    const list = await getDoc('orders');
    if (!list.some(o => o.id === b.id)) list.unshift(b);
    await store().setJSON('orders', list);
    return j({ ok: true, count: list.length });
  }
  // Rota o pedido pro WhatsApp do representante do lojista (dado público mínimo:
  // nenhuma senha ou outro cliente é exposto, só o contato do rep responsável).
  if (req.method === 'GET' && key === 'rep-by-cnpj') {
    const cnpj = onlyd(url.searchParams.get('cnpj'));
    const ent = await getDoc('entities');
    const cli = (ent.clientes || []).find(c => c.ativo && onlyd(c.cnpj) === cnpj);
    const rep = cli && (ent.representantes || []).find(r => r.ativo && r.id === cli.representante_id);
    return j({ representante_id: rep ? rep.id : null, whatsapp: (rep && rep.whatsapp) || null, nome: rep ? rep.nome : null });
  }

  // Rastreamento de acesso ao catálogo — usado no painel "Oportunidades
  // Quentes" do representante (último acesso / carrinho em andamento).
  // Aberto: o catálogo não exige login, só sabe o CNPJ quando o lojista
  // chega por um link individual ou já digitou o CNPJ antes.
  if (req.method === 'POST' && key === 'access' && action === 'ping') {
    const b = await req.json().catch(() => null);
    const cnpj = onlyd(b && b.cnpj);
    if (!cnpj) return j({ error: 'cnpj obrigatório' }, 400);
    const doc = await getDoc('access');
    doc[cnpj] = new Date().toISOString();
    await store().setJSON('access', doc);
    return j({ ok: true });
  }
  if (req.method === 'POST' && key === 'carts' && action === 'set') {
    const b = await req.json().catch(() => null);
    const cnpj = onlyd(b && b.cnpj);
    if (!cnpj) return j({ error: 'cnpj obrigatório' }, 400);
    const doc = await getDoc('carts');
    doc[cnpj] = { items: Array.isArray(b.items) ? b.items : [], totalValue: Number(b.totalValue) || 0, updatedAt: new Date().toISOString() };
    await store().setJSON('carts', doc);
    return j({ ok: true });
  }
  if (req.method === 'POST' && key === 'carts' && action === 'clear') {
    const b = await req.json().catch(() => null);
    const cnpj = onlyd(b && b.cnpj);
    if (!cnpj) return j({ error: 'cnpj obrigatório' }, 400);
    const doc = await getDoc('carts');
    delete doc[cnpj];
    await store().setJSON('carts', doc);
    return j({ ok: true });
  }

  // Confirmar/recusar pedido: master (qualquer um) ou representante (só da própria carteira)
  if (req.method === 'POST' && key === 'orders' && action === 'update') {
    const p = verify(bearer(req));
    if (!p || (p.role !== 'master' && p.role !== 'rep')) return j({ error: 'não autorizado' }, 401);
    const b = await req.json().catch(() => null);
    if (!b || !b.id) return j({ error: 'bad body' }, 400);
    const list = await getDoc('orders');
    const order = list.find(o => o.id === b.id);
    if (!order) return j({ error: 'pedido não encontrado' }, 404);
    if (p.role === 'rep') {
      const ent = await getDoc('entities');
      const meusCnpjs = new Set((ent.clientes || []).filter(c => c.representante_id === p.id).map(c => onlyd(c.cnpj)));
      if (!meusCnpjs.has(onlyd(order.buyer && order.buyer.cnpj))) return j({ error: 'não autorizado' }, 403);
    }
    await store().setJSON('orders', list.map(o => o.id === b.id ? { ...o, status: b.status } : o));
    return j({ ok: true });
  }

  // ── Daqui pra baixo: só master ─────────────────────────
  const p = verify(bearer(req));
  if (!p || p.role !== 'master') return j({ error: 'não autorizado' }, 401);
  if (!['entities', 'orders', 'access', 'carts'].includes(key)) return j({ error: 'key inválida' }, 400);

  try {
    if (req.method === 'GET') return j(await getDoc(key));

    if (req.method === 'POST') {
      const b = await req.json().catch(() => null);
      if (key === 'orders' && action === 'update') {
        if (!b || !b.id) return j({ error: 'bad body' }, 400);
        const list = await getDoc('orders');
        await store().setJSON('orders', list.map(o => o.id === b.id ? { ...o, status: b.status } : o));
        return j({ ok: true });
      }
      if (b == null) return j({ error: 'bad body' }, 400);
      await store().setJSON(key, b);
      return j({ ok: true });
    }
    return j({ error: 'method' }, 405);
  } catch (e) {
    return j({ error: String(e && e.message || e) }, 500);
  }
};

export const config = { path: '/api/store' };
