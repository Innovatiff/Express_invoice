// ---------------------------------------------------------------------------
// Import from Express Invoice.
//
// This is the screen the whole migration rests on: thousands of invoices,
// quotes and payments have to land here without a single total shifting.
//
// The rule that governs everything below: if the export carries its own totals,
// those totals win. Recomputing a 2017 invoice against today's tax rate would
// silently rewrite history, so imported subtotals, tax and totals are stored
// verbatim and only the missing pieces are derived.
// ---------------------------------------------------------------------------

import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, money, parseMoney,
  parseQty, parseRate, parseDate, today, addDays, loadAll, peekCounter,
  setCounter, numericPart, parseCSV, sniffDelimiter, toast, confirmDialog,
  downloadFile, db, doc, writeBatch, collection, serverTimestamp,
} from '../app.js';
import {
  blankCustomer, blankItem, blankDoc, blankPayment, customerSearchBlob,
  itemSearchBlob, derivePaymentStatus,
} from '../model.js';
import {
  field, card, selectEl,
} from '../components.js';
import {
  invalidate as invalidateStore,
} from '../store.js';
import {
  readFolder, MAX_FILES,
} from '../folder-import.js';

setPageTitle('nav_import');
const { settings } = await initShell('import.html');

const page = $('#page');
page.append(pageHeader('imp_title', []));

// ===========================================================================
// Field definitions per target.
//
// The third entry in each row is the list of CSV header names that map onto
// that field. Spanish spellings are kept in those lists on purpose: they are
// not UI text, they are tolerance for whatever a ten-year-old export happens to
// contain. Every guess is shown for review before anything is written, so a bad
// match costs a click rather than a bad import — and a header this list does not
// recognise just needs mapping by hand.
// ===========================================================================

const TARGETS = {
  customers: {
    labelKey: 'nav_customers',
    collection: 'customers',
    keyField: 'name',
    fields: [
      ['name', 'cust_name', ['name', 'customer', 'customer name', 'nombre', 'cliente', 'full name']],
      ['company', 'cust_company', ['company', 'business', 'empresa', 'compania', 'compañía']],
      ['account', 'cust_account', ['account', 'account number', 'customer id', 'cuenta', 'codigo', 'código']],
      ['contact', 'cust_contact', ['contact', 'contact name', 'contacto', 'attention']],
      // "fulladdress" and friends are Express Invoice's own key names, which
      // arrive unspaced from its .dat files: FullAddress, CustomerCountryCode.
      ['address', 'cust_address', ['address', 'address 1', 'street', 'direccion', 'dirección', 'fulladdress']],
      ['address2', 'cust_address2', ['address 2', 'address2', 'direccion 2']],
      ['city', 'cust_city', ['city', 'ciudad']],
      ['state', 'cust_state', ['state', 'province', 'estado', 'provincia']],
      ['zip', 'cust_zip', ['zip', 'postal', 'postcode', 'zip code', 'codigo postal', 'código postal']],
      ['country', 'cust_country', ['country', 'pais', 'país', 'customercountrycode', 'countrycode']],
      ['phone', 'cust_phone', ['phone', 'telephone', 'tel', 'telefono', 'teléfono']],
      ['mobile', 'cust_mobile', ['mobile', 'cell', 'cellphone', 'celular', 'movil', 'móvil']],
      ['email', 'cust_email', ['email', 'e-mail', 'correo']],
      ['terms', 'terms', ['terms', 'payment terms', 'terminos', 'términos', 'paymenttermsdays', 'paymentterms']],
      ['discountPct', 'cust_discount', ['discount', 'discount %', 'descuento']],
      ['creditLimitCents', 'cust_credit_limit', ['credit limit', 'limite de credito', 'límite de crédito']],
      ['taxExempt', 'cust_tax_exempt', ['tax exempt', 'exempt', 'exento']],
      ['notes', 'notes', ['notes', 'comment', 'comments', 'notas', 'comentarios']],
    ],
  },

  items: {
    labelKey: 'nav_items',
    collection: 'items',
    keyField: 'code',
    fields: [
      ['code', 'item_code', ['code', 'item', 'item code', 'sku', 'product code', 'codigo', 'código', 'articulo', 'artículo']],
      ['description', 'item_description', ['description', 'name', 'item name', 'descripcion', 'descripción']],
      ['priceCents', 'item_price', ['price', 'unit price', 'sale price', 'precio', 'precio de venta']],
      ['costCents', 'item_cost', ['cost', 'unit cost', 'costo']],
      ['unit', 'item_unit', ['unit', 'uom', 'unidad']],
      ['category', 'item_category', ['category', 'group', 'type', 'categoria', 'categoría']],
      ['taxable', 'item_taxable', ['taxable', 'gravable', 'is taxable', 'taxed']],
      ['qtyInStock', 'item_qty_stock', ['quantity', 'qty', 'stock', 'quantity in stock', 'existencia', 'cantidad']],
      ['notes', 'notes', ['notes', 'notas']],
    ],
  },

  invoices: {
    labelKey: 'nav_invoices',
    collection: 'invoices',
    docType: 'invoice',
    grouped: true,
    keyField: 'number',
    fields: documentFields('invoice_number', ['invoice', 'invoice number', 'invoice #', 'factura', 'numero de factura', 'número de factura', 'no. factura']),
  },

  quotes: {
    labelKey: 'nav_quotes',
    collection: 'quotes',
    docType: 'quote',
    grouped: true,
    keyField: 'number',
    fields: documentFields('quote_number', ['quote', 'quote number', 'quote #', 'cotizacion', 'cotización', 'presupuesto']),
  },

  orders: {
    labelKey: 'nav_orders',
    collection: 'orders',
    docType: 'order',
    grouped: true,
    keyField: 'number',
    fields: documentFields('order_number', ['order', 'order number', 'sales order', 'pedido', 'orden']),
  },

  payments: {
    labelKey: 'nav_payments',
    collection: 'payments',
    keyField: 'number',
    fields: [
      ['number', 'payment_number', ['payment', 'payment number', 'receipt', 'recibo', 'pago', 'numero de pago']],
      ['date', 'date', ['date', 'payment date', 'fecha']],
      ['customerName', 'customer', ['customer', 'customer name', 'client', 'cliente', 'nombre']],
      ['customerAccount', 'cust_account', ['account', 'customer id', 'cuenta']],
      ['method', 'pay_method', ['method', 'payment method', 'type', 'forma de pago', 'metodo', 'método']],
      ['reference', 'reference', ['reference', 'check number', 'ref', 'referencia', 'cheque']],
      ['amountCents', 'amount', ['amount', 'payment amount', 'total', 'monto', 'importe']],
      ['invoiceNumber', 'invoice_number', ['invoice', 'invoice number', 'applied to', 'factura']],
      ['notes', 'notes', ['notes', 'memo', 'notas']],
    ],
  },
};

