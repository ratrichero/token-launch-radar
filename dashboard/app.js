(function () {
  'use strict';

  var D = window.RADAR;

  if (!D || !Array.isArray(D.rows) || D.rows.length === 0) {
    var m = document.querySelector('main');
    if (m) m.textContent = 'No radar data. Run main.ts first so it writes data.js in the parent output directory.';
    return;
  }

  var ROWS = D.rows;
  var LIVE = Array.isArray(D.live) ? D.live : [];
  var PEERS = Array.isArray(D.peer_table) ? D.peer_table : [];
  var WATCH = new Set(Array.isArray(D.watchlist) ? D.watchlist : []);
  var FLOOR = typeof D.floor_usd === 'number' ? D.floor_usd : 50000000;
  var BY_SLUG = Object.create(null);
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });
  var PEER_BY_CAT = Object.create(null);
  PEERS.forEach(function (p) { PEER_BY_CAT[p.category] = p; });

  var viewEls = {
    board: document.getElementById('board'),
    detail: document.getElementById('detail'),
    live: document.getElementById('live'),
    peers: document.getElementById('peers'),
    model: document.getElementById('model')
  };

  var state = {
    view: 'board',
    q: '',
    category: '',
    chain: '',
    sort: 'rank',
    desc: false,
    watch: false,
    slug: null
  };

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  function usd(n) {
    if (!isNum(n)) return '\u2014';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(abs >= 1e8 ? 0 : 1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }

  function usdExact(n) {
    if (!isNum(n)) return '\u2014';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (!isNum(n)) return '<span class="flat">no 7d</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }

  function age(ageDays, listedAt) {
    if (isNum(ageDays)) return ageDays + 'd';
    if (listedAt) return listedAt;
    return '\u2014';
  }


  function applyRoute() {
    var h = location.hash.slice(1) || window.ROUTE || '';
    var params = new URLSearchParams(h);
    var view = params.get('view') || h;
    var slug = params.get('protocol') || h;
    state.slug = BY_SLUG[slug] ? slug : null;
    state.view = state.slug ? 'detail' : ['live', 'peers', 'model'].indexOf(view) >= 0 ? view : 'board';
    state.q = params.get('q') || '';
    state.category = params.get('category') || '';
    state.chain = params.get('chain') || '';
    ['category', 'chain'].forEach(function (key) {
      if (!Array.from(el(key).options).some(function (item) { return item.value === state[key]; })) state[key] = '';
    });
    var sort = params.get('sort');
    state.sort = ['tvl', 'implied', 'change'].indexOf(sort) >= 0 ? sort : 'rank';
    state.desc = state.sort !== 'rank';
    state.watch = h === 'watch' || params.get('watch') === '1';
  }

  function route(view, slug) {
    var params = new URLSearchParams();
    if (slug) params.set('protocol', slug);
    else if (view !== 'board') params.set('view', view);
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.sort !== 'rank') params.set('sort', state.sort);
    return '#' + params.toString();
  }

  function updateBoard() {
    // Replacing avoids adding a history entry for every search keystroke.
    history.replaceState(null, '', route('board'));
    renderBoard();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var out = ROWS.filter(function (r) {
      if (state.watch && !WATCH.has(r.slug)) return false;
      if (state.category && (r.category || '(none)') !== state.category) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) === -1) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.desc ? -1 : 1;
    out.sort(function (a, b) {
      var x;
      var y;
      if (key === 'tvl') { x = a.tvl_usd; y = b.tvl_usd; }
      else if (key === 'implied') { x = a.implied_value_usd; y = b.implied_value_usd; }
      else if (key === 'change') {
        x = isNum(a.change_7d) ? a.change_7d : -Infinity;
        y = isNum(b.change_7d) ? b.change_7d : -Infinity;
      } else { x = a.rank; y = b.rank; }
      if (x === y) return a.rank - b.rank;
      if (x === -Infinity || y === -Infinity) return x === -Infinity ? 1 : -1;
      return x < y ? -dir : dir;
    });
    return out;
  }

  function chainsHtml(chains) {
    var list = Array.isArray(chains) ? chains : [];
    if (list.length === 0) return '<span class="muted">\u2014</span>';
    var shown = list.slice(0, 2).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    if (list.length > 2) shown += '<span class="muted">+' + (list.length - 2) + '</span>';
    return shown;
  }

  function livePeers(category) {
    return LIVE.filter(function (l) { return l.category === category; });
  }

  function renderBoard() {
    var rows = filteredRows();
    var tbody = el('rows');
    el('count').textContent = rows.length + ' of ' + ROWS.length + ' pre-token protocols' +
      (state.watch ? ' \u00b7 watchlist only' : '') +
      (state.category ? ' \u00b7 ' + state.category : '') +
      (state.chain ? ' \u00b7 ' + state.chain : '') +
      (state.q ? ' \u00b7 search "' + state.q + '"' : '');
    var html = rows.length ? '' : '<tr><td colspan="8" class="empty">No protocols match these filters. Try Reset.</td></tr>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name"><a class="protocol-link" href="' + esc(route('detail', r.slug)) + '">' + esc(r.name) + '</a>' +
        ' <span class="pill ' + (WATCH.has(r.slug) ? 'watch">Watchlist' : '">Early') + '</span></td>' +
        '<td class="cat">' + esc(r.category || '(none)') + '</td>' +
        '<td class="chains">' + chainsHtml(r.chains) + '</td>' +
        '<td>' + usd(r.tvl_usd) + '</td>' +
        '<td>' + pct(r.change_7d) + '</td>' +
        '<td>' + age(r.age_days, r.listed_at) + '</td>' +
        '<td class="implied">' + usd(r.implied_value_usd) + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    var sortEl = el('sort');
    if (sortEl) {
      var opt = sortEl.options[sortEl.selectedIndex];
      if (opt) opt.textContent = opt.textContent.replace(/\s[\u25b2\u25bc]$/, '') + sortIcon(state.sort);
    }
  }

  function sortIcon(key) {
    if (state.sort !== key) return '';
    return state.desc ? ' \u25bc' : ' \u25b2';
  }


  function peerBox(categoryNote) {
    var peer = PEER_BY_CAT[categoryNote];
    var live = livePeers(categoryNote);
    var html = '<div class="peerbox"><h4>Priced against its category</h4>';
    if (peer) {
      var note = peer.peers > 0
        ? 'median ' + peer.catMedian.toFixed(4) + ' over ' + peer.peers + ' peer' + (peer.peers === 1 ? '' : 's') + ' in the snapshot, shrunk toward the global median'
        : 'no live peer in the snapshot: it falls back to the global median';
      html += '<div class="peerrow"><span class="n">' + esc(peer.category) + '</span><span class="m">' + peer.multiple.toFixed(4) + 'x</span></div>';
      html += '<p class="muted" style="margin:6px 0 0;font-size:12px">' + esc(note) + '</p>';
    } else {
      html += '<p class="muted" style="margin:0;font-size:12px">No peer in the table for this category: the model uses the global median.</p>';
    }
    if (live.length) {
      html += '<h4 style="margin-top:14px">Live tokens in this category</h4>';
      live.slice(0, 6).forEach(function (l) {
        var mult = isNum(l.mcap_usd) && l.tvl_usd > 0 ? l.mcap_usd / l.tvl_usd : null;
        html += '<div class="peerrow"><span class="n">' + esc(l.name) + '</span><span class="m">' +
          (isNum(mult) ? mult.toFixed(2) + 'x' : '\u2014') + ' mcap/TVL</span></div>';
      });
    }
    html += '</div>';
    return html;
  }

  function renderDetail(slug) {
    var r = BY_SLUG[slug];
    if (!r) return;
    var isWatch = WATCH.has(r.slug);
    var chains = Array.isArray(r.chains) ? r.chains : [];
    var html = '';

    html += '<a class="back board-link" href="' + esc(route('board')) + '">Back to board</a><div class="detail-head">';
    html += '<div><h1 class="detail-title" tabindex="-1"><span class="rk">#' + r.rank + '</span>' + esc(r.name) +
      (isWatch ? ' <span class="pill watch">watchlist</span>' : '') + '</h1>';
    html += '<p class="detail-sub">' + esc(r.category || '(no category)') + ' \u00b7 <span class="slug" style="display:inline">' + esc(r.slug) + '</span> \u00b7 ' +
      (isWatch ? 'watchlist: no token metadata recorded in the snapshot'
               : 'early find: no token recorded, TVL below the ' + usd(FLOOR) + ' floor') + '</p></div>';
    html += '<div class="bigval"><b>' + usd(r.implied_value_usd) + '</b><span>implied value</span></div>';
    html += '</div>';

    html += '<div class="dgrid">' +
      '<div class="dstat"><span>TVL</span><b>' + usd(r.tvl_usd) + '</b></div>' +
      '<div class="dstat"><span>7d change</span><b>' + pct(r.change_7d) + '</b></div>' +
      '<div class="dstat"><span>Age since listing</span><b>' + age(r.age_days, r.listed_at) + '</b></div>' +
      '<div class="dstat"><span>Listed</span><b>' + esc(r.listed_at || '\u2014') + '</b></div>' +
      '<div class="dstat"><span>Chains</span><b>' + chains.length + '</b></div>' +
      '<div class="dstat"><span>Peer multiple</span><b>' + r.peer_multiple.toFixed(4) + 'x</b></div>' +
      '</div>';

    if (chains.length) {
      html += '<p class="detail-sub">Chains: ' + chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</p>';
    }

    html += '<div class="cols">';
    html += '<div class="card howto"><h3>How this value is computed</h3>';
    html += '<div class="formula">implied = <b>TVL</b> \u00d7 <b>peerMultiple</b> \u00d7 <b>growthMult</b> \u00d7 <b>maturityMult</b> \u00d7 <b>chainMult</b><br>' +
      usdExact(r.tvl_usd) + ' \u00d7 ' + r.peer_multiple.toFixed(4) + ' \u00d7 ' + r.growth_multiplier.toFixed(4) + ' \u00d7 ' +
      r.maturity_multiplier.toFixed(4) + ' \u00d7 ' + r.chain_multiplier.toFixed(4) + ' \u2248 <b>' + usdExact(r.implied_value_usd) + '</b></div>';
    if (D.model_version === 'radar-3') {
      html += '<details class="exact"><summary>Copyable calculation with full precision</summary><pre class="block">' +
        'Math.max(1, Math.round(' + [r.tvl_usd, r.peer_multiple, r.growth_multiplier, r.maturity_multiplier, r.chain_multiplier].join(' * ') + '))' +
        ' = ' + r.implied_value_usd + '</pre></details>';
    }
    html += '<p class="muted">The display rounds the factors above; the model uses full precision.</p>';
    html += '<table class="modeltable"><tbody>';
    html += '<tr><td class="lbl">TVL</td><td>' + usdExact(r.tvl_usd) + '</td></tr>';
    html += '<tr><td class="lbl">peerMultiple<br><span class="fn">median mcap/TVL of live peers in ' + esc(r.category || 'its category') + ', shrunk toward the global median</span></td><td>' + r.peer_multiple.toFixed(4) + 'x</td></tr>';
    html += '<tr><td class="lbl">growthMult<br><span class="fn">7d change ' + (isNum(r.change_7d) ? r.change_7d.toFixed(2) + '%' : 'not reported') + ', clamped -60 to +120</span></td><td>' + r.growth_multiplier.toFixed(4) + 'x</td></tr>';
    html += '<tr><td class="lbl">maturityMult<br><span class="fn">age ' + (isNum(r.age_days) ? r.age_days + ' days' : 'not recorded, 365 used') + ', capped at 1095</span></td><td>' + r.maturity_multiplier.toFixed(4) + 'x</td></tr>';
    html += '<tr><td class="lbl">chainMult<br><span class="fn">' + chains.length + ' chain' + (chains.length === 1 ? '' : 's') + ', 1 + 0.04 per extra chain, up to five extras</span></td><td>' + r.chain_multiplier.toFixed(4) + 'x</td></tr>';
    html += '<tr class="total"><td class="lbl">implied value (rounded)</td><td>' + usdExact(r.implied_value_usd) + '</td></tr>';
    html += '</tbody></table>';
    if (D.global_median === null || D.global_peer_count === 0) {
      html += '<p class="peermid">No eligible peers. The multiple is an assumed floor, not a market observation.</p>';
    } else if (r.peer_count > 0) {
      html += '<p class="peermid">Peer support: ' + r.peer_count + ' category peer(s); ' +
        (r.peer_count < 3 ? 'thin sample' : 'category data') + '. Winsorised category median: <b>' + r.category_median.toFixed(3) + '×</b>.</p>';
    } else {
      html += '<p class="peermid">No category peers. The model uses the global median (subject to the model limits): <b>' +
        (isNum(D.global_median) ? D.global_median.toFixed(3) + '×' : 'not available') + '</b>.</p>';
    }
    if (Array.isArray(D.peer_observations) && D.peer_observations.length) {
      var category = r.category ?? '(no category)';
      var observations = D.peer_observations;
      var local = observations.filter(function (p) { return p.category === category; });
      var blended = local.length ? (local.length * r.category_median + 3 * D.global_median) / (local.length + 3) : D.global_median;
      html += '<p class="lead">Global median: ' + D.global_median.toFixed(4) + '× · Before final limits: ' + blended.toFixed(4) + '× · Applied: ' + r.peer_multiple.toFixed(4) + '×</p>';
      function peerAudit(label, rows) {
        return '<details class="exact"><summary>' + label + ' (' + rows.length + ')</summary><div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Raw ratio</th><th>Bounded ratio</th></tr></thead><tbody>' +
          rows.map(function (p) { return '<tr><td>' + esc(p.name) + ' (' + esc(p.slug) + ')</td><td>' + (p.raw === null ? 'Overflow' : p.raw.toPrecision(6)) + '</td><td>' + p.bounded.toPrecision(6) + '</td></tr>'; }).join('') +
          '</tbody></table></div></details>';
      }
      if (local.length) html += peerAudit('Category peers', local);
      html += peerAudit('Global median sample', observations);
    } else {
      html += peerBox(r.category);
    }
    html += '</div>';
    html += '<div class="card"><h3>Farm steps before a launch</h3>';
    var evidence = D.farm_evidence && Object.hasOwn(D.farm_evidence, slug) ? D.farm_evidence[slug] : null;
    if (evidence) {
      html += '<h4>Source checked on ' + esc(evidence.checked_at) + '</h4><p>Networks: ' + esc(evidence.networks.join(', ')) +
        '</p><p>Eligibility: ' + esc(evidence.eligibility) + '</p><p>Exit: ' + esc(evidence.exit) +
        '</p><p>Official source (copy to open): <code>' + esc(evidence.source) + '</code></p>';
    }
    html += '<p class="lead">The steps below are category examples, not confirmed reward conditions.</p><ol class="steps"></ol></div>';
    html += '</div>';
    el('detail').innerHTML = html;
    renderSteps(r);
  }


  function renderSteps(r) {
    var ol = document.querySelector('#detail ol.steps');
    if (!ol) return;
    var steps = Array.isArray(r.farm_steps) ? r.farm_steps : [];
    var html = '';
    for (var i = 0; i < steps.length; i++) html += '<li>' + esc(steps[i]) + '</li>';
    ol.innerHTML = html;
  }

  function renderLive() {
    var tbody = el('liverows');
    var html = '';
    for (var i = 0; i < LIVE.length; i++) {
      var l = LIVE[i];
      var mult = isNum(l.mcap_usd) && l.tvl_usd > 0 ? l.mcap_usd / l.tvl_usd : null;
      html += '<tr>' +
        '<td class="name">' + esc(l.name) + '<span class="slug">' + esc(l.slug) + '</span></td>' +
        '<td class="cat">' + esc(l.category || '(none)') + '</td>' +
        '<td class="chains">' + chainsHtml(l.chains) + '</td>' +
        '<td>' + usd(l.tvl_usd) + '</td>' +
        '<td>' + pct(l.change_7d) + '</td>' +
        '<td>' + usd(l.mcap_usd) + '</td>' +
        '<td>' + (isNum(mult) ? mult.toFixed(2) + 'x' : '\u2014') + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }

  function renderPeers() {
    var tbody = el('peerrows');
    var html = '';
    for (var i = 0; i < PEERS.length; i++) {
      var p = PEERS[i];
      var width = Math.max(2, Math.min(100, Math.round((p.multiple / 0.5915) * 100)));
      html += '<tr>' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="name">' + esc(p.category) + '</td>' +
        '<td>' + p.peers + '</td>' +
        '<td>' + p.catMedian.toFixed(4) + '</td>' +
        '<td class="implied"><span class="bar" style="width:' + width + '%"></span>' + p.multiple.toFixed(4) + 'x</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    var sum = el('peersum');
    if (sum) {
      sum.textContent = PEERS.length + ' categories are priced from live peers in the snapshot, each median shrunk toward the global one with 3 virtual peers, as computePeerTable() does. A category with no live peer falls back to the global median, so a protocol still gets a claim on any record.';
    }
  }


  function renderModel() {
    var body = el('modelbody');
    if (!body) return;
    var topWatch = 0;
    var topLive = 0;
    for (var i = 0; i < ROWS.length; i++) {
      if (WATCH.has(ROWS[i].slug)) topWatch++;
      if (ROWS[i].tvl_usd >= FLOOR) topLive++;
    }
    var html = '';
    html += '<p class="lead">This page fetches nothing: every figure comes from <code>data.js</code>, which <code>main.ts</code> writes beside it. <code>window.RADAR</code> holds ' + ROWS.length + ' scored rows and ' + LIVE.length + ' live tokens. No protocol is named in the code.</p>';
    html += '<div class="cols">';
    html += '<div class="card"><h3>1. The formula \u2014 <span class="muted" style="font-weight:400">impliedValue()</span></h3>';
    html += '<div class="formula">implied = round( <b>TVL</b> \u00d7 <b>peer_multiple</b>(category) \u00d7 <b>growth</b> \u00d7 <b>maturity</b> \u00d7 <b>chain</b> )</div>';
    html += '<ol class="steps">';
    html += '<li><b>peer_multiple</b> asks what token holders already pay for this category: the winsorised median of mcap / TVL over live tokens in the same category, shrunk toward the global median.</li>';
    html += '<li><b>growth</b> rewards TVL that rose this week and penalises a fall harder: change_7d clamped -60 to +120, scaled 0.4 up and 0.9 down.</li>';
    html += '<li><b>maturity</b> = 0.65 + min(age, 1095) / 1095 \u00d7 0.35, so a half-year protocol reads lower than a three-year one; unknown age uses 365 days.</li>';
    html += '<li><b>chain</b> = 1 + 0.04 per extra chain up to 6, for multi-chain reach; 1.00 to 1.20.</li>';
    html += '</ol></div>';
    html += '<div class="card"><h3>2. Reading the board</h3>';
    html += '<p class="lead">Sort by rank, TVL, 7d change or implied value; filter category and chain; search a name or slug. Every row opens a detail view with the full multiplication, the peer it was priced against, and the farm steps the model wrote for it with checks to make before risking any capital.</p>';
    html += '<div class="dgrid">';
    html += '<div class="dstat"><span>Ranked protocols</span><b>' + ROWS.length + '</b></div>';
    html += '<div class="dstat"><span>On the watchlist</span><b>' + topWatch + '</b></div>';
    html += '<div class="dstat"><span>At or above the floor</span><b>' + topLive + '</b></div>';
    html += '<div class="dstat"><span>Live tokens set aside</span><b>' + LIVE.length + '</b></div>';
    html += '</div>';
    html += '<p class="muted" style="font-size:12px;margin:8px 0 0">The watchlist is the floor, never the ceiling: ' + (ROWS.length - topWatch) + ' early protocols below the ' + usd(FLOOR) + ' floor are ranked too, because a launch below the floor is still a launch.</p>';
    html += '</div>';
    html += '</div>';
    html += '<div class="card sensitivity"><h3>Top 10: model sensitivity</h3>' +
      '<p class="lead">This score uses circulating market cap / TVL as a proxy, not FDV, expected rewards or a forecast. Scenarios show how scores change for the current top ten; they do not rerank the board.</p>';
    if (D.model_version !== 'radar-3') {
      html += '<p>Rebuild with a current snapshot to see scenarios with full-precision factors.</p>';
    } else {
      html += '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Base</th><th>No chain bonus</th><th>Peer −25%</th><th>Peer +25%</th></tr></thead><tbody>';
      ROWS.slice(0, 10).forEach(function (r) {
        function scenario(peer, chain) {
          return usd(Math.max(1, Math.round(r.tvl_usd * peer * r.growth_multiplier * r.maturity_multiplier * chain)));
        }
        html += '<tr><td>' + esc(r.name) + '</td><td>' + usd(r.implied_value_usd) + '</td><td>' + scenario(r.peer_multiple, 1) +
          '</td><td>' + scenario(r.peer_multiple * 0.75, r.chain_multiplier) + '</td><td>' + scenario(r.peer_multiple * 1.25, r.chain_multiplier) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    body.innerHTML = html;
  }

  function showView(name) {
    state.view = name;
    for (var k in viewEls) {
      if (Object.prototype.hasOwnProperty.call(viewEls, k)) {
        var sec = viewEls[k];
        if (sec) sec.classList.toggle('hidden', k !== name);
      }
    }
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i].getAttribute('data-view') === (name === 'detail' ? 'board' : name);
      tabs[i].classList.toggle('on', active);
      if (active) tabs[i].setAttribute('aria-current', 'page');
      else tabs[i].removeAttribute('aria-current');
    }
    try { window.scrollTo(0, 0); } catch (e) { /* no-op */ }
  }

  function renderStats() {
    var st = el('stats');
    if (!st) return;
    var top = ROWS[0];
    var watchCount = 0;
    for (var i = 0; i < ROWS.length; i++) if (WATCH.has(ROWS[i].slug)) watchCount++;
    var cards = [
      { k: 'Ranked pre-token protocols', v: String(ROWS.length), cls: '' },
      { k: 'Top implied value', v: top ? usd(top.implied_value_usd) : '\u2014', s: top ? top.name : '', cls: 'accent' },
      { k: 'On the watchlist', v: String(watchCount), cls: '' },
      { k: 'Live tokens set aside', v: String(LIVE.length), cls: '' },
      { k: 'TVL floor', v: usd(FLOOR), cls: '' }
    ];
    var html = '';
    for (var j = 0; j < cards.length; j++) {
      html += '<div class="stat ' + cards[j].cls + '"><span>' + esc(cards[j].k) + '</span><b>' + esc(cards[j].v) + '</b>' +
        (cards[j].s ? '<span class="sub">' + esc(cards[j].s) + '</span>' : '') + '</div>';
    }
    st.innerHTML = html;
  }

  function renderTop10() {
    var box = el('top10');
    if (!box) return;
    var top = ROWS.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; }).slice(0, 10);
    if (!top.length) return;
    var max = top[0].implied_value_usd;
    var W = 660, H = 200, rowH = 17, padT = 26, labelW = 172, valW = 84;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Top 10 implied values">';
    s += '<text x="0" y="14" class="t10title">Top 10 implied value</text>';
    for (var i = 0; i < top.length; i++) {
      var r = top[i];
      var y = padT + i * rowH;
      var bw = Math.max(3, Math.round((r.implied_value_usd / max) * (W - labelW - valW - 14)));
      var label = r.name.length > 20 ? r.name.slice(0, 19) + '\u2026' : r.name;
      s += '<text x="0" y="' + (y + 12) + '" class="t10lbl">#' + r.rank + ' ' + esc(label) + '</text>';
      s += '<rect x="' + labelW + '" y="' + (y + 4) + '" width="' + bw + '" height="11" rx="2" class="t10bar' + (i === 0 ? ' top' : '') + '"></rect>';
      s += '<text x="' + (W - 4) + '" y="' + (y + 12) + '" text-anchor="end" class="t10val">' + usd(r.implied_value_usd) + '</text>';
    }
    s += '</svg>';
    box.innerHTML = s;
  }

  function uniqueValues(list, key) {
    var set = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var v = key(list[i]);
      if (v === null || v === undefined || v === '') continue;
      set[v] = true;
    }
    return Object.keys(set).sort();
  }

  function allChains() {
    var set = Object.create(null);
    for (var i = 0; i < ROWS.length; i++) {
      var list = Array.isArray(ROWS[i].chains) ? ROWS[i].chains : [];
      for (var j = 0; j < list.length; j++) set[list[j]] = true;
    }
    return Object.keys(set).sort();
  }

  function fillOptions(select, values) {
    var html = select.getAttribute('data-first') || '';
    for (var i = 0; i < values.length; i++) {
      html += '<option value="' + esc(values[i]) + '">' + esc(values[i]) + '</option>';
    }
    select.innerHTML = html;
  }

  function buildControls() {
    el('watch').textContent = 'Watchlist (' + WATCH.size + ') only';
    var cats = uniqueValues(ROWS, function (r) { return r.category; });
    fillOptions(el('category'), cats);
    fillOptions(el('chain'), allChains());
  }


  function syncControls() {
    var sortEl = el('sort');
    if (sortEl && sortEl.value !== state.sort) sortEl.value = state.sort;
    var catEl = el('category');
    if (catEl) catEl.value = state.category;
    var chEl = el('chain');
    if (chEl) chEl.value = state.chain;
    var wEl = el('watch');
    if (wEl) wEl.setAttribute('aria-pressed', state.watch ? 'true' : 'false');
  }

  function renderMeta() {
    var parts = [];
    if (D.as_of) parts.push('snapshot ' + esc(D.as_of));
    if (D.source) parts.push(esc(D.source));
    if (D.model_version) parts.push('model ' + esc(D.model_version));
    if (typeof D.board_size === 'number') parts.push(D.board_size + ' rows');
    if (typeof D.live_size === 'number') parts.push(D.live_size + ' live');
    parts.push('floor ' + usd(FLOOR));
    el('meta').innerHTML = parts.map(function (p) { return '<span>' + p + '</span>'; }).join('');
  }

  function renderRoute(focus) {
    var previousSlug = state.slug;
    applyRoute();
    syncControls();
    el('search').value = state.q;
    if (state.view === 'detail') renderDetail(state.slug);
    else if (state.view === 'live') renderLive();
    else if (state.view === 'peers') renderPeers();
    else if (state.view === 'model') renderModel();
    else renderBoard();
    showView(state.view);
    if (focus && state.view === 'detail') document.querySelector('.detail-title').focus();
    if (focus && state.view === 'board' && previousSlug) {
      var links = Array.from(document.querySelectorAll('.protocol-link'));
      var link = links.find(function (element) { return element.getAttribute('href') === route('detail', previousSlug); });
      if (link) link.focus();
    }
  }

  function bindEvents() {
    el('search').addEventListener('input', function () { state.q = this.value; updateBoard(); });
    ['category', 'chain', 'sort'].forEach(function (key) {
      el(key).addEventListener('change', function () {
        state[key] = this.value;
        state.desc = state.sort !== 'rank';
        updateBoard();
      });
    });
    el('watch').addEventListener('click', function () {
      state.watch = !state.watch;
      syncControls();
      updateBoard();
    });
    el('reset').addEventListener('click', function () {
      state.q = state.category = state.chain = '';
      state.sort = 'rank';
      state.desc = state.watch = false;
      el('search').value = '';
      syncControls();
      updateBoard();
    });
    document.querySelectorAll('section button.back, .tab').forEach(function (button) {
      button.addEventListener('click', function () {
        location.hash = route(button.getAttribute('data-view') || 'board');
      });
    });
    window.addEventListener('hashchange', function () { renderRoute(true); });
  }

  function init() {
    renderMeta();
    renderStats();
    renderTop10();
    buildControls();
    bindEvents();
    renderRoute(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
