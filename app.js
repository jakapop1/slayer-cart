/* Slayer Cart — a local-first shopping list and total tracker.
 *
 * Privacy & safety by design:
 *   - Everything is stored in this browser's localStorage. Nothing is sent anywhere.
 *   - No accounts, passwords, API keys, analytics or third-party scripts.
 *   - All text you type is rendered with textContent (never innerHTML), so it can't run as code.
 *   - Backups you import are validated and cleaned before use.
 */
'use strict';

(() => {
  // ---------------------------------------------------------------- constants
  const STORAGE_KEY = 'slayer-cart:v1';
  const VIEWS = ['list', 'receipt', 'stores', 'history', 'settings'];

  /** Breathing styles double as store colors. */
  const STYLES = {
    water:   { label: 'Water',   kanji: '水', color: '#4aa3f0' },
    flame:   { label: 'Flame',   kanji: '炎', color: '#ff6a2b' },
    thunder: { label: 'Thunder', kanji: '雷', color: '#f5c518' },
    beast:   { label: 'Beast',   kanji: '獣', color: '#93a9c0' },
    insect:  { label: 'Insect',  kanji: '蟲', color: '#b98ff5' },
    mist:    { label: 'Mist',    kanji: '霞', color: '#8fe0d8' },
    love:    { label: 'Love',    kanji: '恋', color: '#ff8fc0' },
    sound:   { label: 'Sound',   kanji: '音', color: '#e8a838' },
    wind:    { label: 'Wind',    kanji: '風', color: '#5fd08a' },
    stone:   { label: 'Stone',   kanji: '岩', color: '#b8a888' },
    serpent: { label: 'Serpent', kanji: '蛇', color: '#8f82f5' },
    sun:     { label: 'Sun',     kanji: '日', color: '#ff9d3c' },
  };

  const DEFAULT_STORES = [
    { id: 'costco', name: 'Costco', style: 'water' },
    { id: 'walmart', name: 'Walmart', style: 'thunder' },
    { id: 'times', name: 'Times', style: 'flame' },
    { id: 'safeway', name: 'Safeway', style: 'insect' },
    { id: 'donquijote', name: 'Don Quijote', style: 'beast' },
  ];

  const CURRENCIES = {
    USD: 'US dollar ($)', JPY: 'Japanese yen (¥)', CAD: 'Canadian dollar', EUR: 'Euro (€)',
    GBP: 'British pound (£)', AUD: 'Australian dollar', PHP: 'Philippine peso (₱)', KRW: 'Korean won (₩)',
  };

  const LIMITS = { name: 60, store: 40, price: 999999, qty: 999, items: 2000, stores: 60, history: 500, priceBook: 800, importBytes: 5 * 1024 * 1024 };

  // ---------------------------------------------------------------- tiny helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const uid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  /** Build DOM safely. Strings always become text nodes, never HTML. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  const styleOf = (key) => STYLES[key] || STYLES.water;
  const styleVars = (key) => ({ '--c': styleOf(key).color });

  // Money is stored as a number of currency units with up to 2 decimals; totals are summed in cents.
  const lineCents = (it) => Math.round(it.price * 100) * it.qty;
  const sumCents = (items) => items.reduce((a, it) => a + lineCents(it), 0);
  function totalsFor(items, rate) {
    const sub = sumCents(items);
    const tax = Math.round((sub * rate) / 100);
    return { sub, tax, total: sub + tax, count: items.reduce((a, it) => a + it.qty, 0) };
  }

  let fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
  function makeFormatter() {
    try { fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency }); }
    catch { fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }); }
  }
  const fmtCents = (c) => fmt.format(c / 100);
  const fmtPrice = (p) => fmt.format(p);
  const fracDigits = () => fmt.resolvedOptions().maximumFractionDigits;
  const priceStr = (p) => Number(p).toFixed(fracDigits());
  const currencySymbol = () => (fmt.formatToParts(0).find((p) => p.type === 'currency') || { value: '' }).value;

  /** Parse a typed price; returns null when it isn't a usable number. */
  function parseMoney(raw) {
    const s = String(raw ?? '').replace(/[^0-9.]/g, '');
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(Math.min(n, LIMITS.price) * 100) / 100 : null;
  }

  // ---------------------------------------------------------------- state & storage
  function defaultState() {
    return {
      version: 1,
      settings: { taxRate: 0, budget: 0, currency: 'USD', petals: true },
      stores: DEFAULT_STORES.map((s) => ({ ...s })),
      items: [],
      priceBook: Object.create(null),
      history: [],
      ui: { view: 'list', filter: 'all', hideDone: false, lastStore: DEFAULT_STORES[0].id, detail: 'itemized', scope: 'basket' },
    };
  }

  // Validation helpers: everything loaded or imported passes through these.
  const cleanStr = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const cleanNum = (v, lo, hi, fallback) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  };
  const cleanPrice = (v) => Math.round(cleanNum(v, 0, LIMITS.price, 0) * 100) / 100;
  const cleanQty = (v) => Math.round(cleanNum(v, 1, LIMITS.qty, 1));
  const cleanId = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : uid());

  function sanitizeState(raw) {
    const d = defaultState();
    if (!raw || typeof raw !== 'object') return d;

    const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const settings = {
      taxRate: Math.round(cleanNum(s.taxRate, 0, 25, 0) * 1000) / 1000,
      budget: cleanPrice(s.budget),
      currency: Object.hasOwn(CURRENCIES, s.currency) ? s.currency : 'USD',
      petals: s.petals !== false,
    };

    const stores = [];
    const storeIds = new Set();
    for (const st of Array.isArray(raw.stores) ? raw.stores.slice(0, LIMITS.stores) : []) {
      if (!st || typeof st !== 'object') continue;
      const name = cleanStr(st.name, LIMITS.store);
      if (!name) continue;
      let id = cleanId(st.id);
      if (storeIds.has(id)) id = uid();
      storeIds.add(id);
      stores.push({ id, name, style: Object.hasOwn(STYLES, st.style) ? st.style : 'water' });
    }
    if (!stores.length) for (const st of d.stores) { stores.push(st); storeIds.add(st.id); }

    const items = [];
    const itemIds = new Set();
    for (const it of Array.isArray(raw.items) ? raw.items.slice(0, LIMITS.items) : []) {
      if (!it || typeof it !== 'object') continue;
      const name = cleanStr(it.name, LIMITS.name);
      if (!name) continue;
      let id = cleanId(it.id);
      if (itemIds.has(id)) id = uid();
      itemIds.add(id);
      items.push({
        id,
        name,
        price: cleanPrice(it.price),
        qty: cleanQty(it.qty),
        storeId: storeIds.has(it.storeId) ? it.storeId : stores[0].id,
        done: it.done === true,
        ref: it.ref == null ? null : cleanPrice(it.ref),
        t: cleanNum(it.t, 0, 8.64e15, Date.now()),
      });
    }

    const priceBook = Object.create(null);
    if (raw.priceBook && typeof raw.priceBook === 'object') {
      for (const [k, v] of Object.entries(raw.priceBook).slice(0, LIMITS.priceBook)) {
        if (k.length > 140 || !k.includes('|') || !v || typeof v !== 'object') continue;
        const name = cleanStr(v.name, LIMITS.name);
        if (!name) continue;
        priceBook[k] = { name, price: cleanPrice(v.price), t: cleanNum(v.t, 0, 8.64e15, 0) };
      }
    }

    const history = [];
    for (const tr of Array.isArray(raw.history) ? raw.history.slice(0, LIMITS.history) : []) {
      if (!tr || typeof tr !== 'object' || !Array.isArray(tr.items)) continue;
      const tItems = [];
      for (const x of tr.items.slice(0, LIMITS.items)) {
        if (!x || typeof x !== 'object') continue;
        tItems.push({
          name: cleanStr(x.name, LIMITS.name) || 'Item',
          price: cleanPrice(x.price),
          qty: cleanQty(x.qty),
          store: cleanStr(x.store, LIMITS.store) || 'Store',
          style: Object.hasOwn(STYLES, x.style) ? x.style : 'water',
        });
      }
      if (!tItems.length) continue;
      const time = typeof tr.date === 'string' ? Date.parse(tr.date) : NaN;
      history.push({
        id: cleanId(tr.id),
        date: new Date(Number.isFinite(time) ? time : Date.now()).toISOString(),
        taxRate: Math.round(cleanNum(tr.taxRate, 0, 25, 0) * 1000) / 1000,
        items: tItems,
      });
    }

    const u = raw.ui && typeof raw.ui === 'object' ? raw.ui : {};
    const ui = {
      view: VIEWS.includes(u.view) ? u.view : 'list',
      filter: u.filter === 'all' || storeIds.has(u.filter) ? u.filter : 'all',
      hideDone: u.hideDone === true,
      lastStore: storeIds.has(u.lastStore) ? u.lastStore : stores[0].id,
      detail: u.detail === 'summary' ? 'summary' : 'itemized',
      scope: u.scope === 'all' ? 'all' : 'basket',
    };

    return { version: 1, settings, stores, items, priceBook, history, ui };
  }

  let storageOk = true;
  function load() {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); }
    catch { storageOk = false; return defaultState(); }
    if (!raw) return defaultState();
    try { return sanitizeState(JSON.parse(raw)); }
    catch {
      // Never silently throw away data we couldn't read: park a copy first.
      try { localStorage.setItem(`${STORAGE_KEY}:unreadable:${Date.now()}`, raw); } catch { /* ignore */ }
      return defaultState();
    }
  }

  let saveWarned = false;
  function save() {
    if (!storageOk) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveWarned = false;
    } catch {
      if (!saveWarned) toast('Couldn’t save — this browser’s storage is full or blocked. Export a backup from Settings.', { kanji: '危', ms: 6000 });
      saveWarned = true;
    }
  }

  let state = load();
  makeFormatter();

  const findItem = (id) => state.items.find((i) => i.id === id);
  const findStore = (id) => state.stores.find((s) => s.id === id);
  const priceKey = (name, storeId) => `${norm(name)}|${storeId}`;

  function rememberPrice(name, storeId, price) {
    if (!(price > 0)) return;
    state.priceBook[priceKey(name, storeId)] = { name, price, t: Date.now() };
    const keys = Object.keys(state.priceBook);
    if (keys.length > LIMITS.priceBook) {
      keys.sort((a, b) => state.priceBook[a].t - state.priceBook[b].t)
        .slice(0, keys.length - LIMITS.priceBook)
        .forEach((k) => delete state.priceBook[k]);
    }
  }

  // ---------------------------------------------------------------- toasts, dialog, effects
  function toast(msg, { kanji = '鴉', ms = 2600, action, onAction } = {}) {
    const wrap = $('#toasts');
    while (wrap.children.length >= 3) wrap.firstElementChild.remove();
    let timer;
    const t = h('div', { class: 'toast' },
      h('span', { class: 'toast-k', 'aria-hidden': 'true', text: kanji }),
      h('span', { class: 'toast-msg', text: msg }));
    const close = () => {
      clearTimeout(timer);
      t.classList.add('out');
      setTimeout(() => t.remove(), 230);
    };
    if (action) t.append(h('button', { type: 'button', class: 'toast-act', text: action, onclick: () => { close(); onAction && onAction(); } }));
    wrap.append(t);
    timer = setTimeout(close, action ? 6000 : ms);
  }

  /** Promise-based modal. Resolves true for OK, false for cancel / Esc / backdrop. */
  function dialog({ title, body, okText = 'OK', cancelText = 'Cancel', danger = false, focus } = {}) {
    const dlg = $('#dialog');
    if (dlg.open) dlg.close();
    $('#dlgTitle').textContent = title;
    const b = $('#dlgBody');
    b.replaceChildren();
    if (typeof body === 'string') b.append(h('p', { text: body }));
    else if (body) b.append(body);
    const ok = $('#dlgOk');
    const cancel = $('#dlgCancel');
    ok.textContent = okText;
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    cancel.textContent = cancelText;

    return new Promise((resolve) => {
      const finish = (v) => {
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        dlg.removeEventListener('cancel', onEsc);
        dlg.removeEventListener('keydown', onKey);
        dlg.removeEventListener('click', onBackdrop);
        if (dlg.open) dlg.close();
        resolve(v);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onEsc = (e) => { e.preventDefault(); finish(false); };
      const onKey = (e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'radio') { e.preventDefault(); finish(true); }
      };
      const onBackdrop = (e) => { if (e.target === dlg) finish(false); };
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      dlg.addEventListener('cancel', onEsc);
      dlg.addEventListener('keydown', onKey);
      dlg.addEventListener('click', onBackdrop);
      dlg.showModal();
      (focus || ok).focus();
      if (focus instanceof HTMLInputElement && focus.type === 'text') focus.select();
    });
  }

  let fieldSeq = 0;
  function field(labelText, input) {
    if (!input.id) input.id = `fld-${++fieldSeq}`;
    return h('div', { class: 'field' }, h('label', { for: input.id, text: labelText }), input);
  }

  function emptyState(kanji, title, text) {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-k', 'aria-hidden': 'true', text: kanji }),
      h('p', { class: 'empty-title', text: title }),
      h('p', { text }));
  }

  function stylePicker(name, selected) {
    return h('div', { class: 'swatches' }, Object.entries(STYLES).map(([key, st]) =>
      h('label', { class: 'swatch', style: styleVars(key) },
        h('input', { type: 'radio', name, value: key, checked: key === selected }),
        h('span', {}, h('b', { 'aria-hidden': 'true', text: st.kanji }), st.label))));
  }

  const tweens = new WeakMap();
  function animateNumber(el, toCents) {
    const from = Number(el.dataset.cents || 0);
    el.dataset.cents = String(toCents);
    const prev = tweens.get(el);
    if (prev) cancelAnimationFrame(prev);
    if (from === toCents || reducedMotion()) { el.textContent = fmtCents(toCents); return; }
    const start = performance.now();
    const dur = 480;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmtCents(Math.round(from + (toCents - from) * e));
      if (t < 1) tweens.set(el, requestAnimationFrame(step));
      else tweens.delete(el);
    };
    tweens.set(el, requestAnimationFrame(step));
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  function setupPetals() {
    const wrap = $('.petals');
    wrap.replaceChildren();
    if (!state.settings.petals || reducedMotion()) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const n = window.innerWidth < 600 ? 10 : 16;
    for (let i = 0; i < n; i++) {
      wrap.append(h('span', {
        class: 'petal',
        style: {
          '--x': `${(Math.random() * 100).toFixed(1)}vw`,
          '--d': `${(11 + Math.random() * 12).toFixed(1)}s`,
          '--delay': `${(-Math.random() * 22).toFixed(1)}s`,
          '--s': (0.6 + Math.random() * 0.8).toFixed(2),
          '--sway': `${((Math.random() * 2 - 1) * 14).toFixed(1)}vw`,
        },
      }));
    }
  }

  function stamp() {
    if (reducedMotion()) return;
    const el = $('#stamp');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---------------------------------------------------------------- summary bar
  function renderSummary() {
    const { taxRate, budget } = state.settings;
    const basket = state.items.filter((i) => i.done);
    const b = totalsFor(basket, taxRate);
    const all = totalsFor(state.items, taxRate);
    animateNumber($('#basketTotal'), b.total);
    animateNumber($('#listTotal'), all.total);

    const n = state.items.length;
    $('#basketHint').textContent = n
      ? `${basket.length} of ${plural(n, 'item')} in basket`
      : 'No items yet';
    $('#taxHint').textContent = taxRate > 0 ? `incl. ${taxRate}% tax` : 'before tax';

    const box = $('#budgetBox');
    const budgetC = Math.round(budget * 100);
    if (budgetC > 0) {
      box.hidden = false;
      const ratio = b.total / budgetC;
      $('#budgetFill').style.setProperty('--fill', String(Math.min(1, ratio)));
      $('#budgetGhost').style.setProperty('--fill', String(Math.min(1, all.total / budgetC)));
      const left = budgetC - b.total;
      $('#budgetText').textContent = left >= 0
        ? `${fmtCents(left)} left of ${fmtCents(budgetC)}`
        : `${fmtCents(-left)} over ${fmtCents(budgetC)}!`;
      box.classList.toggle('over', left < 0);
      box.classList.toggle('warn', left >= 0 && ratio >= 0.85);
      $('#budgetNote').textContent = all.total > budgetC && left >= 0
        ? `Heads up: the whole list would be ${fmtCents(all.total - budgetC)} over budget.`
        : '';
    } else {
      box.hidden = true;
    }
  }

  // ---------------------------------------------------------------- LIST view
  let rowRefs = new Map();
  let groupRefs = new Map();
  let renderTimer = 0;

  function renderFilterChips() {
    const wrap = $('#storeFilter');
    const chip = (id, label, count, style) => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(state.ui.filter === id),
      style: style ? styleVars(style) : null,
      onclick: () => {
        state.ui.filter = id;
        if (id !== 'all') state.ui.lastStore = id;
        save();
        renderList();
      },
    }, style ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null, label, h('span', { class: 'count', text: String(count) }));
    wrap.replaceChildren(
      chip('all', 'All', state.items.length),
      ...state.stores.map((s) => chip(s.id, s.name, state.items.filter((i) => i.storeId === s.id).length, s.style)));
  }

  function renderStoreSelect() {
    const sel = $('#addStore');
    const want = findStore(state.ui.lastStore) ? state.ui.lastStore : state.stores[0].id;
    sel.replaceChildren(...state.stores.map((s) => h('option', { value: s.id, text: `${s.name}  ·  ${styleOf(s.style).kanji}` })));
    sel.value = want;
    sel.style.setProperty('--c', styleOf(findStore(want).style).color);
  }

  function renderList() {
    clearTimeout(renderTimer);
    renderFilterChips();
    renderStoreSelect();
    $('#hideDone').checked = state.ui.hideDone;

    const wrap = $('#itemGroups');
    wrap.replaceChildren();
    rowRefs = new Map();
    groupRefs = new Map();

    const { filter, hideDone } = state.ui;
    const stores = filter === 'all' ? state.stores : state.stores.filter((s) => s.id === filter);
    let shownGroups = 0;

    for (const store of stores) {
      const items = state.items.filter((i) => i.storeId === store.id);
      if (!items.length) continue;
      shownGroups++;
      const st = styleOf(store.style);
      const sub = h('div', { class: 'g-sub' });
      const meta = h('div', { class: 'g-meta' });
      const visible = hideDone ? items.filter((i) => !i.done) : items;
      const body = visible.length
        ? h('ul', { class: 'items' }, visible.map((it) => itemRow(it)))
        : h('p', { class: 'g-note', text: `All ${plural(items.length, 'item')} from ${store.name} are in your basket.` });
      const el = h('section', { class: 'group', style: styleVars(store.style), 'aria-label': store.name },
        h('header', { class: 'group-head' },
          h('div', { class: 'g-kanji', 'aria-hidden': 'true', text: st.kanji }),
          h('div', { class: 'g-title' },
            h('h3', { class: 'g-name', text: store.name }),
            h('div', { class: 'g-style' }, `${st.label} Breathing`, h('span', { class: 'g-badge', text: 'Cleared' }))),
          h('div', { class: 'g-totals' }, sub, meta)),
        body);
      groupRefs.set(store.id, { el, sub, meta });
      wrap.append(el);
    }

    if (!shownGroups) {
      if (filter === 'all') {
        wrap.append(emptyState('鴉', 'Your list is quiet… for now.', 'Add your first item above. Pick a store so the Corps knows where to hunt — prices you enter are remembered for next time.'));
      } else {
        const s = findStore(filter);
        wrap.append(emptyState(styleOf(s.style).kanji, `Nothing on the ${s.name} list yet.`, 'Add an item above, or tap “All” to see every store.'));
      }
    }
    refreshTotals();
  }

  function itemRow(it) {
    const check = h('button', {
      type: 'button', class: 'check', role: 'checkbox',
      'aria-checked': String(it.done), 'aria-label': `In basket: ${it.name}`,
      onclick: () => toggleDone(it.id),
    }, h('span', { 'aria-hidden': 'true', text: '滅' }));
    const minus = h('button', { type: 'button', 'aria-label': `One less ${it.name}`, onclick: () => changeQty(it.id, -1) }, '−');
    const qty = h('span', { class: 'qty-val' });
    const plus = h('button', { type: 'button', 'aria-label': `One more ${it.name}`, onclick: () => changeQty(it.id, 1) }, '+');
    const price = h('input', {
      type: 'number', class: 'price-in', inputmode: 'decimal', min: '0', step: 'any',
      'aria-label': `Price each for ${it.name}`, value: priceStr(it.price),
    });
    price.addEventListener('focus', () => price.select());
    price.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); price.blur(); } });
    price.addEventListener('change', () => setPrice(it.id, price.value));
    const delta = h('span', { class: 'delta', hidden: true });
    const line = h('span', { class: 'line-total' });
    const row = h('li', { class: `item${it.done ? ' done' : ''}`, dataset: { id: it.id } },
      check,
      h('button', { type: 'button', class: 'item-name', title: 'Edit item', 'aria-label': `Edit ${it.name}`, onclick: () => editItem(it.id) }, it.name),
      h('div', { class: 'item-side' },
        line,
        h('button', { type: 'button', class: 'del', title: 'Remove', 'aria-label': `Remove ${it.name}`, onclick: () => deleteItem(it.id) }, '✕')),
      h('div', { class: 'item-controls' },
        h('div', { class: 'stepper', role: 'group', 'aria-label': `Quantity of ${it.name}` }, minus, qty, plus),
        h('label', { class: 'price-wrap' }, h('span', { 'aria-hidden': 'true', text: `@ ${currencySymbol()}` }), price),
        delta));
    const ref = { row, check, qty, minus, price, delta, line };
    rowRefs.set(it.id, ref);
    updateRow(it, ref);
    return row;
  }

  function updateRow(it, r) {
    r.qty.textContent = String(it.qty);
    r.minus.disabled = it.qty <= 1;
    r.line.textContent = fmtCents(lineCents(it));
    if (document.activeElement !== r.price) r.price.value = priceStr(it.price);
    if (it.ref != null && Math.abs(it.ref - it.price) >= 0.005) {
      const up = it.price > it.ref;
      r.delta.hidden = false;
      r.delta.className = `delta ${up ? 'up' : 'down'}`;
      r.delta.textContent = `${up ? '▲' : '▼'} ${fmtPrice(Math.abs(it.price - it.ref))}`;
      r.delta.title = `Last time: ${fmtPrice(it.ref)} each`;
    } else {
      r.delta.hidden = true;
    }
  }

  /** Update numbers in place (no re-render) so typing and animations aren't interrupted. */
  function refreshTotals() {
    const byId = new Map(state.items.map((i) => [i.id, i]));
    for (const [storeId, g] of groupRefs) {
      const items = state.items.filter((i) => i.storeId === storeId);
      const done = items.filter((i) => i.done);
      g.sub.textContent = fmtCents(sumCents(items));
      g.meta.textContent = `${done.length}/${items.length} in basket · ${fmtCents(sumCents(done))}`;
      g.el.classList.toggle('cleared', items.length > 0 && done.length === items.length);
    }
    for (const [id, r] of rowRefs) { const it = byId.get(id); if (it) updateRow(it, r); }
    renderSummary();
    const anyDone = state.items.some((i) => i.done);
    $('#finishTrip').disabled = !anyDone;
    $('#uncheckAll').disabled = !anyDone;
  }

  function toggleDone(id) {
    const it = findItem(id);
    if (!it) return;
    it.done = !it.done;
    save();
    const r = rowRefs.get(id);
    if (r) {
      r.row.classList.toggle('done', it.done);
      r.check.setAttribute('aria-checked', String(it.done));
      r.row.classList.remove('slash');
      if (it.done && !reducedMotion()) { void r.row.offsetWidth; r.row.classList.add('slash'); }
    }
    refreshTotals();
    if (it.done) {
      const storeItems = state.items.filter((i) => i.storeId === it.storeId);
      if (storeItems.length > 1 && storeItems.every((i) => i.done)) {
        const s = findStore(it.storeId);
        toast(`${s.name} cleared! Every item is in the basket.`, { kanji: styleOf(s.style).kanji });
      }
    }
    if (state.ui.hideDone && it.done) {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderList, 650);
    }
  }

  function changeQty(id, d) {
    const it = findItem(id);
    if (!it) return;
    const next = clamp(it.qty + d, 1, LIMITS.qty);
    if (next === it.qty) return;
    it.qty = next;
    save();
    refreshTotals();
  }

  function setPrice(id, raw) {
    const it = findItem(id);
    const r = rowRefs.get(id);
    if (!it) return;
    const p = parseMoney(raw);
    if (p == null || p === it.price) { if (r) r.price.value = priceStr(it.price); return; }
    it.price = p;
    rememberPrice(it.name, it.storeId, p);
    save();
    refreshTotals();
    if (r) {
      r.price.value = priceStr(p);
      r.row.classList.remove('flash');
      void r.row.offsetWidth;
      r.row.classList.add('flash');
    }
    updateSuggestions();
  }

  function deleteItem(id) {
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const [it] = state.items.splice(idx, 1);
    save();
    const r = rowRefs.get(id);
    if (r && !reducedMotion()) { r.row.classList.add('cut'); setTimeout(renderList, 340); }
    else renderList();
    toast(`Cut “${it.name}” from the list.`, {
      kanji: '斬',
      action: 'Undo',
      onAction: () => {
        state.items.splice(Math.min(idx, state.items.length), 0, it);
        save();
        renderList();
      },
    });
  }

  async function editItem(id) {
    const it = findItem(id);
    if (!it) return;
    const nameIn = h('input', { type: 'text', maxlength: String(LIMITS.name), value: it.name });
    const priceIn = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: priceStr(it.price) });
    const qtyIn = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: String(LIMITS.qty), step: '1', value: String(it.qty) });
    const storeSel = h('select', {}, state.stores.map((s) => h('option', { value: s.id, text: s.name, selected: s.id === it.storeId })));
    const body = h('div', { class: 'dlg-form' },
      field('Item', nameIn),
      h('div', { class: 'row2' }, field(`Price each (${currencySymbol() || 'price'})`, priceIn), field('Qty', qtyIn)),
      field('Store', storeSel));
    const ok = await dialog({ title: 'Edit item', body, okText: 'Save', focus: nameIn });
    if (!ok || !findItem(id)) return;
    const name = cleanStr(nameIn.value, LIMITS.name);
    if (name) it.name = name;
    const p = parseMoney(priceIn.value);
    if (p != null) it.price = p;
    it.qty = cleanQty(qtyIn.value);
    if (findStore(storeSel.value)) it.storeId = storeSel.value;
    rememberPrice(it.name, it.storeId, it.price);
    save();
    renderList();
    updateSuggestions();
  }

  function uncheckAll() {
    let n = 0;
    for (const it of state.items) if (it.done) { it.done = false; n++; }
    if (!n) return;
    save();
    renderList();
    toast(`${plural(n, 'item')} taken back out of the basket.`, { kanji: '戻' });
  }

  async function finishTrip() {
    const basket = state.items.filter((i) => i.done);
    if (!basket.length) { toast('Tap the circle next to items as they go in your basket first.'); return; }
    const t = totalsFor(basket, state.settings.taxRate);
    const names = [...new Set(basket.map((i) => (findStore(i.storeId) || {}).name).filter(Boolean))];
    const left = state.items.length - basket.length;
    const body = h('div', {},
      h('p', { text: `Log ${plural(basket.length, 'item')} from ${names.join(', ')} — ${fmtCents(t.total)} total — to your History?` }),
      h('p', { text: left ? `They’ll leave the list. The ${plural(left, 'item')} you didn’t get will stay.` : 'Your list will be cleared.' }));
    const ok = await dialog({ title: 'Mission complete?', body, okText: 'Log trip' });
    if (!ok) return;
    state.history.unshift({
      id: uid(),
      date: new Date().toISOString(),
      taxRate: state.settings.taxRate,
      items: basket.map((i) => {
        const s = findStore(i.storeId) || { name: 'Store', style: 'water' };
        return { name: i.name, price: i.price, qty: i.qty, store: s.name, style: s.style };
      }),
    });
    if (state.history.length > LIMITS.history) state.history.length = LIMITS.history;
    for (const i of basket) rememberPrice(i.name, i.storeId, i.price);
    state.items = state.items.filter((i) => !i.done);
    save();
    renderList();
    updateSuggestions();
    stamp();
    toast(`Mission complete! ${fmtCents(t.total)} logged to History.`, { kanji: '祝', ms: 3600 });
  }

  // add-item form -------------------------------------------------------
  function updateSuggestions() {
    const seen = new Set();
    const names = [];
    for (const e of Object.values(state.priceBook).sort((a, b) => b.t - a.t)) {
      const k = norm(e.name);
      if (seen.has(k)) continue;
      seen.add(k);
      names.push(e.name);
      if (names.length >= 200) break;
    }
    $('#itemSuggestions').replaceChildren(...names.map((n) => h('option', { value: n })));
  }

  /** Shows what you paid last time, at this store and others, while typing a name. */
  function updatePriceMemory() {
    const name = $('#addName').value.trim();
    const storeId = $('#addStore').value;
    const el = $('#priceMemory');
    const priceIn = $('#addPrice');
    priceIn.placeholder = priceStr(0);
    if (!name) { el.hidden = true; return; }
    const prefix = `${norm(name)}|`;
    const seen = [];
    for (const [k, v] of Object.entries(state.priceBook)) {
      if (!k.startsWith(prefix)) continue;
      const s = findStore(k.slice(prefix.length));
      if (s) seen.push({ store: s, price: v.price });
    }
    if (!seen.length) { el.hidden = true; return; }
    seen.sort((a, b) => a.price - b.price);
    const here = seen.find((x) => x.store.id === storeId);
    if (here) priceIn.placeholder = priceStr(here.price);
    el.replaceChildren(
      h('span', { text: here ? 'Last paid (leave price blank to reuse):' : 'Seen before at:' }),
      ...seen.slice(0, 5).map((x, i) => h('span', {
        class: `pm-chip${i === 0 && seen.length > 1 && seen[0].price < seen[seen.length - 1].price ? ' best' : ''}`,
        style: styleVars(x.store.style),
      }, `${x.store.name} ${fmtPrice(x.price)}`)));
    el.hidden = false;
  }

  function onAddItem(e) {
    e.preventDefault();
    const nameIn = $('#addName');
    const priceIn = $('#addPrice');
    const qtyIn = $('#addQty');
    const name = cleanStr(nameIn.value, LIMITS.name);
    if (!name) { nameIn.focus(); return; }
    const store = findStore($('#addStore').value) || state.stores[0];
    const known = state.priceBook[priceKey(name, store.id)];
    const typed = priceIn.value.trim();
    const price = typed === '' ? (known ? known.price : 0) : parseMoney(typed);
    if (price == null) { toast('That price doesn’t look right.', { kanji: '危' }); priceIn.focus(); return; }
    const qty = cleanQty(qtyIn.value);

    const existing = state.items.find((i) => !i.done && i.storeId === store.id && norm(i.name) === norm(name));
    let id;
    if (existing) {
      existing.qty = clamp(existing.qty + qty, 1, LIMITS.qty);
      if (typed !== '') existing.price = price;
      id = existing.id;
      toast(`${existing.name} was already on the ${store.name} list — now ×${existing.qty}.`, { kanji: styleOf(store.style).kanji });
    } else {
      if (state.items.length >= LIMITS.items) { toast('Your list is full! Finish a trip or remove some items.', { kanji: '危' }); return; }
      id = uid();
      state.items.push({ id, name, price, qty, storeId: store.id, done: false, ref: known ? known.price : null, t: Date.now() });
      toast(`Kaw! ${name} → ${store.name}`, { ms: 1800 });
    }
    rememberPrice(name, store.id, price);
    state.ui.lastStore = store.id;
    if (state.ui.filter !== 'all' && state.ui.filter !== store.id) state.ui.filter = 'all';
    save();

    nameIn.value = '';
    priceIn.value = '';
    qtyIn.value = '1';
    renderList();
    updateSuggestions();
    updatePriceMemory();
    const r = rowRefs.get(id);
    if (r && !reducedMotion()) r.row.classList.add(existing ? 'flash' : 'enter');
    nameIn.focus();
  }

  // ---------------------------------------------------------------- RECEIPT view
  const scopeItems = () => (state.ui.scope === 'all' ? state.items : state.items.filter((i) => i.done));
  const storeGroups = (items) => state.stores
    .map((s) => [s, items.filter((i) => i.storeId === s.id)])
    .filter(([, its]) => its.length);

  function receiptLine(it) {
    return h('div', { class: 'r-line' },
      h('span', { class: 'r-qty', text: `${it.qty}×` }),
      h('span', { class: 'r-name' }, it.name, it.qty > 1 ? h('small', { text: ` @ ${fmtPrice(it.price)}` }) : null),
      h('span', { class: 'r-amt', text: fmtCents(lineCents(it)) }));
  }
  const totalRow = (label, cents, cls) => h('div', { class: `r-row${cls ? ` ${cls}` : ''}` }, h('span', { text: label }), h('span', { text: fmtCents(cents) }));

  function renderReceipt() {
    const { detail, scope } = state.ui;
    for (const b of $$('[data-detail]')) b.setAttribute('aria-pressed', String(b.dataset.detail === detail));
    for (const b of $$('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    const paper = $('#receiptPaper');
    paper.replaceChildren();
    const groups = storeGroups(scopeItems());
    const all = groups.flatMap(([, its]) => its);
    const rate = state.settings.taxRate;
    const t = totalsFor(all, rate);

    paper.append(h('header', { class: 'r-head' },
      h('div', { class: 'r-emblem', 'aria-hidden': 'true', text: '滅' }),
      h('h2', { class: 'r-title', text: 'Slayer Cart' }),
      h('p', { class: 'r-kind', text: scope === 'basket' ? 'In-basket receipt' : 'Whole-list estimate' }),
      h('p', { class: 'r-date', text: new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) })));

    const hasItems = all.length > 0;
    $('#copyReceipt').disabled = !hasItems;
    $('#shareReceipt').disabled = !hasItems;
    $('#printReceipt').disabled = !hasItems;
    if (!hasItems) {
      paper.append(h('p', {
        class: 'r-empty',
        text: scope === 'basket'
          ? 'Nothing in the basket yet. On the List tab, tap the circle beside each item as it goes in your cart — or switch to “Whole list” for an estimate.'
          : 'Your list is empty. Add items on the List tab.',
      }));
      return;
    }

    for (const [store, its] of groups) {
      const st = styleOf(store.style);
      const sec = h('section', { class: 'r-store', style: styleVars(store.style) },
        h('h3', { class: 'r-store-name' },
          h('span', { class: 'r-k', 'aria-hidden': 'true', text: st.kanji }),
          store.name,
          h('span', { class: 'r-count', text: plural(its.length, 'item') })));
      if (detail === 'itemized') for (const it of its) sec.append(receiptLine(it));
      sec.append(h('div', { class: 'r-subtotal' }, h('span', { text: detail === 'itemized' ? 'Subtotal' : `${store.name} subtotal` }), h('span', { text: fmtCents(sumCents(its)) })));
      paper.append(sec);
    }
    paper.append(
      h('div', { class: 'r-totals' },
        totalRow('Subtotal', t.sub),
        rate > 0 ? totalRow(`Tax (${rate}%)`, t.tax) : null,
        totalRow('Total', t.total, 'grand')),
      h('footer', { class: 'r-foot' },
        h('div', { class: 'r-stamp', 'aria-hidden': 'true', text: '滅' }),
        h('p', { text: `${plural(t.count, 'piece')} · ${plural(groups.length, 'store')}` }),
        h('p', { class: 'r-thanks', text: 'Thank you for your service, Slayer.' })));
  }

  function receiptText() {
    const { detail, scope } = state.ui;
    const groups = storeGroups(scopeItems());
    const all = groups.flatMap(([, its]) => its);
    const rate = state.settings.taxRate;
    const t = totalsFor(all, rate);
    const W = 34;
    const pad = (l, r) => {
      const left = l.length + r.length + 1 > W ? `${l.slice(0, Math.max(4, W - r.length - 2))}…` : l;
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
    };
    const out = [`SLAYER CART — ${scope === 'basket' ? 'In basket' : 'Whole list'}`, new Date().toLocaleString(), '-'.repeat(W)];
    for (const [store, its] of groups) {
      out.push(store.name.toUpperCase());
      if (detail === 'itemized') {
        for (const it of its) {
          out.push(pad(`${it.qty} x ${it.name}`, fmtCents(lineCents(it))));
          if (it.qty > 1) out.push(`    @ ${fmtPrice(it.price)} each`);
        }
      }
      out.push(pad('  Subtotal', fmtCents(sumCents(its))), '');
    }
    out.push('-'.repeat(W), pad('Subtotal', fmtCents(t.sub)));
    if (rate > 0) out.push(pad(`Tax (${rate}%)`, fmtCents(t.tax)));
    out.push(pad('TOTAL', fmtCents(t.total)));
    return out.join('\n');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = h('textarea', { class: 'sr-only', readonly: true });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  // ---------------------------------------------------------------- STORES view
  function nextFreeStyle() {
    const used = new Set(state.stores.map((s) => s.style));
    return Object.keys(STYLES).find((k) => !used.has(k)) || 'water';
  }

  function renderNewStylePicker() {
    $('#newStylePick').replaceChildren(stylePicker('newStyle', nextFreeStyle()));
  }

  function renderStores() {
    const grid = $('#storeGrid');
    grid.replaceChildren();
    const spent = new Map();
    for (const tr of state.history) {
      for (const it of tr.items) {
        const k = norm(it.store);
        spent.set(k, (spent.get(k) || 0) + lineCents(it));
      }
    }
    for (const s of state.stores) {
      const st = styleOf(s.style);
      const items = state.items.filter((i) => i.storeId === s.id);
      grid.append(h('article', { class: 'store-card', style: styleVars(s.style) },
        h('div', { class: 'sc-kanji', 'aria-hidden': 'true', text: st.kanji }),
        h('h3', { class: 'sc-name', text: s.name }),
        h('p', { class: 'sc-style', text: `${st.label} Breathing` }),
        h('dl', { class: 'sc-stats' },
          h('div', {}, h('dt', { text: 'On list' }), h('dd', { text: `${items.length} · ${fmtCents(sumCents(items))}` })),
          h('div', {}, h('dt', { text: 'Spent so far' }), h('dd', { text: fmtCents(spent.get(norm(s.name)) || 0) }))),
        h('div', { class: 'sc-actions' },
          h('button', {
            type: 'button', class: 'btn small',
            onclick: () => { state.ui.filter = s.id; state.ui.lastStore = s.id; save(); go('list'); },
          }, 'View list'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => editStore(s.id) }, 'Edit'),
          h('button', { type: 'button', class: 'btn small ghost danger-text', 'aria-label': `Remove ${s.name}`, onclick: () => deleteStore(s.id) }, 'Remove'))));
    }
  }

  function onAddStore(e) {
    e.preventDefault();
    const input = $('#storeName');
    const name = cleanStr(input.value, LIMITS.store);
    if (!name) { input.focus(); return; }
    if (state.stores.some((s) => norm(s.name) === norm(name))) { toast(`${name} is already one of your stores.`); return; }
    if (state.stores.length >= LIMITS.stores) { toast('That’s a lot of stores! Remove one to add another.', { kanji: '危' }); return; }
    const picked = $('#newStylePick input:checked');
    const style = picked && Object.hasOwn(STYLES, picked.value) ? picked.value : 'water';
    state.stores.push({ id: uid(), name, style });
    save();
    input.value = '';
    renderStores();
    renderNewStylePicker();
    toast(`${name} joins the Corps — ${styleOf(style).label} Breathing.`, { kanji: styleOf(style).kanji });
  }

  async function editStore(id) {
    const s = findStore(id);
    if (!s) return;
    const nameIn = h('input', { type: 'text', maxlength: String(LIMITS.store), value: s.name });
    const picker = stylePicker('editStyle', s.style);
    const body = h('div', { class: 'dlg-form' },
      field('Store name', nameIn),
      h('fieldset', { class: 'style-field' }, h('legend', { text: 'Breathing style · its color' }), picker));
    const ok = await dialog({ title: `Edit ${s.name}`, body, okText: 'Save', focus: nameIn });
    if (!ok || !findStore(id)) return;
    const name = cleanStr(nameIn.value, LIMITS.store);
    if (name && norm(name) !== norm(s.name) && state.stores.some((o) => o.id !== s.id && norm(o.name) === norm(name))) {
      toast(`You already have a store called ${name}.`);
      return;
    }
    if (name) s.name = name;
    const picked = picker.querySelector('input:checked');
    if (picked && Object.hasOwn(STYLES, picked.value)) s.style = picked.value;
    save();
    renderStores();
  }

  async function deleteStore(id) {
    const s = findStore(id);
    if (!s) return;
    if (state.stores.length <= 1) { toast('Keep at least one store.'); return; }
    const n = state.items.filter((i) => i.storeId === id).length;
    const ok = await dialog({
      title: `Remove ${s.name}?`,
      body: n
        ? `This also removes the ${plural(n, 'item')} on your ${s.name} list. Past trips in History are kept.`
        : 'Past trips in History are kept.',
      okText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    state.stores = state.stores.filter((x) => x.id !== id);
    state.items = state.items.filter((i) => i.storeId !== id);
    for (const k of Object.keys(state.priceBook)) if (k.endsWith(`|${id}`)) delete state.priceBook[k];
    if (state.ui.filter === id) state.ui.filter = 'all';
    if (state.ui.lastStore === id) state.ui.lastStore = state.stores[0].id;
    save();
    renderStores();
    renderSummary();
    updateSuggestions();
    toast(`${s.name} removed.`);
  }

  // ---------------------------------------------------------------- HISTORY view
  function renderHistory() {
    const now = new Date();
    let allC = 0;
    let monthC = 0;
    const totals = state.history.map((tr) => {
      const t = totalsFor(tr.items, tr.taxRate);
      const d = new Date(tr.date);
      allC += t.total;
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthC += t.total;
      return t;
    });
    const stat = (label, value) => h('div', { class: 'hstat' }, h('span', { class: 'hs-label', text: label }), h('strong', { class: 'hs-val', text: value }));
    $('#historyStats').replaceChildren(
      stat('Trips', String(state.history.length)),
      stat(now.toLocaleDateString(undefined, { month: 'long' }), fmtCents(monthC)),
      stat('All time', fmtCents(allC)));

    const list = $('#historyList');
    list.replaceChildren();
    if (!state.history.length) {
      list.append(emptyState('記', 'No missions logged yet.', 'When you’re done shopping, tap “Finish trip” on the List tab. The receipt lands here so you can track spending — and shop again with one tap.'));
      return;
    }
    state.history.forEach((tr, i) => list.append(tripCard(tr, totals[i])));
  }

  function tripCard(tr, t) {
    const d = new Date(tr.date);
    const byStore = new Map();
    for (const it of tr.items) {
      const k = norm(it.store);
      if (!byStore.has(k)) byStore.set(k, { name: it.store, style: it.style, items: [] });
      byStore.get(k).items.push(it);
    }
    const body = h('div', { class: 'trip-body' });
    for (const g of byStore.values()) {
      body.append(h('section', { class: 'r-store', style: styleVars(g.style) },
        h('h4', { class: 'r-store-name' }, h('span', { class: 'r-k', 'aria-hidden': 'true', text: styleOf(g.style).kanji }), g.name, h('span', { class: 'r-count', text: plural(g.items.length, 'item') })),
        g.items.map(receiptLine),
        h('div', { class: 'r-subtotal' }, h('span', { text: 'Subtotal' }), h('span', { text: fmtCents(sumCents(g.items)) }))));
    }
    body.append(
      h('div', { class: 'r-totals' },
        tr.taxRate > 0 ? totalRow(`Tax (${tr.taxRate}%)`, t.tax) : null,
        totalRow('Total', t.total, 'grand')),
      h('div', { class: 'trip-actions' },
        h('button', { type: 'button', class: 'btn small accent', onclick: () => shopAgain(tr) }, 'Shop again'),
        h('button', { type: 'button', class: 'btn small ghost danger-text', onclick: () => deleteTrip(tr.id) }, 'Delete trip')));

    return h('details', { class: 'trip' },
      h('summary', {},
        h('div', { class: 't-date', 'aria-hidden': 'true' },
          h('span', { class: 't-mon', text: d.toLocaleDateString(undefined, { month: 'short' }) }),
          h('span', { class: 't-day', text: String(d.getDate()) })),
        h('div', { class: 't-info' },
          h('div', { class: 't-when', text: d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) }),
          h('div', { class: 't-tags' }, [...byStore.values()].map((g) => h('span', { class: 'tag', style: styleVars(g.style), text: g.name })))),
        h('div', { class: 't-total' }, h('strong', { text: fmtCents(t.total) }), h('span', { text: plural(tr.items.length, 'item') }))),
      body);
  }

  function shopAgain(tr) {
    let added = 0;
    let skipped = 0;
    for (const ti of tr.items) {
      let store = state.stores.find((s) => norm(s.name) === norm(ti.store));
      if (!store) {
        if (state.stores.length >= LIMITS.stores) store = state.stores[0];
        else { store = { id: uid(), name: ti.store, style: ti.style }; state.stores.push(store); }
      }
      if (state.items.some((i) => !i.done && i.storeId === store.id && norm(i.name) === norm(ti.name))) { skipped++; continue; }
      if (state.items.length >= LIMITS.items) break;
      const known = state.priceBook[priceKey(ti.name, store.id)];
      const price = known ? known.price : ti.price;
      state.items.push({ id: uid(), name: ti.name, price, qty: ti.qty, storeId: store.id, done: false, ref: price, t: Date.now() });
      added++;
    }
    state.ui.filter = 'all';
    save();
    go('list');
    toast(`${plural(added, 'item')} added back to your list${skipped ? ` (${skipped} already there)` : ''}.`, { kanji: '再' });
  }

  async function deleteTrip(id) {
    const ok = await dialog({ title: 'Delete this trip?', body: 'It will be removed from your History and spending totals.', okText: 'Delete', danger: true });
    if (!ok) return;
    state.history = state.history.filter((t) => t.id !== id);
    save();
    renderHistory();
    toast('Trip deleted.');
  }

  // ---------------------------------------------------------------- SETTINGS view
  function renderSettings() {
    $('#taxRate').value = String(state.settings.taxRate);
    $('#budget').value = state.settings.budget > 0 ? priceStr(state.settings.budget) : '';
    $('#currency').value = state.settings.currency;
    $('#petalsToggle').checked = state.settings.petals;
    renderStorageNote();
  }

  async function renderStorageNote() {
    const el = $('#storageNote');
    if (!storageOk) {
      el.textContent = 'This browser is blocking storage (often a private window), so nothing is being saved.';
      return;
    }
    const kb = Math.max(1, Math.round(JSON.stringify(state).length / 1024));
    let msg = `Using about ${kb} KB on this device.`;
    try {
      if (navigator.storage && navigator.storage.persisted) {
        const persisted = await navigator.storage.persisted();
        $('#persistBtn').hidden = persisted || !navigator.storage.persist;
        msg += persisted
          ? ' Protected from automatic cleanup ✓'
          : ' Browsers can clear site data that goes unused for a while (Safari after ~7 days unless the app is on your Home Screen) — so export a backup now and then.';
      }
    } catch { /* not supported */ }
    el.textContent = msg;
  }

  function setTax(v) {
    const n = parseFloat(v);
    state.settings.taxRate = Number.isFinite(n) ? Math.round(clamp(n, 0, 25) * 1000) / 1000 : 0;
    $('#taxRate').value = String(state.settings.taxRate);
    save();
    renderSummary();
  }

  function exportData() {
    const payload = {
      app: 'slayer-cart',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      stores: state.stores,
      items: state.items,
      priceBook: state.priceBook,
      history: state.history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `slayer-cart-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Backup saved to your downloads.', { kanji: '巻' });
  }

  async function importData(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > LIMITS.importBytes) { toast('That file is too big to be a Slayer Cart backup.', { kanji: '危' }); return; }
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { toast('Couldn’t read that file. Pick a Slayer Cart backup (.json).', { kanji: '危' }); return; }
    if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.items) && !Array.isArray(parsed.stores))) {
      toast('That file doesn’t look like a Slayer Cart backup.', { kanji: '危' });
      return;
    }
    const next = sanitizeState({ ...parsed, ui: state.ui });
    const ok = await dialog({
      title: 'Replace your data with this backup?',
      body: `It has ${plural(next.items.length, 'list item')}, ${plural(next.stores.length, 'store')} and ${plural(next.history.length, 'past trip')}. What’s on this device now will be replaced.`,
      okText: 'Import',
      danger: true,
    });
    if (!ok) return;
    state = next;
    makeFormatter();
    save();
    setupPetals();
    updateSuggestions();
    renderNewStylePicker();
    showView(state.ui.view);
    toast('Backup restored.', { kanji: '巻' });
  }

  async function eraseAll() {
    const ok = await dialog({
      title: 'Erase everything?',
      body: 'This deletes your list, stores, remembered prices and trip history from this device. It can’t be undone — export a backup first if you might want it back.',
      okText: 'Erase',
      danger: true,
    });
    if (!ok) return;
    state = defaultState();
    makeFormatter();
    save();
    setupPetals();
    updateSuggestions();
    renderNewStylePicker();
    go('list');
    toast('All clear. A fresh start.');
  }

  async function requestPersist() {
    try {
      const granted = await navigator.storage.persist();
      toast(granted
        ? 'Your data is now protected from automatic cleanup.'
        : 'The browser said “not yet.” Adding Slayer Cart to your Home Screen usually helps.', { kanji: '守', ms: 4000 });
    } catch { /* not supported */ }
    renderStorageNote();
  }

  // ---------------------------------------------------------------- routing
  const renderers = { list: renderList, receipt: renderReceipt, stores: renderStores, history: renderHistory, settings: renderSettings };

  function go(view) {
    const hash = `#/${view}`;
    if (location.hash === hash) showView(view);
    else location.hash = hash;
  }

  function showView(name) {
    const view = VIEWS.includes(name) ? name : 'list';
    const changed = state.ui.view !== view;
    state.ui.view = view;
    save();
    for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
    for (const t of $$('.tab')) {
      if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    renderers[view]();
    renderSummary();
    if (changed) window.scrollTo(0, 0);
  }

  function route() {
    const m = location.hash.match(/^#\/(\w+)/);
    showView(m && VIEWS.includes(m[1]) ? m[1] : state.ui.view);
  }

  // ---------------------------------------------------------------- wiring
  function bind() {
    for (const t of $$('.tab')) t.addEventListener('click', () => go(t.dataset.view));

    // list
    $('#addForm').addEventListener('submit', onAddItem);
    $('#addName').addEventListener('input', updatePriceMemory);
    $('#addStore').addEventListener('change', () => {
      state.ui.lastStore = $('#addStore').value;
      save();
      $('#addStore').style.setProperty('--c', styleOf((findStore(state.ui.lastStore) || {}).style).color);
      updatePriceMemory();
    });
    for (const b of $$('#addForm [data-step]')) {
      b.addEventListener('click', () => {
        const q = $('#addQty');
        q.value = String(clamp((parseInt(q.value, 10) || 1) + Number(b.dataset.step), 1, LIMITS.qty));
      });
    }
    $('#hideDone').addEventListener('change', (e) => { state.ui.hideDone = e.target.checked; save(); renderList(); });
    $('#uncheckAll').addEventListener('click', uncheckAll);
    $('#finishTrip').addEventListener('click', finishTrip);

    // receipt
    for (const b of $$('[data-detail]')) b.addEventListener('click', () => { state.ui.detail = b.dataset.detail; save(); renderReceipt(); });
    for (const b of $$('[data-scope]')) b.addEventListener('click', () => { state.ui.scope = b.dataset.scope; save(); renderReceipt(); });
    $('#copyReceipt').addEventListener('click', async () => {
      const ok = await copyText(receiptText());
      toast(ok ? 'Receipt copied — paste it in a text or note.' : 'Copy didn’t work in this browser. Try Share or Print.', { kanji: ok ? '写' : '危' });
    });
    if (navigator.share) {
      const share = $('#shareReceipt');
      share.hidden = false;
      share.addEventListener('click', () => { navigator.share({ title: 'Slayer Cart', text: receiptText() }).catch(() => {}); });
    }
    $('#printReceipt').addEventListener('click', () => window.print());

    // stores
    $('#storeForm').addEventListener('submit', onAddStore);
    renderNewStylePicker();

    // settings
    $('#currency').replaceChildren(...Object.entries(CURRENCIES).map(([code, label]) => h('option', { value: code, text: `${code} — ${label}` })));
    $('#taxRate').addEventListener('change', (e) => setTax(e.target.value));
    for (const b of $$('[data-tax]')) b.addEventListener('click', () => { setTax(b.dataset.tax); toast(`Sales tax set to ${state.settings.taxRate}%.`, { kanji: '計' }); });
    $('#budget').addEventListener('change', (e) => {
      const p = parseMoney(e.target.value);
      state.settings.budget = p == null ? 0 : p;
      e.target.value = state.settings.budget > 0 ? priceStr(state.settings.budget) : '';
      save();
      renderSummary();
    });
    $('#currency').addEventListener('change', (e) => {
      if (!Object.hasOwn(CURRENCIES, e.target.value)) return;
      state.settings.currency = e.target.value;
      makeFormatter();
      save();
      renderSettings();
      renderSummary();
    });
    $('#petalsToggle').addEventListener('change', (e) => { state.settings.petals = e.target.checked; save(); setupPetals(); });
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', importData);
    $('#persistBtn').addEventListener('click', requestPersist);
    $('#eraseBtn').addEventListener('click', eraseAll);

    window.addEventListener('hashchange', route);
    // Keep in sync if the app is open in two tabs.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      let next;
      try { next = sanitizeState(JSON.parse(e.newValue)); } catch { return; }
      next.ui.view = state.ui.view; // each tab keeps its own section; don't write back (avoids ping-pong)
      state = next;
      makeFormatter();
      renderers[state.ui.view]();
      renderSummary();
    });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', setupPetals);
  }

  function registerServiceWorker() {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || local)) return;
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  }

  bind();
  setupPetals();
  updateSuggestions();
  route();
  registerServiceWorker();
  if (!storageOk) toast('This browser is blocking storage (private window?), so your list won’t be saved.', { kanji: '危', ms: 7000 });
})();