function documentFields(numberKey, numberSynonyms) {
  return [
    ['number', numberKey, numberSynonyms],
    ['date', 'date', ['date', 'invoice date', 'issue date', 'fecha']],
    ['dueDate', 'due_date', ['due date', 'due', 'fecha de vencimiento', 'vencimiento']],
    ['customerName', 'customer', ['customer', 'customer name', 'client', 'bill to', 'cliente', 'nombre']],
    ['customerAccount', 'cust_account', ['account', 'customer id', 'customer account', 'cuenta']],
    ['billTo', 'bill_to', ['bill to address', 'billing address', 'address', 'direccion', 'dirección']],
    ['shipTo', 'ship_to', ['ship to', 'shipping address', 'enviar a']],
    ['poNumber', 'po_number', ['po', 'po number', 'purchase order', 'orden de compra']],
    ['salesPerson', 'sales_person', ['sales person', 'salesperson', 'rep', 'vendedor']],
    ['terms', 'terms', ['terms', 'payment terms', 'terminos', 'términos']],
    ['status', 'status', ['status', 'estado']],
    // Line-level
    ['line_code', 'line_code', ['item', 'item code', 'code', 'sku', 'producto', 'codigo', 'código']],
    ['line_description', 'line_description', ['description', 'item description', 'detail', 'descripcion', 'descripción']],
    ['line_qty', 'line_qty', ['quantity', 'qty', 'cantidad', 'cant']],
    ['line_unitPrice', 'line_price', ['unit price', 'price', 'rate', 'precio']],
    ['line_discountPct', 'line_discount', ['line discount', 'discount %', 'descuento linea']],
    // Deliberately not a bare "tax": on an invoice export that column is the
    // tax *amount*, and letting the per-line flag claim it would throw away
    // every historical tax figure in the file.
    ['line_taxable', 'line_taxable', ['taxable', 'gravable', 'is taxable', 'taxed']],
    ['line_amount', 'line_amount', ['amount', 'line total', 'extended', 'importe', 'total linea', 'total línea']],
    // Document totals — preserved verbatim when present
    ['subtotalCents', 'subtotal', ['subtotal', 'sub total', 'sub-total']],
    ['discountCents', 'discount', ['discount', 'discount amount', 'descuento']],
    ['shippingCents', 'shipping', ['shipping', 'freight', 'envio', 'envío']],
    ['taxCents', 'tax', ['tax', 'tax amount', 'sales tax', 'impuesto', 'itbis', 'iva']],
    ['totalCents', 'total', ['total', 'invoice total', 'grand total', 'total general']],
    ['paidCents', 'amount_paid', ['paid', 'amount paid', 'payments', 'pagado', 'monto pagado']],
    ['notes', 'notes', ['notes', 'comments', 'memo', 'notas', 'comentarios']],
    ['privateNotes', 'private_notes', ['private notes', 'internal notes', 'notas privadas']],
  ];
}

// ===========================================================================
// Wizard state
// ===========================================================================

const state = {
  step: 1,
  target: 'customers',
  fileName: '',
  headers: [],
  rows: [],
  mapping: {},          // fieldName -> column index (or -1)
  dayFirst: false,
  createMissingCustomers: true,
  duplicateMode: 'skip', // skip | update | create
};

const stepsHost = el('div', { class: 'steps' });
const bodyHost = el('div', {});
page.append(stepsHost, bodyHost);

renderSteps();
renderStep();

function renderSteps() {
  const labels = [
    ['imp_what', 1],
    ['imp_file', 2],
    ['imp_map', 3],
    ['imp_preview', 4],
  ];
  stepsHost.innerHTML = '';
  for (const [key, n] of labels) {
    stepsHost.append(el('div', {
      class: 'step' + (state.step === n ? ' is-active' : state.step > n ? ' is-done' : ''),
    },
      el('span', { class: 'step-num', text: String(n) }),
      el('span', { html: L(key) }),
    ));
  }
}

function renderStep() {
  renderSteps();
  bodyHost.innerHTML = '';
  if (state.step === 1) return renderChooseTarget();
  if (state.step === 2) return renderChooseFile();
  if (state.step === 3) return renderMapping();
  if (state.step === 4) return renderPreview();
}

// ---- Step 1 ---------------------------------------------------------------

function renderChooseTarget() {
  const list = el('div', { class: 'grid grid-3', style: 'gap:12px' });
  for (const [key, cfg] of Object.entries(TARGETS)) {
    list.append(el('button', {
      class: 'btn btn-default', type: 'button',
      style: 'min-height:64px;justify-content:flex-start;text-align:left',
      html: L(cfg.labelKey),
      onclick: () => { state.target = key; state.step = 2; renderStep(); },
    }));
  }

  bodyHost.append(card('imp_what', el('div', {},
    el('p', { class: 'text-small text-muted mb-2', html:
      'Import in this order: customers, items, invoices, payments — that way invoices find their customers.' }),
    list,
  )));

  bodyHost.append(el('p', { class: 'text-small text-muted', html:
    `${T('imp_group_hint')}` }));
}

// ---- Step 2 ---------------------------------------------------------------

function renderChooseFile() {
  // Deliberately unfiltered. Express Invoice keeps its live data in .dat files,
  // and a picker that only offered .csv would hide exactly the files the owner
  // is holding.
  // Both pickers are <input type=file>, so each carries an id: anything selecting
  // one of them has to say which.
  const fileInput = el('input', { type: 'file', id: 'pick-file',
    accept: '.csv,.txt,.dat,.tsv,.tab,text/csv,text/plain' });
  const status = el('p', { class: 'text-small text-muted' });
  const diagnosis = el('div', {});

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = T('loading');
    diagnosis.innerHTML = '';

    try {
      const buffer = await readFileBuffer(file);
      const info = sniffFormat(buffer);

      if (!info.delimited) {
        status.textContent = '';
        renderUnreadable(diagnosis, file, info, buffer);
        return;
      }

      const text = decodeBuffer(buffer, info.encoding);
      const delimiter = sniffDelimiter(text);
      const rows = parseCSV(text, delimiter);
      if (!rows.length) throw new Error('The file has no rows in it.');

      state.fileName = file.name;
      state.headers = rows[0].map((h) => String(h).trim());
      state.rows = rows.slice(1);
      autoMap();
      state.step = 3;
      renderStep();
    } catch (err) {
      console.error(err);
      status.innerHTML = esc(err.message || 'Could not read the file.');
    }
  });

  // ---- The folder route: one .dat per record, thousands of them ----
  const folderInput = el('input', { type: 'file', id: 'pick-folder' });
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');

  const folderProgress = el('div', { class: 'progress hidden' }, el('div', { style: 'width:0%' }));
  const folderStatus = el('p', { class: 'text-small text-muted' });

  folderInput.addEventListener('change', async () => {
    const files = folderInput.files;
    if (!files || !files.length) return;

    diagnosis.innerHTML = '';
    folderProgress.classList.remove('hidden');
    const bar = folderProgress.firstChild;

    try {
      const result = await readFolder(files, {
        onProgress: ({ read, total, phase }) => {
          bar.style.width = `${total ? Math.round((read / total) * 100) : 0}%`;
          folderStatus.textContent = phase === 'sampling'
            ? `Looking at what is in these ${total} files…`
            : `Reading ${read} of ${total}…`;
        },
      });

      folderProgress.classList.add('hidden');

      if (!result.rows.length) {
        folderStatus.textContent = '';
        renderFolderProblem(diagnosis, result);
        return;
      }

      state.fileName = `${files[0].webkitRelativePath?.split('/')[0] || 'folder'} (${result.stats.parsed} files)`;
      state.headers = result.headers;
      state.rows = result.rows;
      autoMap();
      state.step = 3;
      renderStep();
    } catch (err) {
      console.error(err);
      folderProgress.classList.add('hidden');
      folderStatus.innerHTML = esc(err.message || 'Could not read the folder.');
    }
  });

  bodyHost.append(card('imp_file', el('div', {},
    el('p', { class: 'text-small text-muted mb-2', html:
      `${T('imp_what')}: <strong>${L(TARGETS[state.target].labelKey)}</strong>` }),

    el('div', { class: 'pick' },
      el('div', { class: 'pick-half' },
        el('div', { class: 'pick-title', text: 'One file' }),
        el('p', { class: 'text-small text-muted', text:
          'A CSV exported from Express Invoice, holding every record as a row.' }),
        fileInput,
        status,
      ),
      el('div', { class: 'pick-half' },
        el('div', { class: 'pick-title', text: 'A whole folder' }),
        el('p', { class: 'text-small text-muted', text:
          'Express Invoice\u2019s own folders, holding one .dat file per record. '
          + 'Pick the folder and every file inside is read.' }),
        folderInput,
        folderProgress,
        folderStatus,
      ),
    ),

    el('div', { class: 'mt-2' },
      el('button', { class: 'btn btn-default', type: 'button', html: L('act_back'),
        onclick: () => { state.step = 1; renderStep(); } }),
    ),
  )));

  bodyHost.append(diagnosis);

  bodyHost.append(card(null, el('div', {},
    el('p', { html: '<strong>Getting your data out of Express Invoice</strong>' }),
    el('p', { class: 'text-small text-muted', style: 'margin-top:6px', html:
      'The <code>.dat</code> files in the Express Invoice program folder are its own '
      + 'internal storage, not an export. If the old program still runs, exporting from '
      + 'inside it is by far the shorter road:' }),
    el('ol', { style: 'margin:6px 0 0;padding-left:20px;line-height:1.9' },
      el('li', { html: 'Open the list you want — Invoices, Customers, Items.' }),
      el('li', { html: 'Choose <em>File → Export</em>, and pick CSV.' }),
      el('li', { html: '<strong>For invoices, include the detail lines</strong>, or every invoice arrives as one lump.' }),
      el('li', { html: 'Save the file, then load it here.' }),
    ),
    el('p', { class: 'text-small text-muted mt-1', html:
      'If the old program is gone and all you have are the <code>.dat</code> files, load one '
      + 'anyway — this screen will identify what is inside it and tell you what to do next.' }),
  )));
}

