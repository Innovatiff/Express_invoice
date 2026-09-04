// ---------------------------------------------------------------------------
// The home screen.
//
// Express Invoice opened onto a flow chart of the sales cycle, so this does
// too: the diagram is the first thing on the page and every box is a way in.
// Underneath it sits the detail that a picture cannot carry — what is overdue,
// what was invoiced last, what came in.
// ---------------------------------------------------------------------------

import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, money, fmtDate,
  today, monthStart, monthEnd, loadAll, orderBy, where, limit, onAction,
  spinner,
} from '../app.js';
import { displayStatus } from '../model.js';
import { statusPill, dataTable, stat, card } from '../components.js';
import { renderWorkflow, workflowMetrics } from '../workflow.js';
import { loadCustomers, loadItems } from '../store.js';

setPageTitle('nav_home');
await initShell('dashboard.html');

const page = $('#page');

page.append(pageHeader('nav_home', [
  { key: 'nav_quick', variant: 'primary', onClick: () => { location.href = 'quick.html'; } },
  { key: 'act_new_invoice', accel: 'F2', onClick: () => { location.href = 'invoice.html?new=1'; } },
  { key: 'act_new_quote', accel: 'F3', onClick: () => { location.href = 'quote.html?new=1'; } },
  { key: 'act_new_payment', accel: 'F8', onClick: () => { location.href = 'payment.html?new=1'; } },
], fmtDate(today())));

const body = el('div', {});
page.append(body);
body.append(spinner());

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

let recentInvoices = [];
let openInvoices = [];
let payments = [];
let openQuotes = [];
let openOrders = [];
let activeRecurring = [];
let customers = [];
let items = [];

