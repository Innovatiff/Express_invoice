// ---------------------------------------------------------------------------
// Shared application core.
//
// Every screen imports from here: the auth guard, the chrome (top bar + left
// nav), money and date handling, the keyboard shortcut engine, toasts, modals,
// and the thin Firestore helpers.
// ---------------------------------------------------------------------------

import {
  auth, db, onAuthStateChanged, signOut, collection, doc, getDoc, getDocs,
  setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  runTransaction, writeBatch, serverTimestamp,
} from './fb.js';
import {
  isConfigured,
} from './firebase-config.js';
import {
  T, L, esc,
} from './i18n.js';

export { T, L, esc };
export {
  db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, runTransaction, writeBatch, serverTimestamp,
};

// ===========================================================================
// Tiny DOM helpers
// ===========================================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Read the query string. */
export function params() {
  return Object.fromEntries(new URLSearchParams(location.search).entries());
}

// ===========================================================================
// Settings (cached for the life of the page)
// ===========================================================================

export const DEFAULT_SETTINGS = {
  businessName: '',
  logoDataUrl: '',
  address: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  country: '',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  taxId: '',
  currencySymbol: '$',
  currencyCode: 'USD',
  dateFormat: 'MM/DD/YYYY',
  tax1Name: 'Tax',
  tax1Rate: 0,
  tax2Name: '',
  tax2Rate: 0,
  tax2Compound: false,
  taxInclusive: false,
  defaultTerms: '',
  defaultDueDays: 0,
  quoteValidDays: 30,
  footerMessage: '',
  defaultNotes: '',
};

let _settings = null;

export async function getSettings(force = false) {
  if (_settings && !force) return _settings;
  try {
    const snap = await getDoc(doc(db, 'settings', 'business'));
    _settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
  } catch (err) {
    console.warn('Settings unavailable, using defaults', err);
    _settings = { ...DEFAULT_SETTINGS };
  }
  return _settings;
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await setDoc(doc(db, 'settings', 'business'), next, { merge: true });
  _settings = next;
  return next;
}

// ===========================================================================
// Money — everything is stored as integer cents, never as a float.
// ===========================================================================

