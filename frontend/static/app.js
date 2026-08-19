const $ = id => document.getElementById(id);

// ── Animated counter ──────────────────────────────────────────────────

function animateValue(el, targetVal, prefix = '$', duration = 900, colorize = false, fromVal = 0, formatter = null) {
  if (!el) return;
  const from = fromVal ?? 0;
  const range = targetVal - from;
  const start = performance.now();

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function tick(now) {
    if (el.dataset.scrubbing) return;
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const current = from + range * easeOut(progress);
    if (formatter) {
      el.innerHTML = formatter(current);
    } else {
      const isNeg = current < 0;
      const absCurr = Math.abs(current);
      const formatted = absCurr.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const useColor = colorize || prefix === '';
      const cls = useColor ? (targetVal >= 0 ? 'pos' : 'neg') : '';
      const signChar = isNeg ? '-' : (useColor ? '+' : '');
      el.innerHTML = cls
        ? `<span class="${cls}">${signChar}${prefix}${formatted}</span>`
        : `${prefix}${formatted}`;
    }
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Formatting helpers ────────────────────────────────────────────────

const _AVATAR_PALETTE = [
  '#2563eb','#7c3aed','#0891b2','#059669',
  '#d97706','#db2777','#65a30d','#dc2626',
  '#0ea5e9','#8b5cf6','#f59e0b','#10b981',
];
function _symColor(sym) {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return _AVATAR_PALETTE[h % _AVATAR_PALETTE.length];
}

// Returns avatar HTML: logo img (Parqet CDN) over colored letter fallback
function _symAvatar(sym, extraStyle = '') {
  const bg  = _symColor(sym);
  const url = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(sym)}?format=png`;
  const styleAttr = `background:${bg}${extraStyle ? ';' + extraStyle : ''}`;
  return `<div class="sym-avatar" style="${styleAttr}"><img class="sym-logo" src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">${sym.charAt(0)}</div>`;
}

function fmtDollar(val) {
  const n = parseFloat(val) || 0;
  const sign = n >= 0 ? '+' : '-';
  const cls = n >= 0 ? 'pos' : 'neg';
  return `<span class="${cls}">${sign}$${Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>`;
}

function fmtPct(val) {
  const n = parseFloat(val) || 0;
  const sign = n >= 0 ? '+' : '';
  const cls = n >= 0 ? 'pos' : 'neg';
  return `<span class="${cls}">${sign}${n.toFixed(2)}%</span>`;
}

function fmtCurrency(val) {
  return '$' + (parseFloat(val) || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

// ── Stat card $ / % toggle ────────────────────────────────────────────

function toggleStatCard(card) {
  const valEl = card.querySelector('.value');
  if (!valEl || !card.dataset.dollarHtml) return;
  const nextMode = (card.dataset.mode || 'dollar') === 'dollar' ? 'pct' : 'dollar';
  card.dataset.mode = nextMode;
  valEl.style.transition = 'opacity .1s';
  valEl.style.opacity = '0';
  setTimeout(() => {
    valEl.innerHTML = nextMode === 'pct' ? card.dataset.pctHtml : card.dataset.dollarHtml;
    valEl.style.opacity = '1';
  }, 100);
}

// ── Market status ─────────────────────────────────────────────────────

function updateMarketStatus() {
  const el = $('market-status');
  if (!el) return;
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', {timeZone: 'America/New_York'}));
  const day = et.getDay();
  const h = et.getHours(), m = et.getMinutes(), s = et.getSeconds();
  const totalSecs = h * 3600 + m * 60 + s;
  const OPEN  = 9 * 3600 + 30 * 60;   // 9:30 AM ET
  const CLOSE = 16 * 3600;             // 4:00 PM ET
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && totalSecs >= OPEN && totalSecs < CLOSE;

  const fmtCd = n => {
    const hrs = Math.floor(n / 3600);
    const mins = Math.floor((n % 3600) / 60);
    const secs = n % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return hrs > 0 ? `${hrs}h ${mm}:${ss}` : `${mins}:${ss}`;
  };

  let cdSecs = 0;
  if (isOpen) {
    cdSecs = CLOSE - totalSecs;
  } else if (isWeekday && totalSecs < OPEN) {
    cdSecs = OPEN - totalSecs;
  } else {
    const daysAhead = day === 5 ? 3 : day === 6 ? 2 : 1;
    cdSecs = (86400 - totalSecs) + (daysAhead - 1) * 86400 + OPEN;
  }

  const newClass = 'market-status ' + (isOpen ? 'open' : 'closed');
  if (el.className !== newClass) el.className = newClass;
  const cdEl = el.querySelector('.mkt-cd');
  if (cdEl) {
    cdEl.textContent = `· ${fmtCd(cdSecs)}`;
  } else {
    el.innerHTML = `<span class="market-dot"></span>${isOpen ? 'Open' : 'Closed'}<span class="mkt-cd">· ${fmtCd(cdSecs)}</span>`;
  }
}

// ── Portfolio ─────────────────────────────────────────────────────────

const _prevPrices = {};
let _livePortfolioValue = null;
let _liveDayPnl = null;
let _athCelebrated = false;
let _stickySparkValues = [];
let _lastRefreshTs = null;
let _liveRowTimer  = null;

function _tickLiveRow() {
  const row     = document.getElementById('hero-live-row');
  const dot     = document.getElementById('hero-live-dot');
  const textEl  = document.getElementById('hero-live-text');
  if (!row || !textEl) return;

  const mktEl = document.getElementById('market-status');
  const isOpen = mktEl?.classList.contains('open');

  if (dot) {
    dot.className = 'hero-live-dot' + (isOpen ? ' live' : '');
  }

  if (!_lastRefreshTs) { row.style.display = 'none'; return; }
  row.style.display = 'flex';

  const sec = Math.floor((Date.now() - _lastRefreshTs) / 1000);
  let age;
  if (sec < 5)        age = 'just now';
  else if (sec < 60)  age = `${sec}s ago`;
  else if (sec < 120) age = '1m ago';
  else                age = `${Math.floor(sec / 60)}m ago`;

  const staleClass = sec > 90 ? ' stale' : sec > 45 ? ' aging' : '';
  textEl.innerHTML = `${isOpen ? '<span class="live-label">Live</span>' : 'Closed'} · <span class="age-label${staleClass}">Updated ${age}</span>`;
}

function _startLiveRow() {
  _lastRefreshTs = Date.now();
  if (_liveRowTimer) clearInterval(_liveRowTimer);
  _liveRowTimer = setInterval(_tickLiveRow, 5000);
  _tickLiveRow(); // immediate first tick
}

function _fireATHConfetti() {
  if (_athCelebrated) return;
  _athCelebrated = true;
  const W = window.innerWidth, H = window.innerHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const COLORS = ['#16a34a','#22c55e','#4ade80','#ffffff','#fbbf24','#34d399','#86efac'];
  const particles = Array.from({length: 90}, () => ({
    x: W * (.25 + Math.random() * .5),
    y: H * .22,
    vx: (Math.random() - .5) * 10,
    vy: -(5 + Math.random() * 9),
    r: 4 + Math.random() * 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rot: Math.random() * Math.PI * 2,
    rotV: (Math.random() - .5) * .18,
    rect: Math.random() > .45,
  }));
  let raf;
  function tick() {
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += .22; p.vx *= .98; p.rot += p.rotV;
      if (p.y < H + 30) alive++;
      const alpha = Math.max(0, 1 - Math.max(0, p.y - H * .6) / (H * .5));
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.rect) { ctx.fillRect(-p.r, -p.r * .4, p.r * 2, p.r * .75); }
      else { ctx.beginPath(); ctx.arc(0, 0, p.r * .55, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (alive > 0) { raf = requestAnimationFrame(tick); }
    else { canvas.remove(); }
  }
  raf = requestAnimationFrame(tick);
  setTimeout(() => { cancelAnimationFrame(raf); canvas.remove(); }, 5000);
}
let _portfolioLoaded = false;
let _prevStatCash = null;
let _prevStatInvested = null;
let _prevStatDayPnl = null;
let _prevStatReturn = null;
let _sortKey = null;
let _sortDir = -1;
let _posView = 'table';
let _posFilter = 'all';
const _rangeReturns = {};

function _applyAllTabReturns() {
  document.querySelectorAll('.range-tab[data-label]').forEach(tab => {
    const m = (tab.getAttribute('onclick') || '').match(/setChartRange\((\d+)/);
    if (!m) return;
    const pct = _rangeReturns[parseInt(m[1])];
    if (pct == null) return;
    const cls = pct >= 0 ? 'pos' : 'neg';
    const sign = pct >= 0 ? '+' : '';
    tab.innerHTML = `${tab.dataset.label}<span class="tab-pct ${cls}">${sign}${pct.toFixed(1)}%</span>`;
  });
}

function _ytdTradingDays() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const calDays = Math.floor((now - jan1) / 86400000);
  return Math.max(1, Math.ceil(calDays * 252 / 365) + 5); // +5 session buffer
}

function setChartRangeYTD(btn) {
  const limit = _ytdTradingDays();
  setChartRange(limit, btn);
  // Ensure the tab still reads "YTD" after setChartRange re-applies labels
  btn.textContent = 'YTD';
  const pct = _rangeReturns['ytd'];
  if (pct != null) {
    const cls = pct >= 0 ? 'pos' : 'neg';
    const sign = pct >= 0 ? '+' : '';
    btn.innerHTML = `YTD<span class="tab-pct ${cls}">${sign}${pct.toFixed(1)}%</span>`;
  }
}

async function _preloadRangeReturns() {
  try {
    const snaps = await fetch('/api/snapshots?limit=500').then(r => r.json());
    if (snaps.length < 2) return;
    const sorted = [...snaps].reverse();
    for (const limit of [7, 30, 65, 200]) {
      const slice = sorted.slice(-Math.min(limit, sorted.length));
      if (slice.length < 2) continue;
      const start = slice[0].total_value, end = slice[slice.length - 1].total_value;
      _rangeReturns[limit] = start ? (end - start) / start * 100 : 0;
    }
    // YTD return: filter snapshots from Jan 1 of current year
    const jan1 = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const ytdSnaps = sorted.filter(s => s.snapshot_date >= jan1);
    if (ytdSnaps.length >= 2) {
      const s = ytdSnaps[0].total_value, e = ytdSnaps[ytdSnaps.length - 1].total_value;
      _rangeReturns['ytd'] = s ? (e - s) / s * 100 : 0;
    }
    _applyAllTabReturns();
    // Apply YTD return label to the YTD tab
    const ytdBtn = document.querySelector('.range-tab[data-label="YTD"]');
    if (ytdBtn && _rangeReturns['ytd'] != null) {
      const pct = _rangeReturns['ytd'];
      const cls = pct >= 0 ? 'pos' : 'neg';
      const sign = pct >= 0 ? '+' : '';
      ytdBtn.innerHTML = `YTD<span class="tab-pct ${cls}">${sign}${pct.toFixed(1)}%</span>`;
    }
  } catch(e) { /* non-critical */ }
}
let _lastSparklines = {};
let _watchlistSymbols = new Set();

function _flashChangedPrices(positions) {
  requestAnimationFrame(() => {
    positions.forEach(p => {
      const sym  = p.symbol;
      const curr = parseFloat(p.current_price);
      const prev = _prevPrices[sym];
      _prevPrices[sym] = curr;
      if (prev === undefined || prev === curr) return;
      const row = document.querySelector(`#positions-body tr[data-symbol="${sym}"]`);
      if (!row) return;
      const cell = [...row.querySelectorAll('td')].find(td => td.dataset.label === 'Current');
      if (!cell) return;
      const cls = curr > prev ? 'flash-green' : 'flash-red';
      cell.classList.remove('flash-green', 'flash-red');
      void cell.offsetWidth; // force reflow so re-adds actually retrigger
      cell.classList.add(cls);
      cell.addEventListener('animationend', () => cell.classList.remove(cls), { once: true });
    });
  });
}

function _renderTodayImpact(positions) {
  const container = document.getElementById('today-impact');
  if (!container) return;

  const impacts = positions.map(p => {
    const chgFrac = parseFloat(p.change_today) || 0;
    const mv = parseFloat(p.market_value) || 0;
    const dayDollar = mv && chgFrac ? mv * chgFrac / (1 + chgFrac) : 0;
    return { symbol: p.symbol, dayDollar };
  }).filter(x => x.dayDollar !== 0);

  if (!impacts.length) { container.style.display = 'none'; return; }

  const gainers = impacts.filter(x => x.dayDollar > 0).sort((a, b) => b.dayDollar - a.dayDollar);
  const losers  = impacts.filter(x => x.dayDollar < 0).sort((a, b) => a.dayDollar - b.dayDollar);
  const sorted  = [...gainers, ...losers];

  const total  = impacts.reduce((s, x) => s + x.dayDollar, 0);
  const maxAbs = Math.max(...impacts.map(x => Math.abs(x.dayDollar)));

  const fmtImpact = v => {
    const sign = v >= 0 ? '+' : '-';
    const abs  = Math.abs(v);
    return `${sign}$${abs < 100 ? abs.toFixed(2) : abs.toFixed(0)}`;
  };

  container.style.display = '';
  container.innerHTML = `
    <div class="ti-header">
      <span class="ti-title">Today's Impact</span>
      <span class="ti-total ${total >= 0 ? 'pos' : 'neg'}">${fmtImpact(total)}</span>
    </div>
    <div class="ti-rows">
      ${sorted.map(x => {
        const cls = x.dayDollar >= 0 ? 'pos' : 'neg';
        const w   = (Math.abs(x.dayDollar) / maxAbs * 50).toFixed(1);
        return `<div class="ti-row">
          <span class="ti-sym">${x.symbol}</span>
          <div class="ti-bar-wrap">
            <div class="ti-bar ${cls}" style="width:0%" data-w="${w}"></div>
          </div>
          <span class="ti-val ${cls}">${fmtImpact(x.dayDollar)}</span>
        </div>`;
      }).join('')}
    </div>`;

  requestAnimationFrame(() => {
    container.querySelectorAll('.ti-bar[data-w]').forEach((bar, i) => {
      setTimeout(() => {
        bar.style.transition = 'width .5s cubic-bezier(.4,0,.2,1)';
        bar.style.width = bar.dataset.w + '%';
      }, i * 50);
    });
  });
}

function _renderAllocStrip(positions) {
  const strip = document.getElementById('alloc-strip');
  if (!strip) return;
  const total = positions.reduce((s, p) => s + (parseFloat(p.market_value) || 0), 0);
  if (!total || !positions.length) { strip.style.display = 'none'; return; }
  strip.style.display = 'flex';
  strip.innerHTML = positions.map((p, i) => {
    const pct = parseFloat(p.market_value) / total * 100;
    const color = _symColor(p.symbol);
    const pnlPct = parseFloat(p.unrealized_pnl_pct) || 0;
    const dayChg = parseFloat(p.change_today) || 0;
    const isBorderLeft = i > 0 ? 'border-left:1px solid var(--bg)' : '';
    return `<div class="alloc-seg" style="flex:${pct.toFixed(3)};background:${color};${isBorderLeft}"
      title="${p.symbol}: ${pct.toFixed(1)}% allocation · ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% total · ${dayChg >= 0 ? '+' : ''}${(dayChg * 100).toFixed(2)}% today"
      onclick="openDrawer('${p.symbol}', window._latestPositions.find(x=>x.symbol==='${p.symbol}'))">
      ${pct >= 8 ? `<span class="alloc-seg-label">${p.symbol}</span>` : ''}
    </div>`;
  }).join('');
}

// ── Position filter ───────────────────────────────────────────────────

function _filteredPositions() {
  const all = window._latestPositions || [];
  if (_posFilter === 'gainers') return all.filter(p => parseFloat(p.change_today) > 0);
  if (_posFilter === 'losers')  return all.filter(p => parseFloat(p.change_today) < 0);
  return all;
}

function _updateFilterBar() {
  const all  = window._latestPositions || [];
  const bar  = $('pos-filter-bar');
  if (!bar || !all.length) { if (bar) bar.style.display = 'none'; return; }
  const gainerCount = all.filter(p => parseFloat(p.change_today) > 0).length;
  const loserCount  = all.filter(p => parseFloat(p.change_today) < 0).length;
  if (!gainerCount && !loserCount) { bar.style.display = 'none'; _posFilter = 'all'; return; }
  // Reset stale filter if its bucket is now empty
  if (_posFilter === 'gainers' && !gainerCount) _posFilter = 'all';
  if (_posFilter === 'losers'  && !loserCount)  _posFilter = 'all';
  // Sync active chip to match current filter state
  document.querySelectorAll('.pos-filter-chip').forEach(b => b.classList.remove('active'));
  const activeId = { all: 'pf-all', gainers: 'pf-gainers', losers: 'pf-losers' }[_posFilter];
  const activeBtn = $(activeId);
  if (activeBtn) activeBtn.classList.add('active');
  bar.style.display = '';
  const gBtn = $('pf-gainers'), lBtn = $('pf-losers');
  if (gBtn) gBtn.textContent = gainerCount ? `Gainers (${gainerCount})` : 'Gainers';
  if (lBtn) lBtn.textContent = loserCount  ? `Losers (${loserCount})`  : 'Losers';
}

function setPosFilter(filter, btn) {
  _posFilter = filter;
  document.querySelectorAll('.pos-filter-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const filtered = _filteredPositions();
  if (_posView === 'map') {
    _renderPositionMap(filtered);
  } else {
    _renderPositionsRows(filtered);
    _updateSortHeaders();
    _injectSectorBadges();
    _updateNoteIndicators();
  }
}

// ── Position heat map view ────────────────────────────────────────────

function setPosView(view, btn) {
  _posView = view;
  document.querySelectorAll('.pos-view-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const table = $('positions-table');
  const map   = $('pos-map');
  if (view === 'map') {
    if (table) table.style.display = 'none';
    if (map) { map.style.display = ''; _renderPositionMap(_filteredPositions()); }
  } else {
    if (table) table.style.display = '';
    if (map) map.style.display = 'none';
    _renderPositionsRows(_filteredPositions());
    _updateSortHeaders();
  }
}

function _renderPositionMap(positions) {
  const container = $('pos-map');
  if (!container) return;
  if (!positions.length) { container.innerHTML = ''; return; }

  const total = positions.reduce((s, p) => s + (parseFloat(p.market_value) || 0), 0);
  if (!total) return;

  // Sort by market value descending for layout
  const sorted = [...positions].sort((a, b) =>
    (parseFloat(b.market_value) || 0) - (parseFloat(a.market_value) || 0));

  // Split into two rows: top until cumulative weight > 60%, or max 4, remainder in bottom
  let cumW = 0, splitIdx = sorted.length;
  for (let i = 0; i < sorted.length; i++) {
    cumW += (parseFloat(sorted[i].market_value) || 0) / total;
    if ((cumW >= 0.6 && i >= 1) || i === 3) { splitIdx = i + 1; break; }
  }
  const rows = splitIdx < sorted.length
    ? [sorted.slice(0, splitIdx), sorted.slice(splitIdx)]
    : [sorted];

  const buildCell = (p, rowTotal, showDetail) => {
    const mv    = parseFloat(p.market_value) || 0;
    const chg   = parseFloat(p.change_today) || 0;
    const pnlPct = parseFloat(p.unrealized_pnl_pct) || 0;
    const weight = rowTotal > 0 ? mv / rowTotal : 1 / rows[0].length;
    const isUp   = chg >= 0;
    const mag    = Math.min(Math.abs(chg) / 0.05, 1);
    const alpha  = (0.12 + mag * 0.55).toFixed(2);
    const bg     = isUp ? `rgba(22,163,74,${alpha})` : `rgba(220,38,38,${alpha})`;
    const cls    = isUp ? 'pos' : 'neg';
    const sign   = chg >= 0 ? '+' : '';
    const pSign  = pnlPct >= 0 ? '+' : '';
    const pCls   = pnlPct >= 0 ? 'pos' : 'neg';
    const flexV  = (weight * 100).toFixed(2);
    return `<div class="pos-map-cell" style="flex:${flexV};background:${bg}"
      onclick="openDrawer('${p.symbol}',window._latestPositions.find(x=>x.symbol==='${p.symbol}'))"
      title="${p.symbol} · ${sign}${(chg*100).toFixed(2)}% today · ${pSign}${pnlPct.toFixed(1)}% total P&L">
      <div class="pos-map-sym">
        <div class="pos-map-avatar" style="background:${_symColor(p.symbol)}">
          <img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(p.symbol)}?format=png" alt="" loading="lazy" onerror="this.style.display='none'">
          ${p.symbol.charAt(0)}
        </div>
        <span class="pos-map-ticker">${p.symbol}</span>
      </div>
      <div class="pos-map-chg ${cls}">${sign}${(chg * 100).toFixed(2)}%</div>
      ${showDetail ? `<div class="pos-map-sub ${pCls}">${pSign}${pnlPct.toFixed(1)}%</div>` : ''}
    </div>`;
  };

  container.innerHTML = rows.map((row, ri) => {
    const rowTotal = row.reduce((s, p) => s + (parseFloat(p.market_value) || 0), 0);
    const showDetail = ri === 0 && splitIdx <= 4;
    return `<div class="pos-map-row">${row.map(p => buildCell(p, rowTotal, showDetail)).join('')}</div>`;
  }).join('');
}

function _renderPositionsRows(positions, skipEntrance = false) {
  const tbody = $('positions-body');
  const sorted = _sortedPositions(positions);
  // Compute totals for tfoot
  const totalCost  = sorted.reduce((s, p) => s + (parseFloat(p.avg_entry_price) * parseFloat(p.qty) || 0), 0);
  const totalValue = sorted.reduce((s, p) => s + (parseFloat(p.market_value) || 0), 0);
  const totalPnl   = sorted.reduce((s, p) => s + (parseFloat(p.unrealized_pnl) || 0), 0);
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;
  const totalDayDollar = sorted.reduce((s, p) => {
    const mv = parseFloat(p.market_value) || 0;
    const chg = parseFloat(p.change_today) || 0;
    return s + (mv && chg ? mv * chg / (1 + chg) : 0);
  }, 0);
  const maxAbsPnl  = Math.max(...sorted.map(p => Math.abs(parseFloat(p.unrealized_pnl) || 0)), 1);
  const tfootEl = document.querySelector('#positions-table tfoot');
  if (tfootEl && sorted.length > 1) {
    const tc = totalPnl >= 0 ? 'pos' : 'neg';
    const ts = totalPnl >= 0 ? '+' : '-';
    const dc = totalDayDollar >= 0 ? 'pos' : 'neg';
    const ds = totalDayDollar >= 0 ? '+' : '-';
    tfootEl.innerHTML = `<tr class="positions-totals">
      <td class="totals-label">Total</td>
      <td class="right hide-mobile"></td>
      <td class="right hide-mobile totals-cost">$${totalCost.toFixed(2)}</td>
      <td class="right hide-mobile"></td>
      <td class="right hide-mobile ${dc}">${totalDayDollar !== 0 ? `${ds}$${Math.abs(totalDayDollar).toFixed(2)}` : '—'}</td>
      <td class="right hide-mobile"></td>
      <td class="right totals-value">${fmtCurrency(totalValue)}</td>
      <td class="right"><div class="pnl-cell">
        <span class="${tc}">${ts}$${Math.abs(totalPnl).toFixed(2)}</span>
        <span class="${tc} pct">${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%</span>
      </div></td>
    </tr>`;
    tfootEl.style.display = '';
  } else if (tfootEl) {
    tfootEl.style.display = 'none';
  }

  tbody.innerHTML = sorted.map((p, idx) => {
    const pnlDollar = parseFloat(p.unrealized_pnl) || 0;
    const pnlPct = parseFloat(p.unrealized_pnl_pct) || 0;
    const cls = pnlDollar >= 0 ? 'pos' : 'neg';
    const sign = pnlDollar >= 0 ? '+' : '-';
    const _dayChgFrac = parseFloat(p.change_today) || 0;
    const _mv = parseFloat(p.market_value) || 0;
    const dayDollar = _mv && _dayChgFrac ? _mv * _dayChgFrac / (1 + _dayChgFrac) : 0;
    const dayDir = (() => { const c = parseFloat(p.change_today) || 0; return c > 0 ? 'up' : c < 0 ? 'down' : ''; })();
    const rowDelay = 40 + idx * 45;
    const rowPnlAlpha = Math.min(Math.abs(pnlPct) / 20, 1).toFixed(3);
    return `
      <tr
        data-symbol="${p.symbol}"
        class="${pnlDollar >= 0 ? 'row-pos' : 'row-neg'}"
        ${dayDir ? `data-day="${dayDir}"` : ''}
        onmouseenter="showPositionTooltip(event,'${p.symbol}')"
        onmouseleave="hidePositionTooltip()"
        onmousemove="movePositionTooltip(event)"
        onclick="openDrawer('${p.symbol}', window._latestPositions.find(x=>x.symbol==='${p.symbol}'))"
        style="cursor:pointer;${skipEntrance ? '' : `animation:rowIn .25s ease ${rowDelay}ms both;`}--row-pnl:${rowPnlAlpha}">
        <td data-label="Symbol" data-sym="${p.symbol}">
          <div class="sym-cell">
            ${_symAvatar(p.symbol)}
            <div class="sym-text">
              <span class="sym-ticker">${p.symbol}</span>
              <span class="symbol-name"></span>
              <span class="pos-age-label" data-sym="${p.symbol}"></span>
              <span class="sym-sector-badge" data-sym="${p.symbol}" style="display:none"></span>
            </div>
          </div>
        </td>
        <td class="right hide-mobile" data-label="Shares">${parseFloat(p.qty).toFixed(4)}</td>
        <td class="right hide-mobile" data-label="Avg Cost">$${parseFloat(p.avg_entry_price).toFixed(2)}</td>
        <td class="right" data-label="Current">
          <div class="price-cell">
            <span>$${parseFloat(p.current_price).toFixed(2)}</span>
            ${(() => {
              const chg = parseFloat(p.change_today) || 0;
              if (chg === 0) return '';
              const c  = chg >= 0 ? 'pos' : 'neg';
              const s = chg >= 0 ? '▲' : '▼';
              return `<span class="day-chg ${c}">${s} ${Math.abs(chg * 100).toFixed(2)}%</span>`;
            })()}
          </div>
        </td>
        <td class="right hide-mobile today-col" data-label="Today">
          ${(() => {
            const chg = _dayChgFrac;
            if (chg === 0) return '<span style="color:var(--muted)">—</span>';
            const dollarImpact = _mv * chg / (1 + chg);
            const c = chg >= 0 ? 'pos' : 'neg';
            const ps = chg >= 0 ? '+' : '';
            const ds = dollarImpact >= 0 ? '+' : '-';
            return `<div class="today-col-inner">
              <span class="${c} today-pct">${ps}${(chg * 100).toFixed(2)}%</span>
              <span class="${c} today-dollar">${ds}$${Math.abs(dollarImpact).toFixed(2)}</span>
            </div>`;
          })()}
        </td>
        <td class="right hide-mobile td-spark" data-spark="${p.symbol}"></td>
        <td class="right" data-label="Value">
          ${fmtCurrency(p.market_value)}
          ${totalValue > 0 ? `<div class="pos-alloc-bar-wrap"><div class="pos-alloc-bar" data-w="${Math.min(100, parseFloat(p.market_value) / totalValue * 100).toFixed(1)}" style="width:0%;background:${_symColor(p.symbol)}"></div></div>` : ''}
        </td>
        <td class="right" data-label="P&amp;L">
          <div class="pnl-cell" data-pnl-w="${(Math.abs(pnlDollar) / maxAbsPnl * 100).toFixed(1)}" style="--pnl-bar:0%;--pnl-color:${pnlDollar >= 0 ? '22,163,74' : '220,38,38'}">
            <span class="${cls}">${sign}$${Math.abs(pnlDollar).toFixed(2)}</span>
            <span class="${cls} pct">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</span>
            ${dayDollar !== 0 ? `<span class="pos-day-pnl ${dayDollar >= 0 ? 'pos' : 'neg'}">${dayDollar >= 0 ? '+' : '-'}$${Math.abs(dayDollar).toFixed(2)} today</span>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
  _flashChangedPrices(sorted);
  _renderTodayImpact(sorted);
  _renderAllocStrip(sorted);

  // Animate alloc bars + pnl-cell gradient in after their row's entrance delay
  requestAnimationFrame(() => {
    sorted.forEach((p, idx) => {
      const delay = 90 + idx * 45; // matches rowIn delay + small buffer
      const bar = tbody.querySelector(`tr[data-symbol="${p.symbol}"] .pos-alloc-bar[data-w]`);
      if (bar) setTimeout(() => { bar.style.width = bar.dataset.w + '%'; }, delay);
      const pnlCell = tbody.querySelector(`tr[data-symbol="${p.symbol}"] .pnl-cell[data-pnl-w]`);
      if (pnlCell) setTimeout(() => { pnlCell.style.setProperty('--pnl-bar', pnlCell.dataset.pnlW + '%'); }, delay + 20);
    });
  });
}

function _sortedPositions(positions) {
  if (!_sortKey) return positions;
  return [...positions].sort((a, b) => {
    if (_sortKey === 'symbol') return _sortDir * a.symbol.localeCompare(b.symbol);
    const map = {
      shares: [parseFloat(a.qty),              parseFloat(b.qty)],
      cost:   [parseFloat(a.avg_entry_price),  parseFloat(b.avg_entry_price)],
      price:  [parseFloat(a.current_price),    parseFloat(b.current_price)],
      today:  [parseFloat(a.change_today),     parseFloat(b.change_today)],
      value:  [parseFloat(a.market_value),     parseFloat(b.market_value)],
      pnl:    [parseFloat(a.unrealized_pnl),   parseFloat(b.unrealized_pnl)],
    };
    const [av, bv] = map[_sortKey] || [0, 0];
    return _sortDir * (av - bv);
  });
}

function _updateSortHeaders() {
  document.querySelectorAll('#positions-table th[data-sortkey]').forEach(th => {
    th.classList.toggle('sort-asc',  _sortKey === th.dataset.sortkey && _sortDir ===  1);
    th.classList.toggle('sort-desc', _sortKey === th.dataset.sortkey && _sortDir === -1);
  });
}

function sortPositions(key) {
  if (_sortKey === key) {
    _sortDir = -_sortDir;
  } else {
    _sortKey = key;
    _sortDir = key === 'symbol' ? 1 : -1;
  }
  if (_posView === 'map') { _renderPositionMap(_filteredPositions()); return; }

  // FLIP — First: snapshot Y of each row before re-render
  const tbody = $('positions-body');
  const oldTops = {};
  tbody.querySelectorAll('tr[data-symbol]').forEach(r => {
    oldTops[r.dataset.symbol] = r.getBoundingClientRect().top;
  });

  // Last: render new order without entrance animation
  _renderPositionsRows(_filteredPositions(), true);

  // Invert + Play: push each row back to its old Y, then animate to 0
  const newRows = [...tbody.querySelectorAll('tr[data-symbol]')];
  if (Object.keys(oldTops).length) {
    newRows.forEach(row => {
      const delta = (oldTops[row.dataset.symbol] ?? null);
      if (delta == null) return;
      const shift = delta - row.getBoundingClientRect().top;
      if (Math.abs(shift) < 1) return;
      row.style.transform = `translateY(${shift}px)`;
      row.style.transition = 'none';
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      newRows.forEach(row => {
        if (!row.style.transform) return;
        row.style.transition = 'transform .32s cubic-bezier(.4,0,.2,1)';
        row.style.transform = '';
        row.addEventListener('transitionend', () => { row.style.transition = ''; }, { once: true });
      });
    }));
  }

  const syms = (window._latestPositions || []).map(p => p.symbol);
  if (syms.length) _injectCompanyNames(syms);
  _updateSortHeaders();
}

async function loadPortfolio() {
  try {
    const data = await fetch('/api/portfolio').then(r => r.json());
    const dayPnl = (data.portfolio_value || 0) - (data.last_equity || data.portfolio_value || 0);
    const invested = (data.portfolio_value || 0) - (data.cash || 0);

    const prevPortfolio = _livePortfolioValue;
    _livePortfolioValue = parseFloat(data.portfolio_value) || null;
    _liveDayPnl = dayPnl;
    _updateStickyBar();
    _updatePageTitle();
    _startLiveRow();

    const _heroSection = document.querySelector('.hero-chart-section');
    if (_heroSection) {
      _heroSection.classList.remove('day-up', 'day-down');
      if (dayPnl > 0) _heroSection.classList.add('day-up');
      else if (dayPnl < 0) _heroSection.classList.add('day-down');
    }

    // First load: count up from 0. Subsequent refreshes: tick from previous value.
    const isFirstLoad = !_portfolioLoaded;
    const heroDur   = isFirstLoad ? 1000 : 350;
    const heroFrom  = isFirstLoad ? 0 : (prevPortfolio ?? 0);
    animateValue($('stat-value'), data.portfolio_value, '$', heroDur, false, heroFrom, _fmtHeroValue);

    // Flash the hero text color on live refresh when value changed (skip if chart is being scrubbed)
    if (!isFirstLoad && prevPortfolio != null && _livePortfolioValue !== prevPortfolio) {
      const heroEl = $('stat-value');
      if (heroEl && !heroEl.dataset.scrubbing) {
        const cls = _livePortfolioValue > prevPortfolio ? 'flash-text-green' : 'flash-text-red';
        heroEl.classList.remove('flash-text-green', 'flash-text-red');
        void heroEl.offsetWidth;
        heroEl.classList.add(cls);
        heroEl.addEventListener('animationend', () => heroEl.classList.remove(cls), { once: true });
      }
    }

    const statSubEl = $('stat-value-sub');
    if (statSubEl) {
      let liveSubText;
      if (dayPnl !== 0 && data.last_equity) {
        const dayPct = data.portfolio_value ? (dayPnl / data.portfolio_value * 100) : 0;
        const arrow = dayPnl >= 0 ? '▲' : '▼';
        const cls   = dayPnl >= 0 ? 'pos' : 'neg';
        const sign  = dayPnl >= 0 ? '+' : '';
        liveSubText = `<span class="${cls}">${arrow} ${sign}$${Math.abs(dayPnl).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${sign}${dayPct.toFixed(2)}%) today</span>`;
      } else {
        liveSubText = `${fmtCurrencyRaw(invested)} invested`;
      }
      statSubEl.innerHTML = liveSubText;
      statSubEl.dataset.liveText = statSubEl.textContent; // plain text for restore
      statSubEl.dataset.liveHtml = liveSubText;           // HTML for restore
    }

    // Update browser tab with live portfolio value + direction arrow
    if (data.portfolio_value) {
      const v = parseFloat(data.portfolio_value);
      const fmtTitle = v >= 1e6
        ? `$${(v / 1e6).toFixed(2)}M`
        : `$${v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      const arrow = dayPnl >= 0 ? '▲' : '▼';
      document.title = `${arrow} ${fmtTitle} · Portfolio`;
    }

    const cashDur     = isFirstLoad ? 900 : 300;
    const investedDur = isFirstLoad ? 950 : 300;
    const dayDur      = isFirstLoad ? 900 : 300;
    animateValue($('stat-cash'), data.cash, '$', cashDur, false, isFirstLoad ? 0 : (_prevStatCash ?? 0));
    const cashPct = data.portfolio_value ? ((data.cash / data.portfolio_value) * 100).toFixed(0) : 0;
    $('stat-cash-sub').textContent = `${cashPct}% of portfolio`;
    _prevStatCash = parseFloat(data.cash) || 0;

    animateValue($('stat-invested'), invested, '$', investedDur, false, isFirstLoad ? 0 : (_prevStatInvested ?? 0));
    const posCnt = (data.positions || []).length;
    $('stat-invested-sub').textContent = `across ${posCnt} position${posCnt !== 1 ? 's' : ''}`;
    _prevStatInvested = invested;

    animateValue($('stat-day'), dayPnl, '$', dayDur, true, isFirstLoad ? 0 : (_prevStatDayPnl ?? 0));
    const dayCard = $('stat-day-card');
    if (dayCard) {
      dayCard.className = 'stat stat-tappable ' + (dayPnl >= 0 ? 'pos-stat' : 'neg-stat');
      const _dc = dayPnl >= 0 ? 'pos' : 'neg';
      const _ds = dayPnl >= 0 ? '+' : '-';
      const _df = Math.abs(dayPnl).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      const _dpct = data.portfolio_value ? (dayPnl / data.portfolio_value * 100) : 0;
      dayCard.dataset.dollarHtml = `<span class="${_dc}">${_ds}$${_df}</span>`;
      dayCard.dataset.pctHtml    = `<span class="${_dc}">${dayPnl >= 0 ? '+' : ''}${Math.abs(_dpct).toFixed(2)}%</span>`;
      dayCard.dataset.mode = 'dollar';
      dayCard.onclick = function() { toggleStatCard(this); };
      dayCard.title   = 'Tap to toggle $ / %';
    }
    $('stat-day-sub').textContent = 'vs. yesterday close';
    _prevStatDayPnl = dayPnl;

    _portfolioLoaded = true;

    renderAllocation(data);

    // Positions table
    const tbody = $('positions-body');
    const positions = data.positions || [];
    const _countEl = $('positions-count');
    if (_countEl) {
      const _gUp = positions.filter(p => parseFloat(p.change_today) > 0).length;
      const _gDn = positions.filter(p => parseFloat(p.change_today) < 0).length;
      const _mvrs = (_gUp + _gDn > 0)
        ? ` &nbsp;<span class="pos-cnt-up">${_gUp}▲</span>&thinsp;<span class="pos-cnt-dn">${_gDn}▼</span>`
        : '';
      _countEl.innerHTML = `${positions.length} position${positions.length !== 1 ? 's' : ''}${_mvrs}`;
    }

    if (!positions.length) {
      tbody.innerHTML = `
        <tr><td colspan="7">
          <div class="empty"><div class="icon">📊</div><p>No open positions</p></div>
        </td></tr>`;
      return;
    }

    // store latest positions for drawer lookups + sort
    window._latestPositions = positions;
    _updateFilterBar();
    if (_posView === 'map') {
      _renderPositionMap(_filteredPositions());
    } else {
      _renderPositionsRows(_filteredPositions());
      _updateSortHeaders();
    }

    // Today's movers callout
    const moversEl = $('positions-movers');
    if (moversEl && positions.length >= 2) {
      const withChg = positions.filter(p => parseFloat(p.change_today) !== 0);
      if (withChg.length) {
        const best  = withChg.reduce((a, b) => parseFloat(a.change_today) > parseFloat(b.change_today) ? a : b);
        const worst = withChg.reduce((a, b) => parseFloat(a.change_today) < parseFloat(b.change_today) ? a : b);
        const fmtPct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
        const bestChg  = parseFloat(best.change_today);
        const worstChg = parseFloat(worst.change_today);
        if (best.symbol !== worst.symbol) {
          moversEl.innerHTML =
            `<span class="pos">${best.symbol} ${fmtPct(bestChg)}</span>` +
            `<span style="color:var(--border);margin:0 5px">·</span>` +
            `<span class="neg">${worst.symbol} ${fmtPct(worstChg)}</span>`;
        } else {
          moversEl.textContent = 'click row for details';
        }
      } else {
        moversEl.textContent = 'click row for details';
      }
    } else if (moversEl) {
      moversEl.textContent = 'click row for details';
    }

    // Async: fetch sparklines + company names in parallel
    if (positions.length) {
      const symbols = positions.map(p => p.symbol);
      const symStr = symbols.join(',');
      fetch(`/api/sparklines?symbols=${symStr}`)
        .then(r => r.json())
        .then(sparks => { _lastSparklines = sparks; _injectRowSparklines(sparks); })
        .catch(() => {});
      _injectCompanyNames(symbols);
    }
  } catch (e) {
    document.title = 'AI Portfolio Manager';
    $('positions-body').innerHTML = `
      <tr><td colspan="7">
        <div class="empty"><p>Could not load portfolio — check API keys in Settings</p></div>
      </td></tr>`;
  }
}

const _nameCache = {};
const _earningsCache = {}; // sym -> 'YYYY-MM-DD'
const _sectorCache  = {}; // sym -> sector string

async function _injectCompanyNames(symbols) {
  const uncached = symbols.filter(s => !_nameCache[s]);
  if (uncached.length) {
    await Promise.allSettled(uncached.map(async sym => {
      try {
        const d = await fetch(`/api/fundamentals/${sym}`).then(r => r.json());
        _nameCache[sym] = d.company_name || sym;
        if (d.next_earnings_date) _earningsCache[sym] = d.next_earnings_date;
        if (d.sector) _sectorCache[sym] = d.sector;
      } catch(e) {
        _nameCache[sym] = sym;
      }
    }));
  }
  document.querySelectorAll('td[data-sym]').forEach(td => {
    const nameEl = td.querySelector('.symbol-name');
    const name = _nameCache[td.dataset.sym];
    if (nameEl && name && name !== td.dataset.sym) {
      nameEl.textContent = name;
    }
  });
  _injectSectorBadges();
  _renderEarningsCard();
  _updateNoteIndicators();
  _renderSectorMix();
}

function _renderEarningsCard() {
  const card = document.getElementById('earnings-card');
  if (!card) return;
  const posSyms = new Set((window._latestPositions || []).map(p => p.symbol));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + 30);

  const upcoming = Object.entries(_earningsCache)
    .filter(([sym]) => posSyms.has(sym))
    .map(([sym, dateStr]) => {
      const d = new Date(dateStr + 'T12:00:00');
      const days = Math.round((d - today) / 86400000);
      return { sym, date: d, days };
    })
    .filter(e => e.days >= 0 && e.date <= cutoff)
    .sort((a, b) => a.days - b.days);

  if (!upcoming.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  const countEl = document.getElementById('earnings-count');
  if (countEl) countEl.textContent = `${upcoming.length} event${upcoming.length !== 1 ? 's' : ''}`;

  document.getElementById('earnings-rows').innerHTML = upcoming.map(e => {
    const urgent = e.days <= 3;
    const when = e.days === 0 ? 'Today' : e.days === 1 ? 'Tomorrow' : `In ${e.days}d`;
    const name = (_nameCache[e.sym] && _nameCache[e.sym] !== e.sym) ? _nameCache[e.sym] : '';
    const fmtDate = e.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <div class="earn-row${urgent ? ' earn-urgent' : ''}"
           onclick="openDrawer('${e.sym}', (window._latestPositions||[]).find(p=>p.symbol==='${e.sym}'))"
           style="cursor:pointer">
        ${_symAvatar(e.sym, 'width:30px;height:30px;border-radius:8px;font-size:12px;flex-shrink:0')}
        <div class="earn-sym">
          <span class="earn-ticker">${e.sym}</span>
          ${name ? `<span class="earn-name">${name}</span>` : ''}
        </div>
        <div class="earn-when${urgent ? ' earn-when-urgent' : ''}">${when}</div>
        <div class="earn-date">${fmtDate}</div>
      </div>`;
  }).join('');
}

function _injectWatchlistEarningsBadges() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  document.querySelectorAll('.wl-earn-badge[data-earn-sym]').forEach(el => {
    const sym = el.dataset.earnSym;
    const dateStr = _earningsCache[sym];
    if (!dateStr) { el.style.display = 'none'; return; }
    const d = new Date(dateStr + 'T12:00:00');
    const days = Math.round((d - today) / 86400000);
    if (days < 0 || days > 14) { el.style.display = 'none'; return; }
    const label = days === 0 ? 'Earnings today'
                : days === 1 ? 'Earnings tmrw'
                : `Earnings in ${days}d`;
    el.textContent = label;
    el.dataset.urgent = days <= 3 ? '1' : '0';
    el.style.display = '';
  });
}

// ── Sector mix ────────────────────────────────────────────────────────

const _SECTOR_COLORS = {
  'Technology': '#6366f1', 'Information Technology': '#6366f1',
  'Health Care': '#0ea5e9', 'Healthcare': '#0ea5e9',
  'Financial Services': '#f59e0b', 'Financials': '#f59e0b',
  'Consumer Cyclical': '#ec4899', 'Consumer Discretionary': '#ec4899',
  'Consumer Staples': '#14b8a6',
  'Energy': '#f97316',
  'Industrials': '#8b5cf6',
  'Materials': '#84cc16',
  'Real Estate': '#ef4444',
  'Communication Services': '#22c55e',
  'Utilities': '#06b6d4',
};
const _SECTOR_SHORT = {
  'Information Technology': 'Tech', 'Technology': 'Tech',
  'Health Care': 'Health', 'Healthcare': 'Health',
  'Communication Services': 'Comms',
  'Consumer Cyclical': 'Cyclical', 'Consumer Discretionary': 'Cyclical',
  'Consumer Staples': 'Staples',
  'Financial Services': 'Finance', 'Financials': 'Finance',
  'Real Estate': 'Real Est.',
  'Industrials': 'Industrial',
  'Materials': 'Materials',
  'Energy': 'Energy',
  'Utilities': 'Utilities',
};

function _sectorAbbr(sector) {
  return _SECTOR_SHORT[sector] || sector;
}

function _injectSectorBadges() {
  document.querySelectorAll('.sym-sector-badge[data-sym]').forEach(el => {
    const sym = el.dataset.sym;
    const sector = _sectorCache[sym];
    if (!sector) return;
    const label = _sectorAbbr(sector);
    const color = _SECTOR_COLORS[sector] || 'var(--muted-2)';
    el.textContent = label;
    el.style.color = color;
    el.style.display = '';
  });
}

function _renderSectorMix() {
  const allocCard = document.getElementById('allocation-card');
  if (!allocCard) return;
  const positions = window._latestPositions || [];
  if (!positions.length) return;

  const totals = {}, dayTotals = {};
  let totalMv = 0, anyMapped = false, anyDay = false;
  positions.forEach(p => {
    const sector = _sectorCache[p.symbol];
    const mv  = parseFloat(p.market_value) || 0;
    const chg = parseFloat(p.change_today) || 0;
    totalMv += mv;
    if (sector) {
      totals[sector] = (totals[sector] || 0) + mv;
      anyMapped = true;
      if (chg !== 0) {
        const dayDollar = mv * chg / (1 + chg);
        dayTotals[sector] = (dayTotals[sector] || 0) + dayDollar;
        anyDay = true;
      }
    }
  });
  if (!anyMapped || !totalMv) return;

  const sectors = Object.entries(totals)
    .map(([name, mv], i) => ({
      name, mv, pct: mv / totalMv * 100, i,
      day: dayTotals[name] || 0,
    }))
    .sort((a, b) => anyDay
      ? Math.abs(b.day) - Math.abs(a.day)   // biggest mover first when market data available
      : b.pct - a.pct);                       // else by allocation %

  let el = allocCard.querySelector('.sector-mix-wrap');
  if (!el) { el = document.createElement('div'); el.className = 'sector-mix-wrap'; allocCard.appendChild(el); }

  const color = (s) => _SECTOR_COLORS[s.name] || `hsl(${s.i * 47 % 360},60%,55%)`;
  const short  = (n) => _sectorAbbr(n);
  const fmtDay = (v) => {
    const sign = v >= 0 ? '+' : '-';
    const abs  = Math.abs(v);
    return `${sign}$${abs < 100 ? abs.toFixed(2) : abs.toFixed(0)}`;
  };

  el.innerHTML = `
    <div class="section-label" style="margin-bottom:8px">Sector Mix</div>
    <div class="sector-bar">
      ${[...sectors].sort((a,b)=>b.pct-a.pct).map(s =>
        `<div class="sector-seg" style="flex:${s.pct.toFixed(2)};background:${color(s)}"
          title="${s.name}: ${s.pct.toFixed(1)}%${s.day ? ` · ${fmtDay(s.day)} today` : ''}"></div>`
      ).join('')}
    </div>
    <div class="sector-legend">
      ${sectors.map(s => {
        const dayCls = s.day > 0 ? 'pos' : s.day < 0 ? 'neg' : '';
        const dayBadge = anyDay && s.day !== 0
          ? `<span class="sector-leg-day ${dayCls}">${fmtDay(s.day)}</span>`
          : '';
        return `
          <div class="sector-leg-item">
            <span class="sector-dot" style="background:${color(s)}"></span>
            <span class="sector-leg-name">${short(s.name)}</span>
            <span class="sector-leg-pct">${s.pct.toFixed(0)}%</span>
            ${dayBadge}
          </div>`;
      }).join('')}
    </div>`;
}

async function _loadPositionAges() {
  try {
    const data = await fetch('/api/decisions?limit=500').then(r => r.json());
    const firstBuys = {};
    const sorted = [...data].reverse();
    for (const d of sorted) {
      for (const o of (d.orders || [])) {
        if (o.side === 'buy' && !firstBuys[o.symbol]) {
          firstBuys[o.symbol] = d.run_date;
        }
      }
    }
    const today = new Date(); today.setHours(12, 0, 0, 0);
    Object.entries(firstBuys).forEach(([sym, date]) => {
      const ageEl = document.querySelector(`.pos-age-label[data-sym="${sym}"]`);
      if (!ageEl) return;
      const ms = today - new Date(date + 'T12:00:00');
      const days = Math.round(ms / 86400000);
      ageEl.textContent = days === 0 ? 'today' : `${days}d`;
    });
  } catch(e) { /* non-critical */ }
}

function _injectRowSparklines(sparks) {
  const total = _livePortfolioValue;
  document.querySelectorAll('td[data-spark]').forEach(td => {
    const sym = td.dataset.spark;
    const pts = sparks[sym];

    // Allocation % badge + entry price for reference line
    let allocBadge = '';
    let avgEntry = NaN;
    const _pos = (window._latestPositions || []).find(p => p.symbol === sym);
    if (_pos) {
      avgEntry = parseFloat(_pos.avg_entry_price);
      if (total) {
        const mv = parseFloat(_pos.market_value);
        if (!isNaN(mv) && mv > 0) {
          const pct = (mv / total * 100).toFixed(1);
          allocBadge = `<div class="row-alloc">${pct}%</div>`;
        }
      }
    }

    if (!pts || pts.length < 2) { td.innerHTML = `—${allocBadge}`; return; }
    const W = 52, H = 22;
    const min = Math.min(...pts), max = Math.max(...pts);
    const range = max - min || 1;
    const xyPairs = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - ((v - min) / range) * H]);
    const trend = pts[pts.length - 1] >= pts[0] ? '#16a34a' : '#dc2626';
    const pctChg = ((pts[pts.length - 1] - pts[0]) / pts[0] * 100).toFixed(1);
    const sign   = pts[pts.length - 1] >= pts[0] ? '+' : '';
    const smoothLine = _svgSmooth(xyPairs);
    const smoothFill = _svgSmoothFill(smoothLine, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);

    // Entry price reference line — only shown when avg cost falls within the 7D chart range
    let entryLine = '';
    if (!isNaN(avgEntry) && avgEntry > min && avgEntry < max) {
      const ey = (H - ((avgEntry - min) / range) * H).toFixed(1);
      const entryColor = pts[pts.length - 1] >= avgEntry ? '#16a34a' : '#dc2626';
      entryLine = `<line x1="0" y1="${ey}" x2="${W}" y2="${ey}" stroke="${entryColor}" stroke-width="0.8" stroke-dasharray="2,1.5" opacity="0.55" pointer-events="none"/>`;
    }

    const svgTitle = !isNaN(avgEntry) && avgEntry > min && avgEntry < max
      ? `<title>7D trend · avg cost $${avgEntry.toFixed(2)} (dashed line)</title>`
      : `<title>7D trend</title>`;
    td.innerHTML = `<div class="spark-cell spark-fade-in">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${svgTitle}
        <path d="${smoothFill}" fill="${trend}" opacity=".15"/>
        ${entryLine}
        <path d="${smoothLine}" fill="none" stroke="${trend}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="spark-pct" style="color:${trend}">${sign}${pctChg}%</div>
      ${allocBadge}
    </div>`;
  });
}

function fmtCurrencyRaw(val) {
  return '$' + (parseFloat(val) || 0).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});
}

// Split-typography hero value: large integer + small cents (Robinhood style)
function _fmtHeroValue(v) {
  const s = Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const dot = s.lastIndexOf('.');
  const int = dot >= 0 ? s.slice(0, dot) : s;
  const dec = dot >= 0 ? s.slice(dot) : '.00';
  return `$${int}<span class="hero-cents">${dec}</span>`;
}

// ── Portfolio chart ───────────────────────────────────────────────────

let _chartCurrentLimit = 30;
let _chartPctMode = false;

function toggleChartPctMode(btn) {
  _chartPctMode = !_chartPctMode;
  localStorage.setItem('chart-pct', _chartPctMode ? '1' : '0');
  btn.classList.toggle('active', _chartPctMode);
  const container = document.getElementById('chart-container');
  if (container && container.querySelector('svg')) {
    container.style.transition = 'opacity .12s ease';
    container.style.opacity = '0.15';
  }
  loadChart(_chartCurrentLimit);
}

function _svgSmooth(pts) {
  if (!pts || pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cpx = ((x0 + x1) / 2).toFixed(2);
    d += ` C ${cpx},${y0.toFixed(2)} ${cpx},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

function _svgSmoothFill(linePath, firstX, lastX, H) {
  return `${linePath} L ${lastX.toFixed(2)},${H} L ${firstX.toFixed(2)},${H} Z`;
}

function setChartRange(limit, btn) {
  localStorage.setItem('chart-range', limit);
  document.querySelectorAll('.range-tab').forEach(b => {
    b.classList.remove('active');
    delete b.dataset.dir;
    if (b.dataset.label) b.textContent = b.dataset.label;
  });
  _applyAllTabReturns();
  btn.classList.add('active');
  const container = document.getElementById('chart-container');
  if (container && container.querySelector('svg')) {
    container.style.transition = 'opacity .12s ease';
    container.style.opacity = '0.15';
  }
  loadChart(limit);
}

async function loadChart(limit = 30) {
  _chartCurrentLimit = limit;
  const pctMode = _chartPctMode;
  const container = document.getElementById('chart-container');
  const rangeEl = document.getElementById('chart-range');
  if (!container) return;
  try {
    // Pick yfinance period that covers the snapshot window
    const yfPeriod = limit <= 10 ? '7d' : limit <= 35 ? '1mo' : limit <= 90 ? '3mo' : '1y';

    const [data, spyRes, decisionsRes] = await Promise.all([
      fetch(`/api/snapshots?limit=${limit}`).then(r => r.json()),
      fetch(`/api/sparklines?symbols=SPY&period=${yfPeriod}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/decisions?limit=${limit}`).then(r => r.json()).catch(() => []),
    ]);
    if (!data.length) {
      container.innerHTML = '<div class="empty" style="height:200px;display:flex;align-items:center;justify-content:center"><p>Chart appears after first session</p></div>';
      return;
    }
    const sorted = [...data].reverse();
    const rawValues = sorted.map(s => s.total_value);
    const labels = sorted.map(s => s.snapshot_date);
    _stickySparkValues = rawValues.slice(-Math.min(30, rawValues.length));
    _updateStickyBar();
    const values = (pctMode && rawValues[0] > 0)
      ? rawValues.map(v => (v - rawValues[0]) / rawValues[0] * 100)
      : rawValues;
    const _vMin = Math.min(...values), _vMax = Math.max(...values);
    const _pad  = pctMode ? Math.max(0.5, (_vMax - _vMin) * 0.05) : 0;
    const min   = pctMode ? _vMin - _pad : _vMin * 0.998;
    const max   = pctMode ? _vMax + _pad : _vMax * 1.002;
    const W = 800, H = 140, PAD = 8;
    const xStep = (W - PAD * 2) / Math.max(values.length - 1, 1);
    const yScale = v => H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2);

    const xyPairs = values.map((v, i) => [PAD + i * xStep, yScale(v)]);
    const smoothLine = _svgSmooth(xyPairs);
    const smoothFill = _svgSmoothFill(smoothLine, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);
    const isUp = values[values.length - 1] >= values[0];
    const color = isUp ? '#16a34a' : '#dc2626';

    // Build axis labels: first, ~33%, ~66%, last (avoid crowding)
    const axisIdxs = values.length <= 2
      ? [0, values.length - 1]
      : [0, Math.floor(values.length / 3), Math.floor(2 * values.length / 3), values.length - 1];
    const fmtAxisDate = s => {
      const d = new Date(s + 'T12:00:00');
      return d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
    };
    const xlabelsHtml = axisIdxs.map((i, pos) => {
      const leftPct = ((PAD + i * xStep) / W * 100).toFixed(1);
      const anchor = pos === 0 ? 'translateX(0)' : pos === axisIdxs.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)';
      return `<span class="chart-xlabel" style="left:${leftPct}%;transform:${anchor}">${fmtAxisDate(labels[i])}</span>`;
    }).join('');

    // Y-axis: 3 gridlines + HTML overlay labels (avoid text distortion from preserveAspectRatio:none)
    const fmtYVal = pctMode
      ? v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
      : v => v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : `$${(v/1e3).toFixed(1)}k`;
    const yLevels = [
      { val: max,             svgY: PAD },
      { val: (min + max) / 2, svgY: H / 2 },
      { val: min,             svgY: H - PAD },
    ];
    const gridLines = yLevels.map(({ svgY }) =>
      `<line x1="0" y1="${svgY}" x2="${W}" y2="${svgY}" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3,5" opacity="0.12" pointer-events="none"/>`
    ).join('');
    // CSS top % maps SVG Y → container (viewBox height is H, rendered height is 200px)
    const yLabels = yLevels.map(({ val, svgY }) => {
      const topPct = (svgY / H * 100).toFixed(1);
      return `<div class="chart-ylabel" style="top:${topPct}%">${fmtYVal(val)}</div>`;
    }).join('');

    // Trade markers: dates where Claude placed orders
    const tradeDates = new Set(
      (decisionsRes || [])
        .filter(d => (d.orders || []).length > 0)
        .map(d => d.run_date)
    );
    // Map date -> order summaries for tooltip detail
    const tradeOrdersMap = {};
    (decisionsRes || []).filter(d => (d.orders || []).length > 0).forEach(d => {
      tradeOrdersMap[d.run_date] = d.orders.map(o => ({ side: o.side, symbol: o.symbol }));
    });
    const tradeMarkers = labels.map((date, i) => {
      const orders = tradeOrdersMap[date];
      if (!orders || !orders.length) return '';
      const cx = (PAD + i * xStep).toFixed(2);
      const cy = yScale(values[i]).toFixed(2);
      const hasBuy  = orders.some(o => o.side === 'buy');
      const hasSell = orders.some(o => o.side === 'sell');
      const fill   = hasBuy && hasSell ? '#f59e0b' : hasBuy ? '#16a34a' : '#dc2626';
      const letter = hasBuy && hasSell ? '±' : hasBuy ? 'B' : 'S';
      const delay  = (0.8 + i * 0.03).toFixed(2);
      return `<g class="trade-marker" style="transform-origin:${cx}px ${cy}px;animation:tradeMarkerIn .45s cubic-bezier(.34,1.56,.64,1) ${delay}s both" pointer-events="none">
        <circle cx="${cx}" cy="${cy}" r="5.5" fill="${fill}" stroke="var(--surface)" stroke-width="2" opacity="0.95"/>
        <text x="${cx}" y="${parseFloat(cy) + 3.5}" text-anchor="middle" font-size="7" font-weight="800" fill="white" font-family="system-ui,sans-serif" pointer-events="none">${letter}</text>
      </g>`;
    }).join('');

    // ATH + max-drawdown annotations
    // Hoisted so the mousemove closure can annotate the crosshair tooltip at these dates
    let _chartATHIdx = -1, _chartTroughIdx = -1, _chartDDPct = 0;
    let athMarker = '', ddMarker = '';
    if (values.length > 3) {
      const athIdx = values.indexOf(Math.max(...values));
      const isCurrentATH = athIdx === values.length - 1;
      _chartATHIdx = athIdx; // expose to mousemove (includes current-ATH case)
      if (!isCurrentATH) {
        const ax = PAD + athIdx * xStep;
        const ay = yScale(values[athIdx]);
        const anchor = athIdx > values.length * 0.78 ? 'end' : 'middle';
        athMarker = `<g pointer-events="none">
          <circle cx="${ax}" cy="${ay}" r="5" fill="#f59e0b" stroke="var(--surface)" stroke-width="1.5" opacity="0.9"/>
          <text x="${ax}" y="${ay - 9}" text-anchor="${anchor}" font-size="8.5" fill="#f59e0b" font-weight="700" opacity="0.85">ATH</text>
        </g>`;
      }
      // Lowest point after the global peak (max drawdown trough)
      if (athIdx < values.length - 1) {
        const afterPeak = values.slice(athIdx);
        const troughRel = afterPeak.indexOf(Math.min(...afterPeak));
        const troughAbs = athIdx + troughRel;
        const ddPct = (values[troughAbs] - values[athIdx]) / values[athIdx] * 100;
        if (troughRel > 0 && ddPct < -1.5 && troughAbs !== values.length - 1) {
          _chartTroughIdx = troughAbs;
          _chartDDPct     = ddPct;
          const tx = PAD + troughAbs * xStep;
          const ty = yScale(values[troughAbs]);
          const anchor2 = troughAbs > values.length * 0.78 ? 'end' : 'middle';
          ddMarker = `<g pointer-events="none">
            <circle cx="${tx}" cy="${ty}" r="4.5" fill="#dc2626" stroke="var(--surface)" stroke-width="1.5" opacity="0.8"/>
            <text x="${tx}" y="${ty + 16}" text-anchor="${anchor2}" font-size="8" fill="#dc2626" opacity="0.7">DD</text>
          </g>`;
        }
      }
    }

    // SPY benchmark: normalize to portfolio starting value
    const spyRaw = (spyRes && spyRes.SPY) || [];
    let spyLine = '';
    let spyPctStr = '';
    let spyValues = []; // subsampled to portfolio length, for crosshair alpha
    if (spyRaw.length >= 2 && rawValues.length >= 2) {
      const spyDollar = (() => {
        const spyNorm = spyRaw.map(v => (v / spyRaw[0]) * rawValues[0]);
        const n = rawValues.length;
        const step = (spyNorm.length - 1) / Math.max(n - 1, 1);
        return Array.from({length: n}, (_, i) => spyNorm[Math.min(Math.round(i * step), spyNorm.length - 1)]);
      })();
      // Store for beta computation in buildPerfStrip (called later by loadDecisions)
      window._spySnapshotReturns = spyDollar.slice(1).map((v, i) => spyDollar[i] > 0 ? (v - spyDollar[i]) / spyDollar[i] * 100 : 0);
      spyValues = pctMode && rawValues[0] > 0
        ? spyDollar.map(v => (v - rawValues[0]) / rawValues[0] * 100)
        : spyDollar;
      const spyXY = spyValues.map((v, i) => [PAD + i * xStep, yScale(v)]);
      spyLine = `<path d="${_svgSmooth(spyXY)}" fill="none" stroke="var(--muted-2)" stroke-width="1.5" stroke-dasharray="5,3" stroke-linecap="round" opacity="0.7" pointer-events="none"/>`;
      const spyChg = ((spyRaw[spyRaw.length - 1] - spyRaw[0]) / spyRaw[0] * 100).toFixed(2);
      const portChg = rawValues[0] ? ((rawValues[rawValues.length - 1] - rawValues[0]) / rawValues[0] * 100).toFixed(2) : 0;
      const beating = parseFloat(portChg) >= parseFloat(spyChg);
      spyPctStr = `<span class="range-spy-text" style="color:var(--muted);font-size:11px;font-weight:500"> · SPY ${spyChg >= 0 ? '+' : ''}${spyChg}% · <span style="color:${beating ? 'var(--green)' : 'var(--red)'}">${beating ? '▲ beating' : '▼ trailing'} market</span></span>`;
    }

    const periodPct = rawValues[0] > 0 ? ((rawValues[rawValues.length - 1] - rawValues[0]) / rawValues[0] * 100) : 0;
    const periodSign = periodPct >= 0 ? '+' : '';

    if (rangeEl) {
      rangeEl.innerHTML = `<span style="color:${color};font-weight:700">${periodSign}${periodPct.toFixed(2)}%</span>${spyPctStr}`;
    }

    // ── Performance stats strip ───────────────────────────────────────
    const dayChanges = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].total_value, curr = sorted[i].total_value;
      if (prev > 0) dayChanges.push((curr - prev) / prev * 100);
    }
    const winDays  = dayChanges.filter(c => c > 0).length;
    const winRate  = dayChanges.length ? winDays / dayChanges.length * 100 : null;
    const bestDay  = dayChanges.length ? Math.max(...dayChanges) : null;
    const worstDay = dayChanges.length ? Math.min(...dayChanges) : null;
    const firstDate = new Date(sorted[0].snapshot_date + 'T12:00:00');
    const lastDate  = new Date(sorted[sorted.length - 1].snapshot_date + 'T12:00:00');
    const yearFrac  = (lastDate - firstDate) / (365.25 * 86400000);
    const annualPct = yearFrac > 0.02 && periodPct !== 0
      ? (Math.pow(1 + periodPct / 100, 1 / yearFrac) - 1) * 100
      : null;

    // Sharpe ratio (annualized, ~5% risk-free rate)
    let sharpe = null;
    if (dayChanges.length >= 5) {
      const rfDaily = 5.0 / 252;
      const mean = dayChanges.reduce((s, v) => s + v, 0) / dayChanges.length;
      const variance = dayChanges.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / dayChanges.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) sharpe = ((mean - rfDaily) / stdDev) * Math.sqrt(252);
    }

    const _ps = (val, dp = 2, suffix = '%', signed = true) => {
      if (val == null) return '—';
      const s = signed && val >= 0 ? '+' : '';
      return `${s}${val.toFixed(dp)}${suffix}`;
    };

    const perfItems = [
      { label: 'Total Return',  val: _ps(periodPct),   cls: periodPct >= 0 ? 'pos' : 'neg' },
      annualPct != null ? { label: 'Annualized', val: _ps(annualPct), cls: annualPct >= 0 ? 'pos' : 'neg' } : null,
      sharpe    != null ? { label: 'Sharpe',     val: sharpe.toFixed(2), cls: sharpe >= 1 ? 'pos' : sharpe < 0 ? 'neg' : '', signed: false } : null,
      winRate  != null ? { label: 'Win Rate',   val: _ps(winRate, 1), cls: winRate >= 50 ? 'pos' : 'neg' } : null,
      bestDay  != null ? { label: 'Best Day',   val: _ps(bestDay),  cls: 'pos' } : null,
      worstDay != null ? { label: 'Worst Day',  val: _ps(worstDay), cls: 'neg' } : null,
    ].filter(Boolean);

    const perfStrip = perfItems.length >= 2 ? `
      <div class="chart-perf-strip">
        ${perfItems.map(item => `
          <div class="chart-perf-item">
            <div class="chart-perf-label">${item.label}</div>
            <div class="chart-perf-val ${item.cls}">${item.val}</div>
          </div>`).join('')}
      </div>` : '';

    // Update all range tabs with stored returns
    _rangeReturns[limit] = periodPct;
    _applyAllTabReturns();
    // Re-apply active styling after innerHTML rebuild; color tab to match period direction
    const activeTab = document.querySelector('.range-tab.active[data-label]');
    if (activeTab) {
      activeTab.classList.add('active');
      activeTab.dataset.dir = isUp ? 'up' : 'down';
    }

    // Keep hero sub in sync with the active chart period
    const statSub = $('stat-value-sub');
    if (statSub && !statSub.dataset.scrubbing && rawValues.length >= 2) {
      const periodDelta = rawValues[rawValues.length - 1] - rawValues[0];
      const sign  = periodDelta >= 0 ? '+' : '';
      const cls   = periodDelta >= 0 ? 'pos' : 'neg';
      const arrow = periodDelta >= 0 ? '▲' : '▼';
      const deltaFmt = `${sign}$${Math.abs(periodDelta).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
      const pctFmt   = `${sign}${periodPct.toFixed(2)}%`;
      const rawLabel = activeTab ? activeTab.dataset.label : '';
      const periodLabel = rawLabel === 'All' ? 'all time' : rawLabel ? `past ${rawLabel}` : 'this period';
      const subHtml = `<span class="${cls}">${arrow} ${deltaFmt} (${pctFmt}) ${periodLabel}</span>`;
      statSub.innerHTML = subHtml;
      statSub.dataset.liveHtml = subHtml;
    }

    const liveX = PAD + (values.length - 1) * xStep;
    const liveY = yScale(values[values.length - 1]);

    // Period-start reference line: subtle horizontal line at values[0]
    const startY = yScale(values[0]).toFixed(1);
    const startLine = values.length >= 3 ? `<line id="chart-baseline" x1="${PAD}" y1="${startY}" x2="${W - PAD}" y2="${startY}" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="3,5" opacity="0.5" pointer-events="none"/>` : '';

    container.style.position = 'relative';
    container.innerHTML = `
      <svg id="chart-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:200px;overflow:visible;display:block;cursor:crosshair" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartFillGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#16a34a" stop-opacity="0.32"/>
            <stop offset="100%" stop-color="#16a34a" stop-opacity="0.04"/>
          </linearGradient>
          <linearGradient id="chartFillRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#dc2626" stop-opacity="0.04"/>
            <stop offset="100%" stop-color="#dc2626" stop-opacity="0.28"/>
          </linearGradient>
          <clipPath id="chartClipAbove"><rect x="0" y="0" width="${W}" height="${parseFloat(startY)}"/></clipPath>
          <clipPath id="chartClipBelow"><rect x="0" y="${parseFloat(startY)}" width="${W}" height="${H}"/></clipPath>
          <clipPath id="chartScrubReveal"><rect id="chart-scrub-rect" x="0" y="0" width="${W}" height="${H}"/></clipPath>
        </defs>
        ${gridLines}
        ${startLine}
        ${spyLine}
        <g clip-path="url(#chartScrubReveal)">
          <path id="chart-fill-green" d="${smoothFill}" fill="url(#chartFillGreen)" clip-path="url(#chartClipAbove)" opacity="0"/>
          <path id="chart-fill-red"   d="${smoothFill}" fill="url(#chartFillRed)"   clip-path="url(#chartClipBelow)" opacity="0"/>
        </g>
        <path id="chart-line" d="${smoothLine}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${values.map((v, i) => `<circle class="chart-dot-pt" cx="${PAD + i * xStep}" cy="${yScale(v)}" r="2.5" fill="${color}" opacity="0"/>`).join('')}
        <circle class="chart-live-ring" cx="${liveX}" cy="${liveY}" r="5" fill="${color}" pointer-events="none"/>
        <circle class="chart-live-dot"  cx="${liveX}" cy="${liveY}" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="1.5" opacity="0" pointer-events="none"/>
        ${tradeMarkers}
        ${athMarker}
        ${ddMarker}
        <line id="chart-xhair" x1="0" y1="0" x2="0" y2="${H}" stroke="${color}" stroke-width="1" stroke-dasharray="4,3" opacity="0" pointer-events="none"/>
        <circle id="chart-dot" cx="0" cy="0" r="5" fill="${color}" stroke="var(--surface)" stroke-width="2" opacity="0" pointer-events="none"/>
        <rect id="chart-overlay" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
      </svg>
      <div class="chart-xlabels">${xlabelsHtml}</div>
      <div class="chart-ylabels">${yLabels}
        <div class="chart-live-badge" style="top:${Math.max(5, Math.min(88, liveY / H * 100)).toFixed(1)}%;background:${color}">${'$' + rawValues[rawValues.length - 1].toLocaleString('en-US', {maximumFractionDigits: 0})}</div>
      </div>
      <div class="chart-legend">
        <span class="chart-legend-dot" style="background:${color}"></span>Portfolio
        ${spyLine ? `<span class="chart-legend-dot spy-dot"></span>S&amp;P 500` : ''}
        ${tradeDates.size ? `<span class="chart-legend-trade-dot buy"></span>Bought<span class="chart-legend-trade-dot sell"></span>Sold` : ''}
      </div>
      <div id="chart-xhair-label" class="chart-xhair-label"></div>
      <div id="chart-tip" class="chart-tip">
        <div class="chart-tip-date" id="chart-tip-date"></div>
        <div class="chart-tip-val" id="chart-tip-val"></div>
      </div>
      ${perfStrip}`;

    requestAnimationFrame(() => {
      container.style.transition = 'opacity .22s ease';
      container.style.opacity = '1';
      const line = document.getElementById('chart-line');
      const fillGreen = document.getElementById('chart-fill-green');
      const fillRed   = document.getElementById('chart-fill-red');
      if (line) {
        const len = line.getTotalLength();
        line.style.strokeDasharray = len;
        line.style.strokeDashoffset = len;
        line.style.transition = 'stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)';
        requestAnimationFrame(() => { line.style.strokeDashoffset = '0'; });
      }
      [fillGreen, fillRed].forEach(poly => {
        if (poly) { poly.style.transition = 'opacity .6s ease .4s'; requestAnimationFrame(() => { poly.style.opacity = '1'; }); }
      });
      document.querySelectorAll('.chart-dot-pt').forEach((dot, i) => {
        dot.style.transition = `opacity .3s ease ${(0.5 + i * 0.02).toFixed(2)}s`;
        requestAnimationFrame(() => { dot.style.opacity = '0.5'; });
      });
      const liveDot = document.querySelector('.chart-live-dot');
      if (liveDot) {
        liveDot.style.transition = 'opacity .3s ease .85s';
        requestAnimationFrame(() => { liveDot.style.opacity = '1'; });
      }
      const liveBadge = container.querySelector('.chart-live-badge');
      if (liveBadge) {
        liveBadge.style.transition = 'opacity .3s ease .9s';
        requestAnimationFrame(() => { liveBadge.style.opacity = '1'; });
      }
    });

    const svg        = document.getElementById('chart-svg');
    const overlay    = document.getElementById('chart-overlay');
    const xhair      = document.getElementById('chart-xhair');
    const dot        = document.getElementById('chart-dot');
    const tip        = document.getElementById('chart-tip');
    const tipDate    = document.getElementById('chart-tip-date');
    const tipVal     = document.getElementById('chart-tip-val');
    const chartLine  = document.getElementById('chart-line');
    const scrubRect  = document.getElementById('chart-scrub-rect');
    const xhairLabel = document.getElementById('chart-xhair-label');
    const gradStops = [];

    // Shift chart line color during scrub (Robinhood signature); fill is always split green/red
    let _scrubColor = null;
    const baseline = document.getElementById('chart-baseline');
    function _applyChartColor(c) {
      if (_scrubColor === c) return;
      _scrubColor = c;
      if (chartLine) chartLine.style.stroke = c;
      if (baseline) baseline.style.stroke = c;
      if (gradStops.length >= 2) {
        gradStops[0].style.stopColor = c;
        gradStops[1].style.stopColor = c;
      }
      if (dot) dot.style.fill = c;
      if (xhair) xhair.style.stroke = c;
    }
    function _resetChartColor() {
      if (!_scrubColor) return;
      _scrubColor = null;
      if (chartLine) chartLine.style.stroke = '';
      if (baseline) baseline.style.stroke = '';
      if (dot) dot.style.fill = '';
      if (xhair) xhair.style.stroke = '';
    }

    let _heroRestoreToken = 0;

    // Builds the hero sub-label shown while scrubbing (Robinhood-style delta display)
    function _scrubSubHtml(idx) {
      const d    = new Date(labels[idx] + 'T12:00:00');
      const dateStr   = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const _so = tradeOrdersMap[labels[idx]] || [];
      const tradeFlag = tradeDates.has(labels[idx])
        ? ` &nbsp;·&nbsp; ${_so.some(o=>o.side==='buy') && _so.some(o=>o.side==='sell') ? '<span style="color:#f59e0b">traded</span>' : _so.some(o=>o.side==='buy') ? '<span style="color:var(--green)">bought</span>' : '<span style="color:var(--red)">sold</span>'}`
        : '';
      if (pctMode) {
        if (idx === 0) return `<span style="color:var(--muted)">${dateStr}${tradeFlag}</span>`;
        const pctVal = values[idx];
        const sign = pctVal >= 0 ? '+' : '';
        const cls  = pctVal >= 0 ? 'pos' : 'neg';
        let spyHtml = '';
        if (spyValues.length > idx) {
          const spyPct = spyValues[idx];
          const alpha  = pctVal - spyPct;
          const aSign  = alpha >= 0 ? '+' : '';
          const aCls   = alpha >= 0 ? 'pos' : 'neg';
          spyHtml = `<span style="color:var(--muted-2);font-size:12px"> &nbsp;·&nbsp; SPY ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(2)}% <span class="${aCls}">${aSign}${alpha.toFixed(2)}% α</span></span>`;
        }
        return `<span class="${cls}">${sign}${pctVal.toFixed(2)}%</span>${spyHtml}<span style="color:var(--muted);font-size:13px"> &nbsp;·&nbsp; ${dateStr}${tradeFlag}</span>`;
      }
      const val  = values[idx];
      const base = values[0];
      if (idx === 0 || base === 0) {
        return `<span style="color:var(--muted)">${dateStr}${tradeFlag}</span>`;
      }
      const delta    = val - base;
      const deltaPct = (delta / base) * 100;
      const sign     = delta >= 0 ? '+' : '';
      const cls      = delta >= 0 ? 'pos' : 'neg';
      const deltaFmt = `${sign}$${Math.abs(delta).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
      const pctFmt   = `${sign}${deltaPct.toFixed(2)}%`;
      let spyHtml = '';
      if (spyValues.length > idx && spyValues[0] > 0) {
        const spyPct  = (spyValues[idx] - spyValues[0]) / spyValues[0] * 100;
        const alpha   = deltaPct - spyPct;
        const aSign   = alpha >= 0 ? '+' : '';
        const aCls    = alpha >= 0 ? 'pos' : 'neg';
        spyHtml = `<span style="color:var(--muted-2);font-size:12px"> &nbsp;·&nbsp; SPY ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(2)}% <span class="${aCls}">${aSign}${alpha.toFixed(2)}% α</span></span>`;
      }
      return `<span class="${cls}">${deltaFmt} &nbsp;·&nbsp; ${pctFmt}</span>${spyHtml}<span style="color:var(--muted);font-size:13px"> &nbsp;·&nbsp; ${dateStr}${tradeFlag}</span>`;
    }

    overlay.addEventListener('mousemove', e => {
      const svgRect = svg.getBoundingClientRect();
      const cRect   = container.getBoundingClientRect();
      const svgX    = ((e.clientX - svgRect.left) / svgRect.width) * W;
      const idx     = Math.max(0, Math.min(values.length - 1, Math.round((svgX - PAD) / xStep)));
      const cx      = PAD + idx * xStep;
      const cy      = yScale(values[idx]);

      xhair.setAttribute('x1', cx); xhair.setAttribute('x2', cx);
      xhair.setAttribute('opacity', '0.5');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
      dot.setAttribute('opacity', '1');

      // X-axis date pill snapped under crosshair
      if (xhairLabel) {
        const svgBottom = svg.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
        xhairLabel.style.top  = svgBottom + 'px';
        xhairLabel.style.left = (cx / W * 100).toFixed(2) + '%';
        xhairLabel.textContent = new Date(labels[idx] + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'});
        xhairLabel.style.opacity = '1';
      }
      container.classList.add('scrubbing');

      // Dynamic color: green if above period start, red if below (Robinhood signature)
      _applyChartColor(values[idx] >= values[0] ? '#16a34a' : '#dc2626');
      // Scrub-to-reveal: clip fill to [0, cursor x] so history "reveals" as you drag
      if (scrubRect) scrubRect.setAttribute('width', Math.min(W, cx + PAD));

      // Map SVG coords back to container-relative CSS pixels
      const scaleX = svgRect.width / W;
      const scaleY = svgRect.height / H;
      let tipLeft = (e.clientX - cRect.left);
      let tipTop  = cy * scaleY - 52;
      // Keep tooltip inside container (wider margin on trade dates for the order chips)
      const _tipMargin = tradeDates.has(labels[idx]) ? 80 : 60;
      if (tipLeft < _tipMargin) tipLeft = _tipMargin;
      if (tipLeft > cRect.width - _tipMargin) tipLeft = cRect.width - _tipMargin;
      tip.style.left    = tipLeft + 'px';
      tip.style.top     = Math.max(0, tipTop) + 'px';
      tip.style.opacity = '1';
      const _td = new Date(labels[idx] + 'T12:00:00');
      const _tfmt = _td.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
      const _hasTrades = tradeDates.has(labels[idx]);
      const _tradeOrds = _hasTrades ? (tradeOrdersMap[labels[idx]] || []) : [];
      const _hasBuy = _tradeOrds.some(o => o.side === 'buy');
      const _hasSell = _tradeOrds.some(o => o.side === 'sell');
      const _tradeLabel = !_hasTrades ? '' : _hasBuy && _hasSell ? ' · traded' : _hasBuy ? ' · bought' : ' · sold';
      if (idx === _chartATHIdx) {
        tipDate.innerHTML = _tfmt + _tradeLabel + ' <span style="color:#f59e0b;font-weight:800">· ATH</span>';
      } else if (idx === _chartTroughIdx && _chartDDPct < 0) {
        tipDate.innerHTML = _tfmt + _tradeLabel + ` <span style="color:#dc2626;font-weight:800">· ${_chartDDPct.toFixed(1)}% DD</span>`;
      } else {
        tipDate.textContent = _tfmt + _tradeLabel;
      }
      const _tipOrders = _hasTrades ? (tradeOrdersMap[labels[idx]] || []) : [];
      const _tipTradeHtml = _tipOrders.length
        ? `<div class="chart-tip-trades">${_tipOrders.slice(0, 4).map(o =>
            `<span class="chart-tip-order ${o.side}">${o.side === 'buy' ? '▲' : '▼'}&thinsp;${o.symbol}</span>`
          ).join('')}${_tipOrders.length > 4 ? `<span class="chart-tip-order-more">+${_tipOrders.length - 4}</span>` : ''}</div>`
        : '';
      const _snapDay = _snapDeltaMap[labels[idx]];
      const _dayDeltaHtml = _snapDay
        ? (() => {
            const cls  = _snapDay.delta >= 0 ? 'pos' : 'neg';
            const sign = _snapDay.delta >= 0 ? '+' : '';
            const abs  = Math.abs(_snapDay.delta);
            const valStr = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`;
            return `<div class="chart-tip-day ${cls}">${sign}${valStr} <span class="chart-tip-day-pct">${sign}${_snapDay.pct.toFixed(2)}%</span></div>`;
          })()
        : '';
      tipVal.innerHTML = '$' + rawValues[idx].toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) + _dayDeltaHtml + _tipTradeHtml;

      // Robinhood-style: update the big stat card with historical value
      _heroRestoreToken++; // cancel any pending fade-restore
      const statVal = $('stat-value');
      const statSub = $('stat-value-sub');
      if (statVal) {
        if (statVal.style.opacity === '0') { statVal.style.transition = ''; statVal.style.opacity = ''; }
        statVal.innerHTML = _fmtHeroValue(rawValues[idx]);
        statVal.dataset.scrubbing = '1';
      }
      if (statSub) {
        if (statSub.style.opacity === '0') { statSub.style.transition = ''; statSub.style.opacity = ''; }
        statSub.innerHTML = _scrubSubHtml(idx);
        statSub.dataset.scrubbing = '1';
      }
    });

    // Touch crosshair (mobile scrub) with haptic ticks + fade-restore on lift
    let _touchLastIdx = -1;
    function _chartHitFromClientX(clientX) {
      const svgRect = svg.getBoundingClientRect();
      const svgX = ((clientX - svgRect.left) / svgRect.width) * W;
      return Math.max(0, Math.min(values.length - 1, Math.round((svgX - PAD) / xStep)));
    }
    function _touchHaptic() { try { navigator.vibrate?.(1); } catch(_) {} }
    function _touchUpdateHero(idx) {
      const statVal = $('stat-value');
      const statSub = $('stat-value-sub');
      if (statVal) { statVal.innerHTML = _fmtHeroValue(rawValues[idx]); statVal.dataset.scrubbing = '1'; }
      if (statSub) { statSub.innerHTML = _scrubSubHtml(idx); statSub.dataset.scrubbing = '1'; }
    }
    function _updateXhairLabel(idx, cx) {
      if (!xhairLabel) return;
      const svgBottom = svg.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
      xhairLabel.style.top  = svgBottom + 'px';
      xhairLabel.style.left = (cx / W * 100).toFixed(2) + '%';
      xhairLabel.textContent = new Date(labels[idx] + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'});
      xhairLabel.style.opacity = '1';
    }
    svg.addEventListener('touchstart', e => {
      e.preventDefault();
      const idx = _chartHitFromClientX(e.touches[0].clientX);
      _touchLastIdx = idx;
      const cx = PAD + idx * xStep, cy = yScale(values[idx]);
      xhair.setAttribute('x1', cx); xhair.setAttribute('x2', cx); xhair.setAttribute('opacity', '0.5');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('opacity', '1');
      tip.style.opacity = '0';
      _updateXhairLabel(idx, cx);
      container.classList.add('scrubbing');
      _heroRestoreToken++; // cancel any pending mouse restore
      _touchUpdateHero(idx);
      _applyChartColor(values[idx] >= values[0] ? '#16a34a' : '#dc2626');
      if (scrubRect) scrubRect.setAttribute('width', Math.min(W, cx + PAD));
      _touchHaptic();
    }, { passive: false });
    svg.addEventListener('touchmove', e => {
      e.preventDefault();
      const idx = _chartHitFromClientX(e.touches[0].clientX);
      const cx = PAD + idx * xStep, cy = yScale(values[idx]);
      xhair.setAttribute('x1', cx); xhair.setAttribute('x2', cx);
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
      _updateXhairLabel(idx, cx);
      _touchUpdateHero(idx);
      _applyChartColor(values[idx] >= values[0] ? '#16a34a' : '#dc2626');
      if (scrubRect) scrubRect.setAttribute('width', Math.min(W, cx + PAD));
      if (idx !== _touchLastIdx) { _touchLastIdx = idx; _touchHaptic(); }
    }, { passive: false });
    svg.addEventListener('touchend', () => {
      xhair.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0');
      if (xhairLabel) xhairLabel.style.opacity = '0';
      container.classList.remove('scrubbing');
      if (scrubRect) scrubRect.setAttribute('width', W);
      _resetChartColor();
      const statVal = $('stat-value'); const statSub = $('stat-value-sub');
      const wasScrubbing = (statVal && statVal.dataset.scrubbing) || (statSub && statSub.dataset.scrubbing);
      if (!wasScrubbing) return;
      // Same fade-restore as mouseleave so the snap-back isn't jarring
      const token = ++_heroRestoreToken;
      if (statVal && statVal.dataset.scrubbing) { statVal.style.transition = 'opacity .12s ease'; statVal.style.opacity = '0'; }
      if (statSub && statSub.dataset.scrubbing) { statSub.style.transition = 'opacity .12s ease'; statSub.style.opacity = '0'; }
      setTimeout(() => {
        if (token !== _heroRestoreToken) return;
        if (statVal && statVal.dataset.scrubbing) {
          delete statVal.dataset.scrubbing;
          if (_livePortfolioValue !== null) statVal.innerHTML = _fmtHeroValue(_livePortfolioValue);
          statVal.style.transition = 'opacity .15s ease'; statVal.style.opacity = '1';
          setTimeout(() => { statVal.style.transition = ''; statVal.style.opacity = ''; }, 180);
        }
        if (statSub && statSub.dataset.scrubbing) {
          delete statSub.dataset.scrubbing;
          if (statSub.dataset.liveHtml) statSub.innerHTML = statSub.dataset.liveHtml; else statSub.textContent = statSub.dataset.liveText || '';
          statSub.style.transition = 'opacity .15s ease'; statSub.style.opacity = '1';
          setTimeout(() => { statSub.style.transition = ''; statSub.style.opacity = ''; }, 180);
        }
      }, 120);
    });

    overlay.addEventListener('mouseleave', () => {
      xhair.setAttribute('opacity', '0');
      dot.setAttribute('opacity', '0');
      tip.style.opacity = '0';
      if (xhairLabel) xhairLabel.style.opacity = '0';
      container.classList.remove('scrubbing');
      _resetChartColor();
      if (scrubRect) scrubRect.setAttribute('width', W);

      // Fade-restore hero to live value (120ms out → swap content → 150ms in)
      const statVal = $('stat-value');
      const statSub = $('stat-value-sub');
      const wasScrubbing = (statVal && statVal.dataset.scrubbing) || (statSub && statSub.dataset.scrubbing);
      if (!wasScrubbing) return;

      const token = ++_heroRestoreToken;
      if (statVal && statVal.dataset.scrubbing) {
        statVal.style.transition = 'opacity .12s ease';
        statVal.style.opacity = '0';
      }
      if (statSub && statSub.dataset.scrubbing) {
        statSub.style.transition = 'opacity .12s ease';
        statSub.style.opacity = '0';
      }

      setTimeout(() => {
        if (token !== _heroRestoreToken) return; // mouse re-entered, cancel
        if (statVal && statVal.dataset.scrubbing) {
          delete statVal.dataset.scrubbing;
          if (_livePortfolioValue !== null) {
            statVal.innerHTML = _fmtHeroValue(_livePortfolioValue);
          }
          statVal.style.transition = 'opacity .15s ease';
          statVal.style.opacity = '1';
          setTimeout(() => { statVal.style.transition = ''; statVal.style.opacity = ''; }, 180);
        }
        if (statSub && statSub.dataset.scrubbing) {
          delete statSub.dataset.scrubbing;
          if (statSub.dataset.liveHtml) {
            statSub.innerHTML = statSub.dataset.liveHtml;
          } else {
            statSub.textContent = statSub.dataset.liveText || 'Current value';
          }
          statSub.style.transition = 'opacity .15s ease';
          statSub.style.opacity = '1';
          setTimeout(() => { statSub.style.transition = ''; statSub.style.opacity = ''; }, 180);
        }
      }, 120);
    });

  } catch(e) {
    container.innerHTML = '<div style="height:200px"></div>';
  }
}

// ── Watchlist ─────────────────────────────────────────────────────────

async function loadWatchlist() {
  const container = $('watchlist-chips');
  try {
    const data = await fetch('/api/watchlist').then(r => r.json());
    renderWatchlistChips(data.watchlist || []);
  } catch(e) {
    container.innerHTML = '<span style="color:var(--muted);font-size:13px">Could not load watchlist</span>';
  }
}

function renderWatchlistChips(symbols) {
  _watchlistSymbols = new Set(symbols);
  const container = $('watchlist-chips');
  const countEl = $('watchlist-count');
  if (countEl) countEl.textContent = `${symbols.length} ticker${symbols.length !== 1 ? 's' : ''}`;
  if (!symbols.length) {
    container.innerHTML = '<p class="wl-empty">No tickers yet — add one below</p>';
    return;
  }
  container.innerHTML = symbols.map(s => `
    <div class="wl-item" data-symbol="${s}" onclick="openWatchlistDrawer('${s}')" style="cursor:pointer">
      <div class="wl-avatar" style="background:${_symColor(s)};position:relative;overflow:hidden"><img class="sym-logo" src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(s)}?format=png" alt="" loading="lazy" onerror="this.style.display='none'">${s.charAt(0)}</div>
      <div class="wl-info">
        <span class="wl-sym">${s}</span>
        <span class="wl-name"></span>
        <span class="wl-earn-badge" data-earn-sym="${s}" style="display:none"></span>
      </div>
      <div class="wl-spark" data-spark-sym="${s}"></div>
      <div class="wl-right">
        <span class="wl-price">—</span>
        <span class="wl-pct"></span>
      </div>
      <button class="wl-remove" onclick="event.stopPropagation();removeTicker('${s}')" title="Remove ${s}">&times;</button>
    </div>
  `).join('');
  loadSparklines();
  _updateAlertIndicators();
}

// ── Sparklines ────────────────────────────────────────────────────────

function buildSparklineSVG(closes, W = 44, H = 18) {
  if (!closes || closes.length < 2) return '';
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const xStep = (W - 2) / (closes.length - 1);
  const yFn = v => H - 2 - ((v - min) / range) * (H - 4);
  const xyPairs = closes.map((v, i) => [2 + i * xStep, yFn(v)]);
  const isUp = closes[closes.length - 1] >= closes[0];
  const color = isUp ? '#16a34a' : '#dc2626';
  const smoothLine = _svgSmooth(xyPairs);
  const smoothFill = _svgSmoothFill(smoothLine, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);
  return `<svg class="ticker-sparkline" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="${smoothFill}" fill="${color}" opacity=".15"/>
    <path d="${smoothLine}" fill="none" stroke="${color}" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

async function loadSparklines() {
  const items = document.querySelectorAll('#watchlist-chips .wl-item[data-symbol]');
  if (!items.length) return;
  const symbols = [...items].map(c => c.dataset.symbol);

  // Fetch sparklines + company names in parallel
  const [sparkData] = await Promise.all([
    fetch(`/api/sparklines?symbols=${symbols.join(',')}`).then(r => r.json()).catch(() => ({})),
    _injectCompanyNames(symbols),
  ]);

  items.forEach(item => {
    const sym = item.dataset.symbol;

    // Company name from cache
    const nameEl = item.querySelector('.wl-name');
    if (nameEl && _nameCache[sym] && _nameCache[sym] !== sym) {
      nameEl.textContent = _nameCache[sym];
    }

    const closes = sparkData[sym];
    if (!closes || closes.length < 2) return;
    const lastPrice = closes[closes.length - 1];
    const isUp = lastPrice >= closes[0];
    const pct = ((lastPrice - closes[0]) / closes[0] * 100).toFixed(2);
    const sign = isUp ? '+' : '';
    const cls  = isUp ? 'pos' : 'neg';

    const sparkCell = item.querySelector('.wl-spark');
    if (sparkCell) sparkCell.innerHTML = buildSparklineSVG(closes, 72, 28);

    const priceEl = item.querySelector('.wl-price');
    if (priceEl) priceEl.textContent = `$${lastPrice.toFixed(2)}`;

    const pctEl = item.querySelector('.wl-pct');
    if (pctEl) { pctEl.textContent = `${sign}${pct}%`; pctEl.className = `wl-pct ${cls}`; }
  });

  // Build price map and check alerts
  const priceMap = {};
  items.forEach(item => {
    const sym    = item.dataset.symbol;
    const closes = sparkData[sym];
    if (closes && closes.length) priceMap[sym] = closes[closes.length - 1];
  });
  _checkPriceAlerts(priceMap);
  _updateAlertIndicators();
  _injectWatchlistEarningsBadges();
}

async function addTicker() {
  const input = $('ticker-input');
  const symbol = input.value.trim().toUpperCase();
  if (!symbol) return;
  input.value = '';
  try {
    const data = await fetch('/api/watchlist/add', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({symbol}),
    }).then(r => r.json());
    renderWatchlistChips(data.watchlist || []);
    showToast(`${symbol} added`, 'Claude will consider it next session.', 'success', 3000);
  } catch(e) {
    showToast('Could not add ticker', e.message, 'error');
  }
}

async function removeTicker(symbol) {
  try {
    const data = await fetch(`/api/watchlist/${symbol}`, {method: 'DELETE'}).then(r => r.json());
    renderWatchlistChips(data.watchlist || []);
    showToast(`${symbol} removed`, '', 'info', 2500);
  } catch(e) {
    showToast('Could not remove ticker', e.message, 'error');
  }
}

// ── Date helpers ──────────────────────────────────────────────────────

function relativeDate(dateStr) {
  // dateStr is YYYY-MM-DD
  const today = new Date();
  const d = new Date(dateStr + 'T12:00:00'); // noon avoids timezone edge cases
  const diffMs = today.setHours(0,0,0,0) - d.setHours(0,0,0,0);
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString('en-US', {weekday:'long'});
  return d.toLocaleDateString('en-US', {month:'short', day:'numeric'});
}

// ── Decision log ──────────────────────────────────────────────────────

const DECISIONS_PAGE = 20;
let _decisionsOffset = 0;
let _decisionsAllLoaded = false;
let _decisionsAutoExpanded = false;
let _decisionsLoading = false;
let _lastDecisionDate = null;
let _sessionSentinelIO = null;
// Running totals for the stats badge across all loaded pages
let _decisionsTotals = { sessions: 0, orders: 0, tradeSessions: 0 };
// Snapshot-based day P&L map { date -> { delta, pct } }
let _snapDeltaMap = {};

function _armSessionSentinel(container) {
  // Clean up any prior observer
  if (_sessionSentinelIO) { _sessionSentinelIO.disconnect(); _sessionSentinelIO = null; }
  document.getElementById('session-sentinel')?.remove();

  const sentinel = document.createElement('div');
  sentinel.id = 'session-sentinel';
  sentinel.className = 'session-sentinel';
  sentinel.innerHTML = '<span class="session-sentinel-dot"></span><span class="session-sentinel-dot"></span><span class="session-sentinel-dot"></span>';
  container.appendChild(sentinel);

  _sessionSentinelIO = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting || _decisionsLoading || _decisionsAllLoaded) return;
    _decisionsLoading = true;
    _decisionsOffset += DECISIONS_PAGE;
    loadDecisions(true).finally(() => { _decisionsLoading = false; });
  }, { rootMargin: '120px' });
  _sessionSentinelIO.observe(sentinel);
}

