// ---------------------------------------------------------------------------
// Express Invoice's own record format, read directly.
//
// The generic folder importer works out a shape and then asks which column is
// which. For Express Invoice's own files that question has one right answer,
// always, so asking it is only a chance to get it wrong: the keys are fixed,
// the record type is obvious from which keys are present, and a customer's
// name is always the file name. This module skips the mapping entirely and
// converts a parsed .dat straight into a finished record.
//
// MONEY IS ALREADY IN CENTS. Every amount in these files is an integer number
// of cents, which the files themselves confirm: an invoice with
// Item1UnitValue=55000 carries TaxAmountCombined1=7150 at 13%, and 7150 is
// exactly 13% of 55000. Reading 55000 as dollars is what turns a $550 phone
// into a $43,050,000,000 invoice, so nothing here multiplies by 100.
// ---------------------------------------------------------------------------

/** The record types these folders hold. Quotes and orders are out of scope. */
export const EXPRESS_TYPES = ['customers', 'items', 'invoices', 'payments'];

/**
 * Which list a file belongs to, from the keys it carries.
 *
 * Checked most-specific first: only payments carry PaymentMethod, only
 * invoices carry ItemCount, only items carry Value together with LastUsed.
 * A customer file is what is left — address, terms and balance, no amounts.
 */
export function detectRecordType(record) {
  const has = (k) => record[k] !== undefined;
  if (has('PaymentMethod') && has('Amount')) return 'payments';
  if (has('ItemCount') || has('Item1UnitValue')) return 'invoices';
  if (has('Value') && (has('LastUsed') || has('TaxRate'))) return 'items';
  if (has('FullAddress') || has('Balance') || has('LastInvoice')) return 'customers';
  return null;
}