/** "1,234.56" / "$1,234.56" / "1234,56" -> 123456 */
export function parseMoney(input) {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return Math.round(input * 100);
  let s = String(input).trim().replace(/[^\d.,\-]/g, '');
  if (!s) return 0;
  const negative = s.includes('-');
  s = s.replace(/-/g, '');
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;

  if (commas && dots) {
    // Both present, so whichever comes last is the decimal point: either
    // 1.234,56 or 1,234.56.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(/,([^,]*)$/, '.$1');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (commas) {
    // Only commas. One comma with one or two digits after it is a decimal
    // ("1,23"); anything else is thousands ("1,234" and "1,234,567"), which
    // used to come out as $1.23 and $12.35 — a thousand times short.
    s = commas === 1 && /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (dots > 1) {
    // "1.234.567" can only be thousands.
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

/** 123456 -> "$1,234.56" */
export function money(cents, opts = {}) {
  const s = _settings || DEFAULT_SETTINGS;
  const sym = opts.symbol === false ? '' : (s.currencySymbol ?? '$');
  const n = (Number(cents) || 0) / 100;
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-' : '') + sym + body;
}

/** 123456 -> "1234.56" (for input fields) */
export function moneyInput(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

export function parseQty(input) {
  if (input === null || input === undefined || input === '') return 0;
  const n = parseFloat(String(input).replace(/,/g, '.').replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

export function fmtQty(q) {
  const n = Number(q) || 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function parseRate(input) {
  const n = parseFloat(String(input ?? '').replace(/,/g, '.').replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

// ===========================================================================
// Dates — stored as plain "YYYY-MM-DD" strings, which sort correctly, survive
// timezone changes, and match what the CSV exports contain.
// ===========================================================================

export function today() {
  const d = new Date();
  return iso(d);
}

export function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(isoDate, days) {
  const d = fromIso(isoDate);
  d.setDate(d.getDate() + Number(days || 0));
  return iso(d);
}

export function addMonths(isoDate, months) {
  const d = fromIso(isoDate);
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Number(months || 0));
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return iso(d);
}

export function fromIso(isoDate) {
  const [y, m, d] = String(isoDate || today()).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Format for display using the configured date format. */
export function fmtDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).split('-');
  if (!y || !m || !d) return String(isoDate);
  const f = (_settings || DEFAULT_SETTINGS).dateFormat || 'MM/DD/YYYY';
  if (f === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  if (f === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
  return `${m}/${d}/${y}`;
}

/**
 * Accepts anything a ten-year-old CSV export might hold and returns
 * "YYYY-MM-DD", or '' if it truly cannot be read.
 */
export function parseDate(input, preferDayFirst = false) {
  if (!input) return '';
  const s = String(input).trim();
  if (!s) return '';

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    // If one part is clearly a day, trust it regardless of the preference.
    let month, day;
    if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else if (preferDayFirst) { day = a; month = b; }
    else { month = a; day = b; }
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return iso(parsed);
  return '';
}

function pad2(n) {
  return String(Number(n)).padStart(2, '0');
}

export function daysBetween(a, b) {
  const ms = fromIso(b).getTime() - fromIso(a).getTime();
  return Math.round(ms / 86400000);
}

export function monthStart(d = today()) {
  const dt = fromIso(d);
  return iso(new Date(dt.getFullYear(), dt.getMonth(), 1));
}

export function monthEnd(d = today()) {
  const dt = fromIso(d);
  return iso(new Date(dt.getFullYear(), dt.getMonth() + 1, 0));
}

export function yearStart(d = today()) {
  return iso(new Date(fromIso(d).getFullYear(), 0, 1));
}

export function yearEnd(d = today()) {
  return iso(new Date(fromIso(d).getFullYear(), 11, 31));
}

// ===========================================================================
// Auth
// ===========================================================================

export function requireAuth() {
  return new Promise((resolve) => {
    if (!isConfigured()) {
      showConfigError();
      return; // never resolves — the page stays on the config notice
    }
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      if (!user) {
        const back = encodeURIComponent(location.pathname + location.search);
        location.replace(`login.html?next=${back}`);
        return;
      }
      resolve(user);
    });
  });
}

export async function doSignOut() {
  await signOut(auth);
  location.replace('login.html');
}

function showConfigError() {
  document.body.innerHTML = '';
  document.body.append(
    el('div', { class: 'config-error' },
      el('h1', { text: 'Configuration' }),
      el('p', { html: L('msg_config_missing') }),
      el('pre', { text: 'public/js/firebase-config.js' }),
    ),
  );
}

// ===========================================================================
// Chrome — top bar and left navigation
// ===========================================================================

const NAV = [
  { group: 'nav_home', items: [
    { key: 'nav_home', href: 'dashboard.html', icon: '⌂' },
  ] },
  { group: 'nav_sales', items: [
    { key: 'nav_invoices', href: 'invoices.html', icon: '▤' },
    { key: 'nav_quotes', href: 'quotes.html', icon: '◇' },
    { key: 'nav_orders', href: 'orders.html', icon: '▦' },
    { key: 'nav_payments', href: 'payments.html', icon: '⛁' },
    { key: 'nav_recurring', href: 'recurring.html', icon: '↻' },
  ] },
  { group: 'nav_catalog', items: [
    { key: 'nav_customers', href: 'customers.html', icon: '☺' },
    { key: 'nav_items', href: 'items.html', icon: '▧' },
  ] },
  { group: 'nav_tools', items: [
    { key: 'nav_statements', href: 'statements.html', icon: '☰' },
    { key: 'nav_reports', href: 'reports.html', icon: '◪' },
    { key: 'nav_import', href: 'import.html', icon: '⤓' },
    { key: 'nav_settings', href: 'settings.html', icon: '⚙' },
  ] },
];

/**
 * Builds the shell around whatever `<main id="page">` the screen declares.
 * Returns the settings object so callers do not have to fetch it again.
 */
export async function initShell(activeHref) {
  const user = await requireAuth();
  const settings = await getSettings();
  document.documentElement.lang = 'en';

  const brand = settings.businessName || T('app_name');
  const active = activeHref || location.pathname.split('/').pop() || 'dashboard.html';

  const nav = el('nav', { class: 'nav', 'aria-label': 'Principal / Main' });
  for (const group of NAV) {
    if (group.group !== 'nav_home') {
      nav.append(el('div', { class: 'nav-group', html: L(group.group) }));
    }
    for (const item of group.items) {
      nav.append(el('a', {
        class: 'nav-link' + (item.href === active ? ' is-active' : ''),
        href: item.href,
        html: `<span class="nav-icon" aria-hidden="true">${item.icon}</span>${L(item.key)}`,
      }));
    }
  }
  nav.append(
    el('div', { class: 'nav-spacer' }),
    el('a', { class: 'nav-link nav-link--muted', href: 'shortcuts.html',
      html: `<span class="nav-icon" aria-hidden="true">⌨</span>${L('nav_shortcuts')}` }),
  );

  const topbar = el('header', { class: 'topbar' },
    el('button', {
      class: 'topbar-menu', type: 'button', 'aria-label': 'Menu',
      onclick: () => document.body.classList.toggle('nav-open'),
      html: '☰',
    }),
    el('a', { class: 'topbar-brand', href: 'dashboard.html', text: brand }),
    el('div', { class: 'topbar-search' },
      el('input', {
        type: 'search', id: 'global-search', autocomplete: 'off',
        placeholder: `${T('act_search')}  ( / )`,
        'aria-label': T('act_search'),
        onkeydown: (e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            location.href = 'search.html?q=' + encodeURIComponent(e.currentTarget.value.trim());
          }
        },
      }),
    ),
    el('div', { class: 'topbar-user' },
      el('span', { class: 'topbar-email', text: user.email || '' }),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        html: L('act_sign_out'),
        onclick: () => doSignOut(),
      }),
    ),
  );

  const main = $('#page') || el('main', { id: 'page' });
  main.remove();
  const shell = el('div', { class: 'shell' }, nav, main);

  const scrim = el('div', { class: 'nav-scrim', onclick: () => document.body.classList.remove('nav-open') });

  document.body.prepend(topbar, shell, scrim);
  installShortcuts();
  return { user, settings };
}

// ===========================================================================
// Page header / toolbar helper — the Express Invoice "big buttons on top" look
// ===========================================================================

export function pageHeader(titleKey, buttons = [], subtitle = '') {
  const bar = el('div', { class: 'pagebar' },
    el('div', { class: 'pagebar-title' },
      el('h1', { html: L(titleKey) }),
      subtitle ? el('p', { class: 'pagebar-sub', text: subtitle }) : null,
    ),
    el('div', { class: 'pagebar-actions' },
      ...buttons.filter(Boolean).map((b) =>
        el('button', {
          class: 'btn ' + (b.variant ? 'btn-' + b.variant : 'btn-default') + (b.id ? '' : ''),
          type: 'button',
          id: b.id || null,
          title: b.hint || null,
          onclick: b.onClick,
          html: L(b.key) + (b.accel ? `<kbd class="btn-kbd">${esc(b.accel)}</kbd>` : ''),
        }),
      ),
    ),
  );
  return bar;
}

export function setPageTitle(key) {
  document.title = `${T(key)} — ${T('app_name')}`;
}

// ===========================================================================
// Toast + modal
// ===========================================================================

let toastHost = null;

export function toast(message, kind = 'ok', ms = 3200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div', { class: `toast toast--${kind}`, html: message });
  toastHost.append(node);
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 220);
  }, ms);
}

export function toastKey(key, kind = 'ok') {
  toast(L(key), kind);
}

/** Promise-based confirm dialog. Resolves true/false. */
export function confirmDialog(messageHtml, { okKey = 'ok', cancelKey = 'act_cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
      if (e.key === 'Enter') { e.stopPropagation(); close(true); }
    };
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(false); } },
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        el('div', { class: 'modal-body', html: messageHtml }),
        el('div', { class: 'modal-foot' },
          el('button', { class: 'btn btn-default', type: 'button', html: L(cancelKey), onclick: () => close(false) }),
          el('button', {
            class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'),
            type: 'button', html: L(okKey), onclick: () => close(true),
          }),
        ),
      ),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('.btn-primary, .btn-danger')?.focus();
  });
}

