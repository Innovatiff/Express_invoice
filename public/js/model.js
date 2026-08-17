// ---------------------------------------------------------------------------
// Business logic: document shape, totals, statuses, conversions, payments.
//
// Every money value in here is an integer number of cents. Nothing is ever a
// float dollar amount, because ten years of history has to add up exactly.
// ---------------------------------------------------------------------------

import {
  db, doc, runTransaction, serverTimestamp, today, addDays, addMonths,
  fromIso, parseQty, parseRate, nextNumber, searchBlob,
} from './app.js';

// ===========================================================================
// Document types
// ===========================================================================

export const DOC_TYPES = {
  invoice: {
    type: 'invoice',
    collection: 'invoices',
    counter: 'invoice',
    titleKey: 'doc_invoice',
    numberKey: 'invoice_number',
    listPage: 'invoices.html',
    editPage: 'invoice.html',
    navKey: 'nav_invoices',
    hasDueDate: true,
    hasPayments: true,
  },
  quote: {
    type: 'quote',
    collection: 'quotes',
    counter: 'quote',
    titleKey: 'doc_quote',
    numberKey: 'quote_number',
    listPage: 'quotes.html',
    editPage: 'quote.html',
    navKey: 'nav_quotes',
    hasExpiry: true,
    hasPayments: false,
  },
  order: {
    type: 'order',
    collection: 'orders',
    counter: 'order',
    titleKey: 'doc_order',
    numberKey: 'order_number',
    listPage: 'orders.html',
    editPage: 'order.html',
    navKey: 'nav_orders',
    hasPayments: false,
  },
};

export const PAYMENT_METHODS = [
  { value: 'cash', key: 'pay_cash' },
  { value: 'check', key: 'pay_check' },
  { value: 'card', key: 'pay_card' },
  { value: 'transfer', key: 'pay_transfer' },
  { value: 'other', key: 'pay_other' },
];

export const QUOTE_STATUSES = ['open', 'accepted', 'declined', 'expired', 'converted', 'void'];
export const ORDER_STATUSES = ['open', 'fulfilled', 'invoiced', 'cancelled', 'void'];

export const STATUS_KEYS = {
  draft: 'st_draft',
  unpaid: 'st_unpaid',
  partial: 'st_partial',
  paid: 'st_paid',
  overdue: 'st_overdue',
  void: 'st_void',
  open: 'st_open',
  accepted: 'st_accepted',
  declined: 'st_declined',
  expired: 'st_expired',
  converted: 'st_converted',
  fulfilled: 'st_fulfilled',
  invoiced: 'st_invoiced',
  cancelled: 'st_cancelled',
  sent: 'st_sent',
  credit: 'st_credit',
};

// ===========================================================================
// Blank records
// ===========================================================================

export function blankLine() {
  return {
    itemId: '',
    code: '',
    description: '',
    qty: 1,
    unit: '',
    unitCents: 0,
    discountPct: 0,
    taxable: true,
    amountCents: 0,
  };
}

export function blankDoc(type, settings) {
  const cfg = DOC_TYPES[type];
  const d = today();
  return {
    type,
    number: '',
    date: d,
    dueDate: cfg.hasDueDate ? addDays(d, Number(settings.defaultDueDays) || 0) : '',
    expiryDate: cfg.hasExpiry ? addDays(d, Number(settings.quoteValidDays) || 30) : '',
    customerId: '',
    customerName: '',
    billTo: '',
    shipTo: '',
    poNumber: '',
    salesPerson: '',
    terms: settings.defaultTerms || '',
    lines: [blankLine()],
    discountPct: 0,
    discountCents: 0,
    shippingCents: 0,
    shippingTaxable: false,
    taxExempt: false,
    notes: settings.defaultNotes || '',
    privateNotes: '',
    footerMessage: settings.footerMessage || '',
    currencyCode: settings.currencyCode || 'USD',
    // computed
    subtotalCents: 0,
    taxableCents: 0,
    tax1Cents: 0,
    tax2Cents: 0,
    taxCents: 0,
    totalCents: 0,
    paidCents: 0,
    balanceCents: 0,
    // state
    status: type === 'invoice' ? 'draft' : 'open',
    paymentStatus: 'draft',
    voided: false,
    convertedToId: '',
    convertedToType: '',
    convertedFromId: '',
    convertedFromType: '',
    convertedFromNumber: '',
  };
}