function _renderDecisionBatch(data) {
  const _allPcts = Object.values(_snapDeltaMap).map(v => Math.abs(v.pct));
  const _maxPct  = _allPcts.length ? Math.max(..._allPcts, 0.01) : 1;
  return data.map(d => {
    const orders = d.orders || [];
    const divider = d.run_date !== _lastDecisionDate
      ? `<div class="session-date-divider"><span>${relativeDate(d.run_date)}</span></div>`
      : '';
    _lastDecisionDate = d.run_date;
    const chips = orders.map(o =>
      `<span class="order-chip order-${o.side}">${o.side.toUpperCase()} ${o.symbol}</span>`
    ).join('');
    const orderCards = orders.length ? orders.map(o => {
      const filledPx  = parseFloat(o.filled_avg_price);
      const filledQty = parseFloat(o.filled_qty) || parseFloat(o.qty) || 0;
      const notional  = parseFloat(o.notional);
      // Cost basis of this order
      const cost = !isNaN(filledPx) && filledQty ? filledPx * filledQty
                 : !isNaN(notional) ? notional : NaN;
      // Current price from positions cache
      const currPos = (window._latestPositions || []).find(p => p.symbol === o.symbol);
      const currPx  = currPos ? parseFloat(currPos.current_price) : NaN;
      let gainBadge = '';
      if (o.side === 'buy' && !isNaN(cost) && !isNaN(currPx) && filledQty) {
        const gain    = (currPx - filledPx) * filledQty;
        const gainPct = !isNaN(filledPx) && filledPx > 0 ? ((currPx - filledPx) / filledPx * 100) : NaN;
        const cls     = gain >= 0 ? 'pos' : 'neg';
        const sign    = gain >= 0 ? '+' : '';
        gainBadge = `<span class="order-gain ${cls}" title="Gain since this buy">
          ${sign}$${Math.abs(gain).toFixed(2)} (${sign}${gainPct.toFixed(1)}%)
        </span>`;
      }
      const filledLine = !isNaN(filledPx) && filledPx > 0
        ? `<span class="order-filled">filled @ $${filledPx.toFixed(2)}${filledQty ? ` · ${filledQty.toFixed(4)} sh` : ''}</span>`
        : '';
      return `
        <div class="order-card ${o.side}">
          <div class="order-card-top">
            <span class="order-label" style="color:${o.side === 'buy' ? 'var(--green)' : 'var(--red)'}">
              ${o.side.toUpperCase()} ${o.symbol}
            </span>
            ${gainBadge}
          </div>
          ${filledLine}
          <div class="order-reason">"${o.reason}"</div>
        </div>`;
    }).join('') : '<p style="color:var(--muted);font-size:13px">No trades — held all positions.</p>';

    const rawNarrative = (d.claude_narrative || '').replace(/\s+/g, ' ').trim();
    const narrativePreview = rawNarrative.length > 100
      ? rawNarrative.slice(0, 100).replace(/\s\S+$/, '') + '…'
      : rawNarrative;

    const snapEntry = _snapDeltaMap[d.run_date];
    const pnlBadge = snapEntry
      ? (() => {
          const { delta, pct } = snapEntry;
          const cls  = delta >= 0 ? 'pos' : 'neg';
          const sign = delta >= 0 ? '+' : '';
          const abs  = Math.abs(delta);
          const valStr = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`;
          return `<span class="session-pnl-badge ${cls}">${sign}${valStr} (${sign}${pct.toFixed(1)}%)</span>`;
        })()
      : '';

    const pnlDir  = snapEntry ? (snapEntry.delta >= 0 ? 'pos' : 'neg') : '';
    const pnlBarW = snapEntry ? Math.round(Math.abs(snapEntry.pct) / _maxPct * 100) : 0;

    return divider + `
      <div class="decision" id="dec-${d.id}" data-date="${d.run_date}" data-has-trades="${orders.length > 0 ? '1' : '0'}" data-pnl="${pnlDir}" data-syms="${[...new Set(orders.map(o => o.symbol))].join(',')}">
        <div class="decision-header" onclick="toggleDecision(${d.id})">
          <div class="decision-header-inner">
            <div class="decision-meta">
              ${orders.length === 0 ? 'Held all positions' : `${orders.length} trade${orders.length !== 1 ? 's' : ''}`}
              ${pnlBadge}
              ${chips}
            </div>
            ${narrativePreview ? `<div class="decision-preview">${narrativePreview}</div>` : ''}
          </div>
          <i class="decision-chevron">›</i>
          ${pnlBarW > 0 ? `<div class="decision-pnl-bar ${pnlDir}" style="width:${pnlBarW}%"></div>` : ''}
        </div>
        <div class="decision-body" id="body-${d.id}">
          <div class="decision-body-inner">
            <div style="margin-bottom:12px">${orderCards}</div>
            ${d.claude_narrative ? `
            <div class="narrative-wrap">
              <button type="button" class="copy-narrative" onclick="copyNarrative(this)" data-text="${d.claude_narrative.replace(/"/g,'&quot;')}" title="Copy narrative">⎘</button>
              <div class="narrative">${_formatNarrative(d.claude_narrative)}</div>
            </div>` : ''}
            <div class="session-meta">${(d.tokens_used || 0).toLocaleString()} tokens &nbsp;·&nbsp; ${(d.run_duration_sec || 0).toFixed(1)}s</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function _narrativeSentiment(text) {
  const t = text.toLowerCase();
  const score = (words) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const bullWords = ['bullish','opportunity','upside','growth','strong','momentum','rally','breakout','outperform','confidence','optimistic','favorable','positive','conviction','aggressive'];
  const bearWords = ['cautious','risk','volatile','defensive','concern','uncertain','headwind','pullback','correction','overvalued','expensive','caution','worry','bearish','avoid','reduce','trim'];
  const b = score(bullWords), e = score(bearWords);
  if (b > e + 1) return { key: 'bull', icon: '▲', label: 'Bullish' };
  if (e > b + 1) return { key: 'bear', icon: '▼', label: 'Cautious' };
  return { key: 'neutral', icon: '◆', label: 'Neutral' };
}

async function loadDecisions(append = false) {
  const container = $('decisions-container');
  if (!append) {
    _decisionsOffset = 0;
    _decisionsAllLoaded = false;
    _decisionsTotals = { sessions: 0, orders: 0, tradeSessions: 0 };
    _lastDecisionDate = null;
  }

  // Remove existing sentinel before fetching (re-armed below if hasMore)
  if (!append) {
    if (_sessionSentinelIO) { _sessionSentinelIO.disconnect(); _sessionSentinelIO = null; }
    document.getElementById('session-sentinel')?.remove();
  }

  try {
    // Fetch decisions; on first load also fetch snapshots to build the daily P&L delta map
    const [data, snapsRaw] = await Promise.all([
      fetch(`/api/decisions?limit=${DECISIONS_PAGE + 1}&offset=${_decisionsOffset}`).then(r => r.json()),
      !append ? fetch('/api/snapshots?limit=500').then(r => r.json()).catch(() => []) : Promise.resolve(null),
    ]);

    // Build date -> { delta, pct } from consecutive snapshots (oldest-first)
    if (snapsRaw && snapsRaw.length) {
      _snapDeltaMap = {};
      const sorted = [...snapsRaw].sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));
      sorted.forEach((s, i) => {
        if (i === 0) return;
        const prev = sorted[i - 1].total_value;
        const curr = s.total_value;
        if (prev != null && curr != null && prev > 0) {
          _snapDeltaMap[s.snapshot_date] = { delta: curr - prev, pct: (curr - prev) / prev * 100 };
        }
      });
      buildHeatmap(_snapDeltaMap);
      buildPerfStrip(_snapDeltaMap, sorted);
    }

    const hasMore = data.length > DECISIONS_PAGE;
    const batch = data.slice(0, DECISIONS_PAGE);

    // Accumulate totals
    _decisionsTotals.sessions    += batch.length;
    _decisionsTotals.orders      += batch.reduce((n, d) => n + (d.orders || []).length, 0);
    _decisionsTotals.tradeSessions += batch.filter(d => (d.orders || []).length > 0).length;

    const countEl = $('session-count');
    if (countEl) {
      const { sessions, orders, tradeSessions } = _decisionsTotals;
      const pct = sessions ? Math.round(100 * tradeSessions / sessions) : 0;
      const suffix = hasMore ? '+' : '';
      countEl.textContent = `${sessions}${suffix} sessions · ${orders} orders · ${pct}% active`;
    }

    if (!append && !batch.length) {
      container.innerHTML = `
        <div class="empty">
          <div class="icon">📋</div>
          <p>No sessions yet — hit Run Now to start</p>
        </div>`;
      return;
    }

    // Claude's stance banner: first sentence of most recent narrative
    if (!append && batch.length) {
      const stanceEl = document.getElementById('claude-stance');
      const raw = (batch[0].claude_narrative || '').trim();
      if (stanceEl && raw) {
        const sentenceEnd = raw.search(/[.!?](\s|$)/);
        const sentence = sentenceEnd >= 0 ? raw.slice(0, sentenceEnd + 1) : raw.slice(0, 160);
        const dateLabel = relativeDate(batch[0].run_date);
        const tradeCount = (batch[0].orders || []).length;
        const tradeMeta = tradeCount === 0 ? 'Held all positions' : `${tradeCount} trade${tradeCount !== 1 ? 's' : ''}`;
        const sentiment = _narrativeSentiment(raw);
        stanceEl.innerHTML = `
          <div class="cs-label">Claude</div>
          <div class="cs-body">
            <div class="cs-text">${sentence}</div>
            <div class="cs-meta">${dateLabel} · ${tradeMeta}</div>
          </div>
          <span class="cs-sentiment cs-sent-${sentiment.key}" title="${sentiment.label}">${sentiment.icon}</span>`;
        stanceEl.style.display = 'flex';
      }
    }

    const html = _renderDecisionBatch(batch);
    if (append) {
      container.insertAdjacentHTML('beforeend', html);
    } else {
      container.innerHTML = html;
      // Auto-expand most recent entry on first page load only
      if (!_decisionsAutoExpanded && batch.length) {
        _decisionsAutoExpanded = true;
        const firstDec = container.querySelector('.decision');
        if (firstDec) {
          const id = firstDec.id.replace('dec-', '');
          document.getElementById(`body-${id}`)?.classList.add('open');
          firstDec.classList.add('expanded');
        }
      }
    }

    _rebuildTickerChips();

    if (hasMore) {
      _decisionsAllLoaded = false;
      _armSessionSentinel(container);
    } else {
      _decisionsAllLoaded = true;
      if (_sessionSentinelIO) { _sessionSentinelIO.disconnect(); _sessionSentinelIO = null; }
      document.getElementById('session-sentinel')?.remove();
    }
  } catch (e) {
    if (!append) container.innerHTML = '<div class="empty"><p>Could not load session log</p></div>';
  }
}

// ── Performance heatmap ───────────────────────────────────────────────

function buildPerfStrip(snapDeltaMap, snaps = null) {
  const strip = document.getElementById('perf-strip');
  if (!strip) return;
  const entries = Object.entries(snapDeltaMap);
  if (entries.length < 2) { strip.style.display = 'none'; return; }

  const wins = entries.filter(([, v]) => v.delta >= 0);
  const losses = entries.filter(([, v]) => v.delta < 0);
  const winRate = Math.round(wins.length / entries.length * 100);

  const best  = entries.reduce((a, b) => b[1].pct > a[1].pct ? b : a);
  const worst = entries.reduce((a, b) => b[1].pct < a[1].pct ? b : a);

  // Max drawdown from absolute portfolio values
  let maxDD = null;
  let maxDDFrom = null, maxDDTo = null;
  if (snaps && snaps.length >= 2) {
    let peak = snaps[0].total_value;
    let peakDate = snaps[0].snapshot_date;
    for (const s of snaps) {
      if (s.total_value > peak) { peak = s.total_value; peakDate = s.snapshot_date; }
      const dd = peak > 0 ? (s.total_value - peak) / peak * 100 : 0;
      if (dd < (maxDD ?? 0)) { maxDD = dd; maxDDFrom = peakDate; maxDDTo = s.snapshot_date; }
    }
  }

  const fmtDate = d => {
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'}); }
    catch(e) { return d; }
  };
  const fmtPct = (v, withSign = true) => `${withSign && v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtDollar = v => {
    const a = Math.abs(v);
    const s = v >= 0 ? '+' : '-';
    return a >= 1000 ? `${s}$${(a/1000).toFixed(1)}k` : `${s}$${a.toFixed(0)}`;
  };

  const metric = (label, value, sub, cls = '', tip = '') => `
    <div class="ps-metric"${tip ? ` data-tip="${tip}"` : ''}>
      <div class="ps-label">${label}</div>
      <div class="ps-value${cls ? ' ' + cls : ''}">${value}</div>
      ${sub ? `<div class="ps-sub">${sub}</div>` : ''}
    </div>`;

  const divider = '<div class="ps-divider"></div>';

  const maxDDMetric = maxDD != null && maxDD < 0
    ? divider + metric('Max Drawdown', fmtPct(maxDD, false),
        maxDDFrom && maxDDTo && maxDDFrom !== maxDDTo
          ? `${fmtDate(maxDDFrom)} → ${fmtDate(maxDDTo)}`
          : `${entries.length} sessions`, 'neg',
        'Largest peak-to-trough decline. Lower is better — measures the worst losing streak the portfolio experienced.')
    : divider + metric('Avg Session',
        fmtPct(entries.reduce((s, [, v]) => s + v.pct, 0) / entries.length),
        `${entries.length} days tracked`,
        entries.reduce((s, [, v]) => s + v.pct, 0) / entries.length >= 0 ? 'pos' : 'neg',
        'Average daily P&L as a % of portfolio value, across all tracked sessions.');

  const winRateColor = winRate >= 50 ? 'var(--green)' : 'var(--red)';
  const winRateMetric = `
    <div class="ps-metric" data-tip="% of sessions where the portfolio gained value. Above 50% means more wins than losses.">
      <div class="ps-label">Win Rate</div>
      <div class="ps-value ${winRate >= 50 ? 'pos' : 'neg'}">${winRate}%</div>
      <div class="ps-win-bar" title="${wins.length} wins · ${losses.length} losses">
        <div class="ps-win-fill" style="width:${winRate}%;background:${winRateColor}"></div>
      </div>
      <div class="ps-sub">${wins.length}W / ${losses.length}L</div>
    </div>`;

  // Sharpe ratio + annualized volatility (needs ≥10 data points)
  let sharpeMetric = '';
  if (entries.length >= 10) {
    const rets  = entries.map(([, v]) => v.pct / 100);
    const mean  = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1);
    const stdDev   = Math.sqrt(variance);
    const annVol   = stdDev * Math.sqrt(252) * 100; // as percent
    const annRet   = mean * 252 * 100;
    const rfAnn    = 5.0; // risk-free rate %
    const sharpe   = annVol > 0 ? (annRet - rfAnn) / annVol : null;
    if (sharpe != null) {
      const sharpeCls = sharpe >= 1 ? 'pos' : sharpe >= 0 ? '' : 'neg';
      const sharpeTag = entries.length < 30 ? 'Limited data' : sharpe >= 2 ? 'Excellent' : sharpe >= 1 ? 'Good' : sharpe >= 0 ? 'Fair' : 'Below avg';
      sharpeMetric = divider + metric(
        'Sharpe (Ann.)',
        sharpe.toFixed(2),
        `Vol ${annVol.toFixed(1)}% · ${sharpeTag}`,
        sharpeCls,
        'Risk-adjusted return. Above 1.0 is good; above 2.0 is excellent. Assumes a 5% risk-free rate. Annualized from daily returns.'
      );
    }
  }

  // Portfolio beta vs SPY (uses returns stored by loadChart)
  let betaMetric = '';
  const spySnap = window._spySnapshotReturns || [];
  const portRets = entries.map(([, v]) => v.pct);
  if (spySnap.length >= 10 && portRets.length >= 10) {
    const n = Math.min(spySnap.length, portRets.length);
    const pRets = portRets.slice(-n);
    const sRets = spySnap.slice(-n);
    const pMean = pRets.reduce((a, b) => a + b, 0) / n;
    const sMean = sRets.reduce((a, b) => a + b, 0) / n;
    const cov    = pRets.reduce((s, p, i) => s + (p - pMean) * (sRets[i] - sMean), 0) / (n - 1);
    const spyVar = sRets.reduce((s, x) => s + (x - sMean) ** 2, 0) / (n - 1);
    const beta   = spyVar > 0 ? cov / spyVar : null;
    if (beta != null && isFinite(beta)) {
      const betaCls   = beta < 0.85 ? 'pos' : beta > 1.25 ? 'neg' : '';
      const betaLabel = beta < 0.6  ? 'Low risk'
                      : beta < 0.9  ? 'Defensive'
                      : beta <= 1.1 ? 'Market-like'
                      : beta <= 1.4 ? 'Aggressive'
                      : 'High risk';
      betaMetric = divider + metric('Beta (vs SPY)', beta.toFixed(2), betaLabel, betaCls,
        'Sensitivity to S&P 500 moves. 1.0 moves with the market. Below 1.0 is more defensive; above 1.0 amplifies market swings.');
    }
  }

  strip.innerHTML =
    winRateMetric +
    divider +
    metric('Best Session', fmtPct(best[1].pct),
      `${fmtDollar(best[1].delta)} · ${fmtDate(best[0])}`, 'pos',
      'Highest single-day gain across all trading sessions.') +
    divider +
    metric('Worst Session', fmtPct(worst[1].pct),
      `${fmtDollar(worst[1].delta)} · ${fmtDate(worst[0])}`, 'neg',
      'Largest single-day loss across all trading sessions.') +
    maxDDMetric +
    sharpeMetric +
    betaMetric;

  strip.style.display = 'flex';

  // Mini bar chart on Day P&L card showing last 14 sessions for context
  const dayCard = document.getElementById('stat-day-card');
  if (dayCard && entries.length >= 2) {
    const recent = [...entries].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-14);
    const maxAbs = Math.max(...recent.map(([, e]) => Math.abs(e.delta)));
    if (maxAbs > 0) {
      const BAR_W = 100, BAR_H = 20;
      const bw = Math.floor(BAR_W / recent.length) - 1;
      const bars = recent.map(([, e], i) => {
        const h = Math.max(2, Math.round(Math.abs(e.delta) / maxAbs * BAR_H));
        const color = e.delta >= 0 ? '#16a34a' : '#dc2626';
        return `<rect x="${i * (bw + 1)}" y="${BAR_H - h}" width="${bw}" height="${h}" fill="${color}" opacity="0.65" rx="1"/>`;
      }).join('');
      let barsWrap = dayCard.querySelector('.stat-day-bars');
      if (!barsWrap) {
        barsWrap = document.createElement('div');
        barsWrap.className = 'stat-day-bars';
        dayCard.appendChild(barsWrap);
      }
      barsWrap.innerHTML = `<svg viewBox="0 0 ${BAR_W} ${BAR_H}" preserveAspectRatio="none" style="width:100%;height:20px;display:block">${bars}</svg>`;
    }
  }
}

function buildHeatmap(snapDeltaMap) {
  const card      = document.getElementById('heatmap-card');
  const container = document.getElementById('heatmap-container');
  const legendEl  = document.getElementById('heatmap-legend');
  if (!card || !container) return;

  const WEEKS = 18;
  const todayStr = new Date().toISOString().split('T')[0];
  const today = new Date();

  // Anchor the grid: last column ends on the Saturday of this week
  const endSunday = new Date(today);
  endSunday.setDate(today.getDate() + (6 - today.getDay())); // this Saturday
  const start = new Date(endSunday);
  start.setDate(endSunday.getDate() - WEEKS * 7 + 1); // Sunday of the earliest week

  // Collect all cells: [week][dow]
  const grid = []; // grid[week][dow] = { dateStr, entry }
  const monthLabels = []; // [{ week, label }]
  let lastMonth = -1;
  const cur = new Date(start);
  for (let w = 0; w < WEEKS; w++) {
    grid.push([]);
    for (let dow = 0; dow < 7; dow++) {
      const dateStr = cur.toISOString().split('T')[0];
      if (cur.getMonth() !== lastMonth) {
        monthLabels.push({ week: w, label: cur.toLocaleDateString('en-US', { month: 'short' }) });
        lastMonth = cur.getMonth();
      }
      grid[w].push({ dateStr, entry: snapDeltaMap[dateStr] || null });
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Compute current streak (consecutive green or red trading days, most-recent first)
  const streakEl = document.getElementById('heatmap-streak');
  if (streakEl) {
    const sortedDates = Object.keys(snapDeltaMap).sort().reverse();
    let streak = 0;
    let streakSign = null;
    for (const date of sortedDates) {
      const sign = snapDeltaMap[date].delta >= 0 ? 1 : -1;
      if (streakSign === null) { streakSign = sign; streak = 1; }
      else if (sign === streakSign) { streak++; }
      else { break; }
    }
    if (streak >= 2 && streakSign !== null) {
      const isWin = streakSign === 1;
      const label = isWin ? `${streak}-day win streak` : `${streak}-day drawdown`;
      streakEl.className = `streak-badge ${isWin ? 'streak-win' : 'streak-loss'}`;
      streakEl.textContent = label;
    } else {
      streakEl.textContent = '';
      streakEl.className = '';
    }
  }

  // Normalize intensities
  const allPcts = Object.values(snapDeltaMap).map(e => Math.abs(e.pct));
  const maxPct = allPcts.length ? Math.max(...allPcts) : 1;

  function cellColor(entry) {
    if (!entry) return null;
    const intensity = Math.min(Math.abs(entry.pct) / maxPct, 1);
    const alpha = 0.15 + intensity * 0.82;
    return entry.delta >= 0
      ? `rgba(22,163,74,${alpha.toFixed(2)})`
      : `rgba(220,38,38,${alpha.toFixed(2)})`;
  }

  // Build month label row
  let monthHtml = '<div class="heatmap-months">';
  let prev = 0;
  monthLabels.forEach(({ week, label }) => {
    if (week > prev || week === 0) {
      monthHtml += `<span class="heatmap-month" style="grid-column:${week + 1}">${label}</span>`;
      prev = week;
    }
  });
  monthHtml += '</div>';

  // Build grid rows (dow 0=Sun … 6=Sat)
  const dowLabels = ['S','M','T','W','T','F','S'];
  let gridHtml = '<div class="heatmap-grid">';
  for (let dow = 0; dow < 7; dow++) {
    gridHtml += `<div class="heatmap-row"><span class="heatmap-dow">${dowLabels[dow]}</span>`;
    for (let w = 0; w < WEEKS; w++) {
      const { dateStr, entry } = grid[w][dow];
      const isFuture = dateStr > todayStr;
      const color = cellColor(entry);
      const colorAttr = color ? ` style="background:${color}"` : '';
      const cls = isFuture ? ' heatmap-future' : (entry ? '' : ' heatmap-empty');
      const title = entry
        ? `${dateStr}: ${entry.delta >= 0 ? '+' : ''}${entry.delta.toFixed(2)} (${entry.pct >= 0 ? '+' : ''}${entry.pct.toFixed(2)}%)`
        : dateStr;
      gridHtml += `<div class="heatmap-cell${cls}"${colorAttr} data-date="${dateStr}"` +
        (entry ? ` data-delta="${entry.delta.toFixed(2)}" data-pct="${entry.pct.toFixed(2)}"` : '') +
        ` aria-label="${title}"></div>`;
    }
    gridHtml += '</div>';
  }
  gridHtml += '</div>';

  container.innerHTML = monthHtml + gridHtml;
  card.style.display = '';

  // Legend
  if (legendEl) {
    legendEl.innerHTML = `
      <span class="heatmap-legend-label">Less</span>
      <div class="heatmap-legend-cells">
        ${[.15,.35,.55,.75,.95].map(a =>
          `<div class="heatmap-cell" style="background:rgba(22,163,74,${a})"></div>`
        ).join('')}
      </div>
      <span class="heatmap-legend-label">More</span>`;
  }

  // Hover tooltip
  let htip = document.getElementById('heatmap-tip');
  if (!htip) {
    htip = document.createElement('div');
    htip.id = 'heatmap-tip';
    htip.className = 'heatmap-tip';
    document.body.appendChild(htip);
  }

  container.addEventListener('mousemove', e => {
    const cell = e.target.closest('.heatmap-cell[data-date]');
    if (!cell || cell.classList.contains('heatmap-future')) {
      htip.style.opacity = '0';
      return;
    }
    const date = cell.dataset.date;
    const delta = cell.dataset.delta != null ? parseFloat(cell.dataset.delta) : null;
    const pct   = cell.dataset.pct   != null ? parseFloat(cell.dataset.pct)   : null;
    const sign  = delta != null && delta >= 0 ? '+' : '';
    const cls   = delta != null ? (delta >= 0 ? 'pos' : 'neg') : '';
    htip.innerHTML = `<div class="heatmap-tip-date">${date}</div>` +
      (delta != null
        ? `<div class="heatmap-tip-val ${cls}">${sign}$${Math.abs(delta).toFixed(2)} &nbsp;<span class="heatmap-tip-pct">${sign}${pct.toFixed(2)}%</span></div>`
        : `<div class="heatmap-tip-val" style="color:var(--muted)">No data</div>`);
    const bRect = container.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    let left = cRect.left - bRect.left + cRect.width / 2;
    const tipW = 130;
    left = Math.max(tipW / 2, Math.min(bRect.width - tipW / 2, left));
    htip.style.left = left + 'px';
    htip.style.top  = (cRect.top - bRect.top - 4) + 'px';
    htip.style.opacity = '1';
  });
  container.addEventListener('mouseleave', () => { htip.style.opacity = '0'; });

  container.addEventListener('click', e => {
    const cell = e.target.closest('.heatmap-cell[data-date][data-delta]');
    if (!cell || cell.classList.contains('heatmap-future')) return;
    const date = cell.dataset.date;
    const decEl = document.querySelector(`.decision[data-date="${date}"]`);
    if (!decEl) { showToast('Session', `No session recorded for ${date}.`, 'info', 2000); return; }
    // Auto-expand if collapsed
    const body = decEl.querySelector('.decision-body');
    if (body && !body.classList.contains('open')) toggleDecision(parseInt(decEl.id.replace('dec-', '')));
    decEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    decEl.classList.remove('heatmap-jump');
    void decEl.offsetWidth;
    decEl.classList.add('heatmap-jump');
    decEl.addEventListener('animationend', () => decEl.classList.remove('heatmap-jump'), { once: true });
  });
}

// ── Analyst consensus bar ─────────────────────────────────────────────

function _buildAnalystBar(fund) {
  const rec    = (fund.analyst_recommendation || '').toLowerCase().replace(/[-\s]/g, '_');
  const target = parseFloat(fund.analyst_target);
  if (!rec) return '';

  const scale = {
    strong_buy: 0.92, buy: 0.72, outperform: 0.72, overweight: 0.72,
    market_perform: 0.5, neutral: 0.5, hold: 0.5,
    underperform: 0.28, underweight: 0.28, sell: 0.08, strong_sell: 0.08,
  };
  const pct = scale[rec];
  if (pct == null) return '';

  const label     = rec.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const labelCls  = pct >= 0.65 ? 'pos' : pct <= 0.35 ? 'neg' : '';
  const targetHtml = !isNaN(target) && target > 0
    ? `<span class="analyst-target-val">Target <strong>$${target.toFixed(2)}</strong></span>`
    : '';

  return `
  <div class="pos-sparkline-wrap pos-analyst-wrap">
    <div class="analyst-wrap-row">
      <div class="section-label">Analyst Consensus</div>
      ${targetHtml}
    </div>
    <div class="analyst-gradient-bar">
      <div class="analyst-marker" style="left:${(pct * 100).toFixed(1)}%"></div>
    </div>
    <div class="analyst-scale-labels">
      <span>Sell</span><span>Hold</span><span>Buy</span>
    </div>
    <div class="analyst-rec-label${labelCls ? ' ' + labelCls : ''}">${label}</div>
  </div>`;
}

// ── Drawer chart helpers ──────────────────────────────────────────────

function _buildDrawerChartSVG(closes, avgEntry = null, symOrders = null, period = '7d', spyCloses = []) {
  if (!closes || closes.length < 2) {
    return '<span style="color:var(--muted);font-size:12px;display:block;padding:20px 0">No data</span>';
  }
  const W = 320, H = 110, PAD = 2;
  const last  = closes[closes.length - 1];
  const first = closes[0];
  const isUp  = last >= first;
  const color = isUp ? '#16a34a' : '#dc2626';
  const pct   = ((last - first) / first * 100);
  const sign  = pct >= 0 ? '+' : '';

  // Normalize SPY to position's starting price
  let spyNorm = [], spyLine = '', spyAlphaHtml = '';
  if (spyCloses.length >= 2) {
    const n = closes.length;
    const step = (spyCloses.length - 1) / Math.max(n - 1, 1);
    spyNorm = Array.from({length: n}, (_, i) =>
      spyCloses[Math.min(Math.round(i * step), spyCloses.length - 1)] / spyCloses[0] * first);
    const spyPct   = (spyNorm[spyNorm.length - 1] - first) / first * 100;
    const alpha    = pct - spyPct;
    const alphaSign = alpha >= 0 ? '+' : '';
    const alphaCls  = alpha >= 0 ? 'pos' : 'neg';
    spyAlphaHtml = `<span class="dc-spy-alpha">vs S&P <span class="${alphaCls}">${alphaSign}${alpha.toFixed(1)}% α</span></span>`;
  }

  const min = Math.min(...closes), max = Math.max(...closes);
  const range = max - min || 1;
  const xStep = (W - PAD * 2) / (closes.length - 1);
  const yScale = v => H - PAD - ((v - min) / range) * (H - PAD * 2);
  const dcXY = closes.map((v, i) => [PAD + i * xStep, yScale(v)]);
  const dcSmoothLine = _svgSmooth(dcXY);
  const dcSmoothFill = _svgSmoothFill(dcSmoothLine, dcXY[0][0], dcXY[dcXY.length - 1][0], H);

  if (spyNorm.length) {
    const spyXY = spyNorm.map((v, i) => [PAD + i * xStep, yScale(v)]);
    spyLine = `<path d="${_svgSmooth(spyXY)}" fill="none" stroke="var(--muted-2)" stroke-width="1.2" stroke-dasharray="4,3" stroke-linecap="round" opacity="0.55" pointer-events="none"/>`;
  }
  const fmt = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(2)}`;
  const gId = `dcg${Math.random().toString(36).slice(2,7)}`;

  // Trade order markers on chart
  const periodDays = { '7d': 5, '1mo': 22, '3mo': 66, '1y': 252 };
  const totalTradingDays = periodDays[period] || 5;
  let orderMarkers = '';
  if (symOrders && symOrders.length) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    symOrders.forEach(o => {
      const px = parseFloat(o.filled_avg_price);
      if (isNaN(px) || px <= 0) return;
      const calDaysAgo = (today - new Date(o.run_date + 'T12:00:00')) / 86400000;
      const approxTradingDaysAgo = calDaysAgo * 5 / 7;
      const frac = 1 - approxTradingDaysAgo / totalTradingDays;
      if (frac < -0.05 || frac > 1.05) return;
      const cx = Math.max(PAD + 5, Math.min(W - PAD - 5, PAD + frac * (W - PAD * 2)));
      const rawY = yScale(px);
      const isBuy = o.side === 'buy';
      const mc = isBuy ? '#16a34a' : '#dc2626';
      const s = 5;
      const cy = Math.max(PAD + s + 1, Math.min(H - PAD - s - 1, rawY));
      const triPts = isBuy
        ? `${cx},${cy - s} ${cx - s},${cy + s * .65} ${cx + s},${cy + s * .65}`
        : `${cx},${cy + s} ${cx - s},${cy - s * .65} ${cx + s},${cy - s * .65}`;
      orderMarkers += `<polygon points="${triPts}" fill="${mc}" opacity="0.85" stroke="var(--surface)" stroke-width="0.8" pointer-events="none"/>`;
    });
  }

  // Entry price reference line (position drawer only)
  let entryLine = '';
  if (avgEntry != null && !isNaN(avgEntry)) {
    const slack = range * 0.2;
    if (avgEntry >= min - slack && avgEntry <= max + slack) {
      const ey = Math.max(PAD, Math.min(H - PAD, yScale(avgEntry)));
      const entryColor = avgEntry <= last ? '#16a34a' : '#dc2626';
      const labelY = ey <= 14 ? ey + 9 : ey - 3;
      entryLine = `
    <line x1="${PAD}" y1="${ey}" x2="${W - PAD}" y2="${ey}"
      stroke="${entryColor}" stroke-width="1" stroke-dasharray="4,3" opacity="0.55" pointer-events="none"/>
    <text x="${W - PAD - 2}" y="${labelY}" font-size="8" fill="${entryColor}" opacity="0.75"
      text-anchor="end" pointer-events="none">avg $${avgEntry.toFixed(2)}</text>`;
    }
  }

  return `
  <div class="dc-chart-header">
    <div class="drawer-chart-pct ${isUp ? 'pos' : 'neg'} dc-pct-label">${sign}${pct.toFixed(2)}%</div>
    ${spyAlphaHtml}
  </div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:110px;display:block;overflow:visible;cursor:crosshair"
       data-closes='${JSON.stringify(closes)}' data-first="${first}">
    <defs>
      <linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path class="dc-fill" d="${dcSmoothFill}" fill="url(#${gId})" opacity="0"/>
    ${entryLine}
    ${spyLine}
    <path class="dc-line" d="${dcSmoothLine}" fill="none" stroke="${color}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
    ${orderMarkers}
    <text x="${PAD}" y="10" font-size="9" fill="var(--muted-2)">${fmt(max)}</text>
    <text x="${PAD}" y="${H - 2}" font-size="9" fill="var(--muted-2)">${fmt(min)}</text>
    <line class="dc-xhair" x1="0" y1="0" x2="0" y2="${H}" stroke="${color}" stroke-width="1" stroke-dasharray="3,3" opacity="0" pointer-events="none"/>
    <circle class="dc-dot" cx="0" cy="0" r="4" fill="${color}" stroke="var(--surface)" stroke-width="1.5" opacity="0" pointer-events="none"/>
    <rect class="dc-overlay" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
  </svg>`;
}

async function toggleDrawerWatchlist(symbol, btn) {
  const inList = _watchlistSymbols.has(symbol);
  try {
    let data;
    if (inList) {
      data = await fetch(`/api/watchlist/${symbol}`, { method: 'DELETE' }).then(r => r.json());
    } else {
      data = await fetch('/api/watchlist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      }).then(r => r.json());
    }
    renderWatchlistChips(data.watchlist || []);
    const nowIn = _watchlistSymbols.has(symbol);
    if (btn) {
      btn.textContent = nowIn ? '★' : '☆';
      btn.title = nowIn ? 'Remove from watchlist' : 'Add to watchlist';
      btn.classList.toggle('wl-btn-active', nowIn);
    }
    showToast(nowIn ? `${symbol} added to watchlist` : `${symbol} removed`, '', nowIn ? 'success' : 'info', 2500);
  } catch(e) {
    showToast('Watchlist error', e.message, 'error');
  }
}

function _drawerPeriod() { return localStorage.getItem('drawer-period') || '7d'; }

// ── Price alerts ──────────────────────────────────────────────────────

function _loadAlert(sym) {
  try { return JSON.parse(localStorage.getItem(`price-alert-${sym}`) || 'null') || {}; }
  catch(e) { return {}; }
}

function savePriceAlert(sym) {
  const above = parseFloat(document.getElementById(`alert-above-${sym}`)?.value) || null;
  const below = parseFloat(document.getElementById(`alert-below-${sym}`)?.value) || null;
  const prev  = _loadAlert(sym);
  const next  = { above, below,
    firedAbove: above === prev.above ? prev.firedAbove : false,
    firedBelow: below === prev.below ? prev.firedBelow : false };
  if (above || below) localStorage.setItem(`price-alert-${sym}`, JSON.stringify(next));
  else               localStorage.removeItem(`price-alert-${sym}`);
  _updateAlertIndicators();
  showToast(`${sym} alert ${above || below ? 'set' : 'cleared'}`, '', 'success', 2500);
  // Refresh the Clear button visibility
  const section = document.getElementById(`alert-section-${sym}`);
  if (section) {
    const actions = section.querySelector('.alert-actions');
    if (actions) {
      let clearBtn = actions.querySelector('.btn-ghost');
      if (above || below) {
        if (!clearBtn) {
          clearBtn = document.createElement('button');
          clearBtn.className = 'btn btn-ghost btn-sm';
          clearBtn.onclick = () => clearPriceAlert(sym);
          clearBtn.textContent = 'Clear';
          actions.appendChild(clearBtn);
        }
      } else if (clearBtn) {
        clearBtn.remove();
      }
    }
  }
}

function clearPriceAlert(sym) {
  localStorage.removeItem(`price-alert-${sym}`);
  _updateAlertIndicators();
  const aboveIn = document.getElementById(`alert-above-${sym}`);
  const belowIn = document.getElementById(`alert-below-${sym}`);
  if (aboveIn) aboveIn.value = '';
  if (belowIn) belowIn.value = '';
  const section = document.getElementById(`alert-section-${sym}`);
  if (section) section.querySelector('.btn-ghost')?.remove();
  showToast(`${sym} alert cleared`, '', 'info', 2500);
}

function _updateAlertIndicators() {
  document.querySelectorAll('.wl-item[data-symbol]').forEach(item => {
    const sym = item.dataset.symbol;
    const saved = _loadAlert(sym);
    const hasAlert = saved.above != null || saved.below != null;
    let dot = item.querySelector('.alert-dot');
    if (hasAlert && !dot) {
      dot = document.createElement('span');
      dot.className = 'alert-dot';
      dot.title = [
        saved.above != null ? `Above $${saved.above}` : null,
        saved.below != null ? `Below $${saved.below}` : null,
      ].filter(Boolean).join(' · ');
      // Insert before the remove button
      const removeBtn = item.querySelector('.wl-remove');
      if (removeBtn) item.insertBefore(dot, removeBtn);
      else item.appendChild(dot);
    } else if (!hasAlert && dot) {
      dot.remove();
    } else if (hasAlert && dot) {
      dot.title = [
        saved.above != null ? `Above $${saved.above}` : null,
        saved.below != null ? `Below $${saved.below}` : null,
      ].filter(Boolean).join(' · ');
    }
  });
}

function _checkPriceAlerts(priceMap) {
  // priceMap: { sym -> lastClosePrice }
  for (const [sym, price] of Object.entries(priceMap)) {
    if (!price || !isFinite(price)) continue;
    const raw = localStorage.getItem(`price-alert-${sym}`);
    if (!raw) continue;
    let alert;
    try { alert = JSON.parse(raw); } catch(e) { continue; }

    let changed = false;
    if (alert.above != null && price >= alert.above && !alert.firedAbove) {
      alert.firedAbove = true; changed = true;
      showToast(`🔔 ${sym} above $${alert.above}`, `Last close: $${price.toFixed(2)}`, 'success', 6000);
      sendNotification(`${sym} price alert`, `${sym} is above $${alert.above} — last close $${price.toFixed(2)}`);
    } else if (alert.above != null && price < alert.above && alert.firedAbove) {
      alert.firedAbove = false; changed = true;
    }
    if (alert.below != null && price <= alert.below && !alert.firedBelow) {
      alert.firedBelow = true; changed = true;
      showToast(`🔔 ${sym} below $${alert.below}`, `Last close: $${price.toFixed(2)}`, 'error', 6000);
      sendNotification(`${sym} price alert`, `${sym} is below $${alert.below} — last close $${price.toFixed(2)}`);
    } else if (alert.below != null && price > alert.below && alert.firedBelow) {
      alert.firedBelow = false; changed = true;
    }
    if (changed) localStorage.setItem(`price-alert-${sym}`, JSON.stringify(alert));
  }
}

function savePosNote(symbol, text) {
  const key = `pos-note-${symbol}`;
  if (text.trim()) localStorage.setItem(key, text);
  else localStorage.removeItem(key);
  _updateNoteIndicators();
}

function _updateNoteIndicators() {
  document.querySelectorAll('td[data-sym]').forEach(td => {
    const sym = td.dataset.sym;
    const hasNote = !!localStorage.getItem(`pos-note-${sym}`);
    let dot = td.querySelector('.note-dot');
    if (hasNote && !dot) {
      dot = document.createElement('span');
      dot.className = 'note-dot';
      dot.title = 'You have notes on this position';
      td.appendChild(dot);
    } else if (!hasNote && dot) {
      dot.remove();
    }
  });
}

async function drawerSetPeriod(period, symbol, btn) {
  // 'mine' is ephemeral — don't persist it so other positions get normal default
  if (period !== 'mine') localStorage.setItem('drawer-period', period);
  const tabs = btn.closest('.range-tabs');
  if (tabs) tabs.querySelectorAll('.range-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const area = document.getElementById('drawer-chart-area');
  if (!area) return;
  area.style.opacity = '0.4';
  try {
    const yfPeriod = period === 'mine' ? (btn.dataset.yfperiod || '1y') : period;
    const data = await fetch(`/api/sparklines?symbols=${symbol},SPY&period=${yfPeriod}`).then(r => r.json());
    const closes    = data[symbol] || [];
    const spyCloses = data['SPY']  || [];
    area.innerHTML = _buildDrawerChartSVG(closes, _drawerAvgEntry, _drawerSymOrders, yfPeriod, spyCloses);
    area.style.opacity = '1';
    _animateDrawerChart(area);
  } catch(e) {
    area.style.opacity = '1';
  }
}

function _animateDrawerChart(area) {
  const line = area.querySelector('.dc-line');
  const fill = area.querySelector('.dc-fill');
  if (line) {
    const len = line.getTotalLength();
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    line.style.transition = 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)';
    requestAnimationFrame(() => { line.style.strokeDashoffset = '0'; });
  }
  if (fill) {
    fill.style.transition = 'opacity .5s ease .3s';
    requestAnimationFrame(() => { fill.style.opacity = '1'; });
  }
  _initDrawerChartScrub(area);
}

function _initDrawerChartScrub(area) {
  const svg   = area.querySelector('svg[data-closes]');
  const pctEl = area.querySelector('.dc-pct-label');
  if (!svg || !pctEl) return;

  const closes = JSON.parse(svg.dataset.closes);
  const first  = parseFloat(svg.dataset.first);
  const last   = closes[closes.length - 1];
  const isUp   = last >= first;
  const color  = isUp ? '#16a34a' : '#dc2626';
  const W = 320, H = 110, PAD = 2;
  const xStep  = (W - PAD * 2) / (closes.length - 1);
  const min    = Math.min(...closes);
  const max    = Math.max(...closes);
  const range  = max - min || 1;
  const yScale = v => H - PAD - ((v - min) / range) * (H - PAD * 2);
  const xhair  = svg.querySelector('.dc-xhair');
  const dot    = svg.querySelector('.dc-dot');

  const periodPct  = first > 0 ? ((last - first) / first * 100) : 0;
  const periodSign = periodPct >= 0 ? '+' : '';
  const restoreLabel = `${periodSign}${periodPct.toFixed(2)}%`;
  const restoreCls   = `drawer-chart-pct ${isUp ? 'pos' : 'neg'} dc-pct-label`;

  function restore() {
    xhair.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
    pctEl.className   = restoreCls;
    pctEl.textContent = restoreLabel;
  }

  function scrubTo(clientX) {
    const rect = svg.getBoundingClientRect();
    const svgX = (clientX - rect.left) / rect.width * W;
    const i    = Math.max(0, Math.min(closes.length - 1, Math.round((svgX - PAD) / xStep)));
    const v    = closes[i];
    const cx   = PAD + i * xStep;
    const cy   = yScale(v);
    xhair.setAttribute('x1', cx); xhair.setAttribute('x2', cx); xhair.setAttribute('opacity', '0.55');
    dot.setAttribute('cx', cx);   dot.setAttribute('cy', cy);   dot.setAttribute('opacity', '1');
    const d    = v - first;
    const p    = first > 0 ? (d / first * 100) : 0;
    const sign = d >= 0 ? '+' : '';
    pctEl.className   = `drawer-chart-pct ${d >= 0 ? 'pos' : 'neg'} dc-pct-label`;
    pctEl.textContent = `$${v.toFixed(2)}  ${sign}${p.toFixed(2)}%`;
  }

  svg.addEventListener('mousemove',  e => scrubTo(e.clientX));
  svg.addEventListener('mouseleave', restore);
  svg.addEventListener('touchstart', e => { e.preventDefault(); scrubTo(e.touches[0].clientX); }, { passive: false });
  svg.addEventListener('touchmove',  e => { e.preventDefault(); scrubTo(e.touches[0].clientX); }, { passive: false });
  svg.addEventListener('touchend',   restore);
}

// ── Position detail drawer ────────────────────────────────────────────

async function openDrawer(symbol, posData) {
  const drawer = $('pos-drawer');
  const backdrop = $('pos-drawer-backdrop');
  const content = $('pos-drawer-content');

  // Directional slide when navigating between positions
  if (_drawerOpenSymbol && _drawerOpenSymbol !== symbol && drawer.classList.contains('open')) {
    const positions = window._latestPositions || [];
    const oldIdx = positions.findIndex(p => p.symbol === _drawerOpenSymbol);
    const newIdx = positions.findIndex(p => p.symbol === symbol);
    if (oldIdx !== -1 && newIdx !== -1) {
      const cls = newIdx > oldIdx ? 'nav-right' : 'nav-left';
      content.classList.remove('nav-right', 'nav-left');
      content.classList.add(cls);
      content.addEventListener('animationend', () => content.classList.remove(cls), { once: true });
    }
  }

  // skeleton while loading
  content.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-header-left">
        <span class="skeleton sk-line" style="width:140px;display:block;margin-bottom:6px"></span>
        <span class="symbol-pill">${symbol}</span>
      </div>
      <div class="drawer-header-right">
        <span class="skeleton sk-line" style="width:72px;display:block"></span>
      </div>
    </div>
    <div class="pos-stat-row">
      ${['Current Price','Market Value','Unrealized P&L','Day Change'].map(l =>
        `<div class="pos-stat-item"><div class="label">${l}</div><div class="val"><span class="skeleton sk-line" style="width:70%"></span></div></div>`
      ).join('')}
    </div>
    <div class="pos-chart-wrap">
      <span class="skeleton" style="display:block;width:100%;height:110px;border-radius:6px"></span>
    </div>`;

  _drawerOpenSymbol = symbol;
  _highlightDrawerRow(symbol);
  drawer.classList.add('open');
  backdrop.classList.add('open');
  _lockBodyScroll();
  document.removeEventListener('keydown', _drawerEsc);
  document.addEventListener('keydown', _drawerEsc);

  // fetch sparkline + fundamentals + decisions + news in parallel (include SPY for benchmark)
  const [sparkRes, fundRes, decRes, newsRes] = await Promise.allSettled([
    fetch(`/api/sparklines?symbols=${symbol},SPY&period=${_drawerPeriod()}`).then(r => r.json()),
    fetch(`/api/fundamentals/${symbol}`).then(r => r.json()),
    fetch(`/api/decisions?limit=200`).then(r => r.json()),
    fetch(`/api/news/${symbol}?limit=5`).then(r => r.json()),
  ]);

  const sparkData = sparkRes.status === 'fulfilled' ? sparkRes.value : {};
  const sparks    = sparkData[symbol] || [];
  const spyCloses = sparkData['SPY']  || [];
  const fund      = fundRes.status === 'fulfilled'  ? fundRes.value : {};
  const decisions = decRes.status  === 'fulfilled'  ? decRes.value  : [];
  const newsItems = newsRes.status === 'fulfilled'  ? (Array.isArray(newsRes.value) ? newsRes.value : []) : [];

  // Find first (oldest) BUY order for this symbol
  let buyReason = null, buyDate = null, lastSellDate = null;
  const revDecs = [...decisions].reverse(); // oldest first
  for (const d of revDecs) {
    for (const o of (d.orders || [])) {
      if (o.symbol !== symbol) continue;
      if (o.side === 'buy' && !buyReason) { buyReason = o.reason; buyDate = d.run_date; }
      if (o.side === 'sell') { lastSellDate = d.run_date; buyReason = null; buyDate = null; }
    }
  }

  // Extract most recent narrative passage mentioning this ticker (newest decision first)
  let latestView = null;
  const symRe = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  for (const d of decisions) {
    const text = (d.claude_narrative || '').trim();
    if (!text || !symRe.test(text)) continue;
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [];
    const hits = sentences.filter(s => symRe.test(s));
    if (hits.length) {
      const excerpt = hits.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
      if (excerpt.length >= 30) { latestView = { text: excerpt, date: d.run_date }; break; }
    }
  }

  const pnlDollar = parseFloat(posData.unrealized_pnl) || 0;
  const pnlPct    = parseFloat(posData.unrealized_pnl_pct) || 0;
  const dayChg    = parseFloat(posData.change_today) || 0;
  const pnlCls    = pnlDollar >= 0 ? 'pos' : 'neg';
  const dayCls    = dayChg >= 0 ? 'pos' : 'neg';

  _drawerAvgEntry = parseFloat(posData.avg_entry_price) || null;
  _drawerSymOrders = [];
  for (const d of decisions) {
    for (const o of (d.orders || [])) {
      if (o.symbol === symbol) _drawerSymOrders.push({ ...o, run_date: d.run_date });
    }
  }
  const sparkSVG = _buildDrawerChartSVG(sparks, _drawerAvgEntry, _drawerSymOrders, _drawerPeriod(), spyCloses);

  const fmt = v => v != null && v !== '' ? String(v) : 'N/A';
  const fmtN = (v, decimals = 2, prefix = '') => {
    const n = parseFloat(v);
    return isNaN(n) ? 'N/A' : `${prefix}${n.toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals})}`;
  };

  const fundamentalItems = [
    { label: 'P/E (TTM)',  val: fmtN(fund.pe_trailing, 1) },
    { label: 'P/E (Fwd)',  val: fmtN(fund.pe_forward, 1) },
    { label: 'Market Cap', val: fund.market_cap ? `$${(fund.market_cap / 1e9).toFixed(1)}B` : 'N/A' },
    { label: 'EPS (TTM)',  val: fund.eps ? `$${parseFloat(fund.eps).toFixed(2)}` : 'N/A' },
  ];

  const _fmtGrowthPct = v => {
    const n = parseFloat(v);
    if (isNaN(n)) return { val: 'N/A', cls: '' };
    return { val: `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`, cls: n >= 0 ? 'pos' : 'neg' };
  };
  const growthItems = [
    { label: 'Rev. Growth',   ..._fmtGrowthPct(fund.revenue_growth) },
    { label: 'Earn. Growth',  ..._fmtGrowthPct(fund.earnings_growth) },
    { label: 'Profit Margin', ..._fmtGrowthPct(fund.profit_margin) },
    { label: 'Debt / Equity', val: (() => {
        const n = parseFloat(fund.debt_to_equity);
        return isNaN(n) ? 'N/A' : `${(n / 100).toFixed(1)}x`;
      })(),
      cls: (() => {
        const n = parseFloat(fund.debt_to_equity);
        if (isNaN(n)) return '';
        return n > 200 ? 'neg' : n < 50 ? 'pos' : '';
      })(),
    },
  ];

  // 52-week range bar with current price + analyst target
  const wkLow   = parseFloat(fund['52w_low']);
  const wkHigh  = parseFloat(fund['52w_high']);
  const currPx  = parseFloat(posData.current_price);
  const target  = parseFloat(fund.analyst_target);
  let rangeBar  = '';
  if (!isNaN(wkLow) && !isNaN(wkHigh) && wkHigh > wkLow) {
    const pct = v => Math.max(0, Math.min(100, (v - wkLow) / (wkHigh - wkLow) * 100)).toFixed(1);
    const currPct = pct(currPx);
    const targetMarker = (!isNaN(target) && target >= wkLow && target <= wkHigh)
      ? `<div class="range-target" style="left:${pct(target)}%" title="Analyst target $${target.toFixed(2)}"></div>`
      : '';
    rangeBar = `
    <div class="pos-range-wrap">
      <div class="section-label">52-Week Range</div>
      <div class="range-track">
        <div class="range-fill" style="left:0%;width:${currPct}%;background:${currPx >= wkLow + (wkHigh - wkLow) * 0.5 ? 'var(--green)' : 'var(--red)'}"></div>
        <div class="range-current" style="left:${currPct}%"></div>
        ${targetMarker}
      </div>
      <div class="range-labels">
        <span>$${wkLow.toFixed(2)}</span>
        <span style="font-size:10px;color:var(--muted-2)">${!isNaN(target) ? `target $${target.toFixed(2)}` : ''}</span>
        <span>$${wkHigh.toFixed(2)}</span>
      </div>
    </div>`;
  }

  // Earnings callout
  let earningsCallout = '';
  if (fund.next_earnings_date) {
    const earningsMs = new Date(fund.next_earnings_date).getTime();
    const nowMs = Date.now();
    const daysUntil = Math.ceil((earningsMs - nowMs) / 86400000);
    if (!isNaN(daysUntil) && daysUntil >= 0 && daysUntil <= 90) {
      const urgency = daysUntil <= 7 ? 'earnings-soon' : '';
      earningsCallout = `<div class="earnings-callout ${urgency}">
        <span class="earnings-icon">📅</span>
        <span>Earnings in <strong>${daysUntil}d</strong> &nbsp;·&nbsp; ${fund.next_earnings_date}</span>
      </div>`;
    }
  }

  const sectorLine = fund.sector ? `<span class="drawer-sector">${fund.sector}${fund.industry && fund.industry !== fund.sector ? ` · ${fund.industry}` : ''}</span>` : '';

  const companyName = fund.company_name || _nameCache[symbol] || symbol;
  const displayName = companyName !== symbol ? companyName : '';

  // Days held
  let daysHeld = null;
  if (buyDate) {
    const ms = Date.now() - new Date(buyDate + 'T12:00:00').getTime();
    daysHeld = Math.max(0, Math.round(ms / 86400000));
  }
  const heldStr = daysHeld !== null ? ` &nbsp;·&nbsp; <span class="held-badge">${daysHeld === 0 ? 'Bought today' : `${daysHeld}d held`}</span>` : '';
  // yfinance period that covers since purchase
  const mineYfPeriod = daysHeld == null ? null
    : daysHeld <= 5 ? '7d' : daysHeld <= 25 ? '1mo' : daysHeld <= 85 ? '3mo' : daysHeld <= 180 ? '6mo' : '1y';

  content.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-header-left">
        ${displayName ? `<div class="drawer-company">${displayName}</div>` : ''}
        <div class="drawer-ticker-row">
          <span class="symbol-pill">${symbol}</span>
          ${sectorLine}
        </div>
        <div class="drawer-holding">${parseFloat(posData.qty).toFixed(4)} shares &nbsp;·&nbsp; avg $${parseFloat(posData.avg_entry_price).toFixed(2)}${heldStr}</div>
      </div>
      <div class="drawer-header-right">
        <div class="drawer-price">$${parseFloat(posData.current_price).toFixed(2)}</div>
        <div class="drawer-day-chg ${dayCls}">${dayChg >= 0 ? '▲' : '▼'} ${Math.abs(dayChg * 100).toFixed(2)}% today</div>
        <button class="drawer-wl-btn ${_watchlistSymbols.has(symbol) ? 'wl-btn-active' : ''}"
          title="${_watchlistSymbols.has(symbol) ? 'Remove from watchlist' : 'Add to watchlist'}"
          onclick="toggleDrawerWatchlist('${symbol}',this)">
          ${_watchlistSymbols.has(symbol) ? '★' : '☆'}
        </button>
      </div>
    </div>
    ${earningsCallout}
    <div class="pos-stat-row">
      <div class="pos-stat-item">
        <div class="label">Current Price</div>
        <div class="val">$${parseFloat(posData.current_price).toFixed(2)}</div>
      </div>
      <div class="pos-stat-item">
        <div class="label">Market Value</div>
        <div class="val">$${parseFloat(posData.market_value).toFixed(2)}</div>
      </div>
      <div class="pos-stat-item">
        <div class="label">Unrealized P&amp;L</div>
        <div class="val"><span class="${pnlCls}">${pnlDollar >= 0 ? '+' : ''}$${Math.abs(pnlDollar).toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)</span></div>
      </div>
      <div class="pos-stat-item">
        <div class="label">Day Change</div>
        <div class="val"><span class="${dayCls}">${dayChg >= 0 ? '+' : ''}${(dayChg * 100).toFixed(2)}%</span></div>
      </div>
      ${daysHeld !== null ? `<div class="pos-stat-item">
        <div class="label">Held</div>
        <div class="val">${daysHeld === 0 ? 'Today' : `${daysHeld} day${daysHeld !== 1 ? 's' : ''}`}</div>
      </div>` : ''}
      ${daysHeld && daysHeld > 0 && pnlPct !== 0 ? (() => {
        const annPct = (Math.pow(1 + pnlPct / 100, 365 / daysHeld) - 1) * 100;
        const cls = annPct >= 0 ? 'pos' : 'neg';
        return `<div class="pos-stat-item">
          <div class="label">Ann. Return</div>
          <div class="val"><span class="${cls}">${annPct >= 0 ? '+' : ''}${annPct.toFixed(1)}%</span></div>
        </div>`;
      })() : ''}
    </div>
    ${buyReason ? `
    <div class="pos-thesis">
      <div class="section-label">Claude's Thesis</div>
      <div class="pos-thesis-text">"${buyReason}"</div>
      <div class="pos-thesis-date">First bought ${(() => { try { return new Date(buyDate + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); } catch(e) { return buyDate; } })()}</div>
    </div>` : ''}
    ${latestView && latestView.text !== buyReason ? `
    <div class="pos-thesis pos-latest-view">
      <div class="section-label" style="color:var(--muted)">Latest View <span class="lv-date">${relativeDate(latestView.date)}</span></div>
      <div class="pos-thesis-text">${latestView.text}</div>
    </div>` : ''}
    <div class="pos-chart-wrap">
      <div class="pos-chart-header">
        <div class="section-label">Price</div>
        <div class="range-tabs">
          ${[['7d','1W'],['1mo','1M'],['3mo','3M'],['1y','1Y']].map(([p,l])=>`<button class="range-tab${_drawerPeriod()===p?' active':''}" data-period="${p}" onclick="drawerSetPeriod('${p}','${symbol}',this)">${l}</button>`).join('')}
          ${mineYfPeriod ? `<button class="range-tab range-tab-mine" data-period="mine" data-yfperiod="${mineYfPeriod}" onclick="drawerSetPeriod('mine','${symbol}',this)">Mine</button>` : ''}
        </div>
      </div>
      <div id="drawer-chart-area">${sparkSVG}</div>
    </div>
    ${rangeBar}
    ${_buildAnalystBar(fund)}
    ${fundamentalItems.some(f => f.val !== 'N/A') ? `
    <div class="pos-sparkline-wrap">
      <div class="section-label">Valuation</div>
      <div class="pos-fundamentals">
        ${fundamentalItems.map(f => `
          <div class="pos-fund-item">
            <div class="label">${f.label}</div>
            <div class="val">${f.val}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}
    ${growthItems.some(g => g.val !== 'N/A') ? `
    <div class="pos-sparkline-wrap">
      <div class="section-label">Growth &amp; Health</div>
      <div class="pos-fundamentals">
        ${growthItems.map(g => `
          <div class="pos-fund-item">
            <div class="label">${g.label}</div>
            <div class="val${g.cls ? ` ${g.cls}` : ''}">${g.val}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}
    ${newsItems.length ? `
    <div class="pos-news-wrap">
      <div class="section-label">Recent News</div>
      ${newsItems.map(n => {
        const ago = (() => {
          if (!n.published_at) return '';
          const ms = Date.now() - new Date(n.published_at).getTime();
          const h = Math.floor(ms / 3600000);
          return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
        })();
        const src = (n.source || '').replace(/^www\./i, '');
        const headline = n.url
          ? `<a class="pos-news-headline pos-news-link" href="${n.url}" target="_blank" rel="noopener noreferrer">${n.headline}</a>`
          : `<div class="pos-news-headline">${n.headline}</div>`;
        const meta = [src, ago].filter(Boolean).join(' · ');
        return `<div class="pos-news-item">
          ${headline}
          ${meta ? `<div class="pos-news-meta">${meta}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : ''}
    ${(() => {
      // Collect all orders for this symbol, newest first
      const symOrders = [];
      for (const d of decisions) {
        for (const o of (d.orders || [])) {
          if (o.symbol === symbol) symOrders.push({ ...o, run_date: d.run_date });
        }
      }
      if (!symOrders.length) return '';
      const fmtDate = date => {
        try { return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); }
        catch(e) { return date; }
      };
      const rows = symOrders.map(o => {
        const isBuy = o.side === 'buy';
        const px    = parseFloat(o.filled_avg_price);
        const qty   = parseFloat(o.filled_qty) || parseFloat(o.qty) || 0;
        const notional = parseFloat(o.notional);
        const amtStr = !isNaN(px) && qty
          ? `${qty.toFixed(4)} sh @ $${px.toFixed(2)}`
          : !isNaN(notional)
          ? `$${notional.toFixed(2)} notional`
          : '';
        return `
          <div class="th-row">
            <div class="th-side ${isBuy ? 'buy' : 'sell'}">${isBuy ? 'BUY' : 'SELL'}</div>
            <div class="th-body">
              <div class="th-top">
                <span class="th-amt">${amtStr}</span>
                <span class="th-date">${fmtDate(o.run_date)}</span>
              </div>
              ${o.reason ? `<div class="th-reason">"${o.reason}"</div>` : ''}
            </div>
          </div>`;
      }).join('');
      return `
      <div class="pos-tradehistory-wrap">
        <div class="section-label">Trade History <span class="th-count">${symOrders.length}</span></div>
        <div class="th-list">${rows}</div>
      </div>`;
    })()}`;

  // Animate the chart after render
  const chartArea = document.getElementById('drawer-chart-area');
  if (chartArea) _animateDrawerChart(chartArea);

  // Personal notes — appended separately so the template string stays clean
  const savedNote = localStorage.getItem(`pos-note-${symbol}`) || '';
  const notesSection = document.createElement('div');
  notesSection.className = 'pos-notes-wrap';
  notesSection.innerHTML = `
    <div class="section-label">My Notes</div>
    <textarea class="pos-notes-area" placeholder="Your notes on ${symbol}…"
      oninput="savePosNote('${symbol}', this.value)">${savedNote.replace(/</g, '&lt;')}</textarea>`;
  content.appendChild(notesSection);

  // Inject nav arrows if there are multiple positions
  const positions = window._latestPositions || [];
  if (positions.length > 1) {
    const idx = positions.findIndex(p => p.symbol === symbol);
    const hasPrev = idx > 0;
    const hasNext = idx < positions.length - 1;
    const prevSym = hasPrev ? positions[idx - 1].symbol : '';
    const nextSym = hasNext ? positions[idx + 1].symbol : '';
    const nav = document.createElement('div');
    nav.className = 'drawer-nav';
    nav.innerHTML = `
      <button class="drawer-nav-btn" ${!hasPrev ? 'disabled' : ''}
        onclick="openDrawer('${prevSym}', window._latestPositions.find(p=>p.symbol==='${prevSym}'))">
        ‹ ${prevSym || ''}
      </button>
      <span class="drawer-nav-pos">${idx + 1} / ${positions.length}</span>
      <button class="drawer-nav-btn" ${!hasNext ? 'disabled' : ''}
        onclick="openDrawer('${nextSym}', window._latestPositions.find(p=>p.symbol==='${nextSym}'))">
        ${nextSym || ''} ›
      </button>`;
    content.appendChild(nav);
  }
}

let _drawerOpenSymbol = null;
let _drawerAvgEntry   = null;
let _drawerSymOrders  = null;
let _drawerScrollY = 0;

function _lockBodyScroll() {
  _drawerScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top      = `-${_drawerScrollY}px`;
  document.body.style.width    = '100%';
}
function _unlockBodyScroll() {
  document.body.style.position = '';
  document.body.style.top      = '';
  document.body.style.width    = '';
  window.scrollTo(0, _drawerScrollY);
}

async function openWatchlistDrawer(symbol) {
  const drawer = $('pos-drawer');
  const backdrop = $('pos-drawer-backdrop');
  const content = $('pos-drawer-content');

  content.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-header-left">
        <span class="skeleton sk-line" style="width:150px;display:block;margin-bottom:6px"></span>
        <span class="symbol-pill">${symbol}</span>
      </div>
      <div class="drawer-header-right">
        <span class="skeleton sk-line" style="width:72px;display:block"></span>
      </div>
    </div>
    <div class="pos-chart-wrap">
      <span class="skeleton" style="display:block;width:100%;height:110px;border-radius:6px"></span>
    </div>`;

  _drawerOpenSymbol = symbol;
  _drawerAvgEntry   = null;
  _highlightDrawerRow(null); // watchlist items don't exist in the positions table
  drawer.classList.add('open');
  backdrop.classList.add('open');
  _lockBodyScroll();
  document.removeEventListener('keydown', _drawerEsc);
  document.addEventListener('keydown', _drawerEsc);

  const [sparkRes, fundRes, newsRes] = await Promise.allSettled([
    fetch(`/api/sparklines?symbols=${symbol},SPY&period=${_drawerPeriod()}`).then(r => r.json()),
    fetch(`/api/fundamentals/${symbol}`).then(r => r.json()),
    fetch(`/api/news/${symbol}?limit=5`).then(r => r.json()),
  ]);

  const sparkData = sparkRes.status === 'fulfilled' ? sparkRes.value : {};
  const sparks    = sparkData[symbol] || [];
  const spyCloses = sparkData['SPY']  || [];
  const fund      = fundRes.status  === 'fulfilled' ? fundRes.value : {};
  const newsItems = newsRes.status  === 'fulfilled' ? (Array.isArray(newsRes.value) ? newsRes.value : []) : [];

  const lastPrice  = sparks.length ? sparks[sparks.length - 1] : null;
  const isUp       = sparks.length >= 2 ? sparks[sparks.length - 1] >= sparks[0] : true;
  const pctChange  = sparks.length >= 2 ? ((sparks[sparks.length - 1] - sparks[0]) / sparks[0] * 100) : 0;
  const chgCls     = isUp ? 'pos' : 'neg';
  const periodLabel = {'7d':'1W','1mo':'1M','3mo':'3M','1y':'1Y'}[_drawerPeriod()] || '1W';

  const companyName = fund.company_name || _nameCache[symbol] || symbol;
  const displayName = companyName !== symbol ? companyName : '';
  const sectorLine  = fund.sector
    ? `<span class="drawer-sector">${fund.sector}${fund.industry && fund.industry !== fund.sector ? ` · ${fund.industry}` : ''}</span>`
    : '';

  const wkLow  = parseFloat(fund['52w_low']);
  const wkHigh = parseFloat(fund['52w_high']);
  const target = parseFloat(fund.analyst_target);
  let rangeBar = '';
  if (!isNaN(wkLow) && !isNaN(wkHigh) && wkHigh > wkLow && lastPrice) {
    const pct = v => Math.max(0, Math.min(100, (v - wkLow) / (wkHigh - wkLow) * 100)).toFixed(1);
    const currPct = pct(lastPrice);
    const tgtMarker = (!isNaN(target) && target >= wkLow && target <= wkHigh)
      ? `<div class="range-target" style="left:${pct(target)}%" title="Analyst target $${target.toFixed(2)}"></div>`
      : '';
    rangeBar = `
    <div class="pos-range-wrap">
      <div class="section-label">52-Week Range</div>
      <div class="range-track">
        <div class="range-fill" style="left:0%;width:${currPct}%;background:${lastPrice >= wkLow + (wkHigh - wkLow) * 0.5 ? 'var(--green)' : 'var(--red)'}"></div>
        <div class="range-current" style="left:${currPct}%"></div>
        ${tgtMarker}
      </div>
      <div class="range-labels">
        <span>$${wkLow.toFixed(2)}</span>
        <span style="font-size:10px;color:var(--muted-2)">${!isNaN(target) ? `target $${target.toFixed(2)}` : ''}</span>
        <span>$${wkHigh.toFixed(2)}</span>
      </div>
    </div>`;
  }

  const fmtN = (v, d = 2) => { const n = parseFloat(v); return isNaN(n) ? 'N/A' : n.toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d}); };
  const fmt  = v => (v != null && v !== '') ? String(v) : 'N/A';
  const _fmtGrowthPct = v => {
    const n = parseFloat(v);
    if (isNaN(n)) return { val: 'N/A', cls: '' };
    return { val: `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`, cls: n >= 0 ? 'pos' : 'neg' };
  };

  const fundItems = [
    { label: 'P/E (TTM)',  val: fmtN(fund.pe_trailing, 1) },
    { label: 'P/E (Fwd)',  val: fmtN(fund.pe_forward, 1)  },
    { label: 'Market Cap', val: fund.market_cap ? `$${(fund.market_cap / 1e9).toFixed(1)}B` : 'N/A' },
    { label: 'EPS (TTM)',  val: fund.eps ? `$${parseFloat(fund.eps).toFixed(2)}` : 'N/A' },
  ];
  const growthItems = [
    { label: 'Rev. Growth',   ..._fmtGrowthPct(fund.revenue_growth)  },
    { label: 'Earn. Growth',  ..._fmtGrowthPct(fund.earnings_growth) },
    { label: 'Profit Margin', ..._fmtGrowthPct(fund.profit_margin)   },
    { label: 'Debt / Equity', val: (() => { const n = parseFloat(fund.debt_to_equity); return isNaN(n) ? 'N/A' : `${(n/100).toFixed(1)}x`; })(),
      cls: (() => { const n = parseFloat(fund.debt_to_equity); if (isNaN(n)) return ''; return n > 200 ? 'neg' : n < 50 ? 'pos' : ''; })() },
  ];

  content.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-header-left">
        ${displayName ? `<div class="drawer-company">${displayName}</div>` : ''}
        <div class="drawer-ticker-row">
          <span class="symbol-pill">${symbol}</span>
          ${sectorLine}
        </div>
      </div>
      <div class="drawer-header-right">
        ${lastPrice ? `<div class="drawer-price">$${lastPrice.toFixed(2)}</div>` : ''}
        ${sparks.length >= 2 ? `<div class="drawer-day-chg ${chgCls}">${isUp ? '▲' : '▼'} ${Math.abs(pctChange).toFixed(2)}% ${periodLabel}</div>` : ''}
        <button class="drawer-wl-btn wl-btn-active" title="Remove from watchlist"
          onclick="toggleDrawerWatchlist('${symbol}',this)">★</button>
      </div>
    </div>
    <div class="pos-chart-wrap">
      <div class="pos-chart-header">
        <div class="section-label">Price</div>
        <div class="range-tabs">
          ${[['7d','1W'],['1mo','1M'],['3mo','3M'],['1y','1Y']].map(([p,l])=>`<button class="range-tab${_drawerPeriod()===p?' active':''}" data-period="${p}" onclick="drawerSetPeriod('${p}','${symbol}',this)">${l}</button>`).join('')}
        </div>
      </div>
      <div id="drawer-chart-area">${_buildDrawerChartSVG(sparks, null, null, _drawerPeriod(), spyCloses)}</div>
    </div>
    ${rangeBar}
    ${_buildAnalystBar(fund)}
    ${fundItems.some(f => f.val !== 'N/A') ? `
    <div class="pos-sparkline-wrap">
      <div class="section-label">Valuation</div>
      <div class="pos-fundamentals">
        ${fundItems.map(f => `<div class="pos-fund-item"><div class="label">${f.label}</div><div class="val">${f.val}</div></div>`).join('')}
      </div>
    </div>` : ''}
    ${growthItems.some(g => g.val !== 'N/A') ? `
    <div class="pos-sparkline-wrap">
      <div class="section-label">Growth &amp; Health</div>
      <div class="pos-fundamentals">
        ${growthItems.map(g => `<div class="pos-fund-item"><div class="label">${g.label}</div><div class="val${g.cls ? ` ${g.cls}` : ''}">${g.val}</div></div>`).join('')}
      </div>
    </div>` : ''}
    ${newsItems.length ? `
    <div class="pos-news-wrap">
      <div class="section-label">Recent News</div>
      ${newsItems.map(n => {
        const ago = (() => { if (!n.published_at) return ''; const h = Math.floor((Date.now() - new Date(n.published_at).getTime()) / 3600000); return h < 24 ? `${h}h ago` : `${Math.floor(h/24)}d ago`; })();
        const src = (n.source || '').replace(/^www\./i, '');
        const hl  = n.url
          ? `<a class="pos-news-headline pos-news-link" href="${n.url}" target="_blank" rel="noopener noreferrer">${n.headline}</a>`
          : `<div class="pos-news-headline">${n.headline}</div>`;
        const meta = [src, ago].filter(Boolean).join(' · ');
        return `<div class="pos-news-item">${hl}${meta ? `<div class="pos-news-meta">${meta}</div>` : ''}</div>`;
      }).join('')}
    </div>` : ''}
    ${(() => {
      const saved = _loadAlert(symbol);
      return `
      <div class="alert-section" id="alert-section-${symbol}">
        <div class="section-label">Price Alert</div>
        <div class="alert-inputs">
          <div class="alert-row">
            <span class="alert-dir-label pos">Above $</span>
            <input type="number" id="alert-above-${symbol}" class="alert-input"
              value="${saved.above != null ? saved.above : ''}" placeholder="—" step="0.01" min="0">
          </div>
          <div class="alert-row">
            <span class="alert-dir-label neg">Below $</span>
            <input type="number" id="alert-below-${symbol}" class="alert-input"
              value="${saved.below != null ? saved.below : ''}" placeholder="—" step="0.01" min="0">
          </div>
        </div>
        <div class="alert-actions">
          <button class="btn btn-primary btn-sm" onclick="savePriceAlert('${symbol}')">Save</button>
          ${(saved.above != null || saved.below != null) ? `<button class="btn btn-ghost btn-sm" onclick="clearPriceAlert('${symbol}')">Clear</button>` : ''}
        </div>
      </div>`;
    })()}`;

  const chartArea = document.getElementById('drawer-chart-area');
  if (chartArea) _animateDrawerChart(chartArea);
}

function _drawerEsc(e) {
  if (e.key === 'Escape') { closeDrawer(); return; }
  const positions = window._latestPositions || [];
  if (!positions.length || !_drawerOpenSymbol) return;
  const idx = positions.findIndex(p => p.symbol === _drawerOpenSymbol);
  if (idx === -1) return;
  if (e.key === 'ArrowRight' && idx < positions.length - 1) {
    e.preventDefault();
    const next = positions[idx + 1];
    openDrawer(next.symbol, next);
  } else if (e.key === 'ArrowLeft' && idx > 0) {
    e.preventDefault();
    const prev = positions[idx - 1];
    openDrawer(prev.symbol, prev);
  }
}

function _highlightDrawerRow(symbol) {
  document.querySelectorAll('#positions-body tr.row-selected').forEach(r => r.classList.remove('row-selected'));
  if (!symbol) return;
  const row = document.querySelector(`#positions-body tr[data-symbol="${symbol}"]`);
  if (row) {
    row.classList.add('row-selected');
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function closeDrawer() {
  const drawer = $('pos-drawer');
  if (drawer) { drawer.style.transform = ''; drawer.style.transition = ''; }
  drawer?.classList.remove('open');
  $('pos-drawer-backdrop')?.classList.remove('open');
  _unlockBodyScroll();
  document.removeEventListener('keydown', _drawerEsc);
  _drawerOpenSymbol = null;
  _drawerAvgEntry   = null;
  _drawerSymOrders  = null;
  _highlightDrawerRow(null);
}

// ── Drawer swipe navigation (mobile) ─────────────────────────────────
// Swipe right → prev position (or close if at first)
// Swipe left  → next position

(function initDrawerSwipe() {
  let startX = 0, startY = 0, dragging = false, lockAxis = false;
  const THRESHOLD = 72;

  function _getNavHint() {
    let el = document.getElementById('drawer-swipe-hint');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drawer-swipe-hint';
      el.className = 'drawer-swipe-hint';
      document.getElementById('pos-drawer')?.appendChild(el);
    }
    return el;
  }

  document.addEventListener('touchstart', e => {
    const drawer = $('pos-drawer');
    if (!drawer?.classList.contains('open')) return;
    if (!drawer.contains(e.target)) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
    lockAxis = false;
    drawer.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const drawer = $('pos-drawer');
    const dx = e.touches[0].clientX - startX;
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (!lockAxis) {
      if (dy > 12 && dy > Math.abs(dx)) { dragging = false; drawer.style.transform = ''; return; }
      if (Math.abs(dx) > 8) lockAxis = true;
    }
    if (!lockAxis) return;

    drawer.style.transform = `translateX(${dx}px)`;

    // Show hint label at threshold
    const positions = window._latestPositions || [];
    const idx = positions.findIndex(p => p.symbol === _drawerOpenSymbol);
    const hint = _getNavHint();
    if (dx > THRESHOLD && idx > 0) {
      hint.textContent = `← ${positions[idx - 1].symbol}`;
      hint.className = 'drawer-swipe-hint visible left';
    } else if (dx > THRESHOLD && idx === 0) {
      hint.textContent = 'Close';
      hint.className = 'drawer-swipe-hint visible left';
    } else if (dx < -THRESHOLD && idx < positions.length - 1) {
      hint.textContent = `${positions[idx + 1].symbol} →`;
      hint.className = 'drawer-swipe-hint visible right';
    } else {
      hint.className = 'drawer-swipe-hint';
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    const drawer = $('pos-drawer');
    if (!drawer) return;
    const dx = e.changedTouches[0].clientX - startX;
    drawer.style.transition = '';
    const hint = document.getElementById('drawer-swipe-hint');
    if (hint) hint.className = 'drawer-swipe-hint';

    const positions = window._latestPositions || [];
    const idx = positions.findIndex(p => p.symbol === _drawerOpenSymbol);

    if (dx > THRESHOLD) {
      // Swipe right: prev or close
      if (idx > 0) {
        drawer.style.transform = 'translateX(110%)';
        setTimeout(() => { drawer.style.transform = ''; openDrawer(positions[idx - 1].symbol, positions[idx - 1]); }, 180);
      } else {
        closeDrawer();
      }
    } else if (dx < -THRESHOLD && idx < positions.length - 1) {
      // Swipe left: next
      drawer.style.transform = 'translateX(-110%)';
      setTimeout(() => { drawer.style.transform = ''; openDrawer(positions[idx + 1].symbol, positions[idx + 1]); }, 180);
    } else {
      drawer.style.transform = '';
    }
  });
})();

async function exportTradesCSV() {
  try {
    const data = await fetch('/api/decisions?limit=500').then(r => r.json());
    const rows = [['Date', 'Symbol', 'Side', 'Qty', 'Notional ($)', 'Reason', 'Tokens', 'Duration (s)']];
    data.forEach(d => {
      const orders = d.orders || [];
      if (!orders.length) {
        rows.push([d.run_date, '', '', '', '', 'No trades — held all positions', d.tokens_used ?? '', d.run_duration_sec ?? '']);
      } else {
        orders.forEach(o => {
          rows.push([
            d.run_date,
            o.symbol,
            (o.side || '').toUpperCase(),
            o.qty ?? '',
            o.notional ? parseFloat(o.notional).toFixed(2) : '',
            o.reason || '',
            d.tokens_used ?? '',
            d.run_duration_sec != null ? parseFloat(d.run_duration_sec).toFixed(1) : '',
          ]);
        });
      }
    });
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `trades-${new Date().toISOString().split('T')[0]}.csv` });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Export complete', `${rows.length - 1} row${rows.length - 1 !== 1 ? 's' : ''} downloaded.`, 'success', 3000);
  } catch(e) {
    showToast('Export failed', e.message, 'error');
  }
}

function _syncDateDividers() {
  const container = document.getElementById('decisions-container');
  if (!container) return;
  container.querySelectorAll('.session-date-divider').forEach(div => {
    let sib = div.nextElementSibling;
    let hasVisible = false;
    while (sib && !sib.classList.contains('session-date-divider')) {
      if (sib.classList.contains('decision') && sib.style.display !== 'none') {
        hasVisible = true;
        break;
      }
      sib = sib.nextElementSibling;
    }
    div.style.display = hasVisible ? '' : 'none';
  });
}

function filterSessionSearch(query) {
  const q = query.trim();
  const ql = q.toLowerCase();
  const cards = document.querySelectorAll('#decisions-container .decision');

  // Restore any previously highlighted containers
  cards.forEach(card => {
    card.querySelectorAll('[data-search-orig]').forEach(el => {
      el.innerHTML = el.dataset.searchOrig;
      delete el.dataset.searchOrig;
    });
  });

  if (!q) {
    cards.forEach(el => { el.style.display = ''; });
    _syncDateDividers();
    return;
  }

  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re  = new RegExp(`(${esc})`, 'gi');

  cards.forEach(el => {
    const text = el.textContent.toLowerCase();
    if (!text.includes(ql)) { el.style.display = 'none'; return; }
    el.style.display = '';
    // Highlight within text-only containers (narrative and preview are plain prose)
    el.querySelectorAll('.narrative, .decision-preview').forEach(container => {
      if (!container.textContent.toLowerCase().includes(ql)) return;
      container.dataset.searchOrig = container.innerHTML;
      container.innerHTML = container.innerHTML.replace(re, '<mark class="search-hl">$1</mark>');
    });
  });

  _syncDateDividers();
}

function _rebuildTickerChips() {
  const row = document.getElementById('ticker-filter-row');
  if (!row) return;
  const counts = {};
  document.querySelectorAll('#decisions-container .decision').forEach(el => {
    (el.dataset.syms || '').split(',').forEach(s => { if (s) counts[s] = (counts[s] || 0) + 1; });
  });
  const syms = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!syms.length) { row.innerHTML = ''; return; }
  // Preserve active state
  const active = row.querySelector('.ticker-chip.active')?.dataset.sym;
  row.innerHTML = syms.map(([sym, n]) =>
    `<button class="ticker-chip${sym === active ? ' active' : ''}" data-sym="${sym}"
      onclick="filterSessionsByTicker('${sym}',this)">
      <span class="tc-dot" style="background:${_symColor(sym)}"></span>
      <span class="tc-label">${sym}</span>
      <span class="tc-count">${n}</span>
    </button>`
  ).join('');
}

function filterSessionsByTicker(sym, btn) {
  const wasActive = btn.classList.contains('active');
  document.querySelectorAll('.ticker-chip').forEach(c => c.classList.remove('active'));
  if (wasActive) {
    // Toggle off — restore All
    document.getElementById('filter-all')?.classList.add('active');
    document.getElementById('filter-trades')?.classList.remove('active');
    document.querySelectorAll('#decisions-container .decision').forEach(el => el.style.display = '');
  } else {
    btn.classList.add('active');
    document.getElementById('filter-all')?.classList.remove('active');
    document.getElementById('filter-trades')?.classList.remove('active');
    document.querySelectorAll('#decisions-container .decision').forEach(el => {
      const syms = (el.dataset.syms || '').split(',');
      el.style.display = syms.includes(sym) ? '' : 'none';
    });
  }
  _syncDateDividers();
}

function filterSessions(mode, btn) {
  document.querySelectorAll('.ticker-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('#decisions-container .range-tab,#filter-all,#filter-trades')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const items = document.querySelectorAll('#decisions-container .decision');
  items.forEach(el => {
    const hasTrades = el.dataset.hasTrades === '1';
    el.style.display = (mode === 'trades' && !hasTrades) ? 'none' : '';
  });
  _syncDateDividers();
  // Update visible count label
  const visible = [...items].filter(el => el.style.display !== 'none').length;
  const countEl = document.getElementById('session-count');
  if (countEl) {
    const total = items.length;
    countEl.textContent = mode === 'trades'
      ? `${visible} of ${total} session${total !== 1 ? 's' : ''}`
      : `${total} session${total !== 1 ? 's' : ''}`;
  }
}

function _formatNarrative(text) {
  if (!text) return '';

  const knownSyms = new Set([
    ...(window._latestPositions || []).map(p => p.symbol),
    ...(_watchlistSymbols || []),
  ]);

  const linkTickers = raw => {
    if (!knownSyms.size) return raw;
    return raw.replace(/\b([A-Z]{2,5})\b/g, (match, sym) => {
      if (!knownSyms.has(sym)) return match;
      const pos = (window._latestPositions || []).find(p => p.symbol === sym);
      const onClick = pos
        ? `openDrawer('${sym}',window._latestPositions.find(p=>p.symbol==='${sym}'))`
        : `openWatchlistDrawer('${sym}')`;
      const color = _symColor(sym);
      return `<span class="nar-ticker" onclick="${onClick}" title="Open ${sym}" style="--ntc:${color}">${sym}</span>`;
    });
  };

  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return '';
  return paras.map((p, i) => {
    const html = linkTickers(p).replace(/\n/g, '<br>');
    return `<p class="nar-p${i === 0 ? ' nar-lead' : ''}">${html}</p>`;
  }).join('');
}

async function copyNarrative(btn) {
  const text = btn.dataset.text.replace(/&quot;/g, '"');
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = '✓';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1800);
  } catch(e) {
    showToast('Copy failed', 'Could not access clipboard.', 'error', 2500);
  }
}

function toggleDecision(id) {
  const body = $(`body-${id}`);
  const dec  = $(`dec-${id}`);
  body.classList.toggle('open');
  dec.classList.toggle('expanded');
}

// ── Run Now ───────────────────────────────────────────────────────────

async function runNow() {
  const btn = $('run-btn');
  btn.disabled = true;
  const startTs = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - startTs) / 1000);
    btn.innerHTML = `<span class="spinner"></span> Running… ${s}s`;
  }, 1000);
  btn.innerHTML = '<span class="spinner"></span> Running… 0s';
  try {
    const result = await fetch('/api/run-now', {method:'POST'}).then(r => r.json());
    clearInterval(timer);
    await loadPortfolio();
    await loadDecisions();
    const n = result.orders_placed ?? 0;
    if (n > 0) fireConfetti();
    const toastTitle = n === 0 ? 'Session complete' : `${n} trade${n !== 1 ? 's' : ''} placed`;
    const toastBody  = n === 0 ? 'Claude reviewed the portfolio — no changes.' : 'Portfolio and session log updated.';
    showToast(toastTitle, toastBody, 'success');
    sendNotification(toastTitle, toastBody);
  } catch (e) {
    clearInterval(timer);
    showToast('Session failed', e.message || 'Check the terminal for details.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Now';
  }
}