/** Generic modal that hosts arbitrary content. Returns { close }. */
export function openModal(contentNode, { wide = false, onClose } = {}) {
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    el('div', { class: 'modal' + (wide ? ' modal--wide' : ''), role: 'dialog', 'aria-modal': 'true' }, contentNode),
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  return { close, overlay };
}

// ===========================================================================
// Keyboard shortcuts
//
// Ten years of muscle memory is the whole point of this project, so the bindings
// are deliberate:
//   - Ctrl/Cmd combos and function keys work everywhere, including in fields.
//   - Bare letters work only when you are NOT typing in a field, the way the
//     desktop app's list views behaved.
//   - "g" is a prefix: g then i = invoices, g then c = customers, and so on.
// Ctrl+N is not used: browsers keep it for "new window" and will not give it up.
// ===========================================================================

const pageActions = new Map();

/** Screens register their own handlers: onAction('save', fn). */
export function onAction(name, fn) {
  pageActions.set(name, fn);
}

export function fireAction(name) {
  const fn = pageActions.get(name);
  if (fn) { fn(); return true; }
  return false;
}

const GOTO = {
  h: 'dashboard.html',
  i: 'invoices.html',
  f: 'invoices.html',
  q: 'quotes.html',
  c: 'customers.html',
  o: 'orders.html',
  p: 'payments.html',
  a: 'items.html',      // "Articles"/items — 'i' is taken by Invoices
  r: 'reports.html',
  e: 'statements.html',
  s: 'settings.html',
};