export function blankCustomer() {
  return {
    name: '',
    company: '',
    account: '',
    contact: '',
    address: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    phone: '',
    mobile: '',
    email: '',
    notes: '',
    terms: '',
    discountPct: 0,
    taxExempt: false,
    creditLimitCents: 0,
    active: true,
  };
}

export function blankItem() {
  return {
    code: '',
    description: '',
    priceCents: 0,
    costCents: 0,
    unit: '',
    category: '',
    taxable: true,
    qtyInStock: 0,
    trackStock: false,
    active: true,
    notes: '',
  };
}

export function blankPayment() {
  return {
    number: '',
    date: today(),
    customerId: '',
    customerName: '',
    method: 'cash',
    reference: '',
    notes: '',
    amountCents: 0,
    allocations: [],
    appliedCents: 0,
    unappliedCents: 0,
  };
}

// ===========================================================================
// Totals
// ===========================================================================

export function recalcLine(line) {
  const qty = parseQty(line.qty);
  const unit = Math.round(Number(line.unitCents) || 0);
  const gross = Math.round(qty * unit);
  const pct = Math.min(100, Math.max(0, parseRate(line.discountPct)));
  const disc = pct ? Math.round(gross * pct / 100) : 0;
  line.qty = qty;
  line.unitCents = unit;
  line.discountPct = pct;
  line.amountCents = gross - disc;
  return line.amountCents;
}

/**
 * Recomputes every derived money field on a document, in place.
 * Returns the same document for convenience.
 */