/** The type most of a sample agrees on, so one odd file cannot decide it. */
export function detectFolderType(records) {
  const votes = {};
  for (const r of records.slice(0, 40)) {
    const t = detectRecordType(r);
    if (t) votes[t] = (votes[t] || 0) + 1;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [type, n] = ranked[0];
  return n >= Math.max(1, Math.ceil(Math.min(records.length, 40) * 0.6)) ? type : null;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * An amount, in cents, exactly as stored.
 *
 * `digits` is Express Invoice's own count of decimal places for the field
 * (Item1UnitValueDigits). It is 2 everywhere seen so far, meaning the number
 * already is cents; the shift is here so a file written with a different
 * setting still lands on the right amount instead of being out by 100.
 */
export function moneyCents(raw, digits = 2) {
  const value = Number(String(raw ?? '').trim());
  if (!Number.isFinite(value)) return 0;
  const places = Number(digits);
  const shift = Number.isFinite(places) ? 2 - places : 0;
  return Math.round(value * (10 ** shift));
}

function num(raw, fallback = 0) {
  const value = Number(String(raw ?? '').trim());
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Express Invoice writes a tax rate as "13.000000/0.000000/0" — first rate,
 * second rate, compound flag. Only whether it is charged at all matters here.
 */
function taxRateOf(raw) {
  const first = String(raw ?? '').split('/')[0];
  return num(first, 0);
}

/** An ISO date, or blank. These files already write YYYY-MM-DD. */
function dateOf(raw) {
  const s = String(raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/**
 * Payment terms as the old program shows them. It stores the code and the days
 * separately (PaymentTerms=2, PaymentTermsDays=30) and prints "Net 30".
 */
function termsOf(record) {
  const days = num(record.PaymentTermsDays, 0);
  return days > 0 ? `Net ${days}` : '';
}

// ---------------------------------------------------------------------------
// One record at a time
// ---------------------------------------------------------------------------

/**
 * A customer. The name is not in the file — the file is called
 * "Aaron%20Martinez%20Gonzalez.dat" and that is the only place it exists.
 *
 * There are no separate city / state / phone fields either. FullAddress is one
 * free-text block, often with the phone number on its own line, and it is kept
 * that way rather than split on a guess.
 */
export function toCustomer(record, name) {
  return {
    name,
    company: '',
    account: '',
    contact: '',
    address: record.FullAddress || '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    country: record.CustomerCountryCode || '',
    phone: '',
    mobile: '',
    email: '',
    terms: termsOf(record),
    discountPct: 0,
    creditLimitCents: 0,
    taxExempt: false,
    notes: '',
  };
}

/** An item. The code is the file name; Value is its price, in cents. */
export function toItem(record, code) {
  return {
    code,
    description: record.Description || '',
    priceCents: moneyCents(record.Value),
    costCents: 0,
    unit: '',
    category: '',
    taxable: num(record.TaxRate, 0) !== 0,
    qtyInStock: 0,
    trackStock: false,
    notes: '',
  };
}

/**
 * An invoice, including its lines.
 *
 * Lines are stored as numbered keys — Item1Code, Item1Qty, Item1UnitValue,
 * Item2Code and so on — with ItemCount saying how many. ItemCount is trusted
 * only as far as the keys actually go, since a file that disagrees with its own
 * count should lose the count, not the lines.
 */
export function toInvoice(record, number) {
  const date = dateOf(record.Date);
  const days = num(record.PaymentTermsDays, 0);

  const lines = [];
  const declared = num(record.ItemCount, 0);
  const cap = Math.max(declared, 0) || 0;
  for (let i = 1; i <= Math.max(cap, 200); i += 1) {
    const code = record[`Item${i}Code`];
    const description = record[`Item${i}Description`];
    const unit = record[`Item${i}UnitValue`];
    if (code === undefined && description === undefined && unit === undefined) {
      if (i > cap) break;
      continue;
    }
    const qty = num(record[`Item${i}Qty`], 1);
    const unitCents = moneyCents(unit, record[`Item${i}UnitValueDigits`] ?? 2);
    const discountPct = num(record[`Item${i}Discount`], 0);
    const gross = qty * unitCents;
    lines.push({
      itemId: '',
      code: code || '',
      description: description || '',
      qty,
      unit: '',
      unitCents,
      discountPct,
      taxable: taxRateOf(record[`Item${i}TaxRate`]) > 0,
      amountCents: Math.round(gross - (gross * discountPct) / 100),
    });
  }

  // Tax as charged at the time. TaxAmountCount says how many of the
  // TaxAmount1..N entries are real; the rest are left over from earlier edits
  // and must not be added in.
  let taxCents = 0;
  const taxCount = num(record.TaxAmountCount, 0);
  for (let i = 1; i <= taxCount; i += 1) taxCents += moneyCents(record[`TaxAmount${i}`]);

  const shippingCents = moneyCents(record.ShippingCosts);
  const totalCents = moneyCents(record.Total);
  const paidCents = moneyCents(record.AmountPaid);
  const refundedCents = moneyCents(record.AmountRefunded);
  const lineSum = lines.reduce((s, l) => s + l.amountCents, 0);

  return {
    number,
    date,
    dueDate: date && days > 0 ? addDaysIso(date, days) : date,
    customerName: record.Customer || '',
    billTo: record.Address || '',
    shipTo: record.ShippingAddress || '',
    poNumber: record.CustomerPO || '',
    salesPerson: record.SalesPerson || '',
    terms: termsOf(record),
    notes: record.Notes || '',
    privateNotes: record.NotesIternal || record.NotesInternal || '',
    lines,
    // Totals exactly as the old program had them. A ten-year-old invoice has
    // to keep printing the figure the customer was actually charged, whatever
    // the tax rate happened to be that year.
    subtotalCents: lineSum,
    discountCents: 0,
    discountPct: 0,
    shippingCents,
    tax1Cents: taxCents,
    tax2Cents: 0,
    taxCents,
    taxableCents: lines.reduce((s, l) => s + (l.taxable ? l.amountCents : 0), 0),
    totalCents,
    paidCents: Math.max(0, paidCents - refundedCents),
    balanceCents: totalCents - Math.max(0, paidCents - refundedCents),
    status: num(record.IsDraft, 0) ? 'draft' : 'sent',
  };
}

/**
 * A payment, with what it was applied to.
 *
 * InvoiceNumber and InvoiceAmounts are parallel lists when one payment covers
 * several invoices, and the amounts arrive quoted: InvoiceAmounts="20000".
 */
export function toPayment(record, number) {
  const numbers = String(record.InvoiceNumber ?? '')
    .split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const amounts = String(record.InvoiceAmounts ?? '')
    .split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => s !== '');

  const amountCents = moneyCents(record.Amount);
  const allocations = numbers.map((n, i) => ({
    invoiceId: '',
    invoiceNumber: n,
    amountCents: amounts[i] !== undefined ? moneyCents(amounts[i]) : 0,
  }));
  // One invoice and no amount given means the whole payment went to it.
  if (allocations.length === 1 && !allocations[0].amountCents) {
    allocations[0].amountCents = amountCents;
  }

  return {
    number,
    date: dateOf(record.Date),
    customerName: record.Customer || '',
    method: methodOf(record.PaymentMethod),
    reference: record.PayRefNumber || '',
    notes: '',
    amountCents,
    isRefund: num(record.IsRefund, 0) !== 0,
    allocations,
  };
}

function methodOf(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('cash')) return 'cash';
  if (v.includes('check') || v.includes('cheque')) return 'check';
  if (v.includes('card') || v.includes('credit') || v.includes('debit') || v.includes('visa')
      || v.includes('master') || v.includes('interac')) return 'card';
  if (v.includes('transfer') || v.includes('wire') || v.includes('ach')
      || v.includes('deposit') || v.includes('e-transfer') || v.includes('etransfer')) return 'transfer';
  return 'other';
}

/** Date arithmetic on the string, so no timezone can move a due date. */
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * A whole folder, converted. `rows` are the parsed key/value records and their
 * file names, exactly as the folder reader produced them.
 */
export function convertFolder(records, type) {
  const out = [];
  const problems = [];
  records.forEach(({ record, name }, i) => {
    try {
      if (type === 'customers') {
        if (!name) { problems.push(`File ${i + 1}: no name on the file, so no customer name`); return; }
        out.push(toCustomer(record, name));
      } else if (type === 'items') {
        if (!name) { problems.push(`File ${i + 1}: no code on the file`); return; }
        out.push(toItem(record, name));
      } else if (type === 'invoices') {
        const invoice = toInvoice(record, name);
        if (!invoice.customerName) problems.push(`Invoice ${name || i + 1}: no customer named in the file`);
        out.push(invoice);
      } else if (type === 'payments') {
        const payment = toPayment(record, name);
        if (!payment.amountCents) { problems.push(`Payment ${name || i + 1}: no amount`); return; }
        out.push(payment);
      }
    } catch (err) {
      problems.push(`File ${name || i + 1}: ${err.message}`);
    }
  });
  return { records: out, problems };
}