let gotoArmed = false;
let gotoTimer = null;
let shortcutsInstalled = false;

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function installShortcuts() {
  if (shortcutsInstalled) return;
  shortcutsInstalled = true;

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = isTyping(e.target);

    // ---- Always active ----
    if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      fireAction('save');
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      fireAction('saveNew');
      return;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      if (!fireAction('saveClose')) fireAction('save');
      return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
      if (pageActions.has('print')) {
        e.preventDefault();
        fireAction('print');
      }
      return;
    }
    if (e.key === 'F2') { e.preventDefault(); location.href = 'invoice.html?new=1'; return; }
    if (e.key === 'F3') { e.preventDefault(); location.href = 'quote.html?new=1'; return; }
    if (e.key === 'F4') { e.preventDefault(); location.href = 'order.html?new=1'; return; }
    if (e.key === 'F8') { e.preventDefault(); location.href = 'payment.html?new=1'; return; }
    if (e.key === 'Escape' && !typing) { fireAction('escape'); return; }

    // ---- Line-grid movement (works while typing, hence the Alt guard) ----
    if (e.altKey && !mod) {
      const k = e.key.toLowerCase();
      if (k === 'i') { e.preventDefault(); fireAction('insertLine'); return; }
      if (k === 'd') { e.preventDefault(); fireAction('deleteLine'); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); fireAction('moveLineUp'); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); fireAction('moveLineDown'); return; }
    }

    if (typing || mod || e.altKey) return;

    // ---- Bare keys, only outside fields ----
    if (gotoArmed) {
      gotoArmed = false;
      clearTimeout(gotoTimer);
      const dest = GOTO[e.key.toLowerCase()];
      if (dest) { e.preventDefault(); location.href = dest; return; }
    }

    switch (e.key) {
      case '/':
        e.preventDefault();
        ($('#list-search') || $('#global-search'))?.focus();
        break;
      case '?':
        e.preventDefault();
        location.href = 'shortcuts.html';
        break;
      case 'g':
        e.preventDefault();
        gotoArmed = true;
        clearTimeout(gotoTimer);
        gotoTimer = setTimeout(() => { gotoArmed = false; }, 1500);
        break;
      case 'n':
        if (pageActions.has('new')) { e.preventDefault(); fireAction('new'); }
        break;
      case 'e':
        if (pageActions.has('edit')) { e.preventDefault(); fireAction('edit'); }
        break;
      case 'p':
        if (pageActions.has('print')) { e.preventDefault(); fireAction('print'); }
        break;
      default:
        break;
    }
  }, false);
}