// ── Market close synthesis ────────────────────────────────────────────

async function loadCloseSynthesis() {
  const card   = $('close-card');
  const body   = $('close-body');
  const badge  = $('close-badge');
  const tsEl   = $('close-ts');
  if (!card) return;
  try {
    const data = await fetch('/api/close-synthesis').then(r => r.json());
    if (!data.run_date) return;

    const runDt = new Date(data.created_at + 'Z');
    const now   = new Date();
    const diffH = (now - runDt) / 3600000;
    const timeStr = runDt.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
    const dateStr = diffH < 20 ? `Today at ${timeStr}` : relativeDate(data.run_date) + ` at ${timeStr}`;

    if (tsEl) tsEl.textContent = dateStr;
    if (badge) {
      badge.textContent = diffH < 20 ? 'Today' : relativeDate(data.run_date);
      badge.className   = 'close-badge ' + (diffH < 20 ? 'close-badge-fresh' : 'close-badge-old');
    }

    if (body) {
      const narrative = data.narrative || '';
      body.innerHTML = `<div class="close-narrative">${_formatNarrative(narrative)}</div>`;
    }

    card.style.display = '';
  } catch(e) { /* non-critical */ }
}

async function runCloseNow() {
  const btn     = $('close-btn');
  const runBtn  = $('close-run-btn');
  [btn, runBtn].forEach(b => { if (b) { b.disabled = true; b.innerHTML = '<span class="spinner"></span> Running…'; } });
  try {
    const result = await fetch('/api/run-close-now', {method:'POST'}).then(r => r.json());
    await loadCloseSynthesis();
    showToast('Close report ready', 'Email sent · Dashboard updated.', 'success', 4000);
  } catch(e) {
    showToast('Close report failed', e.message || 'Check the terminal.', 'error');
  } finally {
    if (btn)    { btn.disabled = false;    btn.textContent = 'Close Report'; }
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Re-run'; }
  }
}

