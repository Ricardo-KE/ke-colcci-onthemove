// ============================================================
//  /api/me — devolve os dados COM ESCOPO conforme o papel:
//   master  → tudo
//   rep     → só seus clientes/metas (sem senhas dos lojistas)
//   lojista → só ele mesmo + seus pedidos
// ============================================================
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const SECRET = process.env.PORTAL_SECRET || 'dev-secret-change-me';
const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const store = () => getStore('portal-db');
const getDoc = async (k) => (await store().get(k, { type: 'json', consistency: 'strong' })) || (k === 'orders' ? [] : {});
const onlyd = (s) => String(s || '').replace(/\D/g, '');
const noSenha = ({ senha, ...rest }) => rest;
const publicSettings = (s) => { const { adminPass, ...rest } = s || {}; return rest; };

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
  const p = verify(bearer(req));
  if (!p) return j({ error: 'não autenticado' }, 401);

  const ent = await getDoc('entities');
  const orders = await getDoc('orders');
  const settings = publicSettings(ent.settings);

  if (p.role === 'master') {
    return j({
      role: 'master', id: p.id, nome: p.nome,
      masters: ent.masters || [],
      representantes: ent.representantes || [],
      clientes: ent.clientes || [],
      metas: ent.metas || [],
      settings: ent.settings || {},
      orders,
    });
  }

  if (p.role === 'rep') {
    const clientes = (ent.clientes || []).filter(c => c.representante_id === p.id).map(noSenha);
    const ids = new Set(clientes.map(c => c.id));
    const metas = (ent.metas || []).filter(m => ids.has(m.cliente_id));
    const rep = (ent.representantes || []).find(r => r.id === p.id);
    const meusCnpjs = new Set(clientes.map(c => onlyd(c.cnpj)));
    const meusPedidos = orders.filter(o => meusCnpjs.has(onlyd(o.buyer && o.buyer.cnpj)));
    return j({
      role: 'rep', id: p.id, nome: p.nome,
      representantes: rep ? [noSenha(rep)] : [],
      clientes, metas, settings, orders: meusPedidos,
    });
  }

  if (p.role === 'lojista') {
    const c = (ent.clientes || []).find(x => x.id === p.id);
    if (!c) return j({ error: 'cliente não encontrado' }, 404);
    const meta = (ent.metas || []).find(m => m.cliente_id === c.id);
    const rep = (ent.representantes || []).find(r => r.id === c.representante_id);
    const repPub = rep ? noSenha({ ...rep, email: undefined }) : null;
    const myOrders = orders.filter(o => onlyd(o.buyer && o.buyer.cnpj) === onlyd(c.cnpj));
    return j({
      role: 'lojista', id: p.id, nome: p.nome,
      clientes: [noSenha(c)],
      metas: meta ? [meta] : [],
      representantes: repPub ? [repPub] : [],
      settings, orders: myOrders,
    });
  }

  return j({ error: 'role inválido' }, 400);
};

export const config = { path: '/api/me' };