export function recalc(document_, settings) {
  const d = document_;
  const s = settings || {};

  // Fill in any missing keys *in place*. The editor's row handlers close over
  // these exact objects, so replacing them with copies here would quietly
  // orphan every input on the screen and freeze the line totals at zero.
  d.lines = d.lines || [];
  const lineDefaults = blankLine();
  for (const line of d.lines) {
    for (const key of Object.keys(lineDefaults)) {
      if (line[key] === undefined) line[key] = lineDefaults[key];
    }
    recalcLine(line);
  }

  const subtotal = d.lines.reduce((sum, l) => sum + l.amountCents, 0);
  d.subtotalCents = subtotal;

  // Document-level discount: a percentage wins if one is set, otherwise the
  // flat amount the owner typed stands as-is.
  //
  // Note that discountCents is both an input here and an output — a percentage
  // is resolved into it. So whoever clears a percentage has to clear the amount
  // with it, or the figure this last computed comes straight back as if it had
  // been typed by hand. The editor does exactly that; imports set one or the
  // other and never both.
  // Clamped: a discount below zero is a surcharge and a discount above the
  // whole invoice is nonsense. Either would have quietly raised a total.
  const docPct = Math.min(100, Math.max(0, parseRate(d.discountPct)));
  d.discountPct = docPct;
  const discount = docPct
    ? Math.round(subtotal * docPct / 100)
    : Math.max(0, Math.round(Number(d.discountCents) || 0));
  d.discountCents = discount;

  const net = subtotal - discount;
  const shipping = Math.round(Number(d.shippingCents) || 0);
  d.shippingCents = shipping;

  // Taxable base: taxable lines, less their proportional share of the
  // document discount, plus shipping when shipping is taxable.
  const taxableGross = d.lines.reduce((sum, l) => sum + (l.taxable ? l.amountCents : 0), 0);
  let taxableBase = subtotal > 0
    ? taxableGross - Math.round(discount * taxableGross / subtotal)
    : 0;
  if (d.shippingTaxable) taxableBase += shipping;
  taxableBase = Math.max(0, taxableBase);

  const exempt = !!d.taxExempt;
  const rate1 = exempt ? 0 : parseRate(s.tax1Rate);
  const rate2 = exempt ? 0 : parseRate(s.tax2Rate);

  let tax1 = 0;
  let tax2 = 0;

  if (s.taxInclusive) {
    // Prices already carry the tax; back it out of the taxable base.
    // Compounding is not modelled here — an inclusive price is a single
    // all-in number, and treating it otherwise would only invent precision.
    const combined = rate1 + rate2;
    const taxTotal = combined > 0
      ? Math.round(taxableBase * combined / (100 + combined))
      : 0;
    tax1 = combined > 0 ? Math.round(taxTotal * rate1 / combined) : 0;
    tax2 = taxTotal - tax1;
    d.taxableCents = taxableBase - taxTotal;
    d.tax1Cents = tax1;
    d.tax2Cents = tax2;
    d.taxCents = taxTotal;
    d.totalCents = net + shipping;
  } else {
    tax1 = Math.round(taxableBase * rate1 / 100);
    const base2 = s.tax2Compound ? taxableBase + tax1 : taxableBase;
    tax2 = Math.round(base2 * rate2 / 100);
    d.taxableCents = taxableBase;
    d.tax1Cents = tax1;
    d.tax2Cents = tax2;
    d.taxCents = tax1 + tax2;
    d.totalCents = net + shipping + tax1 + tax2;
  }

  if (d.voided) {
    d.totalCents = 0;
    d.taxCents = 0;
    d.tax1Cents = 0;
    d.tax2Cents = 0;
  }

  d.paidCents = Math.round(Number(d.paidCents) || 0);
  // A voided document owes nothing, including when it had already been paid.
  // Left as total - paid it showed a negative balance, which then counted
  // against the receivables total at the foot of the list. What the customer is
  // owed for a voided invoice belongs on their statement, where the payment
  // still stands as a credit — not as a negative balance on a dead document.
  d.balanceCents = d.voided ? 0 : d.totalCents - d.paidCents;
  d.paymentStatus = derivePaymentStatus(d);
  d.searchBlob = docSearchBlob(d);
  return d;
}

/**
 * The stored status, which is deliberately free of "overdue" — overdue is a
 * function of today's date, so it is derived at display time instead of being
 * baked into a field that would go stale overnight.
 */
export function derivePaymentStatus(d) {
  if (d.voided) return 'void';
  if (d.type !== 'invoice') return d.status || 'open';
  if (d.status === 'draft') return 'draft';
  if (d.totalCents === 0) return 'paid';
  if (d.paidCents <= 0) return 'unpaid';
  if (d.paidCents >= d.totalCents) return 'paid';
  return 'partial';
}

/** Display status, including overdue. */
export function displayStatus(d, asOf = today()) {
  if (d.voided) return 'void';
  if (d.type === 'invoice') {
    const base = d.paymentStatus || derivePaymentStatus(d);
    if ((base === 'unpaid' || base === 'partial') && d.dueDate && d.dueDate < asOf) return 'overdue';
    return base;
  }
  if (d.type === 'quote') {
    if (d.status === 'open' && d.expiryDate && d.expiryDate < asOf) return 'expired';
    return d.status || 'open';
  }
  return d.status || 'open';
}

export function statusKey(status) {
  return STATUS_KEYS[status] || status;
}

function docSearchBlob(d) {
  return searchBlob(
    d.number,
    d.customerName,
    d.poNumber,
    d.salesPerson,
    d.billTo,
    d.notes,
    (d.lines || []).map((l) => `${l.code} ${l.description}`).join(' '),
  );
}

export function customerSearchBlob(c) {
  return searchBlob(c.name, c.company, c.account, c.email, c.phone, c.mobile, c.city, c.notes);
}

export function itemSearchBlob(i) {
  return searchBlob(i.code, i.description, i.category, i.notes);
}