// ── Allocation donut ──────────────────────────────────────────────────

function buildDonutSVG(segments, S = 130) {
  const cx = S / 2, cy = S / 2;
  const OR = S / 2 - 5, IR = OR - 28;
  const total = segments.reduce((s, g) => s + g.value, 0);
  if (!total) return '';
  const rad = a => a * Math.PI / 180;
  let angle = -90;
  const paths = segments.map((seg, idx) => {
    const sweep = (seg.value / total) * 360;
    const end = angle + sweep - 1.2;
    const la = sweep > 180 ? 1 : 0;
    const x1 = cx + OR * Math.cos(rad(angle)),  y1 = cy + OR * Math.sin(rad(angle));
    const x2 = cx + OR * Math.cos(rad(end)),    y2 = cy + OR * Math.sin(rad(end));
    const x3 = cx + IR * Math.cos(rad(end)),    y3 = cy + IR * Math.sin(rad(end));
    const x4 = cx + IR * Math.cos(rad(angle)),  y4 = cy + IR * Math.sin(rad(angle));
    angle += sweep;
    const f = n => n.toFixed(2);
    const delay = (idx * 55).toFixed(0);
    const isCash = seg.label === 'Cash';
    return `<path
      data-symbol="${seg.label}"
      data-pct="${seg.pct}"
      data-cash="${isCash ? '1' : '0'}"
      d="M${f(x1)} ${f(y1)} A${OR} ${OR} 0 ${la} 1 ${f(x2)} ${f(y2)} L${f(x3)} ${f(y3)} A${IR} ${IR} 0 ${la} 0 ${f(x4)} ${f(y4)}Z"
      fill="${seg.color}"
      style="transform-origin:${cx}px ${cy}px;animation:donutIn .45s cubic-bezier(.34,1.56,.64,1) ${delay}ms both;cursor:${isCash ? 'default' : 'pointer'};transition:transform .12s ease"/>`;
  });
  // Center text: label line + value line
  const centerHtml = `
    <text class="donut-center-label" x="${cx}" y="${cy - 6}" text-anchor="middle"
      font-size="9" font-weight="700" letter-spacing=".07em">INVESTED</text>
    <text class="donut-center-value" x="${cx}" y="${cy + 11}" text-anchor="middle"
      font-size="15" font-weight="800">—</text>`;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" class="alloc-chart">${paths.join('')}${centerHtml}</svg>`;
}

