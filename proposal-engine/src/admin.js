// Read-only admin dashboard. Asks for the API token once, keeps it in
// localStorage, and renders proposal stats from the JSON API.

export function renderAdmin() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Proposals · Admin</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root { --ink:#151B26; --muted:#5B6272; --hairline:#E5E2D9; --paper:#FAF9F6; --accent:#2733C9; --ok:#157F5F; }
* { box-sizing:border-box; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:'IBM Plex Sans',system-ui,sans-serif; font-size:15px; }
.wrap { max-width:1080px; margin:0 auto; padding:40px 24px 100px; }
h1 { font-size:20px; margin:0 0 24px; }
.mono { font-family:'IBM Plex Mono',monospace; }
.token-box { display:flex; gap:10px; margin-bottom:28px; }
.token-box input { flex:1; font:inherit; padding:10px 12px; border:1px solid #C9C5B9; border-radius:4px; }
button { font:inherit; font-weight:600; background:var(--ink); color:#fff; border:0; border-radius:4px; padding:10px 18px; cursor:pointer; }
table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--hairline); }
th,td { text-align:left; padding:12px 14px; border-bottom:1px solid var(--hairline); vertical-align:top; }
th { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
tr:last-child td { border-bottom:0; }
tr.row { cursor:pointer; }
tr.row:hover td { background:#F4F2EC; }
.pill { font-family:'IBM Plex Mono',monospace; font-size:11px; padding:3px 8px; border-radius:99px; border:1px solid var(--hairline); color:var(--muted); white-space:nowrap; }
.pill.accepted { border-color:var(--ok); color:var(--ok); }
.pill.viewed { border-color:var(--accent); color:var(--accent); }
.pill.expired, .pill.declined { opacity:.6; }
.sub { color:var(--muted); font-size:13px; }
.detail td { background:#FCFBF8; }
.detail .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; padding:6px 0 10px; }
.detail h4 { margin:0 0 6px; font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
.bar { height:8px; background:#EAE7DE; border-radius:99px; overflow:hidden; margin-top:4px; }
.bar i { display:block; height:100%; background:var(--accent); }
.err { color:#B4232A; margin:12px 0; }
a { color:var(--accent); }
.empty { padding:40px; text-align:center; color:var(--muted); background:#fff; border:1px dashed var(--hairline); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Proposals</h1>
  <div class="token-box" id="token-box">
    <input type="password" id="token" placeholder="API token">
    <button id="save-token">Load</button>
  </div>
  <p class="err" id="err" hidden></p>
  <div id="list"></div>
</div>
<script>
(function(){
  var tokenInput = document.getElementById('token');
  var err = document.getElementById('err');
  var saved = localStorage.getItem('pe_token');
  if (saved) { tokenInput.value = saved; load(); }
  document.getElementById('save-token').addEventListener('click', load);
  tokenInput.addEventListener('keydown', function(e){ if(e.key==='Enter') load(); });

  function api(path){
    return fetch(path, { headers: { authorization: 'Bearer ' + tokenInput.value.trim() } })
      .then(function(r){ if(!r.ok) throw new Error(r.status===401?'Wrong token.':'Request failed ('+r.status+').'); return r.json(); });
  }

  function fmt(iso){ return iso ? new Date(iso.replace(' ','T')+'Z').toLocaleString() : 'not yet'; }

  function load(){
    err.hidden = true;
    localStorage.setItem('pe_token', tokenInput.value.trim());
    api('/api/proposals?limit=100').then(function(d){ render(d.proposals); })
      .catch(function(e){ err.textContent = e.message; err.hidden = false; });
  }

  function render(items){
    var list = document.getElementById('list');
    if (!items.length) { list.innerHTML = '<div class="empty">No proposals yet. Create one via POST /api/proposals.</div>'; return; }
    var html = '<table><thead><tr><th>Proposal</th><th>Client</th><th>Status</th><th>Views</th><th>Last activity</th></tr></thead><tbody>';
    items.forEach(function(p, i){
      html += '<tr class="row" data-i="'+i+'" data-id="'+p.id+'">'
        + '<td><strong>'+escapeHtml(p.title)+'</strong><div class="sub mono">'+escapeHtml(p.number||p.slug)+'</div></td>'
        + '<td>'+escapeHtml(p.client_company||p.client_name)+'</td>'
        + '<td><span class="pill '+p.status+'">'+p.status+'</span>'+(p.accepted_name?'<div class="sub">by '+escapeHtml(p.accepted_name)+'</div>':'')+'</td>'
        + '<td>'+p.views+'</td>'
        + '<td class="sub">'+fmt(p.last_activity)+'</td></tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = html;
    list.querySelectorAll('tr.row').forEach(function(row){
      row.addEventListener('click', function(){ toggleDetail(row); });
    });
  }

  function toggleDetail(row){
    var next = row.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); return; }
    api('/api/proposals/' + row.getAttribute('data-id')).then(function(p){
      var tr = document.createElement('tr');
      tr.className = 'detail';
      var rt = p.reading_time_seconds || {};
      var max = 1; Object.keys(rt).forEach(function(k){ if(rt[k]>max) max=rt[k]; });
      var bars = Object.keys(rt).map(function(k){
        return '<div><h4>'+escapeHtml(k)+'</h4><span class="mono">'+rt[k]+'s</span><div class="bar"><i style="width:'+Math.round(rt[k]/max*100)+'%"></i></div></div>';
      }).join('') || '<div class="sub">No reading data yet.</div>';
      tr.innerHTML = '<td colspan="5">'
        + '<div class="grid">'
        + '<div><h4>Link</h4><a href="'+p.url+'" target="_blank" class="mono">'+p.slug+'</a></div>'
        + '<div><h4>Created</h4>'+fmt(p.created_at)+'</div>'
        + '<div><h4>First viewed</h4>'+fmt(p.first_viewed_at)+'</div>'
        + '<div><h4>Accepted</h4>'+(p.accepted_at?fmt(p.accepted_at)+' · '+escapeHtml(p.accepted_name||''):'not yet')+'</div>'
        + '</div>'
        + '<h4 style="margin-top:8px">Time spent per section</h4>'
        + '<div class="grid">'+bars+'</div>'
        + '</td>';
      row.after(tr);
    }).catch(function(e){ err.textContent = e.message; err.hidden = false; });
  }

  function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
})();
</script>
</body>
</html>`;
}
