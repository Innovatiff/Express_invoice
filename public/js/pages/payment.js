import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  moneyInput, parseMoney, fmtDate, today, loadOne, loadAll, saveRecord,
  removeRecord, nextNumber, peekCounter, setCounter, formatNumber,
  numericPart, where, orderBy, limit, onAction, toast, toastKey,
  confirmDialog, trackDirty, spinner,
} from '../app.js';
import {
  blankPayment, PAYMENT_METHODS, paymentTotals, allocationDeltas,
  applyInvoiceDeltas, autoAllocate,
} from '../model.js';
import {
  loadCustomers, findCustomer,
} from '../store.js';
import {
  field, card, selectEl, customerAutocomplete, statusPill,
} from '../components.js';

setPageTitle('doc_payment');
const { settings } = await initShell('payments.html');

const page = $('#page');
const p = params();
const isNew = !p.id;

let customers = [];
try { customers = await loadCustomers(); } catch { /* handled below */ }

let record = blankPayment();
let original = null;
let counterPreview = '';

if (isNew) {
  const state = await peekCounter('payment');
  counterPreview = formatNumber(state.next, state.prefix, state.padding);
  record.number = counterPreview;
  if (p.customer) {
    const c = await findCustomer(p.customer);
    if (c) { record.customerId = c.id; record.customerName = c.name || c.company || ''; }
  }
} else {
  const loaded = await loadOne('payments', p.id);
  if (!loaded) {
    page.append(el('div', { class: 'empty', html: `<p>${L('msg_not_found')}</p>` }));
    throw new Error('payment not found');
  }
  record = { ...blankPayment(), ...loaded, id: p.id };
  original = JSON.parse(JSON.stringify(record));
}

let dirty = false;
const markDirty = () => { dirty = true; };
trackDirty(() => dirty);

// Allocations the saved version of this payment already made, so the invoice
// rows can show what is genuinely still owed rather than double-counting it.
const originalAlloc = new Map(
  (original?.allocations || []).map((a) => [a.invoiceId, Math.round(Number(a.amountCents) || 0)]),
);

const header = pageHeader('doc_payment', [
  { key: 'act_save', variant: 'primary', accel: 'Ctrl+S', onClick: () => save({ stay: true }) },
  { key: 'act_save_new', onClick: () => save({ then: 'new' }) },
  { key: 'act_print', accel: 'Ctrl+P', onClick: () => doPrint() },
  !isNew ? { key: 'act_delete', variant: 'danger', onClick: () => destroy() } : null,
]);
page.append(header);

// ---------------------------------------------------------------------------
// Header form
// ---------------------------------------------------------------------------

const customerInput = el('input', { type: 'text', id: 'f-customer', value: record.customerName || '' });
const numberInput = el('input', { type: 'text', class: 'input-mono', value: record.number || '' });
const dateInput = el('input', { type: 'date', value: record.date || today() });
const amountInput = el('input', {
  type: 'text', class: 'input-money', inputmode: 'decimal',
  value: moneyInput(record.amountCents), id: 'f-amount',
});
const methodSelect = selectEl(
  PAYMENT_METHODS.map((m) => ({ value: m.value, labelKey: m.key, selected: record.method === m.value })),
);
const referenceInput = el('input', { type: 'text', value: record.reference || '' });
const notesInput = el('textarea', { rows: 2 });
notesInput.value = record.notes || '';

numberInput.addEventListener('input', () => { record.number = numberInput.value.trim(); markDirty(); });
dateInput.addEventListener('change', () => { record.date = dateInput.value || today(); markDirty(); });
amountInput.addEventListener('input', () => { record.amountCents = parseMoney(amountInput.value); markDirty(); refreshSummary(); });
amountInput.addEventListener('blur', () => { amountInput.value = moneyInput(record.amountCents); });
methodSelect.addEventListener('change', () => { record.method = methodSelect.value; markDirty(); });
referenceInput.addEventListener('input', () => { record.reference = referenceInput.value; markDirty(); });
notesInput.addEventListener('input', () => { record.notes = notesInput.value; markDirty(); });

page.append(card(null, el('div', {},
  el('div', { class: 'grid grid-2' },
    field('customer', customerInput),
    el('div', { class: 'grid grid-2' },
      field('payment_number', numberInput),
      field('date', dateInput),
    ),
  ),
  el('div', { class: 'grid grid-4' },
    field('pay_amount_received', amountInput),
    field('pay_method', methodSelect),
    field('reference', referenceInput),
    field('notes', notesInput),
  ),
)));

customerAutocomplete(customerInput, () => customers, async (c) => {
  record.customerId = c.id;
  record.customerName = c.name || c.company || '';
  record.allocations = [];
  markDirty();
  await loadOpenInvoices();
});

// ---------------------------------------------------------------------------
// Allocation table
// ---------------------------------------------------------------------------

const allocHost = el('div', {});
const summaryHost = el('div', { class: 'card-foot' });