function renderAllocation(data) {
  const container = $('allocation-container');
  const totalEl   = $('allocation-total');
  if (!container) return;
  const positions = data.positions || [];
  const cash = data.cash || 0;
  const total = data.portfolio_value || 0;
  if (!total || (!positions.length && !cash)) {
    container.innerHTML = '<div class="empty"><p>No positions yet</p></div>';
    return;
  }
  const segments = positions.map(p => ({
    label: p.symbol,
    value: parseFloat(p.market_value) || 0,
    color: _symColor(p.symbol),
  }));
  if (cash > total * 0.005) {
    segments.push({ label: 'Cash', value: cash, color: '#94a3b8' });
  }
  const withPct = segments.map(s => ({ ...s, pct: (s.value / total * 100).toFixed(1) }));
  const svg = buildDonutSVG(withPct);
  const legend = withPct.map((s, i) => {
    const delay  = (i * 55 + 120).toFixed(0);
    const valStr = s.value >= 1e6
      ? `$${(s.value / 1e6).toFixed(2)}M`
      : `$${Math.round(s.value).toLocaleString('en-US')}`;
    return `
    <div class="alloc-row" style="animation:allocRowIn .35s ease ${delay}ms both">
      <span class="alloc-dot" style="background:${s.color}"></span>
      <span class="alloc-sym">${s.label}</span>
      <span class="alloc-bar-wrap">
        <span class="alloc-bar-fill" style="width:0%;background:${s.color};transition:width .6s cubic-bezier(.4,0,.2,1) ${(i * 55 + 200)}ms" data-w="${s.pct}"></span>
      </span>
      <span class="alloc-val">${valStr}</span>
      <span class="alloc-pct">${s.pct}%</span>
    </div>`;
  }).join('');
  container.innerHTML = `${svg}<div class="alloc-legend">${legend}</div>`;
  if (totalEl) totalEl.textContent = `${withPct.length} position${withPct.length !== 1 ? 's' : ''} + cash`;

  // Trigger bar width animations after paint
  requestAnimationFrame(() => {
    container.querySelectorAll('.alloc-bar-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });

  // Wire up donut center label + hover/click
  const svgEl = container.querySelector('.alloc-chart');
  if (svgEl) {
    const labelEl = svgEl.querySelector('.donut-center-label');
    const valueEl = svgEl.querySelector('.donut-center-value');
    const invested = total - cash;
    const fmtShort = v => v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString('en-US')}`;

    if (valueEl) valueEl.textContent = fmtShort(invested);

    svgEl.addEventListener('mouseover', e => {
      const path = e.target.closest('path[data-symbol]');
      if (!path) return;
      if (labelEl) labelEl.textContent = path.dataset.symbol;
      if (valueEl) valueEl.textContent = path.dataset.pct + '%';
      path.style.transform = 'scale(1.07)';
    });
    svgEl.addEventListener('mouseout', e => {
      const path = e.target.closest('path[data-symbol]');
      if (!path) return;
      if (labelEl) labelEl.textContent = 'INVESTED';
      if (valueEl) valueEl.textContent = fmtShort(invested);
      path.style.transform = '';
    });
    svgEl.addEventListener('click', e => {
      const path = e.target.closest('path[data-symbol]');
      if (!path || path.dataset.cash === '1') return;
      const sym = path.dataset.symbol;
      const pos = (window._latestPositions || []).find(p => p.symbol === sym);
      if (pos) openDrawer(sym, pos);
    });
  }
}

// ── Total return ──────────────────────────────────────────────────────

async function loadTotalReturn(currentValue) {
  const card  = $('stat-return-card');
  const valEl = $('stat-return');
  const subEl = $('stat-return-sub');
  if (!card || !valEl) return;
  try {
    const snaps = await fetch('/api/snapshots?limit=500').then(r => r.json());
    if (!snaps.length) {
      valEl.textContent = '—';
      if (subEl) subEl.textContent = 'No sessions yet';
      return;
    }
    // snapshots come newest-first; oldest is last
    const oldest = snaps[snaps.length - 1];
    const start  = oldest.total_value;
    const now    = currentValue || snaps[0].total_value;
    const diff     = now - start;
    const pct      = start ? (diff / start * 100) : 0;
    const sign     = diff >= 0 ? '+' : '';
    const firstDate = new Date(oldest.snapshot_date + 'T12:00:00');
    const yearFrac  = (Date.now() - firstDate.getTime()) / (365.25 * 86400000);
    const annReturn = yearFrac > 0.05 && start > 0
      ? (Math.pow(1 + pct / 100, 1 / yearFrac) - 1) * 100
      : null;

    const _returnDur = _prevStatReturn === null ? 1000 : 300;
    animateValue(valEl, diff, '$', _returnDur, true, _prevStatReturn ?? 0);
    _prevStatReturn = diff;
    card.className = 'stat stat-tappable ' + (diff >= 0 ? 'pos-stat' : 'neg-stat');
    const _rc = diff >= 0 ? 'pos' : 'neg';
    const _rs = diff >= 0 ? '+' : '-';
    const _rf = Math.abs(diff).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    card.dataset.dollarHtml = `<span class="${_rc}">${_rs}$${_rf}</span>`;
    card.dataset.pctHtml    = `<span class="${_rc}">${sign}${pct.toFixed(2)}%</span>`;
    card.dataset.mode = 'dollar';
    card.onclick = function() { toggleStatCard(this); };
    card.title   = 'Tap to toggle $ / %';

    // SPY comparison for same window
    let spyLine = '';
    try {
      const daysSince = Math.round((Date.now() - new Date(oldest.snapshot_date + 'T12:00:00').getTime()) / 86400000);
      const spyPeriod = daysSince < 10 ? '7d' : daysSince < 35 ? '1mo' : daysSince < 100 ? '3mo' : daysSince < 200 ? '6mo' : '1y';
      const spyData = await fetch(`/api/sparklines?symbols=SPY&period=${spyPeriod}`).then(r => r.json());
      const prices = spyData['SPY'] || [];
      if (prices.length >= 2) {
        const spyPct = (prices[prices.length - 1] - prices[0]) / prices[0] * 100;
        const alpha = pct - spyPct;
        const spySign = spyPct >= 0 ? '+' : '';
        const alphaSign = alpha >= 0 ? '+' : '';
        const alphaCls = alpha >= 0 ? 'pos' : 'neg';
        spyLine = ` &nbsp;<span style="color:var(--muted-2)">·</span>&nbsp; S&amp;P <span style="color:var(--muted)">${spySign}${spyPct.toFixed(2)}%</span> &nbsp;<span class="${alphaCls}" title="Alpha vs S&P 500">${alphaSign}${alpha.toFixed(2)}% alpha</span>`;
      }
    } catch(e) { /* non-critical */ }

    if (subEl) {
      const sinceD = new Date(oldest.snapshot_date + 'T12:00:00');
      const sinceLabel = sinceD.toLocaleDateString('en-US', sinceD.getFullYear() !== new Date().getFullYear()
        ? { month: 'short', day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric' });

      let projLine = '';
      if (annReturn != null) {
        const yearEnd  = new Date(new Date().getFullYear(), 11, 31);
        const daysLeft = Math.max(1, (yearEnd.getTime() - Date.now()) / 86400000);
        const proj     = now * Math.pow(1 + annReturn / 100, daysLeft / 365);
        const annCls   = annReturn >= 0 ? 'pos' : 'neg';
        const annSign  = annReturn >= 0 ? '+' : '';
        projLine = `<div class="stat-proj-line">Ann. <span class="${annCls}">${annSign}${annReturn.toFixed(1)}%</span> &nbsp;·&nbsp; ~$${Math.round(proj).toLocaleString('en-US')} by Dec 31</div>`;
      }

      subEl.innerHTML = `<span class="${diff >= 0 ? 'pos' : 'neg'}">${sign}${pct.toFixed(2)}%</span> since ${sinceLabel}${spyLine}${projLine}`;
    }

    // Mini sparkline on the Total Return card
    const sparkWrap = (() => {
      let el = document.getElementById('stat-return-spark');
      if (!el) { el = document.createElement('div'); el.id = 'stat-return-spark'; el.className = 'stat-spark'; card.appendChild(el); }
      return el;
    })();
    const snapVals = [...snaps].reverse().slice(-60).map(s => s.total_value);
    if (snapVals.length >= 2) {
      const W = 200, H = 28, PAD = 2;
      const minV = Math.min(...snapVals), maxV = Math.max(...snapVals);
      const range = maxV - minV || 1;
      const xStep = (W - PAD * 2) / Math.max(snapVals.length - 1, 1);
      const yFn = v => H - PAD - ((v - minV) / range) * (H - PAD * 2 - 2);
      const xyPairs = snapVals.map((v, i) => [PAD + i * xStep, yFn(v)]);
      const sc = diff >= 0 ? '#16a34a' : '#dc2626';
      const smoothLine = _svgSmooth(xyPairs);
      const smoothFill = _svgSmoothFill(smoothLine, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);
      sparkWrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:28px;display:block">
        <defs><linearGradient id="sfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${sc}" stop-opacity=".3"/>
          <stop offset="100%" stop-color="${sc}" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${smoothFill}" fill="url(#sfill)"/>
        <path d="${smoothLine}" fill="none" stroke="${sc}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }

    // Cash sparkline
    const _cashCard = $('stat-cash')?.parentElement;
    if (_cashCard) {
      const _cSpark = (() => {
        let el = document.getElementById('stat-cash-spark');
        if (!el) { el = document.createElement('div'); el.id = 'stat-cash-spark'; el.className = 'stat-spark'; _cashCard.appendChild(el); }
        return el;
      })();
      const _cashVals = [...snaps].reverse().slice(-60).map(s => s.cash).filter(v => v != null);
      if (_cashVals.length >= 2) {
        const W = 200, H = 28, PAD = 2;
        const minV = Math.min(..._cashVals), maxV = Math.max(..._cashVals);
        const range = maxV - minV || 1;
        const xStep = (W - PAD * 2) / Math.max(_cashVals.length - 1, 1);
        const yFn = v => H - PAD - ((v - minV) / range) * (H - PAD * 2 - 2);
        const xyPairs = _cashVals.map((v, i) => [PAD + i * xStep, yFn(v)]);
        const sc = '#6b7280';
        const sl = _svgSmooth(xyPairs);
        const sf = _svgSmoothFill(sl, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);
        _cSpark.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:28px;display:block">
          <defs><linearGradient id="cfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${sc}" stop-opacity=".3"/>
            <stop offset="100%" stop-color="${sc}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${sf}" fill="url(#cfill)"/>
          <path d="${sl}" fill="none" stroke="${sc}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      }
    }

    // Invested sparkline
    const _invCard = $('stat-invested')?.parentElement;
    if (_invCard) {
      const _iSpark = (() => {
        let el = document.getElementById('stat-invested-spark');
        if (!el) { el = document.createElement('div'); el.id = 'stat-invested-spark'; el.className = 'stat-spark'; _invCard.appendChild(el); }
        return el;
      })();
      const _invVals = [...snaps].reverse().slice(-60)
        .map(s => (s.total_value != null && s.cash != null) ? s.total_value - s.cash : null)
        .filter(v => v != null);
      if (_invVals.length >= 2) {
        const W = 200, H = 28, PAD = 2;
        const minV = Math.min(..._invVals), maxV = Math.max(..._invVals);
        const range = maxV - minV || 1;
        const xStep = (W - PAD * 2) / Math.max(_invVals.length - 1, 1);
        const yFn = v => H - PAD - ((v - minV) / range) * (H - PAD * 2 - 2);
        const xyPairs = _invVals.map((v, i) => [PAD + i * xStep, yFn(v)]);
        const sc = '#7c3aed';
        const sl = _svgSmooth(xyPairs);
        const sf = _svgSmoothFill(sl, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);
        _iSpark.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:28px;display:block">
          <defs><linearGradient id="ifill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${sc}" stop-opacity=".3"/>
            <stop offset="100%" stop-color="${sc}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${sf}" fill="url(#ifill)"/>
          <path d="${sl}" fill="none" stroke="${sc}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      }
    }

    const athBadge = document.getElementById('ath-badge');
    if (athBadge) {
      const ath = Math.max(...snaps.map(s => s.total_value));
      const isATH = now >= ath;
      const drawdownPct = isATH ? 0 : (now - ath) / ath * 100;
      const heroSection = document.querySelector('.hero-chart-section');
      if (isATH) {
        athBadge.className = 'ath-badge ath-peak';
        athBadge.textContent = '▲ All-time High';
        setTimeout(_fireATHConfetti, 400);
        heroSection?.classList.add('is-ath');
      } else {
        athBadge.className = 'ath-badge ath-drawdown';
        athBadge.textContent = `↓ ${Math.abs(drawdownPct).toFixed(2)}% from ATH ($${ath.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})})`;
        heroSection?.classList.remove('is-ath');
      }
      athBadge.style.display = '';
    }
  } catch(e) {
    if (valEl) valEl.textContent = '—';
  }
}

// ── Portfolio news feed ────────────────────────────────────────────────

async function loadPortfolioNews() {
  const card      = document.getElementById('portfolio-news-card');
  const container = document.getElementById('portfolio-news-container');
  const countEl   = document.getElementById('portfolio-news-count');
  const positions = window._latestPositions || [];
  if (!card || !container || !positions.length) return;

  try {
    const syms     = positions.map(p => p.symbol).join(',');
    const articles = await fetch(`/api/news?symbols=${syms}&limit=3`).then(r => r.json());
    if (!articles.length) return;

    card.style.display = '';
    if (countEl) countEl.textContent = `${articles.length} article${articles.length !== 1 ? 's' : ''}`;

    container.innerHTML = articles.slice(0, 8).map(a => {
      const ms  = Date.now() - new Date(a.published_at).getTime();
      const h   = ms / 3600000;
      const ago = h < 1 ? `${Math.round(ms / 60000)}m ago` : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
      const src = (a.source || '').replace(/^www\./i, '');
      const headline = a.url
        ? `<a class="pos-news-headline pos-news-link" href="${a.url}" target="_blank" rel="noopener noreferrer">${a.headline}</a>`
        : `<div class="pos-news-headline">${a.headline}</div>`;
      return `
      <div class="pos-news-item pnews-item">
        <div class="pnews-sym-col">
          ${_symAvatar(a.symbol, 'width:26px;height:26px;border-radius:7px;font-size:11px')}
        </div>
        <div class="pnews-body">
          ${headline}
          <div class="pos-news-meta"><span class="pnews-sym">${a.symbol}</span>${src ? ` · ${src}` : ''} · ${ago}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { /* non-critical */ }
}

// ── Market regime ─────────────────────────────────────────────────────

async function loadRegime() {
  const banner = $('regime-banner');
  const label  = $('regime-label');
  const detail = $('regime-detail');
  if (!banner) return;
  try {
    const d = await fetch('/api/market-context').then(r => r.json());
    const summary = d.regime_summary || '';
    const regime = summary.startsWith('FAVORABLE') ? 'favorable'
                 : summary.startsWith('CAUTIOUS')  ? 'cautious'
                 : summary.startsWith('MIXED')      ? 'mixed'
                 : summary.startsWith('DEFENSIVE')  ? 'defensive'
                 : null;
    if (!regime) return;

    const vix    = d.vix?.level  != null ? `VIX ${d.vix.level}` : '';
    const sp     = d.sp500 ? (d.sp500.above_sma20 ? 'S&P above SMA-20' : 'S&P below SMA-20') : '';
    const ret5   = d.sp500?.return_5d_pct != null
                   ? `${d.sp500.return_5d_pct >= 0 ? '+' : ''}${d.sp500.return_5d_pct.toFixed(1)}% 5d` : '';
    const parts  = [vix, sp, ret5].filter(Boolean);

    label.textContent  = regime.toUpperCase();
    detail.textContent = parts.join('  ·  ');
    banner.className   = `regime-banner ${regime}`;
    banner.style.display = 'flex';
    // If initScrollReveal already ran and missed this element (was display:none), apply in-view now
    if (banner.classList.contains('scroll-reveal') && !banner.classList.contains('in-view')) {
      requestAnimationFrame(() => banner.classList.add('in-view'));
    }
  } catch(e) { /* non-critical */ }
}

// ── Mobile bottom nav ─────────────────────────────────────────────────

function mnavGoto(section) {
  const targets = {
    home:      document.querySelector('.hero-chart-section'),
    positions: document.getElementById('positions-card'),
    history:   document.getElementById('session-log-card'),
    watchlist: document.getElementById('watchlist-card'),
  };
  const el = targets[section];
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  _mnavSetActive(section);
}

function _mnavSetActive(id) {
  const nav = document.getElementById('mobile-nav');
  if (!nav) return;
  nav.querySelectorAll('.mnav-tab').forEach(t => t.classList.toggle('active', t.dataset.section === id));
}

function _initMobileNav() {
  const nav = document.getElementById('mobile-nav');
  if (!nav) return;
  const sections = [
    { id: 'home',      el: document.querySelector('.hero-chart-section') },
    { id: 'positions', el: document.getElementById('positions-card') },
    { id: 'history',   el: document.getElementById('session-log-card') },
    { id: 'watchlist', el: document.getElementById('watchlist-card') },
  ].filter(s => s.el);
  if (!sections.length) return;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const match = sections.find(s => s.el === e.target);
        if (match) _mnavSetActive(match.id);
      }
    }
  }, { threshold: 0, rootMargin: '-10% 0px -55% 0px' });
  sections.forEach(s => io.observe(s.el));
}

