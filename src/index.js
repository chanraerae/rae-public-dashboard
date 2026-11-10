const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
const bad = (message, status = 400) => json({ error: message }, status);
const trim = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validURL = (s) => { try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && Boolean(u.hostname); } catch { return false; } };
const goodHostname = (s) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(s);

async function handleAPI(request, env, path) {
  if (!env.DB) return bad('Database binding is missing.', 503);
  const method = request.method;
  if (method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin !== new URL(request.url).origin) return bad('Invalid request origin.', 403);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return bad('JSON required.', 415);
  }
  let body = {};
  if (['POST', 'PUT', 'DELETE'].includes(method)) {
    try { body = await request.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
    catch { return bad('Malformed JSON.'); }
  }
  try {
    if (path === '/api/data' && method === 'GET') {
      const [domains, links] = await Promise.all([
        env.DB.prepare('SELECT * FROM domains ORDER BY name COLLATE NOCASE').all(),
        env.DB.prepare('SELECT * FROM links ORDER BY favorite DESC, title COLLATE NOCASE').all(),
      ]);
      return json({ domains: domains.results, links: links.results });
    }
    if (path === '/api/domains' && method === 'POST') {
      const name = trim(body.name, 100);
      const hostname = trim(body.hostname, 253).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (!name || !goodHostname(hostname)) return bad('Enter a domain name and valid hostname.');
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO domains (id,name,hostname) VALUES (?,?,?)').bind(id, name, hostname).run();
      return json({ id }, 201);
    }
    const domainMatch = path.match(/^\/api\/domains\/([0-9a-f-]{36})$/);
    if (domainMatch && method === 'PUT') {
      const name = trim(body.name, 100);
      const hostname = trim(body.hostname, 253).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (!name || !goodHostname(hostname)) return bad('Enter a domain name and valid hostname.');
      const result = await env.DB.prepare('UPDATE domains SET name=?,hostname=? WHERE id=?').bind(name, hostname, domainMatch[1]).run();
      return result.meta.changes ? json({ ok: true }) : bad('Domain not found.', 404);
    }
    if (domainMatch && method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM domains WHERE id=?').bind(domainMatch[1]).run();
      return result.meta.changes ? json({ ok: true }) : bad('Domain not found.', 404);
    }
    if (path === '/api/links' && (method === 'POST' || method === 'PUT')) {
      const title = trim(body.title, 120), url = trim(body.url, 2048);
      const kind = body.kind === 'tool' ? 'tool' : 'app';
      const category = trim(body.category, 80) || 'Other';
      const description = trim(body.description, 500);
      const favorite = body.favorite ? 1 : 0;
      const domainId = trim(body.domain_id, 36) || null;
      if (!title || !validURL(url)) return bad('Enter a title and an http(s) URL.');
      if (domainId) {
        const domain = await env.DB.prepare('SELECT id FROM domains WHERE id=?').bind(domainId).first();
        if (!domain) return bad('Selected domain not found.');
      }
      if (method === 'POST') {
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO links (id,title,url,description,kind,domain_id,category,favorite) VALUES (?,?,?,?,?,?,?,?)')
          .bind(id, title, url, description, kind, domainId, category, favorite).run();
        return json({ id }, 201);
      }
      const id = trim(body.id, 36);
      const result = await env.DB.prepare('UPDATE links SET title=?,url=?,description=?,kind=?,domain_id=?,category=?,favorite=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .bind(title, url, description, kind, domainId, category, favorite, id).run();
      return result.meta.changes ? json({ ok: true }) : bad('Link not found.', 404);
    }
    const linkMatch = path.match(/^\/api\/links\/([0-9a-f-]{36})$/);
    if (linkMatch && method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM links WHERE id=?').bind(linkMatch[1]).run();
      return result.meta.changes ? json({ ok: true }) : bad('Link not found.', 404);
    }
    return bad('Not found.', 404);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String(e))) return bad('That hostname is already saved.', 409);
    console.error(e);
    return bad('The database operation failed.', 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleAPI(request, env, url.pathname);
    if (request.method !== 'GET' && request.method !== 'HEAD') return bad('Method not allowed.', 405);
    if (url.pathname === '/' || url.pathname === '/admin') return Response.redirect(`${url.origin}/admin/`, 302);
    if (url.pathname === '/admin/') {
      const asset = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
      return secure(asset);
    }
    return secure(await env.ASSETS.fetch(request));
  },
};
function secure(response) {
  const h = new Headers(response.headers);
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'no-referrer');
  h.set('x-frame-options', 'DENY');
  h.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  h.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
