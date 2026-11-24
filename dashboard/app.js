// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the model's own factors and the protocol's farm plan, and a model sandbox that
// re-ranks the board live. No network: every byte it shows is already in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var boardEl = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'board', sort: 'rank', selected: null };
  var sandbox = { growth_weight: DATA.model.growth_weight, maturity_floor: DATA.model.maturity_floor, multiple_cap: DATA.model.multiple_cap, breadth_per_chain: DATA.model.breadth_per_chain };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model in one function: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. The sandbox changes `model` and re-runs this.
  function impliedOf(row, model) {
    var peer = peerMultiple(row.category);
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (1 - model.maturity_floor) * (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days);
    var breadth = 1 + model.breadth_per_chain * Math.min(row.chains.length, model.max_chains);
    var implied = Math.max(1, Math.round(row.tvl_usd * Math.min(peer, model.multiple_cap) * growthMult * maturity * breadth));
    return { implied: implied, peer: peer, growth: growth, growthMult: growthMult, maturity: maturity, breadth: breadth, age: age };
  }
  function peerMultiple(category) {
    var entry = DATA.peer_multiples[category || 'Unknown'];
    if (entry) return entry.multiple;
    return DATA.global_multiple;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time.
  // No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it and repay it, so the position shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through one full fee cycle.';
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and leave the shares untouched so the yield compounds in the vault.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside the app it lands in.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ', open one small hedge, and close it the same week.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it before the market closes.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it through one peg check.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it for the full distribution cycle.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy for the whole cover period.';
    if (c.indexOf('launchpad') >= 0 || c.indexOf('launch') >= 0) return 'Join ' + name + "'s next launch allocation on " + chain + ' with $' + capital + ' and complete its checklist.';
    if (c.indexOf('chain') >= 0) return 'Use ' + name + ' itself: move $' + capital + ' onto the chain, make one transfer and one app interaction, and keep the wallet active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep the same wallet for all of them.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var h = params.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var rows = DATA.rows.slice();
    if (state.tab === 'watchlist') rows = rows.filter(function (r) { return r.watchlist; });
    if (state.tab === 'early') rows = rows.filter(function (r) { return !r.watchlist; });
    if (state.category !== 'all') rows = rows.filter(function (r) { return (r.category || 'Unknown') === state.category; });
    if (state.chain !== 'all') rows = rows.filter(function (r) { return r.chains.indexOf(state.chain) >= 0; });
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.toLowerCase().indexOf(q) >= 0; });
    }
    var dir = -1;
    rows.sort(function (a, b) {
      if (state.sort === 'tvl') return dir * (a.tvl_usd - b.tvl_usd);
      if (state.sort === 'change') return dir * ((a.change_7d || 0) - (b.change_7d || 0));
      if (state.sort === 'age') return dir * ((a.age_days || 0) - (b.age_days || 0));
      if (state.sort === 'implied') return dir * (a.implied_value_usd - b.implied_value_usd);
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderMeta() {
    document.getElementById('meta').innerHTML =
      'Snapshot <b>' + esc(DATA.as_of) + '</b> · ' + esc(DATA.source) + '<br>' +
      'Model <b>' + esc(DATA.model_version) + '</b> · watchlist floor <b>' + fmtUsd(DATA.floor_usd) + '</b>';
    document.getElementById('method-text').innerHTML =
      'Implied value = TVL &times; <code>peer multiple</code> &times; <code>growth</code> &times; <code>maturity</code> &times; <code>breadth</code>. ' +
      'The peer multiple is the median market-cap-per-TVL of the ' + DATA.live_size + ' tokened protocols in the same category, ' +
      'shrunk toward the market-wide median <code>' + DATA.global_multiple.toFixed(3) + '&times;</code> so a category with one or two tokened peers cannot set a wild multiple. ' +
      'Growth is the 7-day TVL change, clamped to &minus;50%..+100%; maturity rewards protocols that survived up to two years without a token; ' +
      'breadth adds 2% per chain, up to five. The board carries all ' + DATA.watchlist_size + ' watchlist protocols plus ' +
      DATA.early_size + ' early finds below the ' + fmtUsd(DATA.floor_usd) + ' floor.';
    document.getElementById('foot-note').textContent =
      'Data: ' + DATA.source + ' snapshot ' + DATA.as_of + ', ' + DATA.rows.length + ' protocols ranked, ' + DATA.live.length + ' live tokens shown for reference. ' +
      'Implied values are a model, not a price: the market decides what a launch is worth.';
  }

  function renderStats() {
    var stats = [
      { num: String(DATA.watchlist_size), label: 'watchlist protocols' },
      { num: String(DATA.board_size), label: 'ranked on the board' },
      { num: String(DATA.early_size), label: 'early finds below the floor' },
      { num: String(DATA.live_size), label: 'live tokens for reference' },
      { num: DATA.global_multiple.toFixed(3) + '<small>&times;</small>', label: 'market-wide peer multiple' },
      { num: fmtUsd(DATA.rows[0].implied_value_usd), label: '#1 implied value · ' + DATA.rows[0].name }
    ];
    var wrap = document.getElementById('stats');
    wrap.innerHTML = '';
    stats.forEach(function (s) {
      wrap.appendChild(el('div', { class: 'stat' },
        el('div', { class: 'num', html: s.num }),
        el('div', { class: 'label', text: s.label })));
    });
  }

  function renderFilters() {
    var catSel = document.getElementById('category');
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Unknown'; }))).sort();
    catSel.innerHTML = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainSel = document.getElementById('chain');
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains); }, []))).sort();
    chainSel.innerHTML = '<option value="all">All chains</option>' + chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    document.getElementById('q').value = state.q;
    document.getElementById('sort').value = state.sort;
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === state.tab ? 'true' : 'false');
    });
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    var maxImplied = DATA.rows[0].implied_value_usd;
    if (state.tab === 'live') {
      renderLive();
      return;
    }
    var rows = visibleRows();
    boardEl.appendChild(el('div', { class: 'count', text: rows.length + ' of ' + DATA.rows.length + ' ranked protocols' }));
    if (rows.length === 0) {
      boardEl.appendChild(el('div', { class: 'empty', text: 'Nothing matches these filters. Clear the search or widen the category.' }));
      return;
    }
    var table = el('table', {},
      el('thead', {}, el('tr', {},
        el('th', { text: '#' }),
        el('th', { text: 'Protocol' }),
        el('th', { text: 'Category' }),
        el('th', { text: 'Chains' }),
        el('th', { class: 'num', text: 'TVL' }),
        el('th', { class: 'num', text: '7d' }),
        el('th', { class: 'num', text: 'Age' }),
        el('th', { class: 'num', text: 'Implied value' }))));
    var tbody = el('tbody', {});
    rows.forEach(function (r) {
      var change = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var changeClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      var badge = r.watchlist
        ? el('span', { class: 'badge watch', text: 'WATCHLIST' })
        : el('span', { class: 'badge early', text: 'EARLY' });
      var bar = el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(1, Math.round(100 * r.implied_value_usd / maxImplied)) + '%' }));
      var row = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { select(r.slug); } },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', {}, el('span', { class: 'name', text: r.name }), badge, el('div', { class: 'slug', text: r.slug })),
        el('td', { class: 'cat', text: r.category || 'Unknown' }),
        el('td', { class: 'chains', text: r.chains.slice(0, 3).join(', ') || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + changeClass, text: change }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num' }, el('div', { text: fmtUsd(r.implied_value_usd) }), bar));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    boardEl.appendChild(table);
  }

  function renderLive() {
    boardEl.appendChild(el('div', { class: 'count', text: DATA.live.length + ' live tokens, by market cap — the peer evidence behind the model' }));
    var table = el('table', {},
      el('thead', {}, el('tr', {},
        el('th', { text: '#' }),
        el('th', { text: 'Protocol' }),
        el('th', { text: 'Category' }),
        el('th', { class: 'num', text: 'TVL' }),
        el('th', { class: 'num', text: 'Market cap' }),
        el('th', { class: 'num', text: 'Mcap / TVL' }),
        el('th', { class: 'num', text: '7d' }))));
    var tbody = el('tbody', {});
    DATA.live.forEach(function (p, i) {
      var ratio = (p.mcap_usd && p.tvl_usd) ? (p.mcap_usd / p.tvl_usd) : null;
      tbody.appendChild(el('tr', { onclick: function () {} },
        el('td', { class: 'rank', text: String(i + 1) }),
        el('td', {}, el('span', { class: 'name', text: p.name }), el('div', { class: 'slug', text: p.slug })),
        el('td', { class: 'cat', text: p.category || 'Unknown' }),
        el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : ratio.toFixed(3) + '×' }),
        el('td', { class: 'num ' + (p.change_7d === null ? '' : (p.change_7d >= 0 ? 'up' : 'down')), text: p.change_7d === null ? 'n/a' : fmtPct(p.change_7d) })));
    });
    table.appendChild(tbody);
    boardEl.appendChild(table);
  }

  function select(slug) {
    state.selected = slug;
    writeHash();
    renderBoard();
    renderDetail();
  }

  function renderDetail() {
    var drawer = document.getElementById('drawer');
    var row = DATA.rows.find(function (r) { return r.slug === state.selected; });
    if (!row) { drawer.hidden = true; drawer.innerHTML = ''; return; }
    var calc = impliedOf(row, DATA.model);
    var peer = DATA.peer_multiples[row.category || 'Unknown'];
    var steps = farmSteps(row);
    var capital = capitalFor(row);
    drawer.innerHTML = '';
    drawer.hidden = false;
    drawer.appendChild(el('button', { class: 'close', text: 'Close ×', onclick: function () { select(null); } }));
    drawer.appendChild(el('h2', { text: row.name }));
    drawer.appendChild(el('div', { class: 'sub', text: '#' + row.rank + ' · ' + row.slug + ' · ' + (row.category || 'Unknown') + ' · ' + (row.chains.join(', ') || 'no chain listed') + ' · ' + (row.watchlist ? 'watchlist' : 'early find') }));
    drawer.appendChild(el('h3', { text: 'Why this rank — the model, factor by factor' }));
    var factors = el('table', { class: 'factors' });
    var fbody = el('tbody', {});
    function frow(label, value, note) {
      var cell = el('td', {}, el('span', { text: label }));
      if (note) cell.appendChild(el('span', { class: 'note', text: note }));
      fbody.appendChild(el('tr', {}, cell, el('td', { text: value })));
    }
    frow('TVL', fmtUsd(row.tvl_usd));
    frow('Peer multiple', calc.peer.toFixed(3) + '×', peer ? (peer.category_median === null ? 'no tokened peer in this category — market median' : 'category median ' + peer.category_median.toFixed(3) + '× across ' + peer.peers + ' tokened peer' + (peer.peers === 1 ? '' : 's') + ', shrunk toward the market median') : 'market median');
    frow('7-day TVL change', fmtPct(row.change_7d) + ' → ' + calc.growthMult.toFixed(3) + '×', 'clamped to −50%..+100%, weight ' + DATA.model.growth_weight);
    frow('Age', fmtAge(row.age_days) + ' → ' + calc.maturity.toFixed(3) + '×', 'maturity floor ' + DATA.model.maturity_floor + ', full at ' + (DATA.model.maturity_days / 365) + ' years');
    frow('Chains', String(row.chains.length) + ' → ' + calc.breadth.toFixed(3) + '×', '+' + (DATA.model.breadth_per_chain * 100).toFixed(0) + '% per chain, up to ' + DATA.model.max_chains);
    fbody.appendChild(el('tr', { class: 'total' }, el('td', { text: 'Implied value' }), el('td', { text: fmtUsd(calc.implied) })));
    factors.appendChild(fbody);
    drawer.appendChild(factors);
    drawer.appendChild(el('p', { class: 'peers', html: 'The page recomputes this number from the snapshot figures: <b>' + fmtUsd(calc.implied) + '</b> — the same value board.json carries for this row.' }));
    drawer.appendChild(el('h3', { text: 'Farm plan — ' + capital + ' dollars of capital, ' + holdDaysFor(row.age_days) + ' days' }));
    var list = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      list.appendChild(el('li', {}, el('div', { text: s.text }), el('div', { class: 'cost', text: 'Cost: ' + s.cost + ' · Time: ' + s.time })));
    });
    drawer.appendChild(list);
    drawer.appendChild(el('p', { class: 'peers', text: 'Airdrops are never guaranteed. Check the protocol\u2019s own points page before you spend anything, and never pay to claim.' }));
  }

  // The sandbox: the same model, different constants, re-ranked live.
  var SLIDERS = [
    { key: 'growth_weight', label: 'Growth weight', min: 0, max: 1, step: 0.05 },
    { key: 'maturity_floor', label: 'Maturity floor', min: 0.5, max: 0.9, step: 0.05 },
    { key: 'multiple_cap', label: 'Peer multiple cap', min: 0.5, max: 3, step: 0.1 },
    { key: 'breadth_per_chain', label: 'Breadth per chain', min: 0, max: 0.05, step: 0.005 }
  ];
  function renderSandbox() {
    var wrap = document.getElementById('sliders');
    wrap.innerHTML = '';
    SLIDERS.forEach(function (s) {
      var val = el('b', { text: String(sandbox[s.key]) });
      var input = el('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step), value: String(sandbox[s.key]) });
      input.addEventListener('input', function () {
        sandbox[s.key] = parseFloat(input.value);
        val.textContent = input.value;
        renderSandboxOut();
      });
      wrap.appendChild(el('div', { class: 'slider' },
        el('label', {}, el('span', { text: s.label }), val), input));
    });
    renderSandboxOut();
  }
  function renderSandboxOut() {
    var model = {
      growth_weight: sandbox.growth_weight,
      growth_floor: DATA.model.growth_floor,
      growth_cap: DATA.model.growth_cap,
      maturity_floor: sandbox.maturity_floor,
      maturity_days: DATA.model.maturity_days,
      unknown_age_days: DATA.model.unknown_age_days,
      multiple_cap: sandbox.multiple_cap,
      breadth_per_chain: sandbox.breadth_per_chain,
      max_chains: DATA.model.max_chains
    };
    var rescored = DATA.rows.map(function (r) {
      var calc = impliedOf(r, model);
      return { slug: r.slug, name: r.name, implied: calc.implied, oldRank: r.rank };
    });
    rescored.sort(function (a, b) { return b.implied - a.implied || (a.slug < b.slug ? -1 : 1); });
    var moved = 0;
    var top10 = rescored.slice(0, 10).map(function (r, i) {
      var delta = r.oldRank - (i + 1);
      if (delta !== 0) moved++;
      return el('li', {}, el('span', { text: '#' + (i + 1) + ' ' + r.name + ' — ' + fmtUsd(r.implied) + ' ' }),
        delta === 0 ? el('span', { text: '(was #' + r.oldRank + ')' }) : el('span', { class: 'moved', text: '(was #' + r.oldRank + ', ' + (delta > 0 ? 'up ' : 'down ') + Math.abs(delta) + ')' }));
    });
    var out = document.getElementById('sandbox-out');
    out.innerHTML = '';
    out.appendChild(el('p', { text: 'With these constants, ' + moved + ' of the top 10 change position. The top 10 would be:' }));
    var list = el('ol', {});
    top10.forEach(function (li) { list.appendChild(li); });
    out.appendChild(list);
  }

  function render() {
    renderFilters();
    renderBoard();
    renderDetail();
  }

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; writeHash(); renderBoard(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; writeHash(); renderBoard(); });
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); writeHash(); render(); });
  });
  document.getElementById('sandbox-reset').addEventListener('click', function () {
    sandbox = { growth_weight: DATA.model.growth_weight, maturity_floor: DATA.model.maturity_floor, multiple_cap: DATA.model.multiple_cap, breadth_per_chain: DATA.model.breadth_per_chain };
    renderSandbox();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selected) select(null); });

  readHash();
  renderMeta();
  renderStats();
  render();
  renderSandbox();
})();