// ── Next session countdown ────────────────────────────────────────────

function getNextSessionET(hour, minute) {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etStr);

  // Try today and the next 7 days to find next weekday
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(et);
    candidate.setDate(et.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    const dow = candidate.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    if (offset === 0 && candidate <= et) continue; // skip if already passed today
    return candidate;
  }
  return null;
}

function formatNextSession(etTarget) {
  if (!etTarget) return '';
  const now = new Date();
  const etNowStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etNow = new Date(etNowStr);
  const diffMs = etTarget - etNow;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1)   return 'Session starting soon';
  if (diffMin < 60)  return `Next session in ${diffMin}m`;
  if (diffMin < 120) return `Next session in ${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;

  const timeStr = etTarget.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const dow = etTarget.getDay();
  const etTodayDow = etNow.getDay();
  if (dow === etTodayDow) return `Next: Today ${timeStr} ET`;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `Next: ${days[dow]} ${timeStr} ET`;
}

function startSessionCountdown(hour = 9, minute = 35) {
  const el = $('next-session');
  if (!el) return;
  function update() {
    const target = getNextSessionET(hour, minute);
    if (!target) { el.textContent = ''; el.classList.remove('session-imminent'); return; }

    const now = new Date();
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const diffMs  = target - etNow;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const imminent = diffSec > 0 && diffSec <= 300; // < 5 min
    el.classList.toggle('session-imminent', imminent);

    if (diffSec <= 0) {
      el.textContent = 'Session starting now';
    } else if (imminent) {
      const m = Math.floor(diffSec / 60);
      const s = String(diffSec % 60).padStart(2, '0');
      el.textContent = `Session in ${m}:${s}`;
    } else if (diffMin < 60) {
      el.textContent = `Next session in ${diffMin}m`;
    } else if (diffMin < 120) {
      el.textContent = `Next session in ${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
    } else {
      const timeStr = target.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      const dow = target.getDay();
      const etTodayDow = etNow.getDay();
      if (dow === etTodayDow) {
        el.textContent = `Next: Today ${timeStr} ET`;
      } else {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        el.textContent = `Next: ${days[dow]} ${timeStr} ET`;
      }
    }
  }
  update();
  setInterval(update, 1000); // 1-second ticks; imminent mode uses seconds display
}