page.append(el('div', { class: 'card' },
  el('div', { class: 'card-head' },
    el('h2', { html: L('pay_applied_to') }),
    el('div', { class: 'form-row' },
      el('button', {
        class: 'btn btn-default btn-sm', type: 'button',
        html: L('act_apply'),
        title: T('pay_apply_hint'),
        onclick: () => {
          record.allocations = autoAllocate(record.amountCents, openInvoices.map((inv) => ({
            ...inv, balanceCents: available(inv),
          })));
          markDirty();
          renderAllocations();
        },
      }),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        html: L('act_clear'),
        onclick: () => { record.allocations = []; markDirty(); renderAllocations(); },
      }),
    ),
  ),
  allocHost,
  summaryHost,
));

let openInvoices = [];

await loadOpenInvoices();

async function loadOpenInvoices() {
  allocHost.innerHTML = '';
  allocHost.append(spinner());
  if (!record.customerId) {
    allocHost.innerHTML = '';
    allocHost.append(el('div', { class: 'empty', html: `<p>${L('msg_pick_customer')}</p>` }));
    refreshSummary();
    return;
  }
  try {
    const all = await loadAll('invoices', where('customerId', '==', record.customerId));
    openInvoices = all
      .filter((inv) => !inv.voided && inv.status !== 'draft')
      .filter((inv) => available(inv) > 0 || originalAlloc.has(inv.id))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  } catch (err) {
    console.error(err);
    openInvoices = [];
    // Say what actually went wrong. "Could not load invoices" on its own sent
    // the owner looking for missing invoices when the query itself had failed.
    toast(`Could not load this customer's invoices. ${err.message || ''}`.trim(), 'err', 8000);
  }

  // Arriving from an invoice: preselect it and offer the full balance.
  if (isNew && p.invoice && !record.allocations.length) {
    const target = openInvoices.find((inv) => inv.id === p.invoice);
    if (target) {
      const due = available(target);
      record.allocations = [{ invoiceId: target.id, invoiceNumber: target.number, amountCents: due }];
      if (!record.amountCents) {
        record.amountCents = due;
        amountInput.value = moneyInput(due);
      }
    }
  }

  renderAllocations();
}

/** What this invoice still owes, ignoring what this very payment already put on it. */
function available(invoice) {
  return Math.max(0, (Number(invoice.balanceCents) || 0) + (originalAlloc.get(invoice.id) || 0));
}

function allocatedFor(invoiceId) {
  const found = (record.allocations || []).find((a) => a.invoiceId === invoiceId);
  return found ? Math.round(Number(found.amountCents) || 0) : 0;
}

function setAllocation(invoice, cents) {
  const amount = Math.max(0, Math.round(cents || 0));
  record.allocations = (record.allocations || []).filter((a) => a.invoiceId !== invoice.id);
  if (amount > 0) {
    record.allocations.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountCents: amount,
    });
  }
  markDirty();
  refreshSummary();
}

function renderAllocations() {
  allocHost.innerHTML = '';

  if (!record.customerId) {
    allocHost.append(el('div', { class: 'empty', html: `<p>${L('msg_pick_customer')}</p>` }));
    refreshSummary();
    return;
  }
  if (!openInvoices.length) {
    allocHost.append(el('div', { class: 'empty', html:
      '<p>This customer has no open invoices.</p>' }));
    refreshSummary();
    return;
  }

  const table = el('table', { class: 'data' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { html: L('invoice_number') }),
    el('th', { html: L('date') }),
    el('th', { html: L('due_date') }),
    el('th', { class: 'num', html: L('total') }),
    el('th', { class: 'num', html: L('balance_due') }),
    el('th', { class: 'num', html: L('amount') }),
    el('th', { class: 'col-narrow' }),
  )));

  const tb = el('tbody');
  for (const inv of openInvoices) {
    const due = available(inv);
    const input = el('input', {
      type: 'text', class: 'input-money', inputmode: 'decimal',
      value: allocatedFor(inv.id) ? moneyInput(allocatedFor(inv.id)) : '',
      placeholder: '0.00',
    });
    input.addEventListener('input', () => setAllocation(inv, parseMoney(input.value)));
    input.addEventListener('blur', () => {
      const v = allocatedFor(inv.id);
      input.value = v ? moneyInput(v) : '';
    });

    tb.append(el('tr', {},
      el('td', { class: 'nowrap', html:
        `<a href="invoice.html?id=${encodeURIComponent(inv.id)}" class="input-mono"><strong>${esc(inv.number || '—')}</strong></a>` }),
      el('td', { class: 'nowrap', text: fmtDate(inv.date) }),
      el('td', { class: 'nowrap cell-muted', html:
        `${esc(fmtDate(inv.dueDate))} ${statusPill(inv)}` }),
      el('td', { class: 'num', text: money(inv.totalCents) }),
      el('td', { class: 'num', text: money(due) }),
      el('td', { class: 'num' }, input),
      el('td', { class: 'col-narrow' },
        el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          html: L('act_pay_full'),
          onclick: () => { setAllocation(inv, due); input.value = moneyInput(due); },
        })),
    ));
  }
  table.append(tb);

  allocHost.append(el('div', { class: 'table-wrap' }, table));
  refreshSummary();
}

