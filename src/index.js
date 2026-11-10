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
    if (path === '/api/explorer' && method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM discovered_endpoints ORDER BY zone_name, hostname, source, path').all();
      const meta = await env.DB.prepare('SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 5').all();
      return json({ entries: result.results, runs: meta.results, configured: Boolean(env.CF_DISCOVERY_TOKEN && env.CF_ACCOUNT_ID) });
    }
    if (path === '/api/explorer/scan' && method === 'POST') {
      if (!env.CF_DISCOVERY_TOKEN || !env.CF_ACCOUNT_ID) return bad('Set CF_DISCOVERY_TOKEN (secret) and CF_ACCOUNT_ID (variable) in the Worker first.', 503);
      return json(await scanCloudflare(env));
    }
    if (path === '/api/explorer/import' && method === 'POST') {
      const id = trim(body.id, 36);
      const entry = await env.DB.prepare('SELECT * FROM discovered_endpoints WHERE id=?').bind(id).first();
      if (!entry) return bad('Discovered entry not found.', 404);
      if (!entry.url || !validURL(entry.url)) return bad('This entry has no actionable URL.', 400);
      let domainId = null;
      if (entry.zone_name) {
        const d = await env.DB.prepare('SELECT id FROM domains WHERE hostname=?').bind(entry.zone_name).first();
        domainId = d?.id || null;
      }
      const existing = await env.DB.prepare('SELECT id FROM links WHERE url=? LIMIT 1').bind(entry.url).first();
      if (existing) return bad('This URL is already saved in your dashboard.', 409);
      const title = trim(body.title, 120) || entry.hostname || entry.name || 'Discovered application';
      const linkId = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO links (id,title,url,description,kind,domain_id,category,favorite,scope,owner,platform,account_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(linkId,title,entry.url,`Cloudflare discovery: ${entry.source}`, 'app',domainId,'Cloudflare',0,'general','','','').run();
      await env.DB.prepare('UPDATE discovered_endpoints SET imported_link_id=? WHERE id=?').bind(linkId,id).run();
      return json({ id: linkId },201);
    }
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
      const scope = ['general','personal','business','social'].includes(body.scope) ? body.scope : 'general';
      const owner = trim(body.owner, 100);
      const platform = trim(body.platform, 100);
      const accountLabel = trim(body.account_label, 120);
      if (!title || !validURL(url)) return bad('Enter a title and an http(s) URL.');
      if (domainId) {
        const domain = await env.DB.prepare('SELECT id FROM domains WHERE id=?').bind(domainId).first();
        if (!domain) return bad('Selected domain not found.');
      }
      if (method === 'POST') {
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO links (id,title,url,description,kind,domain_id,category,favorite,scope,owner,platform,account_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(id, title, url, description, kind, domainId, category, favorite, scope, owner, platform, accountLabel).run();
        return json({ id }, 201);
      }
      const id = trim(body.id, 36);
      const result = await env.DB.prepare('UPDATE links SET title=?,url=?,description=?,kind=?,domain_id=?,category=?,favorite=?,scope=?,owner=?,platform=?,account_label=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .bind(title, url, description, kind, domainId, category, favorite, scope, owner, platform, accountLabel, id).run();
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


const CF_API = 'https://api.cloudflare.com/client/v4';
async function cfList(env, path, warnings, label, maxPages = 10) {
  const items = [];
  let page = 1;
  while (page <= maxPages) {
    const u = new URL(CF_API + path);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', '100');
    let res, data;
    try {
      res = await fetch(u, { headers: { Authorization: `Bearer ${env.CF_DISCOVERY_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      data = await res.json();
    } catch (e) { warnings.push(`${label}: request failed (${String(e).slice(0,120)})`); return null; }
    if (!res.ok || !data.success) {
      warnings.push(`${label}: API ${res.status} ${Array.isArray(data.errors) ? data.errors.map(x=>x.message).join('; ').slice(0,180) : 'permission or request error'}`);
      return null;
    }
    const result = Array.isArray(data.result) ? data.result : (Array.isArray(data.result?.result) ? data.result.result : []);
    items.push(...result);
    const count = data.result_info?.total_pages;
    if (count && page >= count || result.length < 100) break;
    page++;
  }
  if (page > maxPages) warnings.push(`${label}: truncated after ${maxPages * 100} items.`);
  return items;
}
function zoneFor(host, names) {
  return names.find(z => host === z || host.endsWith('.' + z)) || '';
}
function safeHost(value) {
  const s = String(value || '').toLowerCase().replace(/^\*\./,'').replace(/\.$/,'');
  return goodHostname(s) ? s : '';
}
async function scanCloudflare(env) {
  const runId = crypto.randomUUID();
  const warnings = [];
  await env.DB.prepare('INSERT INTO discovery_runs (id,status) VALUES (?,?)').bind(runId,'running').run();
  try {
    const zones = await cfList(env,'/zones',warnings,'Zones');
    if (!zones) throw new Error('Could not list zones. Check Zone Read permission.');
    const zoneNames = zones.map(z=>z.name).sort((a,b)=>b.length-a.length);
    const found = new Map();
    const add = (type, host, zone, name, path, url, details) => {
      if (found.size >= 1500) return;
      const key = `${type}|${host}|${path}|${name}`;
      if (!found.has(key)) found.set(key,{type,host,zone,name,path,url,details});
    };
    for (const zone of zones.slice(0,50)) {
      const dns = await cfList(env,`/zones/${zone.id}/dns_records`,warnings,`DNS ${zone.name}`);
      for (const r of dns || []) {
        if (!['A','AAAA','CNAME'].includes(r.type)) continue;
        const host = safeHost(r.name);
        if (!host) continue;
        add('dns',host,zone.name,r.type,'',`https://${host}/`,`${r.type} record (not proof that an app is online)`);
      }
      const routes = await cfList(env,`/zones/${zone.id}/workers/routes`,warnings,`Worker routes ${zone.name}`);
      for (const r of routes || []) {
        // A wildcard route is a route pattern, not an independently verified endpoint.
        const pattern = String(r.pattern || '');
        const host = safeHost(pattern.replace(/^https?:\/\//,'').split('/')[0]);
        if (!host || pattern.includes('*')) {
          add('route','',zone.name,r.script || 'Worker route',pattern,'',`Route pattern: ${pattern}`);
        } else {
          const pathPart = '/' + pattern.replace(/^https?:\/\//,'').split('/').slice(1).join('/');
          add('route',host,zone.name,r.script || 'Worker route',pathPart,`https://${host}${pathPart}`,`Worker route: ${pattern}`);
        }
      }
    }
    if (zones.length > 50) warnings.push('Zone listing limited to the first 50 zones.');
    const account = encodeURIComponent(String(env.CF_ACCOUNT_ID));
    const pages = await cfList(env,`/accounts/${account}/pages/projects`,warnings,'Pages projects');
    for (const p of pages || []) {
      for (const domain of [p.subdomain,...(p.domains || [])]) {
        const host=safeHost(domain);
        if (host) add('pages',host,zoneFor(host,zoneNames),p.name || 'Pages project','/',`https://${host}/`,'Pages project hostname');
      }
    }
    const workers = await cfList(env,`/accounts/${account}/workers/scripts`,warnings,'Workers scripts');
    for (const w of workers || []) {
      if (w.id) add('worker','', '', String(w.id),'','', 'Deployed Worker script (no hostname inferred)');
    }
    // Never erase old discoveries: upsert, record when last seen.
    let added=0;
    for (const x of found.values()) {
      const key = [x.type,x.host,x.zone,x.name,x.path].join('|');
      const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))).slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
      const existing=await env.DB.prepare('SELECT id FROM discovered_endpoints WHERE id=?').bind(id).first();
      if (!existing) added++;
      await env.DB.prepare(`INSERT INTO discovered_endpoints (id,source,hostname,zone_name,name,path,url,details,last_seen,first_seen)
        VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET details=excluded.details, url=excluded.url, last_seen=CURRENT_TIMESTAMP`)
        .bind(id,x.type,x.host,x.zone,x.name,x.path,x.url,x.details).run();
    }
    const status=warnings.length?'partial':'completed';
    await env.DB.prepare('UPDATE discovery_runs SET status=?,finished_at=CURRENT_TIMESTAMP,items_found=?,new_items=?,warnings=? WHERE id=?')
      .bind(status,found.size,added,JSON.stringify(warnings.slice(0,30)),runId).run();
    return {status,found:found.size,new_items:added,warnings:warnings.slice(0,30)};
  } catch(e) {
    await env.DB.prepare('UPDATE discovery_runs SET status=?,finished_at=CURRENT_TIMESTAMP,warnings=? WHERE id=?')
      .bind('failed',JSON.stringify([...warnings,String(e)].slice(0,30)),runId).run();
    return {status:'failed',found:0,new_items:0,warnings:[...warnings,String(e)]};
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