// ---------------------------------------------------------------------------
// Reading whatever the owner actually has
//
// A .dat file is a name, not a format. Depending on the version it may be a
// SQLite database, delimited text under an unfamiliar extension, or something
// proprietary. So the bytes are sniffed and named: a file this screen cannot
// use produces an explanation and a way forward, rather than "Could not read
// the file", which tells the owner nothing they can act on.
// ---------------------------------------------------------------------------

function readFileBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
}

const MAGIC = [
  ['SQLite format 3', 'sqlite', 'a SQLite database'],
  ['PK\u0003\u0004', 'zip', 'a Zip archive'],
  ['%PDF', 'pdf', 'a PDF document'],
  ['{\\rtf', 'rtf', 'an RTF document'],
  ['\u00d0\u00cf\u0011\u00e0', 'ole', 'an old Microsoft Office file'],
];

/**
 * Returns { id, label, decodable, delimited, encoding }.
 * `delimited` is the only flag the wizard acts on; the rest is for explaining.
 */
function sniffFormat(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) return { id: 'empty', label: 'an empty file', decodable: false, delimited: false };

  const head = Array.from(bytes.slice(0, 16)).map((b) => String.fromCharCode(b)).join('');
  for (const [magic, id, label] of MAGIC) {
    if (head.startsWith(magic)) return { id, label, decodable: false, delimited: false };
  }

  // A byte-order mark settles the encoding outright, and UTF-16 is common in
  // files written by older Windows software.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { id: 'text', label: 'text (UTF-16)', decodable: true, delimited: true, encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { id: 'text', label: 'text (UTF-16)', decodable: true, delimited: true, encoding: 'utf-16be' };
  }

  const start = head.replace(/^\ufeff/, '').trimStart();
  if (start.startsWith('<?xml')) {
    return { id: 'xml', label: 'XML', decodable: true, delimited: false, encoding: 'utf-8' };
  }
  if (start.startsWith('{') || start.startsWith('[')) {
    return { id: 'json', label: 'JSON', decodable: true, delimited: false, encoding: 'utf-8' };
  }

  // Otherwise judge by how much of it is unprintable. A NUL byte weighs heavily
  // because text files essentially never contain one.
  const sample = bytes.slice(0, 65536);
  let odd = 0;
  for (const b of sample) {
    if (b === 0) odd += 8;
    else if (b < 32 && b !== 9 && b !== 10 && b !== 13) odd += 1;
  }
  if (odd / sample.length > 0.02) {
    return { id: 'binary', label: 'a binary file', decodable: false, delimited: false };
  }
  return { id: 'text', label: 'plain text', decodable: true, delimited: true, encoding: 'utf-8' };
}