function refreshSummary() {
  const totals = paymentTotals(record);
  summaryHost.innerHTML = '';

  const over = totals.unappliedCents < 0;
  const credit = totals.unappliedCents > 0;

  summaryHost.append(el('div', { class: 'form-row', style: 'justify-content:flex-end;gap:26px' },
    el('div', {},
      el('div', { class: 'stat-label', html: L('pay_amount_received') }),
      el('div', { style: 'font-size:17px;font-weight:700' , text: money(totals.amountCents) })),
    el('div', {},
      el('div', { class: 'stat-label', html: L('pay_applied_to') }),
      el('div', { style: 'font-size:17px;font-weight:700', text: money(totals.appliedCents) })),
    el('div', {},
      el('div', { class: 'stat-label', html: L(over ? 'msg_over_applied' : 'pay_unapplied') }),
      el('div', {
        class: over ? 'text-red' : credit ? 'text-green' : '',
        style: 'font-size:17px;font-weight:700',
        text: money(totals.unappliedCents),
      })),
  ));

  if (credit) {
    summaryHost.append(el('p', { class: 'text-small text-muted mt-1', style: 'text-align:right',
      html: `${T('pay_apply_hint')}` }));
  }
}

// ---------------------------------------------------------------------------
// Save / delete
// ---------------------------------------------------------------------------

async function resolveNumber() {
  const typed = String(record.number || '').trim();
  if (!typed || (isNew && typed === counterPreview)) return nextNumber('payment');
  const n = numericPart(typed);
  if (n > 0) {
    const state = await peekCounter('payment');
    if (n >= Number(state.next)) await setCounter('payment', { next: n + 1 });
  }
  return typed;
}

async function save({ stay = false, then = null } = {}) {
  if (!record.customerId) { toastKey('msg_pick_customer', 'warn'); customerInput.focus(); return null; }

  const totals = paymentTotals(record);
  if (totals.amountCents <= 0) {
    toast('Enter the amount received.', 'warn');
    amountInput.focus();
    return null;
  }
  if (totals.unappliedCents < 0) {
    const ok = await confirmDialog(
      `${L('msg_over_applied')}<br>` +
      `${T('pay_applied_to')}: <strong>${esc(money(totals.appliedCents))}</strong> · ` +
      `${T('pay_amount_received')}: <strong>${esc(money(totals.amountCents))}</strong>`,
      { danger: true },
    );
    if (!ok) return null;
  }

  const payload = { ...record };
  payload.number = await resolveNumber();
  Object.assign(payload, paymentTotals(payload));

  try {
    // Move the invoices first: if that fails, no payment record is written and
    // the books stay consistent. A saved payment that never reached the
    // invoices would be far worse than a retry.
    const deltas = allocationDeltas(original, payload);
    await applyInvoiceDeltas(deltas, settings);

    const id = await saveRecord('payments', record.id, payload);
    record.id = id;
    record.number = payload.number;
    original = JSON.parse(JSON.stringify({ ...payload, id }));
    originalAlloc.clear();
    for (const a of payload.allocations || []) originalAlloc.set(a.invoiceId, Math.round(Number(a.amountCents) || 0));

    dirty = false;
    toastKey('msg_saved');
    numberInput.value = record.number;

    if (then === 'new') { location.href = 'payment.html?new=1'; return id; }
    if (!stay) { location.href = 'payments.html'; return id; }
    if (!p.id) history.replaceState({}, '', `payment.html?id=${encodeURIComponent(id)}`);
    await loadOpenInvoices();
    return id;
  } catch (err) {
    console.error('Payment save failed', err);
    toast(`Could not save the payment.` +
      `<br><small>${esc(err.message || '')}</small>`, 'err', 8000);
    return null;
  }
}

async function destroy() {
  const ok = await confirmDialog(
    `${L('msg_confirm_delete')}<br><strong>${esc(record.number)}</strong> — ${esc(money(record.amountCents))}` +
    '<br><span class="text-small text-muted">Invoice balances will be restored.</span>',
    { danger: true, okKey: 'act_delete' },
  );
  if (!ok) return;
  try {
    await applyInvoiceDeltas(allocationDeltas(original, { allocations: [] }), settings);
    await removeRecord('payments', record.id);
    dirty = false;
    toastKey('msg_deleted');
    location.href = 'payments.html';
  } catch (err) {
    console.error(err);
    toast('Could not delete.', 'err');
  }
}

async function doPrint() {
  if (dirty || !record.id) {
    const id = await save({ stay: true });
    if (!id) return;
  }
  location.href = `print.html?type=payment&id=${encodeURIComponent(record.id)}`;
}

onAction('save', () => save({ stay: true }));
onAction('saveNew', () => save({ then: 'new' }));
onAction('saveClose', () => save({ stay: false }));
onAction('print', () => doPrint());

if (isNew && !record.customerId) setTimeout(() => customerInput.focus(), 60);
