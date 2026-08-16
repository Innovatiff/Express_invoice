// ---------------------------------------------------------------------------
// Printable documents.
//
//   print.html?type=invoice|quote|order&id=…
//   print.html?type=payment&id=…
//   print.html?type=statement&customer=…&from=…&to=…
//
// The sheet reproduces the Express Invoice paper layout the shop's customers
// already recognise. Labels carry Spanish first and English after, on one line,
// so the page does not grow a second inch of headers.
// ---------------------------------------------------------------------------

import {
  $, el, esc, T, params, money, fmtDate, fmtQty, today, loadOne, loadAll,
  getSettings, where, orderBy, limit, spinner,
} from '../app.js';
import {
  auth, onAuthStateChanged,
} from '../fb.js';
import {
  isConfigured,
} from '../firebase-config.js';
import {
  DOC_TYPES, PAYMENT_METHODS, buildStatement, openingBalance,
  AGING_BUCKETS, agingBucket,
} from '../model.js';

const root = $('#print-root');
const p = params();

// The print view is still owner-only data, so it waits for auth like any
// other screen — it simply does not draw the app chrome around itself.
await new Promise((resolve) => {
  if (!isConfigured()) { location.replace('login.html'); return; }
  const stop = onAuthStateChanged(auth, (user) => {
    stop();
    if (!user) {
      location.replace(`login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    resolve(user);
  });
});

const settings = await getSettings();

root.append(spinner());

/** A label, escaped for the markup these sheets are built from. */
function L(key) {
  return esc(T(key));
}

// ===========================================================================
// Shared pieces
// ===========================================================================

function businessBlock() {
  const lines = [
    settings.address,
    settings.address2,
    [[settings.city, settings.state].filter(Boolean).join(', '), settings.zip].filter(Boolean).join(' '),
    settings.country,
    settings.phone ? `Tel: ${settings.phone}` : '',
    settings.mobile && settings.mobile !== settings.phone ? `Cel: ${settings.mobile}` : '',
    settings.email,
    settings.website,
    settings.taxId ? `RNC / Tax ID: ${settings.taxId}` : '',
  ].filter(Boolean).join('\n');

  return el('div', { class: 'ds-biz' },
    settings.logoDataUrl ? el('img', { class: 'ds-logo', src: settings.logoDataUrl, alt: '' }) : null,
    el('div', { class: 'ds-biz-name', text: settings.businessName || '' }),
    el('div', { class: 'ds-biz-lines', text: lines }),
  );
}

function titleBlock(titleKey, metaRows) {
  const meta = el('table', { class: 'ds-meta' });
  const tb = el('tbody');
  for (const row of metaRows.filter(Boolean)) {
    tb.append(el('tr', { class: row.strong ? 'ds-meta-strong' : '' },
      el('th', { html: L(row.labelKey) }),
      el('td', { text: row.value }),
    ));
  }
  meta.append(tb);

  return el('div', { class: 'ds-title-block' },
    el('div', { class: 'ds-title', text: T(titleKey) }),
    meta,
  );
}

function partyBlock(labelKey, text) {
  return el('div', { class: 'ds-party' },
    el('div', { class: 'ds-party-label', html: L(labelKey) }),
    el('div', { class: 'ds-party-body', text: text || '' }),
  );
}

function noteBlock(labelKey, text) {
  if (!String(text || '').trim()) return null;
  return el('div', { class: 'ds-block' },
    el('div', { class: 'ds-block-label', html: L(labelKey) }),
    el('div', { class: 'ds-block-body', text }),
  );
}

function totalsTable(rows) {
  const table = el('table', { class: 'ds-totals' });
  const tb = el('tbody');
  for (const row of rows.filter(Boolean)) {
    tb.append(el('tr', { class: row.className || '' },
      el('th', { html: row.rawLabel ? esc(row.rawLabel) : L(row.labelKey) }),
      el('td', { text: row.value }),
    ));
  }
  table.append(tb);
  return table;
}

function toolbar(extra = []) {
  return el('div', { class: 'print-toolbar no-print' },
    el('button', {
      class: 'btn btn-primary', type: 'button',
      html: L('act_print'),
      onclick: () => window.print(),
    }),
    ...extra,
    el('button', {
      class: 'btn btn-default', type: 'button',
      html: L('act_back'),
      onclick: () => history.back(),
    }),
  );
}

function notFound() {
  root.innerHTML = '';
  root.append(el('div', { class: 'doc-sheet' },
    el('p', { html: `${esc(T('msg_not_found'))}` })));
}

// ===========================================================================
// Invoice / quote / order
// ===========================================================================

async function renderDocument(type) {
  const cfg = DOC_TYPES[type];
  const doc_ = await loadOne(cfg.collection, p.id);
  if (!doc_) return notFound();

  const sheet = el('div', { class: 'doc-sheet' });

  if (doc_.voided) {
    sheet.append(el('div', { class: 'ds-void-stamp', text: `${T('st_void')}` }));
  }

  // ---- Header ----
  const metaRows = [
    { labelKey: cfg.numberKey, value: doc_.number || '', strong: true },
    { labelKey: 'date', value: fmtDate(doc_.date) },
    cfg.hasDueDate && doc_.dueDate ? { labelKey: 'due_date', value: fmtDate(doc_.dueDate) } : null,
    cfg.hasExpiry && doc_.expiryDate ? { labelKey: 'expiry_date', value: fmtDate(doc_.expiryDate) } : null,
    doc_.terms ? { labelKey: 'terms', value: doc_.terms } : null,
    doc_.poNumber ? { labelKey: 'po_number', value: doc_.poNumber } : null,
    doc_.salesPerson ? { labelKey: 'sales_person', value: doc_.salesPerson } : null,
  ];

  sheet.append(el('div', { class: 'ds-head' }, businessBlock(), titleBlock(cfg.titleKey, metaRows)));

  // ---- Parties ----
  const parties = el('div', { class: 'ds-parties' },
    partyBlock('bill_to', doc_.billTo || doc_.customerName));
  if (String(doc_.shipTo || '').trim()) parties.append(partyBlock('ship_to', doc_.shipTo));
  sheet.append(parties);

  // ---- Lines ----
  const showDiscount = (doc_.lines || []).some((l) => Number(l.discountPct) > 0);
  const table = el('table', { class: 'ds-lines' });
  const headRow = el('tr', {},
    el('th', { class: 'w-code', html: L('line_code') }),
    el('th', { html: L('line_description') }),
    el('th', { class: 'n w-qty', html: L('line_qty') }),
    el('th', { class: 'n w-price', html: L('line_price') }),
  );
  if (showDiscount) headRow.append(el('th', { class: 'n w-disc', html: L('line_discount') }));
  headRow.append(el('th', { class: 'n w-amount', html: L('line_amount') }));
  table.append(el('thead', {}, headRow));

  const tb = el('tbody');
  for (const line of doc_.lines || []) {
    const tr = el('tr', {},
      el('td', { class: 'ds-code', text: line.code || '' }),
      el('td', { class: 'ds-desc', text: line.description || '' }),
      el('td', { class: 'n', text: fmtQty(line.qty) + (line.unit ? ` ${line.unit}` : '') }),
      el('td', { class: 'n', text: money(line.unitCents) }),
    );
    if (showDiscount) tr.append(el('td', { class: 'n', text: line.discountPct ? `${line.discountPct}%` : '' }));
    tr.append(el('td', { class: 'n', text: money(line.amountCents) }));
    tb.append(tr);
  }
  table.append(tb);
  sheet.append(table);

  // ---- Bottom: notes left, totals right ----
  const left = el('div', { class: 'ds-bottom-left' },
    noteBlock('notes', doc_.notes),
    noteBlock('terms', doc_.terms && !metaRows.some((r) => r && r.labelKey === 'terms') ? doc_.terms : ''),
  );

  const totalRows = [
    { labelKey: 'subtotal', value: money(doc_.subtotalCents) },
    doc_.discountCents ? { labelKey: 'discount', value: `-${money(doc_.discountCents)}` } : null,
    doc_.shippingCents ? { labelKey: 'shipping', value: money(doc_.shippingCents) } : null,
    doc_.tax1Cents ? {
      rawLabel: `${settings.tax1Name || T('tax')} (${settings.tax1Rate}%)`,
      value: money(doc_.tax1Cents),
    } : null,
    doc_.tax2Cents ? {
      rawLabel: `${settings.tax2Name || T('tax')} (${settings.tax2Rate}%)`,
      value: money(doc_.tax2Cents),
    } : null,
    { labelKey: 'total', value: money(doc_.totalCents), className: 'ds-total-row' },
  ];

  if (cfg.hasPayments) {
    totalRows.push({ labelKey: 'amount_paid', value: money(doc_.paidCents) });
    totalRows.push({ labelKey: 'balance_due', value: money(doc_.balanceCents), className: 'ds-balance-row' });
  }

  sheet.append(el('div', { class: 'ds-bottom' },
    left,
    el('div', { class: 'ds-totals-wrap' }, totalsTable(totalRows)),
  ));

  const footer = doc_.footerMessage || settings.footerMessage;
  sheet.append(el('div', { class: 'ds-footer-msg', html:
    footer ? esc(footer) : `${esc(T('thank_you'))}` }));

  root.innerHTML = '';
  root.append(
    toolbar([
      el('a', {
        class: 'btn btn-default',
        href: `${cfg.editPage}?id=${encodeURIComponent(p.id)}`,
        html: L('act_edit'),
      }),
    ]),
    sheet,
  );
  document.title = `${T(cfg.titleKey)} ${doc_.number || ''} — ${settings.businessName || T('app_name')}`;
}

// ===========================================================================
// Payment receipt
// ===========================================================================

async function renderPayment() {
  const pay = await loadOne('payments', p.id);
  if (!pay) return notFound();

  const customer = pay.customerId ? await loadOne('customers', pay.customerId) : null;
  const methodLabel = PAYMENT_METHODS.find((m) => m.value === pay.method);

  const sheet = el('div', { class: 'doc-sheet' });

  sheet.append(el('div', { class: 'ds-head' },
    businessBlock(),
    titleBlock('doc_receipt', [
      { labelKey: 'payment_number', value: pay.number || '', strong: true },
      { labelKey: 'date', value: fmtDate(pay.date) },
      { labelKey: 'pay_method', value: methodLabel ? T(methodLabel.key) : (pay.method || '') },
      pay.reference ? { labelKey: 'reference', value: pay.reference } : null,
    ]),
  ));

  sheet.append(el('div', { class: 'ds-parties' },
    partyBlock('customer', customer
      ? [customer.name, customer.company, customer.address, [customer.city, customer.state].filter(Boolean).join(', '), customer.phone]
        .filter(Boolean).join('\n')
      : pay.customerName),
  ));

  if ((pay.allocations || []).length) {
    const table = el('table', { class: 'ds-lines' });
    table.append(el('thead', {}, el('tr', {},
      el('th', { html: L('invoice_number') }),
      el('th', { html: L('pay_applied_to') }),
      el('th', { class: 'n w-amount', html: L('amount') }),
    )));
    const tb = el('tbody');
    for (const a of pay.allocations) {
      tb.append(el('tr', {},
        el('td', { class: 'ds-code', text: a.invoiceNumber || '' }),
        el('td', { text: '' }),
        el('td', { class: 'n', text: money(a.amountCents) }),
      ));
    }
    table.append(tb);
    sheet.append(table);
  }

  const applied = (pay.allocations || []).reduce((s, a) => s + (Number(a.amountCents) || 0), 0);
  const unapplied = (Number(pay.amountCents) || 0) - applied;

  sheet.append(el('div', { class: 'ds-bottom' },
    el('div', { class: 'ds-bottom-left' }, noteBlock('notes', pay.notes)),
    el('div', { class: 'ds-totals-wrap' }, totalsTable([
      { labelKey: 'pay_applied_to', value: money(applied) },
      unapplied !== 0 ? { labelKey: 'pay_unapplied', value: money(unapplied) } : null,
      { labelKey: 'pay_amount_received', value: money(pay.amountCents), className: 'ds-total-row' },
    ])),
  ));

  sheet.append(el('div', { class: 'ds-footer-msg', html:
    `${esc(T('thank_you'))}` }));

  root.innerHTML = '';
  root.append(
    toolbar([
      el('a', {
        class: 'btn btn-default', href: `payment.html?id=${encodeURIComponent(p.id)}`,
        html: L('act_edit'),
      }),
    ]),
    sheet,
  );
  document.title = `${T('doc_receipt')} ${pay.number || ''} — ${settings.businessName || T('app_name')}`;
}

// ===========================================================================
// Statement
// ===========================================================================

async function renderStatement() {
  const customer = await loadOne('customers', p.customer);
  if (!customer) return notFound();

  const from = p.from || '';
  const to = p.to || today();

  const [invoices, payments] = await Promise.all([
    loadAll('invoices', where('customerId', '==', p.customer), orderBy('date', 'desc'), limit(1000)),
    loadAll('payments', where('customerId', '==', p.customer), orderBy('date', 'desc'), limit(1000)),
  ]);

  const opening = openingBalance(invoices, payments, from);
  const { rows, closingBalanceCents } = buildStatement(invoices, payments, from, to);

  const sheet = el('div', { class: 'doc-sheet' });

  sheet.append(el('div', { class: 'ds-head' },
    businessBlock(),
    titleBlock('doc_statement', [
      { labelKey: 'date', value: fmtDate(to), strong: true },
      from ? { labelKey: 'date_from', value: fmtDate(from) } : null,
      { labelKey: 'date_to', value: fmtDate(to) },
    ]),
  ));

  sheet.append(el('div', { class: 'ds-parties' },
    partyBlock('customer', [
      customer.name, customer.company, customer.address, customer.address2,
      [[customer.city, customer.state].filter(Boolean).join(', '), customer.zip].filter(Boolean).join(' '),
      customer.phone, customer.email,
    ].filter(Boolean).join('\n')),
  ));

  const table = el('table', { class: 'ds-lines' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { class: 'w-code', html: L('date') }),
    el('th', { class: 'w-code', html: L('reference') }),
    el('th', { html: L('line_description') }),
    el('th', { class: 'n w-price', html: L('amount') }),
    el('th', { class: 'n w-price', html: L('amount_paid') }),
    el('th', { class: 'n w-amount', html: L('balance') }),
  )));

  const tb = el('tbody');
  tb.append(el('tr', {},
    el('td', { text: from ? fmtDate(from) : '' }),
    el('td', { text: '' }),
    el('td', { html: `<em>${esc('Balance forward')}</em>` }),
    el('td', { class: 'n', text: '' }),
    el('td', { class: 'n', text: '' }),
    el('td', { class: 'n', text: money(opening) }),
  ));

  for (const r of rows) {
    tb.append(el('tr', {},
      el('td', { text: fmtDate(r.date) }),
      el('td', { class: 'ds-code', text: r.ref || '' }),
      el('td', { html: r.kind === 'invoice'
        ? `${esc(T('doc_invoice'))}${r.description ? ' — ' + esc(r.description) : ''}`
        : `${esc(T('doc_payment'))}${r.description ? ' — ' + esc(r.description) : ''}` }),
      el('td', { class: 'n', text: r.chargeCents ? money(r.chargeCents) : '' }),
      el('td', { class: 'n', text: r.creditCents ? money(r.creditCents) : '' }),
      el('td', { class: 'n', text: money(opening + r.balanceCents) }),
    ));
  }
  table.append(tb);
  sheet.append(table);

  // Aging of what is still open, as of the statement date.
  const openInv = invoices.filter((i) => !i.voided && i.status !== 'draft' && (Number(i.balanceCents) || 0) > 0);
  const buckets = AGING_BUCKETS.map(() => 0);
  for (const inv of openInv) buckets[agingBucket(inv, to)] += Number(inv.balanceCents) || 0;

  const aging = el('table', { class: 'ds-aging' });
  aging.append(el('thead', {}, el('tr', {},
    ...AGING_BUCKETS.map((b) => el('th', { html: L(b.key) })),
    el('th', { html: L('total') }),
  )));
  aging.append(el('tbody', {}, el('tr', {},
    ...buckets.map((c) => el('td', { text: money(c) })),
    el('td', { text: money(buckets.reduce((s, c) => s + c, 0)) }),
  )));

  sheet.append(el('div', { class: 'ds-bottom' },
    el('div', { class: 'ds-bottom-left' }, aging),
    el('div', { class: 'ds-totals-wrap' }, totalsTable([
      { labelKey: 'balance', value: money(opening) },
      { labelKey: 'total', value: money(rows.reduce((s, r) => s + r.chargeCents, 0)) },
      { labelKey: 'amount_paid', value: money(rows.reduce((s, r) => s + r.creditCents, 0)) },
      { labelKey: 'balance_due', value: money(opening + closingBalanceCents), className: 'ds-total-row' },
    ])),
  ));

  sheet.append(el('div', { class: 'ds-footer-msg', html:
    `${esc(T('thank_you'))}` }));

  root.innerHTML = '';
  root.append(
    toolbar([
      el('a', {
        class: 'btn btn-default', href: `customer.html?id=${encodeURIComponent(p.customer)}`,
        html: L('customer'),
      }),
    ]),
    sheet,
  );
  document.title = `${T('doc_statement')} — ${customer.name || ''}`;
}

// ===========================================================================

try {
  if (p.type === 'payment') await renderPayment();
  else if (p.type === 'statement') await renderStatement();
  else if (DOC_TYPES[p.type]) await renderDocument(p.type);
  else notFound();

  if (p.auto === '1') setTimeout(() => window.print(), 350);
} catch (err) {
  console.error('Print render failed', err);
  root.innerHTML = '';
  root.append(el('div', { class: 'doc-sheet' },
    el('p', { text: 'Could not build the document.' }),
    el('pre', { text: err.message || String(err) }),
  ));
}
