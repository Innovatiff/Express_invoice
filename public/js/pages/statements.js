import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  fmtDate, today, yearStart, loadAll, loadOne, where, orderBy, limit,
  onAction, toast, spinner, toCSV, downloadFile,
} from '../app.js';
import {
  buildStatement, openingBalance, AGING_BUCKETS, agingBucket,
} from '../model.js';
import {
  loadCustomers,
} from '../store.js';
import {
  dataTable, customerAutocomplete, field, card,
} from '../components.js';

setPageTitle('nav_statements');
await initShell('statements.html');

const page = $('#page');
const p = params();

const state = {
  customerId: p.customer || '',
  from: p.from || yearStart(),
  to: p.to || today(),
};

let customers = [];
try { customers = await loadCustomers(); } catch { /* reported below */ }

page.append(pageHeader('nav_statements', [
  { key: 'act_print', accel: 'Ctrl+P', onClick: () => openPrint() },
  { key: 'act_export_csv', onClick: () => exportCsv() },
]));

const customerInput = el('input', { type: 'text', id: 'list-search' });
const fromInput = el('input', { type: 'date', value: state.from });
const toInput = el('input', { type: 'date', value: state.to });
const openOnlyBox = el('input', { type: 'checkbox' });

if (state.customerId) {
  const c = customers.find((x) => x.id === state.customerId);
  if (c) customerInput.value = c.name || c.company || '';
}

customerAutocomplete(customerInput, () => customers, (c) => {
  state.customerId = c.id;
  run();
});
fromInput.addEventListener('change', () => { state.from = fromInput.value; run(); });
toInput.addEventListener('change', () => { state.to = toInput.value; run(); });
openOnlyBox.addEventListener('change', () => run());

page.append(el('div', { class: 'card' },
  el('div', { class: 'filters' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('customer') }), customerInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_from') }), fromInput),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: L('date_to') }), toInput),
    el('label', { class: 'check' }, openOnlyBox,
      el('span', { html: 'Open invoices only' })),
  ),
));

const resultHost = el('div', {});
page.append(resultHost);

let lastRows = [];

await run();