// ===========================================================================
// Customer helpers
// ===========================================================================

export function customerLabel(c) {
  if (!c) return '';
  if (c.company && c.name) return `${c.name} — ${c.company}`;
  return c.name || c.company || c.account || '';
}

/** The multi-line "Bill To" block that gets frozen onto the document. */
export function addressBlock(c) {
  if (!c) return '';
  const lines = [];
  if (c.company && c.company !== c.name) lines.push(c.company);
  if (c.name) lines.push(c.name);
  if (c.contact && c.contact !== c.name) lines.push(c.contact);
  if (c.address) lines.push(c.address);
  if (c.address2) lines.push(c.address2);
  const cityLine = [c.city, c.state].filter(Boolean).join(', ');
  const cityZip = [cityLine, c.zip].filter(Boolean).join(' ');
  if (cityZip) lines.push(cityZip);
  if (c.country) lines.push(c.country);
  if (c.phone) lines.push(c.phone);
  if (c.mobile && c.mobile !== c.phone) lines.push(c.mobile);
  if (c.email) lines.push(c.email);
  return lines.join('\n');
}

/** Applies a customer onto a document: address snapshot, terms, tax status. */
export function attachCustomer(document_, customer, settings) {
  document_.customerId = customer?.id || '';
  document_.customerName = customerLabel(customer);
  document_.billTo = addressBlock(customer);
  if (!document_.shipTo) document_.shipTo = '';
  document_.taxExempt = !!customer?.taxExempt;
  if (customer?.terms) document_.terms = customer.terms;
  else if (!document_.terms) document_.terms = settings?.defaultTerms || '';
  if (customer?.discountPct && !document_.discountPct) {
    document_.discountPct = parseRate(customer.discountPct);
  }
  return document_;
}

// ===========================================================================
// Conversion: quote -> invoice / order, order -> invoice
// ===========================================================================

export async function convertDocument(source, targetType, settings) {
  const target = blankDoc(targetType, settings);
  const cfg = DOC_TYPES[targetType];

  Object.assign(target, {
    customerId: source.customerId,
    customerName: source.customerName,
    billTo: source.billTo,
    shipTo: source.shipTo,
    poNumber: source.poNumber,
    salesPerson: source.salesPerson,
    terms: source.terms,
    lines: (source.lines || []).map((l) => ({ ...l })),
    discountPct: source.discountPct,
    discountCents: source.discountCents,
    shippingCents: source.shippingCents,
    shippingTaxable: source.shippingTaxable,
    taxExempt: source.taxExempt,
    notes: source.notes,
    privateNotes: source.privateNotes,
    footerMessage: source.footerMessage,
    currencyCode: source.currencyCode,
    convertedFromId: source.id,
    convertedFromType: source.type,
    convertedFromNumber: source.number,
  });

  target.date = today();
  if (cfg.hasDueDate) target.dueDate = addDays(target.date, Number(settings.defaultDueDays) || 0);
  if (cfg.hasExpiry) target.expiryDate = addDays(target.date, Number(settings.quoteValidDays) || 30);
  target.number = await nextNumber(cfg.counter);
  target.status = targetType === 'invoice' ? 'sent' : 'open';
  recalc(target, settings);
  return target;
}

// ===========================================================================
// Recurring invoices
// ===========================================================================

export const FREQUENCIES = [
  { value: 'weekly', key: 'rec_weekly', days: 7 },
  { value: 'biweekly', key: 'rec_biweekly', days: 14 },
  { value: 'monthly', key: 'rec_monthly', months: 1 },
  { value: 'quarterly', key: 'rec_quarterly', months: 3 },
  { value: 'yearly', key: 'rec_yearly', months: 12 },
];

export function advanceDate(isoDate, frequency) {
  const f = FREQUENCIES.find((x) => x.value === frequency) || FREQUENCIES[2];
  return f.months ? addMonths(isoDate, f.months) : addDays(isoDate, f.days);
}