// ===========================================================================
// Firestore helpers
// ===========================================================================

export function colRef(name) {
  return collection(db, name);
}

export async function loadAll(name, ...constraints) {
  const snap = await getDocs(constraints.length ? query(colRef(name), ...constraints) : colRef(name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function loadOne(name, id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveRecord(name, id, data) {
  const payload = { ...data, updatedAt: serverTimestamp() };
  delete payload.id;
  if (id) {
    await setDoc(doc(db, name, id), payload, { merge: false });
    return id;
  }
  payload.createdAt = serverTimestamp();
  const ref = await addDoc(colRef(name), payload);
  return ref.id;
}

export async function removeRecord(name, id) {
  await deleteDoc(doc(db, name, id));
}

// ---------------------------------------------------------------------------
// Document numbering. A transaction on counters/{type} so a number is never
// handed out twice, with prefix and zero-padding kept alongside the counter.
// ---------------------------------------------------------------------------

export const COUNTER_DEFAULTS = {
  invoice: { next: 1, prefix: '', padding: 4 },
  quote: { next: 1, prefix: '', padding: 4 },
  order: { next: 1, prefix: '', padding: 4 },
  payment: { next: 1, prefix: '', padding: 4 },
  customer: { next: 1, prefix: '', padding: 4 },
};

export async function peekCounter(type) {
  const snap = await getDoc(doc(db, 'counters', type));
  return { ...COUNTER_DEFAULTS[type], ...(snap.exists() ? snap.data() : {}) };
}

export async function setCounter(type, patch) {
  await setDoc(doc(db, 'counters', type), { ...COUNTER_DEFAULTS[type], ...patch }, { merge: true });
}

export async function nextNumber(type) {
  const ref = doc(db, 'counters', type);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const state = { ...COUNTER_DEFAULTS[type], ...(snap.exists() ? snap.data() : {}) };
    const value = Number(state.next) || 1;
    tx.set(ref, { ...state, next: value + 1 }, { merge: true });
    return formatNumber(value, state.prefix, state.padding);
  });
}

export function formatNumber(value, prefix = '', padding = 4) {
  const digits = String(value);
  return String(prefix || '') + (padding > 0 ? digits.padStart(padding, '0') : digits);
}

/**
 * Numeric part of a document number, used to keep the counter ahead of any
 * historical number that comes in through the importer.
 */
export function numericPart(numberString) {
  const m = String(numberString || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

// ===========================================================================
// CSV
// ===========================================================================

/** RFC4180-ish parser that copes with quotes, embedded commas and CRLF. */
export function parseCSV(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/** Guesses the delimiter from the header line. */
export function sniffDelimiter(text) {
  const line = String(text).split(/\r?\n/)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ===========================================================================
// Misc
// ===========================================================================

export function debounce(fn, ms = 220) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Lowercased haystack used for fast client-side filtering. */
export function searchBlob(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase().slice(0, 1500);
}

/** "José" -> "jose", so an accent never stands between a name and its search. */
export function foldAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** True when the text holds anything outside plain ASCII. */
function hasAccents(s) {
  return /[^\u0000-\u007f]/.test(s);
}

export function matchesSearch(blob, term) {
  const words = String(term || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = String(blob || '').toLowerCase();
  if (words.every((w) => haystack.includes(w))) return true;

  // Most of this shop's customers are called things like José Pérez and
  // Castañeda, and nobody types the accents into a search box. Compare again
  // with the accents taken off both sides — done second, and only when there
  // are accents to take off, so the common case costs nothing.
  if (!hasAccents(haystack) && !words.some(hasAccents)) return false;
  const folded = foldAccents(haystack);
  return words.every((w) => folded.includes(foldAccents(w)));
}

/** Guard against navigating away from an edited form. */
export function trackDirty(getDirty) {
  window.addEventListener('beforeunload', (e) => {
    if (getDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

export function emptyState(messageKey = 'msg_empty_list', actionNode = null) {
  return el('div', { class: 'empty' },
    el('p', { html: L(messageKey) }),
    actionNode,
  );
}

export function spinner() {
  return el('div', { class: 'spinner', html: `<span></span>${L('loading')}` });
}
