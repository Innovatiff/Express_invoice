import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  moneyInput, parseMoney, parseQty, fmtQty, loadOne, loadAll, saveRecord,
  removeRecord, orderBy, onAction, toast, toastKey, confirmDialog,
  trackDirty,
} from '../app.js';
import {
  blankItem, itemSearchBlob,
} from '../model.js';
import {
  field, card,
} from '../components.js';
import {
  invalidate as invalidateStore,
} from '../store.js';

setPageTitle('item');
await initShell('items.html');

const page = $('#page');
const p = params();
const isNew = !p.id;

let record = blankItem();
if (!isNew) {
  const loaded = await loadOne('items', p.id);
  if (!loaded) {
    page.append(el('div', { class: 'empty', html: `<p>${L('msg_not_found')}</p>` }));
    throw new Error('item not found');
  }
  record = { ...blankItem(), ...loaded, id: p.id };
}

let dirty = false;
const markDirty = () => { dirty = true; };
trackDirty(() => dirty);

const header = pageHeader('line_item', [
  { key: 'act_save', variant: 'primary', accel: 'Ctrl+S', onClick: () => save({ stay: true }) },
  { key: 'act_save_new', onClick: () => save({ then: 'new' }) },
  !isNew ? { key: 'act_delete', variant: 'danger', onClick: () => destroy() } : null,
]);
page.append(header);
refreshTitle();

const inputs = {};

function bind(name, node, transform) {
  node.value = transform ? transform.out(record[name]) : (record[name] ?? '');
  node.addEventListener('input', () => {
    record[name] = transform ? transform.in(node.value) : node.value;
    markDirty();
    if (name === 'code') refreshTitle();
    if (name === 'priceCents' || name === 'costCents') refreshMargin();
  });
  inputs[name] = node;
  return node;
}

const moneyT = { out: (v) => moneyInput(v), in: (v) => parseMoney(v) };
const qtyT = { out: (v) => fmtQty(v), in: (v) => parseQty(v) };

const marginLabel = el('span', { class: 'text-small text-muted' });

const taxableBox = el('input', { type: 'checkbox', checked: record.taxable !== false });
taxableBox.addEventListener('change', () => { record.taxable = taxableBox.checked; markDirty(); });

const activeBox = el('input', { type: 'checkbox', checked: record.active !== false });
activeBox.addEventListener('change', () => { record.active = activeBox.checked; markDirty(); });

const trackBox = el('input', { type: 'checkbox', checked: !!record.trackStock });
trackBox.addEventListener('change', () => {
  record.trackStock = trackBox.checked;
  stockField.classList.toggle('hidden', !trackBox.checked);
  markDirty();
});

const stockField = field('item_qty_stock',
  bind('qtyInStock', el('input', { type: 'text', class: 'input-num', inputmode: 'decimal' }), qtyT));
stockField.classList.toggle('hidden', !record.trackStock);

const descriptionInput = bind('description', el('textarea', { rows: 4 }));

// Existing categories become a datalist so spelling stays consistent.
const categoryInput = bind('category', el('input', { type: 'text', list: 'category-list' }));
const datalist = el('datalist', { id: 'category-list' });

page.append(card(null, el('div', {},
  el('div', { class: 'grid grid-3' },
    field('item_code', bind('code', el('input', { type: 'text', class: 'input-mono', autofocus: isNew }))),
    field('item_category', categoryInput),
    field('item_unit', bind('unit', el('input', { type: 'text', placeholder: 'ea · hr · box' }))),
  ),
  field('item_description', descriptionInput,
    `${T('item_desc_hint')}`),
  el('div', { class: 'grid grid-3' },
    field('item_cost', bind('costCents', el('input', { type: 'text', class: 'input-money', inputmode: 'decimal' }), moneyT)),
    field('item_price', bind('priceCents', el('input', { type: 'text', class: 'input-money', inputmode: 'decimal' }), moneyT)),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('item_margin') }),
      el('div', { style: 'padding-top:8px' }, marginLabel),
    ),
  ),
  el('div', { class: 'form-row mt-1' },
    el('label', { class: 'check' }, taxableBox, el('span', { html: L('item_taxable') })),
    el('label', { class: 'check' }, activeBox, el('span', { html: L('item_active') })),
    el('label', { class: 'check' }, trackBox,
      el('span', { html: 'Track stock' })),
  ),
  el('div', { class: 'grid grid-2 mt-2' }, stockField, field('notes', bind('notes', el('textarea', { rows: 2 })))),
  datalist,
)));

refreshMargin();

loadAll('items', orderBy('category')).then((all) => {
  const cats = [...new Set(all.map((i) => i.category).filter(Boolean))].sort();
  for (const c of cats) datalist.append(el('option', { value: c }));
}).catch(() => {});

function refreshTitle() {
  const h1 = header.querySelector('h1');
  h1.innerHTML = `${L('line_item')} ${record.code ? `<span class="input-mono" style="font-weight:700">${esc(record.code)}</span>` : ''}`;
}

function refreshMargin() {
  const price = Number(record.priceCents) || 0;
  const cost = Number(record.costCents) || 0;
  if (!price || !cost) { marginLabel.textContent = '—'; return; }
  const pct = Math.round(((price - cost) / price) * 100);
  marginLabel.innerHTML = `<strong>${pct}%</strong> · ${esc(money(price - cost))}`;
}

async function save({ stay = false, then = null } = {}) {
  if (!String(record.code || '').trim() && !String(record.description || '').trim()) {
    toast('Enter a code or a description.', 'warn');
    inputs.code.focus();
    return null;
  }
  const payload = { ...record };
  payload.searchBlob = itemSearchBlob(payload);
  try {
    const id = await saveRecord('items', record.id, payload);
    record.id = id;
    dirty = false;
    invalidateStore();
    toastKey('msg_saved');
    if (then === 'new') { location.href = 'item.html?new=1'; return id; }
    if (!stay) { location.href = 'items.html'; return id; }
    if (!p.id) history.replaceState({}, '', `item.html?id=${encodeURIComponent(id)}`);
    return id;
  } catch (err) {
    console.error(err);
    toast('Could not save.', 'err');
    return null;
  }
}

async function destroy() {
  const ok = await confirmDialog(
    `${L('msg_confirm_delete')}<br><strong>${esc(record.code || record.description)}</strong>` +
    '<br><span class="text-small text-muted">Past invoices keep their own copy of the description and price.</span>',
    { danger: true, okKey: 'act_delete' },
  );
  if (!ok) return;
  await removeRecord('items', record.id);
  invalidateStore();
  dirty = false;
  toastKey('msg_deleted');
  location.href = 'items.html';
}

onAction('save', () => save({ stay: true }));
onAction('saveNew', () => save({ then: 'new' }));
onAction('saveClose', () => save({ stay: false }));