async function run() {
  resultHost.innerHTML = '';
  if (!state.customerId) {
    resultHost.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'empty', html: `<p>${L('msg_pick_customer')}</p>` }))));
    return;
  }
  resultHost.append(spinner());

  const url = new URL(location.href);
  url.searchParams.set('customer', state.customerId);
  url.searchParams.set('from', state.from);
  url.searchParams.set('to', state.to);
  history.replaceState({}, '', url);

  try {
    const [customer, invoices, payments] = await Promise.all([
      loadOne('customers', state.customerId),
      loadAll('invoices', where('customerId', '==', state.customerId)),
      loadAll('payments', where('customerId', '==', state.customerId)),
    ]);

    const opening = openingBalance(invoices, payments, state.from);
    let { rows, closingBalanceCents } = buildStatement(invoices, payments, state.from, state.to);

    if (openOnlyBox.checked) {
      const openIds = new Set(invoices
        .filter((i) => !i.voided && i.status !== 'draft' && (Number(i.balanceCents) || 0) > 0)
        .map((i) => i.id));
      rows = rows.filter((r) => r.kind !== 'invoice' || openIds.has(r.id));
    }

    lastRows = rows;

    const openInvoices = invoices.filter((i) => !i.voided && i.status !== 'draft' && (Number(i.balanceCents) || 0) > 0);
    const buckets = AGING_BUCKETS.map(() => 0);
    for (const inv of openInvoices) buckets[agingBucket(inv, state.to)] += Number(inv.balanceCents) || 0;
    const totalOpen = buckets.reduce((s, c) => s + c, 0);

    resultHost.innerHTML = '';

    resultHost.append(el('div', { class: 'stat-row' },
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label', text: 'Balance forward' }),
        el('div', { class: 'stat-value', text: money(opening) })),
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: L('total') }),
        el('div', { class: 'stat-value', text: money(rows.reduce((s, r) => s + r.chargeCents, 0)) })),
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: L('amount_paid') }),
        el('div', { class: 'stat-value', text: money(rows.reduce((s, r) => s + r.creditCents, 0)) })),
      el('div', { class: 'stat' + (totalOpen > 0 ? ' stat--warn' : '') },
        el('div', { class: 'stat-label', html: L('balance_due') }),
        el('div', { class: 'stat-value', text: money(opening + closingBalanceCents) })),
    ));

    resultHost.append(card('doc_statement', dataTable({
      columns: [
        { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false,
          html: (r) => esc(fmtDate(r.date)) },
        { key: 'ref', labelKey: 'reference', className: 'nowrap', sortable: false,
          html: (r) => {
            const page_ = r.kind === 'invoice' ? 'invoice.html' : 'payment.html';
            return `<a href="${page_}?id=${encodeURIComponent(r.id)}" class="input-mono">${esc(r.ref || '—')}</a>`;
          } },
        { key: 'kind', labelKey: 'line_description', sortable: false,
          html: (r) => (r.kind === 'invoice'
            ? L('doc_invoice')
            : L('doc_payment')) + (r.description ? ` — <span class="cell-muted">${esc(r.description)}</span>` : '') },
        { key: 'charge', labelKey: 'amount', className: 'num', sortable: false,
          html: (r) => (r.chargeCents ? esc(money(r.chargeCents)) : ''),
          footer: (l) => esc(money(l.reduce((s, r) => s + r.chargeCents, 0))) },
        { key: 'credit', labelKey: 'amount_paid', className: 'num', sortable: false,
          html: (r) => (r.creditCents ? esc(money(r.creditCents)) : ''),
          footer: (l) => esc(money(l.reduce((s, r) => s + r.creditCents, 0))) },
        { key: 'balance', labelKey: 'balance', className: 'num', sortable: false,
          html: (r) => `<strong>${esc(money(opening + r.balanceCents))}</strong>`,
          footer: () => esc(money(opening + closingBalanceCents)) },
      ],
      rows,
      emptyKey: 'rep_no_rows',
    }), {
      flush: true,
      headExtra: el('span', { class: 'text-small text-muted',
        text: `${customer?.name || ''} · ${fmtDate(state.from)} — ${fmtDate(state.to)}` }),
    }));

    if (totalOpen > 0) {
      resultHost.append(card('rep_aged', dataTable({
        columns: [
          ...AGING_BUCKETS.map((b, i) => ({
            key: `b${i}`, labelKey: b.key, className: 'num', sortable: false,
            html: () => esc(money(buckets[i])),
          })),
          { key: 'total', labelKey: 'total', className: 'num', sortable: false,
            html: () => `<strong>${esc(money(totalOpen))}</strong>` },
        ],
        rows: [{}],
      }), { flush: true }));
    }
  } catch (err) {
    console.error(err);
    resultHost.innerHTML = '';
    resultHost.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('p', { html: 'Could not build the statement.' }),
      el('p', { class: 'text-small text-muted', text: err.message || '' }),
    )));
  }
}

function openPrint() {
  if (!state.customerId) { toast(T('msg_pick_customer'), 'warn'); return; }
  location.href = `print.html?type=statement&customer=${encodeURIComponent(state.customerId)}` +
    `&from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`;
}

function exportCsv() {
  if (!lastRows.length) { toast(T('rep_no_rows'), 'warn'); return; }
  const header = [
    `${T('date')}`,
    `${T('reference')}`,
    `${T('line_description')}`,
    `${T('amount')}`,
    `${T('amount_paid')}`,
    `${T('balance')}`,
  ];
  const body = lastRows.map((r) => [
    r.date, r.ref,
    r.kind === 'invoice' ? `${T('doc_invoice')}` : `${T('doc_payment')}`,
    r.chargeCents / 100, r.creditCents / 100, r.balanceCents / 100,
  ]);
  downloadFile(`estado-statement-${state.customerId}-${today()}.csv`, '﻿' + toCSV([header, ...body]));
}

onAction('print', () => openPrint());