function decodeBuffer(buffer, encoding = 'utf-8') {
  let text = new TextDecoder(encoding).decode(buffer);
  // Ten-year-old Windows exports are frequently Windows-1252 rather than UTF-8.
  if (encoding === 'utf-8' && text.includes('\ufffd')) {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  return text.replace(/^\ufeff/, '');
}

/** The opening bytes, as something the owner can copy into a message. */
function fingerprint(buffer, info) {
  if (info.decodable) return decodeBuffer(buffer, info.encoding).slice(0, 700);
  const bytes = new Uint8Array(buffer.slice(0, 128));
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = Array.from(bytes.slice(i, i + 16));
    const hex = chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const chars = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${String(i).padStart(4, '0')}  ${hex}  ${chars}`);
  }
  return lines.join('\n');
}

const NEXT_STEPS = {
  sqlite: [
    'Good news — a SQLite database is completely readable, and you do not need me to unpick it.',
    'Install <strong>DB Browser for SQLite</strong> (free, sqlitebrowser.org), open this file with it, '
    + 'and use <em>File → Export → Table(s) as CSV</em>. Export the customers, items, invoices and '
    + 'payments tables, then load those CSVs here.',
  ],
  zip: [
    'This is a Zip archive. Rename it to end in <code>.zip</code>, open it, and look inside.',
    'If there are CSV files in there, load those instead.',
  ],
  xml: [
    'This is XML — readable, but this screen expects rows and columns.',
    'Send me the opening lines below and I will add a reader for this layout.',
  ],
  json: [
    'This is JSON — readable, but this screen expects rows and columns.',
    'Send me the opening lines below and I will add a reader for this layout.',
  ],
  pdf: ['That is a printed document rather than a data file. You want the data file it was printed from.'],
  rtf: ['That is a word-processor document rather than a data file.'],
  ole: ['That is an old Microsoft Office file. If it is a spreadsheet, open it and save as CSV.'],
  empty: ['The file is empty — nothing was written to it.'],
  binary: [
    'This is Express Invoice\u2019s own storage format, which is not documented publicly.',
    '<strong>If the old program still runs</strong>, the short road is to export CSVs from inside it '
    + '(<em>File → Export</em>). That takes minutes and is exactly what this screen is built for.',
    '<strong>If it does not</strong>, copy the fingerprint below and send it to me. Those opening bytes '
    + 'are usually enough to identify the format, and I can build a converter for it.',
  ],
};

/**
 * A folder whose files this screen cannot turn into records. With thousands of
 * samples of the same record type there is far more to say than about a single
 * file, so the profile is the deliverable: what every file opens with, whether
 * the record size is fixed, and where the data actually sits.
 */
function renderFolderProblem(host, result) {
  const { kind, stats, profile } = result;

  const explain = {
    empty: ['That folder has no readable files in it. Check you picked the folder itself rather than the one above it.'],
    unknown: [
      'The files are readable text, but not in a layout this screen recognises — '
      + 'not key/value lines, not delimited rows, not one value per line, not XML or JSON.',
      '<strong>First, check the folder.</strong> Pick a folder that holds one kind of '
      + 'record — Customers, or Invoices — rather than the Express Invoice program folder '
      + 'itself. A folder with several kinds of file mixed together has no single layout '
      + 'to find, and the file types listed in the profile below will show if that is what '
      + 'happened.',
      'Otherwise the profile below has the answer in it: the opening lines of three real '
      + 'files, exactly as they are stored. <strong>Send it to me and I will add a reader '
      + 'for that layout.</strong> Nothing is guessed at from a format nobody has read.',
    ],
    binary: [
      'These are Express Invoice\u2019s own record files, in a format that is not documented publicly.',
      '<strong>If the old program still runs</strong>, exporting CSVs from inside it '
      + '(<em>File → Export</em>) is much the shorter road, and this screen reads those directly.',
      '<strong>If it does not</strong>, download the profile below and send it to me. A folder of '
      + 'this many files is far more revealing than any single one: it shows what every record '
      + 'opens with, whether the size is fixed, and which positions hold the data. That is usually '
      + 'enough to write a converter.',
    ],
  }[kind] || ['These files could not be read as records.'];

  const body = el('div', {},
    el('p', { html: `<strong>${stats.total}</strong> files in that folder`
      + (stats.sampled ? `, ${stats.sampled} of them examined.` : '.') }),
    ...explain.map((line) => el('p', { class: 'mt-1', html: line })),
  );

  if (profile) {
    body.append(
      el('p', { class: 'field-label mt-2', text: 'Folder profile' }),
      el('div', { class: 'log-box', style: 'white-space:pre; font-size:11.5px', text: profile.text }),
      el('div', { class: 'form-row mt-1' },
        el('button', {
          class: 'btn btn-primary btn-sm', type: 'button', text: 'Download profile',
          onclick: () => downloadFile(`folder-profile-${state.target}-${today()}.txt`, profile.text, 'text/plain'),
        }),
        el('button', {
          class: 'btn btn-default btn-sm', type: 'button', text: 'Copy profile',
          onclick: async (e) => {
            try {
              await navigator.clipboard.writeText(profile.text);
              e.currentTarget.textContent = 'Copied';
            } catch {
              e.currentTarget.textContent = 'Select it by hand — the clipboard is blocked';
            }
          },
        }),
      ),
    );
  }

  host.innerHTML = '';
  host.append(card(null, body));
}

function renderUnreadable(host, file, info, buffer) {
  const steps = NEXT_STEPS[info.id] || NEXT_STEPS.binary;
  const print = fingerprint(buffer, info);

  const body = el('div', {},
    el('p', { html:
      `<strong>${esc(file.name)}</strong> is ${esc(info.label)}, `
      + `${(file.size / 1024).toFixed(0)} KB. This screen reads rows and columns, so it cannot use it as it stands.` }),
    ...steps.map((line) => el('p', { class: 'mt-1', html: line })),
    el('p', { class: 'field-label mt-2', text: 'First bytes of the file' }),
    el('div', { class: 'log-box', style: 'white-space:pre; font-size:11.5px', text: print }),
    el('div', { class: 'form-row mt-1' },
      el('button', {
        class: 'btn btn-default btn-sm', type: 'button', text: 'Copy fingerprint',
        onclick: async (e) => {
          try {
            await navigator.clipboard.writeText(`${file.name} — ${info.label}, ${file.size} bytes\n\n${print}`);
            e.currentTarget.textContent = 'Copied';
          } catch {
            e.currentTarget.textContent = 'Select it by hand — the clipboard is blocked';
          }
        },
      }),
    ),
  );

  host.innerHTML = '';
  host.append(card(null, body));
}


// ---- Step 3 ---------------------------------------------------------------

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function autoMap() {
  const cfg = TARGETS[state.target];
  state.mapping = {};
  const used = new Set();
  const normalized = state.headers.map(normalizeHeader);

  for (const [fieldName] of cfg.fields) state.mapping[fieldName] = -1;

  // Two global passes, not one pass per field. An exact header match must beat
  // any prefix match, whatever order the fields happen to be declared in —
  // otherwise "Line Amount", declared early, quietly swallows the "Amount Paid"
  // column that the paid field would have matched exactly.
  for (const [fieldName, , synonyms] of cfg.fields) {
    const wanted = synonyms.map(normalizeHeader);
    const index = normalized.findIndex((h, i) => !used.has(i) && wanted.includes(h));
    if (index !== -1) {
      state.mapping[fieldName] = index;
      used.add(index);
    }
  }

  for (const [fieldName, , synonyms] of cfg.fields) {
    if (state.mapping[fieldName] !== -1) continue;
    const wanted = synonyms.map(normalizeHeader);
    const index = normalized.findIndex((h, i) => !used.has(i) && wanted.some((w) => h.startsWith(w + ' ')));
    if (index !== -1) {
      state.mapping[fieldName] = index;
      used.add(index);
    }
  }

  // Last resort for the field that identifies the record — the name of a
  // customer, the number of an invoice. Express Invoice keeps that in the file
  // *name* and nowhere else: a customer's file is called
  // "Aaron%20Martinez%20Gonzalez.dat" and holds only their address and terms.
  // So if nothing in the file supplied the identity, the file name is not a
  // guess, it is the only place it exists.
  const key = cfg.keyField;
  if (key && state.mapping[key] === -1) {
    const index = state.headers.indexOf('File name');
    if (index !== -1 && !used.has(index)) {
      state.mapping[key] = index;
      used.add(index);
    }
  }
}

/**
 * Everything the file actually contains, with a sample of each column.
 *
 * The mapping table below is organised the other way round — one row per field
 * this app knows about — so a column nothing has been mapped to is invisible
 * there. That matters most for folders whose files are one delimited line with
 * no header anywhere: the columns arrive as "Field 1", "Field 2", and without
 * seeing a value beside each one there is no way to tell which is which.
 */
function fileColumnsPanel() {
  const scan = state.rows.slice(0, 4000);
  const columns = state.headers.map((name, index) => {
    const sampleRow = scan.find((row) => String(row[index] ?? '').trim());
    return {
      name,
      index,
      sample: sampleRow ? String(sampleRow[index]).replace(/\s+/g, ' ').slice(0, 90) : '',
    };
  });

  // "Field 3" and "Line 3" are both positional: the file carried no name for
  // the column, so an example value is the only way to tell what it holds.
  const positional = state.headers.some((h) => /^(Field|Line) \d+$/.test(h));

  const table = el('table', { class: 'map-table cols-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Column in your file' }),
    el('th', { text: 'Example value' }),
  )));
  const tb = el('tbody');
  for (const c of columns) {
    tb.append(el('tr', {},
      el('td', { html: `<span class="input-mono">${esc(c.name)}</span>` }),
      el('td', { class: 'map-sample', html: c.sample
        ? esc(c.sample)
        : '<em class="text-muted">empty in every row</em>' }),
    ));
  }
  table.append(tb);

  const details = el('details', { class: 'cols-found', open: positional });
  details.append(
    el('summary', { text: `What is in your file — ${columns.length} columns` }),
    positional
      ? el('p', { class: 'text-small text-muted', style: 'margin:8px 0 0', text:
          'These files have no header row, so the columns are numbered by position. '
          + 'Use the example values to work out which is which, then map them below.' })
      : null,
    el('div', { class: 'table-wrap', style: 'margin-top:10px' }, table),
  );
  return details;
}

function renderMapping() {
  const cfg = TARGETS[state.target];

  // Two tables on this screen share .map-table for styling, so each also carries
  // its own class: .map-fields is one row per app field, .cols-table is one row
  // per column in the file. Anything selecting one of them must use the specific
  // class — .cols-table lives inside a <details> that is usually collapsed.
  const table = el('table', { class: 'map-table map-fields' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { html: L('imp_map') }),
    el('th', { html: 'File column' }),
    el('th', { html: 'Sample' }),
  )));

  const tb = el('tbody');
  for (const [fieldName, labelKey] of cfg.fields) {
    const select = el('select', {});
    select.append(el('option', { value: '-1' }, `— ${T('none')} —`));
    state.headers.forEach((h, i) => {
      select.append(el('option', { value: String(i), selected: state.mapping[fieldName] === i },
        `${i + 1}. ${h}`));
    });
    const sample = el('td', { class: 'map-sample' });
    const refreshSample = () => {
      const index = state.mapping[fieldName];
      const value = index >= 0 ? (state.rows.find((r) => String(r[index] ?? '').trim())?.[index] ?? '') : '';
      sample.textContent = value;
    };
    select.addEventListener('change', () => {
      state.mapping[fieldName] = parseInt(select.value, 10);
      refreshSample();
    });
    refreshSample();

    const isLine = fieldName.startsWith('line_');
    tb.append(el('tr', {},
      el('td', { html: (isLine ? '<span class="text-muted">↳ </span>' : '') + L(labelKey) }),
      el('td', {}, select),
      sample,
    ));
  }
  table.append(tb);

  bodyHost.append(card('imp_map', el('div', {},
    el('p', { class: 'text-small text-muted mb-2', html:
      `${T('imp_map_hint')}` }),
    fileColumnsPanel(),
    el('p', { class: 'text-small mb-2', html:
      `<strong>${esc(state.fileName)}</strong> · ${state.rows.length} ${T('imp_rows_found').toLowerCase()}` }),
    el('div', { class: 'table-wrap' }, table),
  )));

  bodyHost.append(el('div', { class: 'form-row mb-2' },
    el('button', { class: 'btn btn-default', type: 'button', html: L('act_back'),
      onclick: () => { state.step = 2; renderStep(); } }),
    el('button', { class: 'btn btn-primary', type: 'button', html: L('imp_preview'),
      onclick: () => { state.step = 4; renderStep(); } }),
  ));
}

// ---- Step 4 ---------------------------------------------------------------

function renderPreview() {
  const cfg = TARGETS[state.target];
  let records;
  let problems;
  try {
    ({ records, problems } = buildRecords());
  } catch (err) {
    console.error(err);
    bodyHost.append(el('p', { class: 'text-red', text: err.message }));
    return;
  }

  const dayFirstBox = el('input', { type: 'checkbox', checked: state.dayFirst });
  dayFirstBox.addEventListener('change', () => { state.dayFirst = dayFirstBox.checked; renderStep(); });

  const createBox = el('input', { type: 'checkbox', checked: state.createMissingCustomers });
  createBox.addEventListener('change', () => { state.createMissingCustomers = createBox.checked; });

  const dupSelect = selectEl([
    { value: 'skip', label: 'Skip existing', selected: state.duplicateMode === 'skip' },
    { value: 'update', label: 'Update existing', selected: state.duplicateMode === 'update' },
    { value: 'create', label: 'Always create new', selected: state.duplicateMode === 'create' },
  ]);
  dupSelect.addEventListener('change', () => { state.duplicateMode = dupSelect.value; });

  const options = el('div', { class: 'form-row mb-2' },
    el('label', { class: 'check' }, dayFirstBox,
      el('span', { html: 'Dates are day/month/year' })),
    el('div', { class: 'field', style: 'min-width:300px' },
      el('label', { class: 'field-label', html: 'Duplicates' }),
      dupSelect),
  );
  if (cfg.grouped || state.target === 'payments') {
    options.append(el('label', { class: 'check' }, createBox,
      el('span', { html: 'Create missing customers' })));
  }

  // Preview table over the first handful of built records.
  const preview = el('div', { class: 'table-wrap' });
  const table = el('table', { class: 'data' });
  const columns = previewColumns();
  table.append(el('thead', {}, el('tr', {}, ...columns.map((c) => el('th', { html: c.label })))));
  const tb = el('tbody');
  for (const record of records.slice(0, 12)) {
    tb.append(el('tr', {}, ...columns.map((c) => el('td', { class: c.className || '', text: c.value(record) }))));
  }
  table.append(tb);
  preview.append(table);

  bodyHost.append(card('imp_preview', el('div', {},
    options,
    el('div', { class: 'stat-row', style: 'margin-bottom:14px' },
      el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: L('imp_rows_found') }),
        el('div', { class: 'stat-value', text: String(records.length) })),
      el('div', { class: 'stat' + (problems.length ? ' stat--warn' : '') },
        el('div', { class: 'stat-label', html: L('imp_errors') }),
        el('div', { class: 'stat-value', text: String(problems.length) })),
      ...(cfg.grouped ? [el('div', { class: 'stat' },
        el('div', { class: 'stat-label', html: L('total') }),
        el('div', { class: 'stat-value', text: money(records.reduce((s, r) => s + (r.totalCents || 0), 0)) }))] : []),
    ),
    preview,
  )));

  if (problems.length) {
    bodyHost.append(card('imp_errors', el('div', { class: 'log-box' },
      ...problems.slice(0, 60).map((p) => el('div', { class: 'log-warn', text: p })),
      problems.length > 60 ? el('div', { class: 'text-muted', text: `… +${problems.length - 60}` }) : null,
    )));
  }

  // How many of these will find the customer they belong to. Worth knowing
  // BEFORE writing: an unmatched name silently becomes a second customer
  // record, and at three thousand invoices that is a mess to unpick afterwards.
  if (cfg.grouped || state.target === 'payments') {
    const matchHost = el('div', {});
    bodyHost.insertBefore(matchHost, bodyHost.lastChild);
    renderCustomerMatch(matchHost, records).catch((err) => {
      console.warn('Could not check customer matching', err);
      matchHost.remove();
    });
  }

  bodyHost.append(el('div', { class: 'form-row mb-2' },
    el('button', { class: 'btn btn-default', type: 'button', html: L('act_back'),
      onclick: () => { state.step = 3; renderStep(); } }),
    el('button', {
      class: 'btn btn-primary', type: 'button', html: L('imp_run'),
      onclick: () => runImport(records),
      disabled: !records.length,
    }),
  ));
}

/**
 * Counts how many records match a customer already on file, and names the ones
 * that do not — so a "Perez, John" that should have been "John Perez" is caught
 * here rather than discovered as a duplicate customer next week.
 */
async function renderCustomerMatch(host, records) {
  const index = buildCustomerIndex(await loadAll('customers'));

  let matched = 0;
  const unmatched = new Map(); // name -> how many records use it
  for (const record of records) {
    if (matchCustomer(index, record)) {
      matched += 1;
    } else {
      const name = String(record.customerName || '').trim() || '(blank)';
      unmatched.set(name, (unmatched.get(name) || 0) + 1);
    }
  }

  host.innerHTML = '';
  if (!records.length) return;

  const willCreate = state.createMissingCustomers;
  const names = [...unmatched.entries()].sort((a, b) => b[1] - a[1]);

  const body = el('div', {},
    el('div', { class: 'stat-row', style: 'margin-bottom:12px' },
      el('div', { class: 'stat stat--good' },
        el('div', { class: 'stat-label', text: 'Matched to a customer on file' }),
        el('div', { class: 'stat-value', text: String(matched) })),
      el('div', { class: 'stat' + (unmatched.size ? ' stat--warn' : '') },
        el('div', { class: 'stat-label',
          text: willCreate ? 'New customers to be created' : 'Left without a customer' }),
        el('div', { class: 'stat-value', text: String(unmatched.size) }),
        el('div', { class: 'stat-sub',
          text: `across ${records.length - matched} ${records.length - matched === 1 ? 'record' : 'records'}` })),
    ),
  );

  if (names.length) {
    body.append(el('p', { class: 'text-small text-muted mb-1', text:
      willCreate
        ? 'These names are not on file yet. If one is a spelling variant of an existing customer, go back, fix it in the CSV, and the invoices will attach to the record you already have.'
        : 'These records will import without a customer attached, so they will not appear on that customer’s statement.' }));
    body.append(el('div', { class: 'log-box' },
      ...names.slice(0, 40).map(([name, count]) =>
        el('div', { class: unmatched.size ? 'log-warn' : '', text: `${name}  ×${count}` })),
      names.length > 40 ? el('div', { class: 'text-muted', text: `… +${names.length - 40} more` }) : null,
    ));
  }

  host.append(card('customer', body));
}

function previewColumns() {
  const cfg = TARGETS[state.target];
  if (cfg.grouped) {
    return [
      { label: T('number'), value: (r) => r.number || '' },
      { label: T('date'), value: (r) => r.date || '' },
      { label: T('customer'), value: (r) => r.customerName || '' },
      { label: T('line_item'), className: 'num', value: (r) => String((r.lines || []).length) },
      { label: T('total'), className: 'num', value: (r) => money(r.totalCents) },
      { label: T('amount_paid'), className: 'num', value: (r) => money(r.paidCents) },
    ];
  }
  if (state.target === 'payments') {
    return [
      { label: T('number'), value: (r) => r.number || '' },
      { label: T('date'), value: (r) => r.date || '' },
      { label: T('customer'), value: (r) => r.customerName || '' },
      { label: T('pay_method'), value: (r) => r.method || '' },
      { label: T('amount'), className: 'num', value: (r) => money(r.amountCents) },
      { label: T('invoice_number'), value: (r) => r._invoiceNumber || '' },
    ];
  }
  if (state.target === 'items') {
    return [
      { label: T('item_code'), value: (r) => r.code || '' },
      { label: T('item_description'), value: (r) => String(r.description || '').slice(0, 60) },
      { label: T('item_price'), className: 'num', value: (r) => money(r.priceCents) },
      { label: T('item_cost'), className: 'num', value: (r) => money(r.costCents) },
      { label: T('item_category'), value: (r) => r.category || '' },
    ];
  }
  return [
    { label: T('cust_name'), value: (r) => r.name || '' },
    { label: T('cust_company'), value: (r) => r.company || '' },
    { label: T('cust_phone'), value: (r) => r.phone || r.mobile || '' },
    { label: T('cust_email'), value: (r) => r.email || '' },
    { label: T('cust_city'), value: (r) => r.city || '' },
  ];
}

// ===========================================================================
// Building records from the mapped rows
// ===========================================================================

function cellOf(row, fieldName) {
  const index = state.mapping[fieldName];
  if (index === undefined || index < 0) return '';
  return String(row[index] ?? '').trim();
}

function truthy(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  return ['1', 'y', 'yes', 'true', 't', 'si', 'sí', 'x', 'taxable', 'gravable'].includes(v);
}

function buildRecords() {
  const cfg = TARGETS[state.target];
  const problems = [];

  if (state.target === 'customers') {
    const records = [];
    state.rows.forEach((row, i) => {
      const name = cellOf(row, 'name');
      const company = cellOf(row, 'company');
      if (!name && !company) { problems.push(`Fila ${i + 2}: sin nombre / no name`); return; }
      const record = {
        ...blankCustomer(),
        name: name || company,
        company,
        account: cellOf(row, 'account'),
        contact: cellOf(row, 'contact'),
        address: cellOf(row, 'address'),
        address2: cellOf(row, 'address2'),
        city: cellOf(row, 'city'),
        state: cellOf(row, 'state'),
        zip: cellOf(row, 'zip'),
        country: cellOf(row, 'country'),
        phone: cellOf(row, 'phone'),
        mobile: cellOf(row, 'mobile'),
        email: cellOf(row, 'email'),
        terms: cellOf(row, 'terms'),
        discountPct: parseRate(cellOf(row, 'discountPct')),
        creditLimitCents: parseMoney(cellOf(row, 'creditLimitCents')),
        taxExempt: truthy(cellOf(row, 'taxExempt')),
        notes: cellOf(row, 'notes'),
      };
      record.searchBlob = customerSearchBlob(record);
      records.push(record);
    });
    return { records, problems };
  }

  if (state.target === 'items') {
    const records = [];
    state.rows.forEach((row, i) => {
      const code = cellOf(row, 'code');
      const description = cellOf(row, 'description');
      if (!code && !description) { problems.push(`Fila ${i + 2}: sin código ni descripción / no code or description`); return; }
      const qty = cellOf(row, 'qtyInStock');
      const record = {
        ...blankItem(),
        code,
        description,
        priceCents: parseMoney(cellOf(row, 'priceCents')),
        costCents: parseMoney(cellOf(row, 'costCents')),
        unit: cellOf(row, 'unit'),
        category: cellOf(row, 'category'),
        taxable: state.mapping.taxable >= 0 ? truthy(cellOf(row, 'taxable')) : true,
        qtyInStock: parseQty(qty),
        trackStock: qty !== '',
        notes: cellOf(row, 'notes'),
      };
      record.searchBlob = itemSearchBlob(record);
      records.push(record);
    });
    return { records, problems };
  }

  if (state.target === 'payments') {
    const records = [];
    state.rows.forEach((row, i) => {
      const amount = parseMoney(cellOf(row, 'amountCents'));
      const customerName = cellOf(row, 'customerName');
      if (!amount) { problems.push(`Fila ${i + 2}: monto vacío / empty amount`); return; }
      if (!customerName) { problems.push(`Fila ${i + 2}: sin cliente / no customer`); return; }
      const record = {
        ...blankPayment(),
        number: cellOf(row, 'number'),
        date: parseDate(cellOf(row, 'date'), state.dayFirst) || today(),
        customerName,
        method: normalizeMethod(cellOf(row, 'method')),
        reference: cellOf(row, 'reference'),
        notes: cellOf(row, 'notes'),
        amountCents: amount,
        allocations: [],
      };
      record._customerAccount = cellOf(row, 'customerAccount');
      record._invoiceNumber = cellOf(row, 'invoiceNumber');
      records.push(record);
    });
    return { records, problems };
  }

  // ---- Grouped documents: many rows per document, keyed by number ----------
  const type = cfg.docType;
  const groups = new Map();
  let fallbackCounter = 0;

  state.rows.forEach((row, i) => {
    let number = cellOf(row, 'number');
    if (!number) {
      // A blank number on a continuation row belongs to the document above it.
      const previous = [...groups.keys()].pop();
      if (previous && hasLineContent(row)) {
        number = previous;
      } else {
        fallbackCounter += 1;
        problems.push(`Fila ${i + 2}: sin número de documento / no document number`);
        return;
      }
    }

    if (!groups.has(number)) {
      const record = blankDoc(type, settings);
      record.number = number;
      record.date = parseDate(cellOf(row, 'date'), state.dayFirst) || today();
      record.customerName = cellOf(row, 'customerName');
      record.billTo = cellOf(row, 'billTo') || record.customerName;
      record.shipTo = cellOf(row, 'shipTo');
      record.poNumber = cellOf(row, 'poNumber');
      record.salesPerson = cellOf(row, 'salesPerson');
      record.terms = cellOf(row, 'terms');
      record.notes = cellOf(row, 'notes');
      record.privateNotes = cellOf(row, 'privateNotes');
      record.lines = [];
      record._customerAccount = cellOf(row, 'customerAccount');
      record._importedStatus = cellOf(row, 'status');

      const due = parseDate(cellOf(row, 'dueDate'), state.dayFirst);
      if (type === 'invoice') record.dueDate = due || record.date;
      if (type === 'quote') record.expiryDate = due || addDays(record.date, Number(settings.quoteValidDays) || 30);

      // Totals as exported. Blank means "derive it".
      record._importedTotals = {
        subtotal: mappedMoney(row, 'subtotalCents'),
        discount: mappedMoney(row, 'discountCents'),
        shipping: mappedMoney(row, 'shippingCents'),
        tax: mappedMoney(row, 'taxCents'),
        total: mappedMoney(row, 'totalCents'),
        paid: mappedMoney(row, 'paidCents'),
      };

      groups.set(number, record);
    }

    const record = groups.get(number);
    if (hasLineContent(row)) {
      const qtyRaw = cellOf(row, 'line_qty');
      const qty = qtyRaw === '' ? 1 : parseQty(qtyRaw);
      const unitPrice = parseMoney(cellOf(row, 'line_unitPrice'));
      const lineAmount = mappedMoney(row, 'line_amount');
      const line = {
        itemId: '',
        code: cellOf(row, 'line_code'),
        description: cellOf(row, 'line_description'),
        qty,
        unit: '',
        unitCents: unitPrice,
        discountPct: parseRate(cellOf(row, 'line_discountPct')),
        taxable: state.mapping.line_taxable >= 0 ? truthy(cellOf(row, 'line_taxable')) : true,
        amountCents: 0,
      };
      // If the export gave a line total but no unit price, derive the price so
      // the line still adds up when it is re-rendered.
      if (lineAmount !== null && !unitPrice && qty) line.unitCents = Math.round(lineAmount / qty);
      line.amountCents = lineAmount !== null ? lineAmount : Math.round(qty * line.unitCents);
      record.lines.push(line);
    }
  });

  const records = [];
  for (const record of groups.values()) {
    if (!record.lines.length) {
      record.lines = [{
        ...blankDoc(type, settings).lines[0],
        description: record.notes || '',
        qty: 1,
        unitCents: record._importedTotals.total ?? 0,
        amountCents: record._importedTotals.total ?? 0,
      }];
    }
    finalizeDocumentTotals(record, type);
    if (!record.customerName) problems.push(`${record.number}: sin cliente / no customer`);
    records.push(record);
  }

  return { records, problems };
}

function hasLineContent(row) {
  return ['line_code', 'line_description', 'line_qty', 'line_unitPrice', 'line_amount']
    .some((f) => cellOf(row, f) !== '');
}

/** Money from a mapped column, or null when the column is absent/blank. */
function mappedMoney(row, fieldName) {
  const index = state.mapping[fieldName];
  if (index === undefined || index < 0) return null;
  const raw = String(row[index] ?? '').trim();
  if (raw === '') return null;
  return parseMoney(raw);
}

/**
 * Locks in the numbers. Where the export supplied a figure it is stored exactly
 * as exported; only what is missing gets computed. A ten-year-old invoice must
 * still print the total the customer was charged at the time.
 */
function finalizeDocumentTotals(record, type) {
  const imported = record._importedTotals;
  const lineSum = record.lines.reduce((s, l) => s + (Number(l.amountCents) || 0), 0);

  record.subtotalCents = imported.subtotal ?? lineSum;
  record.discountCents = imported.discount ?? 0;
  record.discountPct = 0;
  record.shippingCents = imported.shipping ?? 0;

  const tax = imported.tax ?? 0;
  record.tax1Cents = tax;
  record.tax2Cents = 0;
  record.taxCents = tax;
  record.taxableCents = record.lines.reduce((s, l) => s + (l.taxable ? (Number(l.amountCents) || 0) : 0), 0);

  record.totalCents = imported.total
    ?? (record.subtotalCents - record.discountCents + record.shippingCents + tax);

  record.paidCents = imported.paid ?? 0;
  record.balanceCents = record.totalCents - record.paidCents;

  if (type === 'invoice') {
    record.status = 'sent';
    record.paymentStatus = derivePaymentStatus(record);
  } else {
    record.status = normalizeStatus(record._importedStatus, type);
  }

  record.importedAt = today();
  record.searchBlob = [
    record.number, record.customerName, record.poNumber, record.salesPerson,
    ...record.lines.map((l) => `${l.code} ${l.description}`),
  ].filter(Boolean).join(' ').toLowerCase().slice(0, 1500);

  delete record._importedTotals;
  delete record._importedStatus;
}

function normalizeStatus(raw, type) {
  const v = String(raw || '').toLowerCase();
  if (type === 'quote') {
    if (v.includes('accept') || v.includes('acept')) return 'accepted';
    if (v.includes('declin') || v.includes('rechaz')) return 'declined';
    if (v.includes('convert')) return 'converted';
    if (v.includes('expir')) return 'expired';
    return 'open';
  }
  if (v.includes('fulfil') || v.includes('complet')) return 'fulfilled';
  if (v.includes('invoic') || v.includes('factur')) return 'invoiced';
  if (v.includes('cancel')) return 'cancelled';
  return 'open';
}

function normalizeMethod(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('cash') || v.includes('efectiv')) return 'cash';
  if (v.includes('check') || v.includes('cheque') || v.includes('cheq')) return 'check';
  if (v.includes('card') || v.includes('tarjeta') || v.includes('credit') || v.includes('debit')) return 'card';
  if (v.includes('transfer') || v.includes('wire') || v.includes('ach') || v.includes('deposit')) return 'transfer';
  return 'other';
}

// ===========================================================================
// Writing
// ===========================================================================

async function runImport(records) {
  const cfg = TARGETS[state.target];

  const ok = await confirmDialog(
    `Se importarán <strong>${records.length}</strong> registros a <strong>${T(cfg.labelKey)}</strong>.` +
    `<br>${records.length} records will be imported.` +
    '<br><br><span class="text-small text-muted">Take a backup first if you already have data.</span>',
    { okKey: 'imp_run' },
  );
  if (!ok) return;

  bodyHost.innerHTML = '';
  const bar = el('div', { style: 'width:0%' });
  const progress = el('div', { class: 'progress' }, bar);
  const log = el('div', { class: 'log-box' });
  const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
  const countsHost = el('div', { class: 'stat-row' });

  bodyHost.append(card('imp_run', el('div', {}, progress, countsHost, log)));

  const write = (message, kind = '') => {
    log.append(el('div', { class: kind, text: message }));
    log.scrollTop = log.scrollHeight;
  };
  const paintCounts = () => {
    countsHost.innerHTML = '';
    for (const [key, labelKey] of [['created', 'imp_created'], ['updated', 'imp_updated'],
      ['skipped', 'imp_skipped'], ['errors', 'imp_errors']]) {
      countsHost.append(el('div', { class: 'stat' + (key === 'errors' && counts[key] ? ' stat--warn' : '') },
        el('div', { class: 'stat-label', html: L(labelKey) }),
        el('div', { class: 'stat-value', text: String(counts[key]) }),
      ));
    }
  };
  paintCounts();

  try {
    // ---- Existing records, so duplicates can be recognised ----
    write(`${T('loading')}`);
    const existing = await loadAll(cfg.collection);
    const byKey = new Map();
    for (const record of existing) {
      const key = normalizeKey(record[cfg.keyField]);
      if (key) byKey.set(key, record.id);
    }

    // ---- Customer lookup for documents and payments ----
    let index = { byName: new Map(), byAccount: new Map() };
    if (cfg.grouped || state.target === 'payments') {
      index = buildCustomerIndex(await loadAll('customers'));
    }
    const { byName: customersByName, byAccount: customersByAccount } = index;

    // ---- Invoice lookup, so payments can be applied ----
    let invoicesByNumber = new Map();
    if (state.target === 'payments') {
      const invoices = await loadAll('invoices');
      for (const inv of invoices) {
        const key = normalizeKey(inv.number);
        if (key) invoicesByNumber.set(key, inv);
      }
    }

    const invoicePaid = new Map(); // invoiceId -> cents applied by this import
    let batch = writeBatch(db);
    let opsInBatch = 0;
    let maxNumber = 0;

    const flush = async () => {
      if (!opsInBatch) return;
      await batch.commit();
      batch = writeBatch(db);
      opsInBatch = 0;
    };

    for (let i = 0; i < records.length; i++) {
      const record = { ...records[i] };
      try {
        // --- Resolve the customer ---
        if (cfg.grouped || state.target === 'payments') {
          const accountKey = normalizeKey(record._customerAccount);
          const nameKey = normalizeKey(record.customerName);
          let customer = matchCustomer(index, record);

          if (!customer && state.createMissingCustomers && record.customerName) {
            const fresh = {
              ...blankCustomer(),
              name: record.customerName,
              account: record._customerAccount || '',
              address: cfg.grouped ? String(record.billTo || '').split('\n').slice(1).join('\n') : '',
            };
            fresh.searchBlob = customerSearchBlob(fresh);
            const ref = doc(collection(db, 'customers'));
            batch.set(ref, { ...fresh, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            opsInBatch += 1;
            customer = { id: ref.id, ...fresh };
            if (nameKey) customersByName.set(nameKey, customer);
            if (accountKey) customersByAccount.set(accountKey, customer);
            write(`+ ${T('act_new_customer')}: ${record.customerName}`, 'log-ok');
          }
          if (customer) record.customerId = customer.id;
        }

        // --- Payment allocation ---
        if (state.target === 'payments') {
          const invoice = invoicesByNumber.get(normalizeKey(record._invoiceNumber));
          if (invoice) {
            record.allocations = [{
              invoiceId: invoice.id,
              invoiceNumber: invoice.number,
              amountCents: record.amountCents,
            }];
            invoicePaid.set(invoice.id, (invoicePaid.get(invoice.id) || 0) + record.amountCents);
          }
          record.appliedCents = (record.allocations || []).reduce((s, a) => s + a.amountCents, 0);
          record.unappliedCents = record.amountCents - record.appliedCents;
        }

        for (const key of Object.keys(record)) {
          if (key.startsWith('_')) delete record[key];
        }

        // --- Create / update / skip ---
        const key = normalizeKey(records[i][cfg.keyField]);
        const existingId = key ? byKey.get(key) : null;

        if (existingId && state.duplicateMode === 'skip') {
          counts.skipped += 1;
        } else if (existingId && state.duplicateMode === 'update') {
          batch.set(doc(db, cfg.collection, existingId), { ...record, updatedAt: serverTimestamp() }, { merge: true });
          opsInBatch += 1;
          counts.updated += 1;
        } else {
          const ref = doc(collection(db, cfg.collection));
          batch.set(ref, { ...record, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          opsInBatch += 1;
          counts.created += 1;
          if (key) byKey.set(key, ref.id);
        }

        maxNumber = Math.max(maxNumber, numericPart(records[i][cfg.keyField]));
      } catch (err) {
        console.error('Row failed', err);
        counts.errors += 1;
        write(`✗ ${records[i][cfg.keyField] || i + 1}: ${err.message}`, 'log-err');
      }

      // Firestore caps a batch at 500 writes; stay well under it.
      if (opsInBatch >= 400) {
        await flush();
        write(`… ${i + 1} / ${records.length}`);
      }
      if (i % 25 === 0) {
        bar.style.width = `${Math.round(((i + 1) / records.length) * 100)}%`;
        paintCounts();
        await new Promise((r) => setTimeout(r, 0)); // let the browser paint
      }
    }

    await flush();

    // --- Roll the invoice balances forward for imported payments ---
    if (state.target === 'payments' && invoicePaid.size) {
      write(`${T('act_recalculate')} ${T('nav_invoices')}…`);
      let paidBatch = writeBatch(db);
      let ops = 0;
      for (const [invoiceId, cents] of invoicePaid) {
        const invoice = [...invoicesByNumber.values()].find((inv) => inv.id === invoiceId);
        if (!invoice) continue;
        const paid = (Number(invoice.paidCents) || 0) + cents;
        const balance = (Number(invoice.totalCents) || 0) - paid;
        paidBatch.update(doc(db, 'invoices', invoiceId), {
          paidCents: paid,
          balanceCents: balance,
          paymentStatus: derivePaymentStatus({ ...invoice, paidCents: paid, type: 'invoice', status: 'sent' }),
          updatedAt: serverTimestamp(),
        });
        ops += 1;
        if (ops >= 400) { await paidBatch.commit(); paidBatch = writeBatch(db); ops = 0; }
      }
      if (ops) await paidBatch.commit();
    }

    // --- Keep the counter ahead of everything just imported ---
    const counterType = { invoices: 'invoice', quotes: 'quote', orders: 'order', payments: 'payment' }[state.target];
    if (counterType && maxNumber > 0) {
      const current = await peekCounter(counterType);
      if (maxNumber >= Number(current.next)) {
        await setCounter(counterType, { next: maxNumber + 1 });
        write(`${T('set_next_number')}: ${maxNumber + 1}`, 'log-ok');
      }
    }

    bar.style.width = '100%';
    paintCounts();
    write(`✔ ${T('imp_done')}`, 'log-ok');
    invalidateStore();

    bodyHost.append(el('div', { class: 'form-row mt-2' },
      el('button', {
        class: 'btn btn-primary', type: 'button', html: L('nav_import'),
        onclick: () => { state.step = 1; state.rows = []; state.headers = []; renderStep(); },
      }),
      el('a', { class: 'btn btn-default', href: `${cfg.collection}.html`, html: L(cfg.labelKey) }),
      el('a', { class: 'btn btn-default', href: 'dashboard.html', html: L('nav_home') }),
    ));

    toast(`${T('imp_done')} — ${counts.created} ${T('imp_created').toLowerCase()}`, 'ok', 6000);
  } catch (err) {
    console.error('Import failed', err);
    write(`✗ ${err.message}`, 'log-err');
    toast('The import stopped.', 'err', 8000);
    bodyHost.append(el('button', {
      class: 'btn btn-default mt-2', type: 'button', html: L('act_back'),
      onclick: () => { state.step = 4; renderStep(); },
    }));
  }
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Matching a document to a customer already on file.
//
// One implementation, used by both the preview and the import itself. If these
// two ever disagreed, the preview would promise a match that the import then
// failed to make — and quietly create a duplicate customer instead, which is
// the single most expensive mistake this screen can make at three thousand
// invoices.
// ---------------------------------------------------------------------------

export function buildCustomerIndex(customers) {
  const byName = new Map();
  const byAccount = new Map();
  for (const c of customers) {
    const nameKey = normalizeKey(c.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, c);
    const companyKey = normalizeKey(c.company);
    if (companyKey && !byName.has(companyKey)) byName.set(companyKey, c);
    const accountKey = normalizeKey(c.account);
    if (accountKey) byAccount.set(accountKey, c);
  }
  return { byName, byAccount };
}

/** Account number wins over name — it is the identifier that does not vary. */
export function matchCustomer(index, record) {
  const accountKey = normalizeKey(record._customerAccount);
  const nameKey = normalizeKey(record.customerName);
  return (accountKey && index.byAccount.get(accountKey))
    || (nameKey && index.byName.get(nameKey))
    || null;
}