try {
  [recentInvoices, openInvoices, payments, openQuotes, openOrders, activeRecurring, customers, items] =
    await Promise.all([
      loadAll('invoices', orderBy('date', 'desc'), limit(60)),
      loadAll('invoices', where('balanceCents', '>', 0), limit(1000)),
      loadAll('payments', orderBy('date', 'desc'), limit(200)),
      loadAll('quotes', where('status', '==', 'open'), limit(300)),
      loadAll('orders', where('status', '==', 'open'), limit(300)),
      loadAll('recurring', where('active', '==', true), limit(100)),
      loadCustomers(),
      loadItems(),
    ]);
} catch (err) {
  console.error('Home screen load failed', err);
  body.innerHTML = '';
  body.append(el('div', { class: 'empty' },
    el('p', { html: 'Could not load the data.' }),
    el('p', { class: 'text-small text-muted', text: err.message || '' }),
  ));
  throw err;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

const asOf = today();
const from = monthStart();
const to = monthEnd();

const live = (inv) => !inv.voided && inv.status !== 'draft';

const liveOpenInvoices = openInvoices.filter(live);
const overdueList = liveOpenInvoices.filter((i) => displayStatus(i, asOf) === 'overdue');
const liveQuotes = openQuotes.filter((q) => !q.voided && !(q.expiryDate && q.expiryDate < asOf));
const liveOrders = openOrders.filter((o) => !o.voided);
const recurringDue = activeRecurring.filter((r) => r.nextDate && r.nextDate <= asOf);

const monthInvoices = recentInvoices.filter((i) => live(i) && i.date >= from && i.date <= to);
const monthSales = monthInvoices.reduce((s, i) => s + (Number(i.totalCents) || 0), 0);

const monthPayments = payments.filter((p) => p.date >= from && p.date <= to);
const monthPaymentsCents = monthPayments.reduce((s, p) => s + (Number(p.amountCents) || 0), 0);

const outstanding = liveOpenInvoices.reduce((s, i) => s + (Number(i.balanceCents) || 0), 0);
const overdue = overdueList.reduce((s, i) => s + (Number(i.balanceCents) || 0), 0);

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

body.innerHTML = '';

// ---- The diagram ----
body.append(el('div', { class: 'card' },
  el('div', { class: 'card-head' },
    el('div', {},
      el('h2', { text: T('wf_title') }),
      el('p', { class: 'text-small text-muted', style: 'margin:2px 0 0', text: T('wf_sub') }),
    ),
  ),
  el('div', { class: 'card-body' },
    renderWorkflow(workflowMetrics({
      customers,
      items,
      openInvoices: liveOpenInvoices,
      overdueInvoices: overdueList,
      openQuotes: liveQuotes,
      openOrders: liveOrders,
      monthPaymentsCents,
      recurringDue,
    })),
  ),
));

// ---- Today's numbers ----
body.append(el('h2', { class: 'section-heading', text: T('wf_today') }));

body.append(el('div', { class: 'stat-row' },
  stat('dash_month_sales', money(monthSales), {
    sub: `${monthInvoices.length} ${T('nav_invoices').toLowerCase()}`,
  }),
  stat('dash_outstanding', money(outstanding), {
    sub: `${liveOpenInvoices.length} ${T('nav_invoices').toLowerCase()}`,
  }),
  stat('dash_overdue', money(overdue), {
    tone: overdue > 0 ? 'warn' : undefined,
    sub: `${overdueList.length} ${T('nav_invoices').toLowerCase()}`,
  }),
  stat('rep_payments', money(monthPaymentsCents), {
    tone: monthPaymentsCents > 0 ? 'good' : undefined,
    sub: `${monthPayments.length} ${T('nav_payments').toLowerCase()}`,
  }),
));

// ---- Overdue, when there is any ----
if (overdueList.length) {
  const sorted = [...overdueList].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  body.append(card('dash_overdue',
    dataTable({
      columns: [
        { key: 'number', labelKey: 'invoice_number', className: 'nowrap', sortable: false,
          html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
        { key: 'customerName', labelKey: 'customer', sortable: false,
          html: (r) => esc(r.customerName || '—') },
        { key: 'dueDate', labelKey: 'due_date', className: 'nowrap', sortable: false,
          html: (r) => esc(fmtDate(r.dueDate)) },
        { key: 'balanceCents', labelKey: 'balance_due', className: 'num', sortable: false,
          html: (r) => `<strong>${esc(money(r.balanceCents))}</strong>`,
          footer: (list) => esc(money(list.reduce((s, r) => s + (Number(r.balanceCents) || 0), 0))) },
      ],
      rows: sorted.slice(0, 15),
      onRowClick: (r) => { location.href = `invoice.html?id=${encodeURIComponent(r.id)}`; },
    }),
    {
      flush: true,
      headExtra: el('a', { class: 'btn btn-ghost btn-sm', href: 'reports.html?report=aged', html: L('rep_aged') }),
    },
  ));
}

// ---- Recent activity ----
const twoCol = el('div', { class: 'two-col' });

twoCol.append(card('dash_recent_invoices',
  dataTable({
    columns: [
      { key: 'number', labelKey: 'number', className: 'nowrap', sortable: false,
        html: (r) => `<strong class="input-mono">${esc(r.number || '—')}</strong>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false,
        html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer', sortable: false,
        html: (r) => esc(r.customerName || '—') },
      { key: 'totalCents', labelKey: 'total', className: 'num', sortable: false,
        html: (r) => esc(money(r.totalCents)) },
      { key: 'status', labelKey: 'status', className: 'nowrap', sortable: false,
        html: (r) => statusPill(r, asOf) },
    ],
    rows: recentInvoices.slice(0, 8),
    onRowClick: (r) => { location.href = `invoice.html?id=${encodeURIComponent(r.id)}`; },
    rowClass: (r) => (r.voided ? 'is-void' : ''),
  }),
  {
    flush: true,
    headExtra: el('a', { class: 'btn btn-ghost btn-sm', href: 'invoices.html', html: L('all') }),
  },
));

twoCol.append(card('dash_recent_payments',
  dataTable({
    columns: [
      { key: 'number', labelKey: 'number', className: 'nowrap', sortable: false,
        html: (r) => `<span class="input-mono">${esc(r.number || '—')}</span>` },
      { key: 'date', labelKey: 'date', className: 'nowrap', sortable: false,
        html: (r) => esc(fmtDate(r.date)) },
      { key: 'customerName', labelKey: 'customer', sortable: false,
        html: (r) => esc(r.customerName || '—') },
      { key: 'amountCents', labelKey: 'amount', className: 'num', sortable: false,
        html: (r) => `<strong>${esc(money(r.amountCents))}</strong>` },
    ],
    rows: payments.slice(0, 8),
    onRowClick: (r) => { location.href = `payment.html?id=${encodeURIComponent(r.id)}`; },
  }),
  {
    flush: true,
    headExtra: el('a', { class: 'btn btn-ghost btn-sm', href: 'payments.html', html: L('all') }),
  },
));

body.append(twoCol);

// ---- First run ----
if (!recentInvoices.length && !customers.length) {
  body.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
    el('div', { class: 'empty' },
      el('p', { html: '<strong>Nothing here yet.</strong>' }),
      el('p', { class: 'text-small',
        text: 'Coming from Express Invoice? Start by importing your history.' }),
      el('div', { class: 'quick-actions', style: 'justify-content:center' },
        el('a', { class: 'btn btn-primary', href: 'import.html', html: L('nav_import') }),
        el('a', { class: 'btn btn-default', href: 'settings.html', html: L('nav_settings') }),
      ),
    ),
  )));
}

onAction('new', () => { location.href = 'invoice.html?new=1'; });
