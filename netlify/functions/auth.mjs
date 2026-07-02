// ============================================================
//  /api/auth — login do portal (master / rep / lojista)
//  Valida credenciais no servidor e devolve um token assinado.
// ============================================================
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const SECRET = process.env.PORTAL_SECRET || 'dev-secret-change-me';
const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const store = () => getStore('portal-db');
const getDoc = async (k) => (await store().get(k, { type: 'json', consistency: 'strong' })) || (k === 'orders' ? [] : {});
const onlyd = (s) => String(s || '').replace(/\D/g, '');
function sign(p) {
  const b = Buffer.from(JSON.stringify(p)).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  return b + '.' + s;
}

export default async (req) => {
  if (req.method !== 'POST') return j({ error: 'method' }, 405);
  const b = await req.json().catch(() => null);
  if (!b || !b.role) return j({ error: 'bad request' }, 400);

  const ent = await getDoc('entities');
  let id, nome;

  if (b.role === 'master') {
    const pass = (ent.settings && ent.settings.adminPass) || 'ke2027';
    const email = ((ent.settings && ent.settings.adminEmail) || 'contato@ke.com.br').toLowerCase();
    const bEmail = (b.email || '').trim().toLowerCase();
    if (!b.senha || !bEmail || b.senha !== pass || bEmail !== email) return j({ error: 'login inválido' }, 401);
    const m = (ent.masters || [])[0];
    id = m ? m.id : 'master'; nome = m ? m.nome : 'KE LTDA';
  } else if (b.role === 'rep') {
    const email = (b.email || '').trim().toLowerCase();
    const r = (ent.representantes || []).find(x => x.ativo && (x.email || '').toLowerCase() === email && x.senha === b.senha);
    if (!r) return j({ error: 'login inválido' }, 401);
    id = r.id; nome = r.nome;
  } else if (b.role === 'lojista') {
    const d = onlyd(b.cnpj);
    const c = (ent.clientes || []).find(x => x.ativo && onlyd(x.cnpj) === d && x.senha === b.senha);
    if (!c) return j({ error: 'login inválido' }, 401);
    id = c.id; nome = c.razao_social;
  } else {
    return j({ error: 'role inválido' }, 400);
  }

  const token = sign({ role: b.role, id, nome, exp: Date.now() + 12 * 3600 * 1000 });
  return j({ token, role: b.role, id, nome });
};

export const config = { path: '/api/auth' };