// ===========================================================================
// Payments
//
// A payment holds allocations against invoices. Saving, editing or deleting one
// has to move the invoices' paidCents by exactly the difference, and it has to
// happen atomically — otherwise a half-applied payment leaves the shop's
// receivables wrong, which is the one thing this system may never do.
// ===========================================================================

export function allocationMap(payment) {
  const map = new Map();
  for (const a of payment?.allocations || []) {
    if (!a.invoiceId) continue;
    map.set(a.invoiceId, (map.get(a.invoiceId) || 0) + Math.round(Number(a.amountCents) || 0));
  }
  return map;
}

export function paymentTotals(payment) {
  const applied = (payment.allocations || [])
    .reduce((sum, a) => sum + Math.round(Number(a.amountCents) || 0), 0);
  const amount = Math.round(Number(payment.amountCents) || 0);
  return { amountCents: amount, appliedCents: applied, unappliedCents: amount - applied };
}

/**
 * Moves invoice.paidCents by the given per-invoice deltas inside one
 * transaction, recomputing balance and status for each touched invoice.
 * `deltas` is a Map of invoiceId -> cents (may be negative).
 */
export async function applyInvoiceDeltas(deltas, settings) {
  const entries = Array.from(deltas.entries()).filter(([, cents]) => cents !== 0);
  if (!entries.length) return;

  await runTransaction(db, async (tx) => {
    const refs = entries.map(([id]) => doc(db, 'invoices', id));
    const snaps = [];
    for (const ref of refs) snaps.push(await tx.get(ref));

    snaps.forEach((snap, i) => {
      if (!snap.exists()) return; // invoice deleted out from under us; skip
      const invoice = { id: snap.id, ...snap.data() };
      invoice.paidCents = Math.round(Number(invoice.paidCents) || 0) + entries[i][1];
      if (invoice.paidCents < 0) invoice.paidCents = 0;
      // Same rule recalc applies: a voided invoice owes nothing, so editing a
      // payment that had been applied to one cannot revive a negative balance.
      invoice.balanceCents = invoice.voided
        ? 0
        : Math.round(Number(invoice.totalCents) || 0) - invoice.paidCents;
      // Promote out of draft BEFORE deriving the status, not after. A draft that
      // has been paid is no longer a draft, and derivePaymentStatus reads
      // invoice.status — doing this the other way round stamps the invoice
      // "draft" for good while marking it sent, so a paid invoice sits in the
      // list looking unissued.
      if (invoice.status === 'draft' && invoice.paidCents > 0) invoice.status = 'sent';
      invoice.paymentStatus = derivePaymentStatus(invoice);
      tx.update(refs[i], {
        paidCents: invoice.paidCents,
        balanceCents: invoice.balanceCents,
        paymentStatus: invoice.paymentStatus,
        status: invoice.status,
        updatedAt: serverTimestamp(),
      });
    });
  });
}

/** Difference between a payment's old and new allocations. */
export function allocationDeltas(previousPayment, nextPayment) {
  const before = allocationMap(previousPayment);
  const after = allocationMap(nextPayment);
  const deltas = new Map();
  for (const [id, cents] of after) deltas.set(id, cents - (before.get(id) || 0));
  for (const [id, cents] of before) {
    if (!after.has(id)) deltas.set(id, -cents);
  }
  return deltas;
}

/**
 * Spreads an amount over open invoices oldest-first, the way the desktop app's
 * "auto apply" button did.
 */
export function autoAllocate(amountCents, openInvoices) {
  let left = Math.round(Number(amountCents) || 0);
  const allocations = [];
  const sorted = [...openInvoices].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const inv of sorted) {
    if (left <= 0) break;
    const due = Math.max(0, Math.round(Number(inv.balanceCents) || 0));
    if (due <= 0) continue;
    const take = Math.min(left, due);
    allocations.push({ invoiceId: inv.id, invoiceNumber: inv.number, amountCents: take });
    left -= take;
  }
  return allocations;
}

