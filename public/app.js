(() => {
'use strict';
const $ = (s, root = document) => root.querySelector(s);
const els = {
  sections: $('#sections'), notice: $('#notice'), search: $('#search'), sort: $('#sort'),
  linkDialog: $('#link-dialog'), linkForm: $('#link-form'), domainDialog: $('#domain-dialog'),
  domainForm: $('#domain-form'), domainList: $('#domain-list'), linkDomain: $('#link-domain'),
};
let state = { domains: [], links: [], view: 'all' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const domainOf = id => state.domains.find(d => d.id === id);
const shortHost = s => { try { return new URL(s).hostname; } catch { return s; } };
const isMatch = l => {
  const q = els.search.value.trim().toLowerCase();
  return !q || [l.title,l.url,l.category,l.description,domainOf(l.domain_id)?.name,domainOf(l.domain_id)?.hostname].some(x => String(x || '').toLowerCase().includes(q));
};
function sorted(items) {
  return [...items].sort(els.sort.value === 'recent'
    ? (a,b) => b.created_at.localeCompare(a.created_at)
    : (a,b) => a.title.localeCompare(b.title, undefined, {sensitivity:'base'}));
}
function tile(l) {
  const initial = l.title.trim().charAt(0).toUpperCase();
  return `<article class="tile"><div class="tile-icon">${esc(initial)}</div><div class="tile-main"><a class="tile-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(l.title)}">${esc(l.title)} ↗</a><div class="tile-sub">${esc(shortHost(l.url))} · ${esc(l.category)}</div>${l.description ? `<div class="tile-desc">${esc(l.description)}</div>` : ''}</div><div class="tile-actions"><button class="mini ${l.favorite ? 'pinned' : ''}" data-action="favorite" data-id="${esc(l.id)}" title="${l.favorite?'Unpin':'Pin'} favorite" aria-label="${l.favorite?'Unpin':'Pin'} ${esc(l.title)}">${l.favorite ? '★' : '☆'}</button><button class="mini" data-action="edit" data-id="${esc(l.id)}" title="Edit link" aria-label="Edit ${esc(l.title)}">✎</button></div></article>`;
}
function section(title, subtitle, items, key = '') {
  return `<section class="section"><div class="section-title"><h2>${esc(title)}</h2><span class="hint">${esc(subtitle)}</span></div><div class="link-grid">${sorted(items).map(tile).join('')}</div></section>`;
}
const empty = (title, info) => `<div class="empty"><strong>${esc(title)}</strong>${esc(info)}</div>`;
function render() {
  $('#count-links').textContent = state.links.length;
  $('#count-domains').textContent = state.domains.length;
  $('#count-tools').textContent = state.links.filter(l=>l.kind==='tool').length;
  $('#count-favorites').textContent = state.links.filter(l=>l.favorite).length;
  const views = {all:['Everything. One place','All your apps, websites, and online tools — organized your way.','OVERVIEW'],domains:['Your domains','All the projects and web apps connected to your domains.','MY DOMAINS'],tools:['Your online tools','Security, productivity, development, AI and everything in between.','ONLINE TOOLS'],favorites:['Your essentials','The links you reach for most, always one click away.','FAVORITES']};
  const v = views[state.view];
  $('#page-title').innerHTML = `${esc(v[0])}<span class="accent">.</span>`;
  $('#page-description').textContent = v[1]; $('#crumb').textContent = v[2];
  const filtered = state.links.filter(isMatch);
  let html = '';
  if (state.view === 'favorites') {
    const favorites = filtered.filter(l=>l.favorite);
    html = favorites.length ? section('Pinned links',`${favorites.length} links`,favorites) : empty('No pinned links', 'Tap the star on any link to pin it here.');
  } else if (state.view === 'tools') {
    const tools = filtered.filter(l=>l.kind==='tool');
    const cats = [...new Set(tools.map(l=>l.category))].sort();
    html = cats.map(c=>section(c,`${tools.filter(l=>l.category===c).length} tools`,tools.filter(l=>l.category===c))).join('') || empty('No online tools yet','Add a link and select Online tool to create your first one.');
  } else {
    const grouped = state.domains.map(d => ({ d, links: filtered.filter(l=>l.domain_id===d.id) }));
    if (state.view === 'domains') {
      html = grouped.map(({d,links})=>`<div class="domain-summary"><div><b>${esc(d.name)}</b><small>${esc(d.hostname)} · ${links.length} matching links</small></div><button class="ghost small" data-action="add-to-domain" data-id="${esc(d.id)}">＋ Add link</button></div>${links.length ? section('Links under '+d.name,'',links) : ''}`).join('');
      if (!grouped.length) html = empty('No domains yet','Select Manage domains to register your first domain.');
    } else {
      const favorites = filtered.filter(l=>l.favorite);
      if (favorites.length) html += section('★ Quick access',`${favorites.length} pinned`,favorites);
      for (const {d,links} of grouped) if (links.length) html += section(d.name,d.hostname,links);
      const ungrouped = filtered.filter(l=>!l.domain_id && l.kind!=='tool');
      if (ungrouped.length) html += section('General apps',`${ungrouped.length} links`,ungrouped);
      const tools = filtered.filter(l=>l.kind==='tool');
      if (tools.length) html += section('Online tools',`${tools.length} tools`,tools);
      if (!html) html = empty(state.links.length ? 'No matching links':'Your dashboard is ready',state.links.length ? 'Try a different search.':'Add your domains and first links to get started.');
    }
  }
  els.sections.innerHTML = html;
  els.linkDomain.innerHTML = '<option value="">No domain / General</option>' + state.domains.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} (${esc(d.hostname)})</option>`).join('');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
}
function notice(message) { els.notice.textContent = message; els.notice.hidden = false; }
function clearNotice() { els.notice.hidden = true; }
async function api(path, method = 'GET', body) {
  const options = {method, credentials:'same-origin', headers:{'accept':'application/json'}};
  if (body !== undefined) { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(body); }
  const r = await fetch(path, options);
  let data; try { data = await r.json(); } catch { throw new Error(`Unexpected response (${r.status}). Check Cloudflare Access.`); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
async function refresh() {
  try { const data = await api('/api/data'); state.domains = data.domains; state.links = data.links; clearNotice(); render(); }
  catch (e) { notice(e.message); els.sections.innerHTML = empty('Could not load your links','Check D1 configuration and Cloudflare Access setup.'); }
}
function openLink(l, domainId = '') {
  els.linkForm.reset();
  $('#link-modal-title').textContent = l ? 'Edit link' : 'Add a link';
  $('#delete-link').hidden = !l;
  for (const k of ['id','title','url','description','kind','domain_id','category']) {
    const element = els.linkForm.elements.namedItem(k);
    element.value = l?.[k] ?? (k==='domain_id' ? domainId : (k==='kind' ? 'app' : ''));
  }
  els.linkForm.elements.favorite.checked = Boolean(l?.favorite);
  els.linkDialog.showModal();
  els.linkForm.elements.title.focus();
}
function openDomains() { renderDomains(); els.domainDialog.showModal(); }
function renderDomains() {
  els.domainList.innerHTML = state.domains.length ? state.domains.map(d=>`<div class="domain-row"><div><b>${esc(d.name)}</b><small>${esc(d.hostname)}</small></div><div><button class="ghost" data-domain-action="edit" data-id="${esc(d.id)}">Edit</button> <button class="ghost" data-domain-action="delete" data-id="${esc(d.id)}">Delete</button></div></div>`).join('') : '<p class="muted">No domains added yet.</p>';
}
function resetDomain() { els.domainForm.reset(); els.domainForm.elements.id.value=''; $('#domain-submit').textContent='Add domain'; }
$('#add-link').addEventListener('click',()=>openLink());
$('#manage-domains').addEventListener('click',openDomains);
$('#nav').addEventListener('click', e=>{const btn=e.target.closest('[data-view]');if(!btn)return;state.view=btn.dataset.view;render();});
els.search.addEventListener('input',render); els.sort.addEventListener('change',render);
window.addEventListener('keydown',e=>{if(e.key==='/'&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();els.search.focus();}});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
els.sections.addEventListener('click', async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const id=b.dataset.id, l=state.links.find(x=>x.id===id);
  if(b.dataset.action==='edit') return openLink(l);
  if(b.dataset.action==='add-to-domain') return openLink(null,id);
  if(b.dataset.action==='favorite'&&l){try{await api('/api/links','PUT',{...l,favorite:!l.favorite});await refresh();}catch(e){notice(e.message);}}
});
els.linkForm.addEventListener('submit',async e=>{
  e.preventDefault(); const f=els.linkForm;
  const data=Object.fromEntries(new FormData(f).entries()); data.favorite=f.elements.favorite.checked;
  try{await api('/api/links',data.id?'PUT':'POST',data);els.linkDialog.close();await refresh();}
  catch(e){alert(e.message);}
});
els.domainForm.addEventListener('submit',async e=>{
  e.preventDefault();const data=Object.fromEntries(new FormData(els.domainForm).entries());
  try{await api(data.id?`/api/domains/${data.id}`:'/api/domains',data.id?'PUT':'POST',data);resetDomain();await refresh();renderDomains();}
  catch(e){alert(e.message);}
});
$('#reset-domain').addEventListener('click',resetDomain);
$('#delete-link').addEventListener('click', async()=>{
  const id = els.linkForm.elements.id.value;
  const l = state.links.find(x=>x.id===id);
  if (!l || !confirm(`Delete link: ${l.title}?`)) return;
  try { await api(`/api/links/${id}`,'DELETE',{});els.linkDialog.close();await refresh(); } catch(e) { alert(e.message); }
});
els.domainList.addEventListener('click',async e=>{
  const b=e.target.closest('[data-domain-action]');if(!b)return;
  const d=state.domains.find(x=>x.id===b.dataset.id);if(!d)return;
  if(b.dataset.domainAction==='edit'){els.domainForm.elements.id.value=d.id;els.domainForm.elements.name.value=d.name;els.domainForm.elements.hostname.value=d.hostname;$('#domain-submit').textContent='Save domain';return;}
  if(b.dataset.domainAction==='delete'&&confirm(`Delete ${d.name}? Its links will be kept under General.`)){
    try{await api(`/api/domains/${d.id}`,'DELETE',{});await refresh();renderDomains();}catch(e){alert(e.message);}
  }
});
$('#date-chip').textContent = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date()).toUpperCase();
refresh();
})();