// ── Greeting ──────────────────────────────────────────────────────────

function setGreeting() {
  const h = new Date().getHours();
  let greeting;
  if (h < 12) greeting = 'Good morning, Bjorn';
  else if (h < 17) greeting = 'Good afternoon, Bjorn';
  else greeting = 'Good evening, Bjorn';
  const el = $('greeting');
  if (el) el.textContent = greeting;
}

// ── Confetti ──────────────────────────────────────────────────────────

function fireConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const COLORS = ['#2563eb','#7c3aed','#16a34a','#f59e0b','#ec4899','#06b6d4','#f43f5e'];
  const particles = Array.from({length: 110}, (_, i) => {
    // Burst from the Run Now button area (top-right) + some from center-top
    const fromRight = i < 70;
    return {
      x:    fromRight ? window.innerWidth * (.75 + Math.random() * .2) : window.innerWidth * (.3 + Math.random() * .4),
      y:    fromRight ? window.innerHeight * .07 : window.innerHeight * .05,
      w:    5 + Math.random() * 6,
      h:    3 + Math.random() * 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx:   (Math.random() - .5) * 9,
      vy:   -4 - Math.random() * 7,
      rot:  Math.random() * 360,
      vrot: (Math.random() - .5) * 12,
      opacity: 1,
    };
  });

  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.22;           // gravity
      p.vx *= 0.99;           // slight air resistance
      p.rot += p.vrot;
      if (frame > 55) p.opacity -= 0.018;
      if (p.opacity <= 0 || p.y > canvas.height + 20) return;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (alive) requestAnimationFrame(tick);
    else canvas.remove();
  })();
}