// ===========================================================================
// Statements
// ===========================================================================

/**
 * Builds a running-balance statement for one customer over a date range:
 * invoices as charges, payments as credits, oldest first.
 */
export function buildStatement(invoices, payments, from, to) {
  const rows = [];

  for (const inv of invoices) {
    if (inv.voided) continue;
    if (inv.status === 'draft') continue;
    if (from && inv.date < from) continue;
    if (to && inv.date > to) continue;
    rows.push({
      date: inv.date,
      kind: 'invoice',
      ref: inv.number,
      description: inv.poNumber ? `PO ${inv.poNumber}` : '',
      chargeCents: inv.totalCents,
      creditCents: 0,
      id: inv.id,
    });
  }

  for (const pay of payments) {
    if (from && pay.date < from) continue;
    if (to && pay.date > to) continue;
    const applied = (pay.allocations || []).map((a) => a.invoiceNumber).filter(Boolean).join(', ');
    rows.push({
      date: pay.date,
      kind: 'payment',
      ref: pay.number,
      description: applied,
      chargeCents: 0,
      creditCents: Math.round(Number(pay.amountCents) || 0),
      id: pay.id,
      method: pay.method,
    });
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || (a.kind === b.kind ? 0 : a.kind === 'invoice' ? -1 : 1));

  let running = 0;
  for (const r of rows) {
    running += r.chargeCents - r.creditCents;
    r.balanceCents = running;
  }
  return { rows, closingBalanceCents: running };
}

/** Opening balance = everything that happened strictly before `from`. */
export function openingBalance(invoices, payments, from) {
  let balance = 0;
  for (const inv of invoices) {
    if (inv.voided || inv.status === 'draft') continue;
    if (from && inv.date >= from) continue;
    balance += Math.round(Number(inv.totalCents) || 0);
  }
  for (const pay of payments) {
    if (from && pay.date >= from) continue;
    balance -= Math.round(Number(pay.amountCents) || 0);
  }
  return balance;
}

// ===========================================================================
// Aging
// ===========================================================================

export const AGING_BUCKETS = [
  { key: 'rep_current', min: -Infinity, max: 0 },
  { key: 'rep_1_30', min: 1, max: 30 },
  { key: 'rep_31_60', min: 31, max: 60 },
  { key: 'rep_61_90', min: 61, max: 90 },
  { key: 'rep_90_plus', min: 91, max: Infinity },
];

export function agingBucket(invoice, asOf = today()) {
  const due = invoice.dueDate || invoice.date;
  const overdueDays = Math.round(
    (fromIso(asOf).getTime() - fromIso(due).getTime()) / 86400000,
  );
  return AGING_BUCKETS.findIndex((b) => overdueDays >= b.min && overdueDays <= b.max);
}

// ===========================================================================
// Stock (plain counter only — no Inventoria sync, by design)
// ===========================================================================

export function stockDeltasForDoc(document_, sign = -1) {
  const deltas = new Map();
  for (const line of document_.lines || []) {
    if (!line.itemId) continue;
    const qty = parseQty(line.qty);
    if (!qty) continue;
    deltas.set(line.itemId, (deltas.get(line.itemId) || 0) + sign * qty);
  }
  return deltas;
}

export async function applyStockDeltas(deltas) {
  const entries = Array.from(deltas.entries()).filter(([, q]) => q !== 0);
  if (!entries.length) return;
  await runTransaction(db, async (tx) => {
    const refs = entries.map(([id]) => doc(db, 'items', id));
    const snaps = [];
    for (const ref of refs) snaps.push(await tx.get(ref));
    snaps.forEach((snap, i) => {
      if (!snap.exists()) return;
      const item = snap.data();
      if (!item.trackStock) return;
      const next = (Number(item.qtyInStock) || 0) + entries[i][1];
      tx.update(refs[i], { qtyInStock: Math.round(next * 1000) / 1000, updatedAt: serverTimestamp() });
    });
  });
}