// ── Toast notifications ───────────────────────────────────────────────

function showToast(title, msg = '', type = 'info', duration = 4000) {
  const rack = document.getElementById('toast-rack');
  if (!rack) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.style.setProperty('--toast-dur', `${duration}ms`);
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>
    <div class="toast-progress"></div>`;
  rack.appendChild(el);
  const dismiss = () => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(dismiss, duration);
  el.querySelector('.toast-close').addEventListener('click', () => clearTimeout(timer));
}

// ── Position tooltips ─────────────────────────────────────────────────

const _fundCache = {};
let _ttEl = null;
let _ttHideTimer = null;

function _getTooltip() {
  if (!_ttEl) {
    _ttEl = document.createElement('div');
    _ttEl.className = 'pos-tooltip';
    document.body.appendChild(_ttEl);
  }
  return _ttEl;
}

function _positionTooltip(e) {
  const tt = _getTooltip();
  const margin = 14;
  const rect = { w: tt.offsetWidth || 240, h: tt.offsetHeight || 160 };
  let x = e.clientX + margin;
  let y = e.clientY + margin;
  if (x + rect.w > window.innerWidth - 8) x = e.clientX - rect.w - margin;
  if (y + rect.h > window.innerHeight - 8) y = e.clientY - rect.h - margin;
  tt.style.left = x + 'px';
  tt.style.top  = y + 'px';
}

function _buildTtSparkline(closes) {
  if (!closes || closes.length < 2) return '';
  const W = 228, H = 38, PAD = 2;
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = max - min || 1;
  const xStep = (W - PAD * 2) / (closes.length - 1);
  const yFn = v => H - PAD - ((v - min) / range) * (H - PAD * 2 - 4);
  const xyPairs = closes.map((v, i) => [PAD + i * xStep, yFn(v)]);
  const isUp = closes[closes.length - 1] >= closes[0];
  const color = isUp ? '#16a34a' : '#dc2626';
  const smoothLine = _svgSmooth(xyPairs);
  const smoothFill = _svgSmoothFill(smoothLine, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:38px;display:block;margin:8px 0 6px">
    <path d="${smoothFill}" fill="${color}" opacity=".12"/>
    <path d="${smoothLine}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function _renderTooltip(symbol, fundData) {
  const pos    = (window._latestPositions || []).find(p => p.symbol === symbol);
  const closes = _lastSparklines[symbol] || [];
  const fmtN   = (v, dp=1, pre='', suf='') => { const n = parseFloat(v); return isNaN(n) ? null : `${pre}${n.toFixed(dp)}${suf}`; };

  let posHtml = '';
  if (pos) {
    const currPx = parseFloat(pos.current_price);
    const dayChg = parseFloat(pos.change_today) || 0;
    const pnl    = parseFloat(pos.unrealized_pnl) || 0;
    const pnlPct = parseFloat(pos.unrealized_pnl_pct) || 0;
    const val    = parseFloat(pos.market_value) || 0;
    const dayCls = dayChg >= 0 ? '#16a34a' : '#dc2626';
    const pnlCls = pnl >= 0 ? '#16a34a' : '#dc2626';
    posHtml = `
      <div class="tt-price-row">
        <span class="tt-price">$${currPx.toFixed(2)}</span>
        <span style="font-size:11px;font-weight:600;color:${dayCls}">${dayChg >= 0 ? '▲' : '▼'} ${Math.abs(dayChg * 100).toFixed(2)}% today</span>
      </div>
      ${_buildTtSparkline(closes)}
      <div class="tt-pos-stats">
        <div class="tt-pos-stat">
          <div class="tt-pos-label">Value</div>
          <div class="tt-pos-val">$${val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div class="tt-pos-stat">
          <div class="tt-pos-label">P&amp;L</div>
          <div class="tt-pos-val" style="color:${pnlCls}">${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}<br><span style="font-size:10px">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</span></div>
        </div>
      </div>
      <div class="tt-divider"></div>`;
  }

  const fundRows = [
    ['Sector',  fundData.sector],
    ['P/E',     fmtN(fundData.pe_trailing, 1, '', 'x')],
    ['Target',  fmtN(fundData.analyst_target, 2, '$')],
    ['Rec.',    (fundData.analyst_recommendation || '').replace(/_/g,' ') || null],
  ].filter(([, v]) => v);

  const fundHtml = fundRows.length ? `
    <div class="tt-fund-grid">
      ${fundRows.map(([l, v]) => `
        <div class="tt-pos-stat">
          <div class="tt-pos-label">${l}</div>
          <div class="tt-pos-val">${v}</div>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="tt-header">
      <span class="tt-avatar" style="background:${_symColor(symbol)};position:relative;overflow:hidden"><img class="sym-logo" src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png" alt="" loading="lazy" onerror="this.style.display='none'">${symbol.charAt(0)}</span>
      <div class="tt-header-text">
        <span class="tt-symbol">${symbol}</span>
        ${fundData.company_name ? `<span class="tt-name">${fundData.company_name}</span>` : ''}
      </div>
    </div>
    ${posHtml}
    ${fundHtml}`;
}

async function showPositionTooltip(e, symbol) {
  clearTimeout(_ttHideTimer);
  const tt = _getTooltip();
  _positionTooltip(e);

  // Render position data immediately (no network needed)
  tt.innerHTML = _renderTooltip(symbol, _fundCache[symbol] || {});
  tt.classList.add('visible');

  if (!_fundCache[symbol]) {
    try {
      const data = await fetch(`/api/fundamentals/${symbol}`).then(r => r.json());
      _fundCache[symbol] = data;
    } catch(err) {
      _fundCache[symbol] = { error: true };
    }
    // Refresh tooltip content if still showing this symbol
    if (_ttEl && _ttEl.classList.contains('visible') && !(_fundCache[symbol] || {}).error) {
      tt.innerHTML = _renderTooltip(symbol, _fundCache[symbol]);
      _positionTooltip(e);
    }
  }
}

function hidePositionTooltip() {
  _ttHideTimer = setTimeout(() => {
    if (_ttEl) _ttEl.classList.remove('visible');
  }, 120);
}

function movePositionTooltip(e) {
  if (_ttEl && _ttEl.classList.contains('visible')) _positionTooltip(e);
}

// ── Claude Directive ──────────────────────────────────────────────────

let _directiveActive = false;

async function _loadDirective() {
  try {
    const data = await fetch('/api/directive').then(r => r.json());
    _applyDirectiveState(data.user_directive || '');
  } catch(e) { /* non-critical */ }
}

function _applyDirectiveState(text) {
  _directiveActive = !!text.trim();
  const btn    = document.getElementById('directive-btn');
  const banner = document.getElementById('directive-banner');
  const bannerText = document.getElementById('directive-banner-text');
  const clearBtn   = document.getElementById('directive-clear-btn');
  const textarea   = document.getElementById('directive-text');

  if (btn) btn.classList.toggle('directive-btn-active', _directiveActive);
  if (bannerText) bannerText.textContent = text.trim();
  if (banner) banner.style.display = _directiveActive ? 'flex' : 'none';
  if (clearBtn) clearBtn.style.display = _directiveActive ? '' : 'none';
  if (textarea) textarea.value = text.trim();
}

function openDirectiveModal() {
  document.getElementById('directive-backdrop')?.classList.add('open');
  document.getElementById('directive-modal')?.classList.add('open');
  setTimeout(() => document.getElementById('directive-text')?.focus(), 80);
}

function closeDirectiveModal() {
  document.getElementById('directive-backdrop')?.classList.remove('open');
  document.getElementById('directive-modal')?.classList.remove('open');
}

async function saveDirective() {
  const text = (document.getElementById('directive-text')?.value || '').trim();
  try {
    const data = await fetch('/api/directive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(r => r.json());
    _applyDirectiveState(data.user_directive || '');
    closeDirectiveModal();
    showToast(text ? 'Directive set' : 'Directive cleared', text ? 'Claude will act on this in the next session.' : '', 'success', 3000);
  } catch(e) {
    showToast('Error saving directive', e.message, 'error');
  }
}

async function clearDirective() {
  try {
    await fetch('/api/directive', { method: 'DELETE' });
    _applyDirectiveState('');
    closeDirectiveModal();
    showToast('Directive cleared', '', 'info', 2000);
  } catch(e) {
    showToast('Error clearing directive', e.message, 'error');
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────

function closeKb(e) {
  if (!e || e.target === document.getElementById('kb-backdrop')) {
    document.getElementById('kb-backdrop').classList.remove('open');
  }
}

// ── Quick-open command palette ────────────────────────────────────────

let _qoOpen = false;

function openQuickOpen() {
  const backdrop = document.getElementById('qo-backdrop');
  const modal    = document.getElementById('qo-modal');
  const input    = document.getElementById('qo-input');
  if (!modal) return;
  _qoOpen = true;
  backdrop.classList.add('open');
  modal.classList.add('open');
  input.value = '';
  _renderQoResults('');
  requestAnimationFrame(() => input.focus());
}

function closeQuickOpen() {
  document.getElementById('qo-backdrop')?.classList.remove('open');
  document.getElementById('qo-modal')?.classList.remove('open');
  _qoOpen = false;
}

function _qoSymbols() {
  const positions = (window._latestPositions || []).map(p => ({
    sym: p.symbol,
    label: _nameCache[p.symbol] || p.symbol,
    sub: `$${parseFloat(p.current_price).toFixed(2)} · ${parseFloat(p.unrealized_pnl_pct) >= 0 ? '+' : ''}${parseFloat(p.unrealized_pnl_pct).toFixed(2)}% P&L`,
    type: 'position',
    pos: p,
  }));
  const wlExtra = [...(_watchlistSymbols || [])].filter(s => !positions.find(p => p.sym === s)).map(s => ({
    sym: s,
    label: _nameCache[s] || s,
    sub: 'Watchlist',
    type: 'watchlist',
    pos: null,
  }));
  return [...positions, ...wlExtra];
}

function _renderQoResults(query) {
  const container = document.getElementById('qo-results');
  if (!container) return;
  const q = query.trim().toUpperCase();
  const all = _qoSymbols();
  const filtered = q
    ? all.filter(item => item.sym.startsWith(q) || item.sym.includes(q) || (item.label || '').toUpperCase().includes(q))
    : all;

  if (!filtered.length) {
    container.innerHTML = `<div class="qo-empty">No matches for "${query}"</div>`;
    return;
  }
  container.innerHTML = filtered.slice(0, 8).map((item, i) => `
    <div class="qo-result ${i === 0 ? 'qo-selected' : ''}" data-idx="${i}" data-sym="${item.sym}" data-type="${item.type}"
         onclick="_qoSelect('${item.sym}','${item.type}')">
      <div class="qo-result-left">
        <div class="sym-avatar qo-avatar" style="background:${_symColor(item.sym)};position:relative;overflow:hidden"><img class="sym-logo" src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(item.sym)}?format=png" alt="" loading="lazy" onerror="this.style.display='none'">${item.sym.charAt(0)}</div>
        <div class="qo-result-text">
          <div class="qo-result-sym">${item.sym}</div>
          <div class="qo-result-name">${item.label !== item.sym ? item.label : ''}</div>
        </div>
      </div>
      <div class="qo-result-sub">${item.sub}</div>
    </div>`).join('');
}

function _qoSelect(sym, type) {
  closeQuickOpen();
  if (type === 'position') {
    const pos = (window._latestPositions || []).find(p => p.symbol === sym);
    if (pos) { openDrawer(sym, pos); return; }
  }
  openWatchlistDrawer(sym);
}

(function _initQo() {
  const input = document.getElementById('qo-input');
  const container = document.getElementById('qo-results');
  if (!input || !container) return;

  input.addEventListener('input', () => _renderQoResults(input.value));

  input.addEventListener('keydown', e => {
    const items = container.querySelectorAll('.qo-result');
    const sel = container.querySelector('.qo-selected');
    let idx = sel ? parseInt(sel.dataset.idx) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel?.classList.remove('qo-selected');
      const next = Math.min(idx + 1, items.length - 1);
      items[next]?.classList.add('qo-selected');
      items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel?.classList.remove('qo-selected');
      const prev = Math.max(idx - 1, 0);
      items[prev]?.classList.add('qo-selected');
      items[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = container.querySelector('.qo-selected');
      if (active) _qoSelect(active.dataset.sym, active.dataset.type);
    } else if (e.key === 'Escape') {
      closeQuickOpen();
    }
  });
})();

document.addEventListener('keydown', e => {
  // Ignore shortcuts when typing in an input (except Escape and Cmd+K)
  const inInput = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);

  // Cmd+K / Ctrl+K — always intercept
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    _qoOpen ? closeQuickOpen() : openQuickOpen();
    return;
  }

  if (inInput) return;

  if (e.key === 'j' || e.key === 'k') {
    const positions = window._latestPositions || [];
    if (!positions.length) return;
    e.preventDefault();
    const currentIdx = _drawerOpenSymbol
      ? positions.findIndex(p => p.symbol === _drawerOpenSymbol)
      : -1;
    let nextIdx;
    if (e.key === 'j') {
      nextIdx = currentIdx < 0 ? 0 : Math.min(positions.length - 1, currentIdx + 1);
    } else {
      nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
    }
    const target = positions[nextIdx];
    if (target) openDrawer(target.symbol, target);
    return;
  }

  switch (e.key) {
    case 'r': case 'R':
      runNow(); break;
    case 'd': case 'D':
      document.getElementById('dark-toggle')?.click(); break;
    case 's': case 'S':
      window.location = '/onboarding'; break;
    case '?':
      document.getElementById('kb-backdrop').classList.toggle('open'); break;
    case 'Escape':
      if (_qoOpen) { closeQuickOpen(); return; }
      if (document.getElementById('directive-modal')?.classList.contains('open')) { closeDirectiveModal(); return; }
      closeKb(); break;
    case '1': {
      const t7 = document.querySelector('.range-tab[data-label="7D"]');
      if (t7) setChartRange(7, t7);
      break;
    }
    case '2': {
      const t30 = document.querySelector('.range-tab[data-label="30D"]');
      if (t30) setChartRange(30, t30);
      break;
    }
    case '3': {
      const t3m = document.querySelector('.range-tab[data-label="3M"]');
      if (t3m) setChartRange(65, t3m);
      break;
    }
    case '4': {
      const tytd = document.querySelector('.range-tab[data-label="YTD"]');
      if (tytd) setChartRangeYTD(tytd);
      break;
    }
    case '5': {
      const tall = document.querySelector('.range-tab[data-label="All"]');
      if (tall) setChartRange(200, tall);
      break;
    }
    case 'p': case 'P': {
      const pctBtn = document.getElementById('chart-pct-btn');
      if (pctBtn) toggleChartPctMode(pctBtn);
      break;
    }
  }
});

// ── Auto-refresh ──────────────────────────────────────────────────────

let _lastKnownSessionId = null;

function startAutoRefresh(intervalSec = 60) {
  const bar = $('refresh-bar');
  const lastRunEl = $('last-run');
  if (!bar) return;

  let elapsed = 0;

  async function doRefresh() {
    bar.classList.add('flash');
    bar.style.width = '100%';
    try {
      await loadPortfolio();
      await loadChart();
      // Check if a new session ran while we were watching
      const recent = await fetch('/api/decisions?limit=1').then(r => r.json()).catch(() => []);
      if (recent.length) {
        const latestId = recent[0].id;
        if (_lastKnownSessionId !== null && latestId !== _lastKnownSessionId) {
          const orders = recent[0].orders || [];
          const n = orders.length;
          const title = n === 0 ? 'Claude held positions' : `Claude made ${n} trade${n !== 1 ? 's' : ''}`;
          const body  = n === 0
            ? `No changes on ${recent[0].run_date}`
            : orders.map(o => `${o.side?.toUpperCase()} ${o.symbol}`).join(', ');
          sendNotification(title, body);
          showToast(title, body, 'info', 5000);
          await loadDecisions();
        }
        _lastKnownSessionId = latestId;
      }
      if (lastRunEl) {
        const t = new Date().toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
        const prev = lastRunEl.dataset.session || '';
        lastRunEl.textContent = prev ? `${prev} · refreshed ${t}` : `Refreshed at ${t}`;
      }
    } catch(e) { /* silent */ }
    setTimeout(() => {
      bar.classList.remove('flash');
      bar.style.transition = 'none';
      bar.style.width = '0%';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          bar.style.transition = 'width 1s linear';
        });
      });
      elapsed = 0;
    }, 600);
  }

  setInterval(() => {
    elapsed++;
    const pct = (elapsed / intervalSec) * 100;
    if (!bar.classList.contains('flash')) {
      bar.style.width = Math.min(pct, 99) + '%';
    }
    if (elapsed >= intervalSec) {
      elapsed = 0;
      doRefresh();
    }
  }, 1000);
}

// ── Browser notifications ─────────────────────────────────────────────

function _notifSupported() { return 'Notification' in window; }

function sendNotification(title, body) {
  if (!_notifSupported() || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: '/static/favicon.svg' }); }
  catch(e) { /* denied or blocked */ }
}

async function requestNotifPermission() {
  if (!_notifSupported()) {
    showToast('Not supported', 'Your browser does not support notifications.', 'info', 3000);
    return;
  }
  if (Notification.permission === 'granted') {
    showToast('Already enabled', 'Notifications are on.', 'success', 2500);
    _updateNotifBtn();
    return;
  }
  const result = await Notification.requestPermission();
  _updateNotifBtn();
  if (result === 'granted') {
    sendNotification('Notifications enabled', 'You\'ll be alerted when Claude runs a session.');
    showToast('Notifications enabled', 'You\'ll be alerted after each session.', 'success', 3000);
  } else {
    showToast('Permission denied', 'Enable notifications in your browser settings.', 'error', 3500);
  }
}

function _updateNotifBtn() {
  const btn = $('notif-btn');
  if (!btn || !_notifSupported()) return;
  const perm = Notification.permission;
  btn.title = perm === 'granted' ? 'Notifications on' : 'Enable session notifications';
  btn.classList.toggle('notif-active', perm === 'granted');
}

// ── Dark mode ─────────────────────────────────────────────────────────

function initDarkMode() {
  const btn = $('dark-toggle');
  if (!btn) return;
  const isDark = localStorage.getItem('dark') === '1';
  if (isDark) document.body.classList.add('dark');
  btn.addEventListener('click', () => {
    const on = document.body.classList.toggle('dark');
    localStorage.setItem('dark', on ? '1' : '0');
  });
}

// ── Page title ────────────────────────────────────────────────────────

function _updatePageTitle() {
  if (_livePortfolioValue == null) return;
  const val = '$' + _livePortfolioValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const arrow = _liveDayPnl != null ? (_liveDayPnl >= 0 ? '▲' : '▼') : '';
  document.title = arrow ? `${arrow} ${val} · Portfolio` : `${val} · Portfolio`;
}

// ── Pull-to-refresh (mobile) ──────────────────────────────────────────

function initPullToRefresh() {
  // Only active on touch devices
  if (!('ontouchstart' in window)) return;

  const THRESHOLD = 72; // px of overscroll to trigger
  let startY = 0;
  let pulling = false;
  let refreshing = false;

  const ptr = document.createElement('div');
  ptr.id = 'ptr-indicator';
  ptr.innerHTML = '<svg class="ptr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
  document.body.appendChild(ptr);

  document.addEventListener('touchstart', e => {
    if (refreshing || window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    pulling = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!startY || refreshing || window.scrollY > 0) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 4) return;
    pulling = true;
    const progress = Math.min(dy / THRESHOLD, 1);
    const travel   = Math.min(dy * 0.38, 44);
    ptr.style.opacity   = String(Math.min(progress * 1.4, 1));
    ptr.style.transform = `translateX(-50%) translateY(${travel - 44}px) rotate(${progress >= 1 ? 180 : 0}deg)`;
    ptr.classList.toggle('ptr-ready', dy >= THRESHOLD);
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!pulling) { startY = 0; return; }
    const wasReady = ptr.classList.contains('ptr-ready');
    pulling = false;
    startY  = 0;
    ptr.classList.remove('ptr-ready');

    if (!wasReady) {
      ptr.style.opacity = '0';
      ptr.style.transform = '';
      return;
    }

    refreshing = true;
    ptr.classList.add('ptr-spinning');
    ptr.style.opacity   = '1';
    ptr.style.transform = 'translateX(-50%) translateY(4px)';

    try {
      await loadPortfolio();
      await loadChart();
    } finally {
      refreshing = false;
      ptr.classList.remove('ptr-spinning');
      ptr.style.transition = 'opacity .3s ease, transform .3s ease';
      ptr.style.opacity   = '0';
      ptr.style.transform = '';
      setTimeout(() => { ptr.style.transition = ''; }, 350);
    }
  });
}

// ── Sticky bar ────────────────────────────────────────────────────────

function _buildStickySparkSVG(vals) {
  if (!vals || vals.length < 2) return '';
  const W = 60, H = 18;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const xStep = (W - 2) / (vals.length - 1);
  const yScale = v => H - 2 - ((v - min) / range) * (H - 4);
  const xyPairs = vals.map((v, i) => [1 + i * xStep, yScale(v)]);
  const color = vals[vals.length - 1] >= vals[0] ? '#16a34a' : '#dc2626';
  const smoothLine = _svgSmooth(xyPairs);
  const smoothFill = _svgSmoothFill(smoothLine, xyPairs[0][0], xyPairs[xyPairs.length - 1][0], H);
  return `<svg class="sticky-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <path d="${smoothFill}" fill="${color}" opacity=".18"/>
    <path d="${smoothLine}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function _updateStickyBar() {
  const valEl = document.getElementById('sticky-value');
  const pnlEl = document.getElementById('sticky-day-pnl');
  if (!valEl || !pnlEl) return;
  if (_livePortfolioValue != null) {
    valEl.textContent = '$' + _livePortfolioValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }
  if (_liveDayPnl != null) {
    const sign = _liveDayPnl >= 0 ? '+' : '-';
    const cls  = _liveDayPnl >= 0 ? 'pos' : 'neg';
    const pct  = _livePortfolioValue ? (_liveDayPnl / _livePortfolioValue * 100).toFixed(2) : '0.00';
    pnlEl.innerHTML = `<span class="${cls}">${sign}$${Math.abs(_liveDayPnl).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${sign}${pct}%) today</span>`;
  }
  // Update or inject the mini sparkline
  const bar = document.getElementById('sticky-bar');
  if (bar && _stickySparkValues.length >= 2) {
    let sparkEl = bar.querySelector('.sticky-spark');
    const svg = _buildStickySparkSVG(_stickySparkValues);
    if (sparkEl) {
      sparkEl.outerHTML = svg;
    } else {
      valEl.insertAdjacentHTML('afterend', svg);
    }
  }
}

function initStickyBar() {
  const bar   = document.getElementById('sticky-bar');
  const stats = document.querySelector('.stats');
  if (!bar || !stats || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(entries => {
    const visible = entries[0].isIntersecting;
    bar.classList.toggle('visible', !visible);
    bar.setAttribute('aria-hidden', visible ? 'true' : 'false');
  }, { threshold: 0, rootMargin: '-56px 0px 0px 0px' });
  io.observe(stats);
}

// ── Scroll reveal ─────────────────────────────────────────────────────

function initScrollReveal() {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in-view');
      io.unobserve(e.target);
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -10px 0px' });

  // Stats grid as a whole unit (not individual cards — counters must be visible)
  const statsGrid = document.querySelector('.stats');
  if (statsGrid) {
    statsGrid.classList.add('scroll-reveal');
    io.observe(statsGrid);
  }

  // Each .card with a small stagger
  document.querySelectorAll('.card, .regime-banner').forEach((el, i) => {
    el.classList.add('scroll-reveal');
    el.style.transitionDelay = `${Math.min(i * 40, 200)}ms`;
    io.observe(el);
  });
}

// ── Init ──────────────────────────────────────────────────────────────

(async function init() {
  initDarkMode();
  setGreeting();
  updateMarketStatus();
  setInterval(updateMarketStatus, 1000);
  setInterval(_tickLiveRow, 30000);

  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    const badge = $('mode-badge');
    if (cfg.mode === 'live') {
      badge.textContent = 'LIVE';
      badge.className = 'badge badge-live';
    } else {
      badge.textContent = 'PAPER';
      badge.className = 'badge badge-paper';
    }
    startSessionCountdown(cfg.schedule_hour ?? 9, cfg.schedule_minute ?? 35);
  } catch(e) {
    startSessionCountdown(9, 35);
  }

  loadRegime();
  _loadDirective();
  loadCloseSynthesis();
  const portfolioData = await fetch('/api/portfolio').then(r => r.json()).catch(() => null);
  await loadPortfolio();
  window._dismissSplash?.(); // data ready — let splash go early
  loadTotalReturn(portfolioData?.portfolio_value);
  loadPortfolioNews();
  _preloadRangeReturns();
  _loadPositionAges();
  // Restore preferred chart settings before first render
  const _savedRange = parseInt(localStorage.getItem('chart-range')) || 30;
  const _savedPct   = localStorage.getItem('chart-pct') === '1';
  _chartCurrentLimit = _savedRange;
  _chartPctMode      = _savedPct;
  document.querySelectorAll('.range-tab[data-label]').forEach(b => {
    const m = (b.getAttribute('onclick') || '').match(/setChartRange\((\d+)/);
    b.classList.toggle('active', !!m && parseInt(m[1]) === _savedRange);
    if (b.dataset.label) b.textContent = b.dataset.label;
  });
  const pctBtn = document.getElementById('chart-pct-btn');
  if (pctBtn) pctBtn.classList.toggle('active', _savedPct);
  await loadChart(_savedRange);
  await loadWatchlist();
  await loadDecisions();

  try {
    const decisions = await fetch('/api/decisions?limit=1').then(r => r.json());
    const el = $('last-run');
    if (decisions.length) {
      const runLabel = relativeDate(decisions[0].run_date);
      el.textContent = `Last run: ${runLabel}`;
      el.dataset.session = `Last run: ${runLabel}`;
      _lastKnownSessionId = decisions[0].id;
    } else {
      el.textContent = 'No sessions yet';
    }
  } catch(e) {}

  _updateNotifBtn();
  initStickyBar();
  initPullToRefresh();
  startAutoRefresh(60);
  // Fire scroll-reveal ~200ms after splash clears (which now happens at ~900ms min)
  setTimeout(initScrollReveal, 1100);
  _initMobileNav();

  // Hero value: click to copy live portfolio value to clipboard
  const heroValEl = document.getElementById('stat-value');
  const heroSubEl = document.getElementById('stat-value-sub');
  if (heroValEl && navigator.clipboard) {
    heroValEl.style.cursor = 'pointer';
    heroValEl.title = 'Click to copy';
    heroValEl.addEventListener('click', async () => {
      if (_livePortfolioValue == null || heroValEl.dataset.scrubbing) return;
      const text = '$' + _livePortfolioValue.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      try {
        await navigator.clipboard.writeText(text);
        if (heroSubEl && !heroSubEl.dataset.scrubbing) {
          const prev = heroSubEl.innerHTML;
          heroSubEl.innerHTML = '<span style="color:var(--green);font-weight:600">✓ Copied</span>';
          setTimeout(() => { heroSubEl.innerHTML = prev; }, 1400);
        }
      } catch(e) { /* clipboard unavailable */ }
    });
  }
})();

