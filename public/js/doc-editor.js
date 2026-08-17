// ---------------------------------------------------------------------------
// The invoice / quote / order editor.
//
// One implementation drives all three screens, because in Express Invoice they
// were the same form with a different word at the top — and the owner's muscle
// memory depends on them staying that way.
//
// Layout, top to bottom: header fields (customer left, document details right),
// the line grid, then notes bottom-left with the totals stack bottom-right.
// ---------------------------------------------------------------------------

import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, params, money,
  moneyInput, parseMoney, parseQty, fmtQty, parseRate, today, addDays,
  loadOne, saveRecord, removeRecord, loadAll, nextNumber, peekCounter,
  setCounter, formatNumber, numericPart, onAction, toast, toastKey,
  confirmDialog, openModal, trackDirty, query, where, limit, spinner,
} from './app.js';
import {
  DOC_TYPES, blankDoc, blankLine, recalc, statusKey, attachCustomer,
  convertDocument, blankCustomer, customerSearchBlob, stockDeltasForDoc,
  applyStockDeltas, QUOTE_STATUSES, ORDER_STATUSES,
} from './model.js';
import {
  loadCustomers, loadItems, findCustomer, invalidate as invalidateStore,
} from './store.js';
import {
  statusPill, customerAutocomplete, itemAutocomplete, field, card,
  selectEl,
} from './components.js';

export async function mountDocEditor(type) {
  const cfg = DOC_TYPES[type];
  setPageTitle(cfg.titleKey);
  const { settings } = await initShell(cfg.editPage);

  const page = $('#page');
  page.append(spinner());

  const p = params();
  const isNew = !p.id;

  let customers = [];
  let items = [];
  try {
    [customers, items] = await Promise.all([loadCustomers(), loadItems()]);
  } catch {
    toast(L('msg_offline'), 'err');
  }

  // ---- Load or create the document ------------------------------------------
  let doc_;
  let originalLines = [];
  let counterPreview = '';

  if (isNew) {
    doc_ = blankDoc(type, settings);

    // Show the number the document will get, but do not consume it yet — an
    // abandoned draft should not eat a number out of the sequence.
    const state = await peekCounter(cfg.counter);
    counterPreview = formatNumber(state.next, state.prefix, state.padding);
    doc_.number = counterPreview;

    // "Duplicate" hands the source document over through sessionStorage rather
    // than the URL, because a whole invoice does not fit in a query string.
    if (p.dup) {
      const stashed = sessionStorage.getItem('doc-duplicate');
      sessionStorage.removeItem('doc-duplicate');
      if (stashed) {
        try {
          Object.assign(doc_, JSON.parse(stashed), { number: counterPreview });
        } catch (err) {
          console.warn('Could not restore the duplicated document', err);
        }
      }
    }

    if (p.customer) {
      const c = await findCustomer(p.customer);
      if (c) attachCustomer(doc_, c, settings);
    }
    if (p.from && p.fromType) {
      const source = await loadOne(DOC_TYPES[p.fromType].collection, p.from);
      if (source) {
        const converted = await convertDocument({ id: p.from, ...source }, type, settings);
        doc_ = converted;
        counterPreview = '';
      }
    }
  } else {
    const loaded = await loadOne(cfg.collection, p.id);
    if (!loaded) {
      page.innerHTML = '';
      page.append(el('div', { class: 'empty', html: `<p>${L('msg_not_found')}</p>` }));
      return;
    }
    doc_ = { ...blankDoc(type, settings), ...loaded, id: p.id };
    originalLines = (doc_.lines || []).map((l) => ({ ...l }));
  }

  recalc(doc_, settings);
  ensureTrailingLine();

  let dirty = false;
  const markDirty = () => { dirty = true; };
  trackDirty(() => dirty);

  // Mutable view state. These have to be declared before the build* functions
  // run, not merely before they are defined — `let` bindings are in the
  // temporal dead zone until this point, and the render block below calls
  // straight into the functions that assign them.
  let tbody;
  let focusedRow = 0;
  let totalsHost;
  // Set while refreshTotals puts focus back into the box being typed in, so the
  // select-on-focus below does not wipe out the caret it just restored.
  let restoringFocus = false;

  // ---- Render ---------------------------------------------------------------

  page.innerHTML = '';
  const header = pageHeader(cfg.titleKey, buildButtons(), '');
  page.append(header);

  const headCard = card(null, buildHeaderFields(), { flush: false });
  const linesCard = card('line_item', buildLinesSection(), { flush: true });
  const footNode = buildFooter();

  page.append(headCard, linesCard, footNode);

  refreshTitle();
  refreshTotals();

  // =========================================================================
  // Header fields
  // =========================================================================

  function buildHeaderFields() {
    const left = el('div', {});
    const right = el('div', {});

    // --- Customer ---
    const custInput = el('input', {
      type: 'text', id: 'f-customer', value: doc_.customerName || '',
      placeholder: `${T('customer')}`,
    });
    const custField = field('customer', custInput);
    left.append(custField);

    customerAutocomplete(
      custInput,
      () => customers,
      (c) => {
        attachCustomer(doc_, c, settings);
        billTo.value = doc_.billTo;
        termsInput.value = doc_.terms || '';
        exemptBox.checked = !!doc_.taxExempt;
        markDirty();
        refreshTotals();
      },
      (typedName) => openQuickCustomer(typedName, custInput),
    );
    custInput.addEventListener('blur', () => {
      const typed = custInput.value.trim();
      if (!typed) {
        doc_.customerId = '';
        doc_.customerName = '';
        markDirty();
        return;
      }
      // The picker leaves the customer's plain name in the box while the
      // document stores the fuller "Name — Company" label. Those two strings
      // differ, so the linked customer has to be checked before concluding the
      // owner typed over the pick — otherwise clicking away would silently
      // detach the invoice from its customer record.
      const linked = customers.find((c) => c.id === doc_.customerId);
      if (linked && typed === (linked.name || linked.company || '')) return;

      // A name that is not on file is allowed; it just rides along on this one
      // document without creating a customer record.
      if (typed !== doc_.customerName) {
        doc_.customerName = typed;
        doc_.customerId = '';
        markDirty();
      }
    });

    const billTo = el('textarea', { id: 'f-billto', rows: 5, value: doc_.billTo || '' });
    billTo.value = doc_.billTo || '';
    billTo.addEventListener('input', () => { doc_.billTo = billTo.value; markDirty(); });
    left.append(field('bill_to', billTo));

    const shipTo = el('textarea', { id: 'f-shipto', rows: 3 });
    shipTo.value = doc_.shipTo || '';
    shipTo.addEventListener('input', () => { doc_.shipTo = shipTo.value; markDirty(); });
    left.append(field('ship_to', shipTo));

    // --- Document details ---
    const numberInput = el('input', { type: 'text', id: 'f-number', class: 'input-mono', value: doc_.number || '' });
    numberInput.addEventListener('input', () => { doc_.number = numberInput.value.trim(); markDirty(); refreshTitle(); });

    const dateInput_ = el('input', { type: 'date', id: 'f-date', value: doc_.date || today() });
    dateInput_.addEventListener('change', () => {
      doc_.date = dateInput_.value || today();
      if (cfg.hasDueDate && dueInput) dueInput.value = addDays(doc_.date, Number(settings.defaultDueDays) || 0);
      if (cfg.hasDueDate) doc_.dueDate = dueInput.value;
      if (cfg.hasExpiry && expiryInput) {
        expiryInput.value = addDays(doc_.date, Number(settings.quoteValidDays) || 30);
        doc_.expiryDate = expiryInput.value;
      }
      markDirty();
    });

    let dueInput = null;
    let expiryInput = null;

    const row1 = el('div', { class: 'grid grid-2' },
      field(cfg.numberKey, numberInput,
        isNew && counterPreview ? `${T('set_numbering_hint')}` : ''),
      field('date', dateInput_),
    );
    right.append(row1);

    const row2 = el('div', { class: 'grid grid-2' });
    if (cfg.hasDueDate) {
      dueInput = el('input', { type: 'date', id: 'f-due', value: doc_.dueDate || '' });
      dueInput.addEventListener('change', () => { doc_.dueDate = dueInput.value; markDirty(); });
      row2.append(field('due_date', dueInput));
    }
    if (cfg.hasExpiry) {
      expiryInput = el('input', { type: 'date', id: 'f-expiry', value: doc_.expiryDate || '' });
      expiryInput.addEventListener('change', () => { doc_.expiryDate = expiryInput.value; markDirty(); });
      row2.append(field('expiry_date', expiryInput));
    }

    const termsInput = el('input', { type: 'text', id: 'f-terms', value: doc_.terms || '' });
    termsInput.addEventListener('input', () => { doc_.terms = termsInput.value; markDirty(); });
    row2.append(field('terms', termsInput));
    right.append(row2);

    const poInput = el('input', { type: 'text', id: 'f-po', value: doc_.poNumber || '' });
    poInput.addEventListener('input', () => { doc_.poNumber = poInput.value; markDirty(); });

    const spInput = el('input', { type: 'text', id: 'f-sp', value: doc_.salesPerson || '' });
    spInput.addEventListener('input', () => { doc_.salesPerson = spInput.value; markDirty(); });

    right.append(el('div', { class: 'grid grid-2' },
      field('po_number', poInput),
      field('sales_person', spInput),
    ));

    // Status: invoices carry draft/sent (payment state is derived), quotes and
    // orders carry their own lifecycle.
    let statusControl;
    if (type === 'invoice') {
      statusControl = selectEl([
        { value: 'draft', labelKey: 'st_draft', selected: doc_.status === 'draft' },
        { value: 'sent', labelKey: 'st_sent', selected: doc_.status !== 'draft' },
      ], { id: 'f-status' });
    } else {
      const list = type === 'quote' ? QUOTE_STATUSES : ORDER_STATUSES;
      statusControl = selectEl(
        list.filter((s) => s !== 'void').map((s) => ({
          value: s, labelKey: statusKey(s), selected: (doc_.status || 'open') === s,
        })),
        { id: 'f-status' },
      );
    }
    statusControl.addEventListener('change', () => {
      doc_.status = statusControl.value;
      markDirty();
      refreshTotals();
    });

    const exemptBox = el('input', { type: 'checkbox', id: 'f-exempt', checked: !!doc_.taxExempt });
    exemptBox.addEventListener('change', () => {
      doc_.taxExempt = exemptBox.checked;
      markDirty();
      refreshTotals();
    });

    right.append(el('div', { class: 'grid grid-2' },
      field('status', statusControl),
      el('div', { class: 'field' },
        el('label', { class: 'field-label', html: L('tax') }),
        el('label', { class: 'check' }, exemptBox, el('span', { html: L('cust_tax_exempt') })),
      ),
    ));

    return el('div', { class: 'doc-head' }, left, right);
  }

  // =========================================================================
  // Line grid
  // =========================================================================

  function buildLinesSection() {
    const table = el('table', { class: 'lines-table' });
    table.append(el('thead', {},
      el('tr', {},
        el('th', { class: 'col-code', html: L('line_code') }),
        el('th', { html: L('line_description') }),
        el('th', { class: 'col-qty num', html: L('line_qty') }),
        el('th', { class: 'col-price num', html: L('line_price') }),
        el('th', { class: 'col-disc num', html: L('line_discount') }),
        el('th', { class: 'col-tax mid', html: L('line_taxable') }),
        el('th', { class: 'col-amount num', html: L('line_amount') }),
        el('th', { class: 'col-act' }),
      ),
    ));
    tbody = el('tbody');
    table.append(tbody);
    renderLines();

    const foot = el('div', { class: 'card-foot' },
      el('button', {
        class: 'btn btn-default btn-sm', type: 'button',
        html: `+ ${T('act_add_line')}`,
        onclick: () => { doc_.lines.push(blankLine()); markDirty(); renderLines(); focusCell(doc_.lines.length - 1, 'code'); },
      }),
      el('span', { class: 'text-small text-muted', style: 'margin-left:12px',
        html: `<kbd>Alt</kbd>+<kbd>I</kbd> ${T('act_add_line')} · <kbd>Alt</kbd>+<kbd>D</kbd> ${T('act_remove_line')}` }),
    );

    return el('div', {}, el('div', { class: 'table-wrap' }, table), foot);
  }

  function renderLines() {
    tbody.innerHTML = '';
    doc_.lines.forEach((line, index) => tbody.append(buildLineRow(line, index)));
    growAllDescriptions();
  }

  /**
   * A textarea reports scrollHeight 0 while it is still detached, so the
   * auto-grow done during construction cannot size a two-line description
   * (an IMEI under a model name, which is most of them). Re-run it once the
   * rows are in the document.
   */
  function growAllDescriptions() {
    requestAnimationFrame(() => {
      for (const textarea of tbody.querySelectorAll('.line-desc')) autoGrow(textarea);
    });
  }

  function buildLineRow(line, index) {
    const tr = el('tr', { dataset: { index: String(index) } });
    tr.addEventListener('focusin', () => {
      focusedRow = index;
      Array.from(tbody.children).forEach((n) => n.classList.remove('is-focused'));
      tr.classList.add('is-focused');
    });

    // --- Code, with item lookup ---
    const codeInput = el('input', { type: 'text', class: 'line-code input-mono', value: line.code || '' });
    const codeCell = el('td', { class: 'col-code' }, codeInput);
    tr.append(codeCell);

    itemAutocomplete(codeInput, () => items, (item) => {
      line.itemId = item.id;
      line.code = item.code || '';
      // Only overwrite a description the owner has not already typed into.
      if (!line.description || line.description === '') line.description = item.description || '';
      line.unitCents = Math.round(Number(item.priceCents) || 0);
      line.unit = item.unit || '';
      line.taxable = item.taxable !== false;
      syncRow(tr, line);
      appendIfLast(index);
      markDirty();
      recalcAll();
      focusCell(index, 'qty');
    });
    codeInput.addEventListener('input', () => {
      line.code = codeInput.value;
      line.itemId = '';
      markDirty();
    });

    // --- Description ---
    const descInput = el('textarea', { rows: 1, class: 'line-desc' });
    descInput.value = line.description || '';
    autoGrow(descInput);
    descInput.addEventListener('input', () => {
      line.description = descInput.value;
      autoGrow(descInput);
      appendIfLast(index);
      markDirty();
    });
    tr.append(el('td', {}, descInput));

    // --- Qty ---
    // The trailing row is left visually empty rather than showing a default
    // "1" and "0.00", the way the desktop grid's spare row looked.
    const qtyInput = el('input', {
      type: 'text', class: 'input-num', inputmode: 'decimal',
      value: isPristine(line) ? '' : fmtQty(line.qty),
    });
    qtyInput.addEventListener('input', () => {
      line.qty = parseQty(qtyInput.value);
      appendIfLast(index);
      markDirty();
      recalcAll();
    });
    qtyInput.addEventListener('blur', () => {
      qtyInput.value = isPristine(line) ? '' : fmtQty(line.qty);
    });
    tr.append(el('td', { class: 'col-qty' }, qtyInput));

    // --- Unit price ---
    const priceInput = el('input', {
      type: 'text', class: 'input-money', inputmode: 'decimal',
      value: isPristine(line) ? '' : moneyInput(line.unitCents),
    });
    priceInput.addEventListener('input', () => {
      line.unitCents = parseMoney(priceInput.value);
      appendIfLast(index);
      markDirty();
      recalcAll();
    });
    priceInput.addEventListener('blur', () => {
      priceInput.value = isPristine(line) ? '' : moneyInput(line.unitCents);
    });
    tr.append(el('td', { class: 'col-price' }, priceInput));

    // --- Line discount ---
    const discInput = el('input', { type: 'text', class: 'input-num', inputmode: 'decimal', value: line.discountPct ? String(line.discountPct) : '' });
    discInput.addEventListener('input', () => {
      line.discountPct = parseRate(discInput.value);
      markDirty();
      recalcAll();
    });
    tr.append(el('td', { class: 'col-disc' }, discInput));

    // --- Taxable ---
    const taxBox = el('input', { type: 'checkbox', checked: line.taxable !== false });
    taxBox.addEventListener('change', () => { line.taxable = taxBox.checked; markDirty(); recalcAll(); });
    tr.append(el('td', { class: 'col-tax mid' }, taxBox));

    // --- Amount ---
    const amountCell = el('td', { class: 'col-amount num' },
      el('span', { class: 'line-amount', text: isPristine(line) ? '' : money(line.amountCents) }));
    tr.append(amountCell);

    // --- Delete ---
    tr.append(el('td', { class: 'col-act' },
      el('button', {
        class: 'line-del', type: 'button', title: T('act_remove_line'),
        'aria-label': T('act_remove_line'),
        html: '×',
        onclick: () => removeLine(index),
      }),
    ));

    // Enter anywhere in the row jumps to the next row's code cell, adding a row
    // when you are on the last one — exactly the desktop grid's behaviour.
    tr.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // Enter inside a description belongs to the description: plain Enter wraps
      // the line, which is how an IMEI gets under a model name, and Ctrl+Enter
      // is Save & Close everywhere else in the app — so the grid claims neither.
      if (e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      if (index === doc_.lines.length - 1) {
        doc_.lines.push(blankLine());
        renderLines();
      }
      focusCell(index + 1, 'code');
    });

    return tr;
  }

  function syncRow(tr, line) {
    const inputs = tr.querySelectorAll('input, textarea');
    inputs[0].value = line.code || '';
    tr.querySelector('.line-desc').value = line.description || '';
    autoGrow(tr.querySelector('.line-desc'));
    tr.querySelector('.input-num').value = fmtQty(line.qty);
    tr.querySelector('.input-money').value = moneyInput(line.unitCents);
    tr.querySelector('.col-tax input').checked = line.taxable !== false;
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  }

  function appendIfLast(index) {
    if (index === doc_.lines.length - 1) {
      doc_.lines.push(blankLine());
      tbody.append(buildLineRow(doc_.lines[doc_.lines.length - 1], doc_.lines.length - 1));
    }
  }

  /** A row the owner has not touched yet — the spare one at the bottom. */
  function isPristine(line) {
    return !line.code && !String(line.description || '').trim() && !line.unitCents;
  }

  function ensureTrailingLine() {
    const last = doc_.lines[doc_.lines.length - 1];
    if (!last || last.code || last.description || last.amountCents) doc_.lines.push(blankLine());
  }

  function removeLine(index) {
    if (doc_.lines.length <= 1) {
      doc_.lines = [blankLine()];
    } else {
      doc_.lines.splice(index, 1);
    }
    markDirty();
    renderLines();
    recalcAll();
  }

  function moveLine(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= doc_.lines.length) return;
    const [row] = doc_.lines.splice(index, 1);
    doc_.lines.splice(target, 0, row);
    focusedRow = target;
    markDirty();
    renderLines();
    focusCell(target, 'code');
  }

  function focusCell(rowIndex, which) {
    const tr = tbody.children[rowIndex];
    if (!tr) return;
    const map = { code: '.line-code', desc: '.line-desc', qty: '.input-num', price: '.input-money' };
    const node = tr.querySelector(map[which] || '.line-code');
    node?.focus();
    if (node?.select) node.select();
  }

  // =========================================================================
  // Footer: notes + totals
  // =========================================================================

  function buildFooter() {
    const notes = el('textarea', { id: 'f-notes', rows: 3 });
    notes.value = doc_.notes || '';
    notes.addEventListener('input', () => { doc_.notes = notes.value; markDirty(); });

    const privateNotes = el('textarea', { id: 'f-private', rows: 2 });
    privateNotes.value = doc_.privateNotes || '';
    privateNotes.addEventListener('input', () => { doc_.privateNotes = privateNotes.value; markDirty(); });

    const footerMsg = el('input', { type: 'text', id: 'f-footer', value: doc_.footerMessage || '' });
    footerMsg.addEventListener('input', () => { doc_.footerMessage = footerMsg.value; markDirty(); });

    const left = el('div', {},
      field('notes', notes),
      field('private_notes', privateNotes,
        `${T('private_notes_hint')}`),
      field('footer_message', footerMsg),
    );

    totalsHost = el('div', { class: 'totals-panel' });

    return el('div', { class: 'card' },
      el('div', { class: 'card-body' },
        el('div', { class: 'doc-foot' }, left, totalsHost),
      ),
    );
  }

  function refreshTotals() {
    recalc(doc_, settings);

    // This table is rebuilt from scratch on every keystroke, which would
    // otherwise pull the box out from under whoever is typing in it: focus
    // lost after a single character, and a half-typed "12." rewritten to "12"
    // the moment recalc parses it — so the next digit lands on "125". The
    // field being typed into is therefore put back exactly as it was, raw text
    // and caret included, rather than re-rendered from the parsed value.
    // Clicking a box that already reads "0.00" should replace it, not insert
    // ahead of it — otherwise typing 15.50 into shipping leaves "15.500.00".
    // Same convention as arrowing into a line cell.
    const selectOnFocus = (e) => { if (!restoringFocus) e.currentTarget.select(); };

    const active = document.activeElement;
    const typing = active && active.dataset && active.dataset.totalsField
      ? {
        field: active.dataset.totalsField,
        value: active.value,
        start: active.selectionStart,
        end: active.selectionEnd,
      }
      : null;

    // Discount: a percentage box beside the resulting amount.
    const pctInput = el('input', {
      type: 'text', class: 'input-num pct', inputmode: 'decimal',
      value: doc_.discountPct ? String(doc_.discountPct) : '',
      dataset: { totalsField: 'discount' },
      'aria-label': T('discount'),
    });
    pctInput.addEventListener('input', () => {
      doc_.discountPct = parseRate(pctInput.value);
      // This box is the only discount input on the screen, so emptying it means
      // no discount. Without this the amount recalc last worked out from the
      // percentage stays in discountCents, and recalc reads it straight back as
      // though it were a flat discount typed by hand — so the discount could be
      // raised and changed but never removed.
      if (!doc_.discountPct) doc_.discountCents = 0;
      markDirty();
      refreshTotals();
    });
    pctInput.addEventListener('focus', selectOnFocus);
    const discCell = el('td', {},
      el('div', { class: 'totals-inline' }, pctInput, el('span', { text: '%' }),
        el('span', { text: money(-doc_.discountCents) })),
    );

    const shipInput = el('input', {
      type: 'text', class: 'input-money', inputmode: 'decimal',
      value: moneyInput(doc_.shippingCents),
      dataset: { totalsField: 'shipping' },
      'aria-label': T('shipping'),
    });
    shipInput.addEventListener('input', () => { doc_.shippingCents = parseMoney(shipInput.value); markDirty(); refreshTotals(); });
    shipInput.addEventListener('blur', () => { shipInput.value = moneyInput(doc_.shippingCents); });
    shipInput.addEventListener('focus', selectOnFocus);

    const table = el('table', { class: 'totals' });
    const tb = el('tbody');

    tb.append(el('tr', {}, el('th', { html: L('subtotal') }), el('td', { text: money(doc_.subtotalCents) })));
    tb.append(el('tr', {}, el('th', { html: L('discount') }), discCell));
    tb.append(el('tr', {}, el('th', { html: L('shipping') }), el('td', {}, shipInput)));

    if (Number(settings.tax1Rate) > 0) {
      tb.append(el('tr', {},
        el('th', { html: `${esc(settings.tax1Name || T('tax'))} (${settings.tax1Rate}%)` }),
        el('td', { text: money(doc_.tax1Cents) })));
    }
    if (Number(settings.tax2Rate) > 0) {
      tb.append(el('tr', {},
        el('th', { html: `${esc(settings.tax2Name || T('tax'))} (${settings.tax2Rate}%)` }),
        el('td', { text: money(doc_.tax2Cents) })));
    }
    if (settings.taxInclusive && doc_.taxCents > 0) {
      tb.append(el('tr', {},
        el('th', { class: 'text-small text-muted', html: `${T('set_tax_inclusive')}` }),
        el('td', { class: 'text-small text-muted', text: money(doc_.taxCents) })));
    }

    tb.append(el('tr', { class: 'total-row' },
      el('th', { html: L('total') }), el('td', { text: money(doc_.totalCents) })));

    if (cfg.hasPayments) {
      tb.append(el('tr', {}, el('th', { html: L('amount_paid') }), el('td', { text: money(doc_.paidCents) })));
      tb.append(el('tr', { class: 'balance-row' },
        el('th', { html: L('balance_due') }), el('td', { text: money(doc_.balanceCents) })));
    }

    table.append(tb);

    totalsHost.innerHTML = '';
    totalsHost.append(
      el('div', { class: 'mb-1', style: 'text-align:right' }, el('span', { html: statusPill(doc_) })),
      table,
    );

    if (typing) {
      const restored = totalsHost.querySelector(`[data-totals-field="${typing.field}"]`);
      if (restored) {
        restoringFocus = true;
        restored.value = typing.value;
        restored.focus();
        try { restored.setSelectionRange(typing.start, typing.end); } catch { /* caret is a nicety */ }
        restoringFocus = false;
      }
    }

    // Keep the per-line amount cells in step.
    Array.from(tbody.children).forEach((tr, i) => {
      const cell = tr.querySelector('.line-amount');
      if (cell && doc_.lines[i]) {
        cell.textContent = isPristine(doc_.lines[i]) ? '' : money(doc_.lines[i].amountCents);
      }
    });
  }

  function recalcAll() {
    refreshTotals();
  }

  function refreshTitle() {
    const h1 = header.querySelector('h1');
    const num = doc_.number ? ` ${doc_.number}` : '';
    h1.innerHTML = `${L(cfg.titleKey)}<span class="input-mono" style="font-weight:700">${esc(num)}</span>`;
  }

  // =========================================================================
  // Toolbar
  // =========================================================================

  function buildButtons() {
    const buttons = [
      { key: 'act_save', variant: 'primary', accel: 'Ctrl+S', onClick: () => save({ stay: true }) },
      { key: 'act_save_new', onClick: () => save({ then: 'new' }) },
      { key: 'act_print', accel: 'Ctrl+P', onClick: () => doPrint() },
      { key: 'act_email', onClick: () => doEmail() },
    ];

    if (type === 'invoice') {
      buttons.push({ key: 'act_new_payment', accel: 'F8', onClick: () => goPayment() });
    }
    if (type === 'quote') {
      buttons.push({ key: 'act_convert_invoice', onClick: () => convertTo('invoice') });
      buttons.push({ key: 'act_convert_order', onClick: () => convertTo('order') });
    }
    if (type === 'order') {
      buttons.push({ key: 'act_convert_invoice', onClick: () => convertTo('invoice') });
    }

    buttons.push({ key: 'act_duplicate', onClick: () => duplicate() });
    if (!isNew) {
      buttons.push({ key: doc_.voided ? 'act_unvoid' : 'act_void', onClick: () => toggleVoid() });
      buttons.push({ key: 'act_delete', variant: 'danger', onClick: () => destroy() });
    }
    return buttons;
  }

  // =========================================================================
  // Save
  // =========================================================================

  async function resolveNumber() {
    const typed = String(doc_.number || '').trim();

    // Untouched preview, or blank: take the real next number now.
    if (!typed || (isNew && typed === counterPreview)) {
      return nextNumber(cfg.counter);
    }

    // A number the owner typed themselves. Keep it, and push the counter past
    // it so the next automatic number does not collide.
    const n = numericPart(typed);
    if (n > 0) {
      const state = await peekCounter(cfg.counter);
      if (n >= Number(state.next)) {
        await setCounter(cfg.counter, { next: n + 1 });
      }
    }
    return typed;
  }

  async function warnIfDuplicate(number) {
    try {
      const dupes = await loadAll(cfg.collection, where('number', '==', number), limit(2));
      const other = dupes.find((d) => d.id !== doc_.id);
      if (!other) return true;
      return confirmDialog(
        `Number <strong>${esc(number)}</strong> already exists. Save anyway?`,
      );
    } catch {
      return true; // never block a save because a lookup failed
    }
  }

  async function save({ stay = false, then = null } = {}) {
    // Drop the trailing blank row before validating.
    const meaningful = doc_.lines.filter((l) => l.code || String(l.description || '').trim() || l.amountCents);
    if (!meaningful.length) {
      toastKey('msg_need_line', 'warn');
      return null;
    }
    if (!doc_.customerName) {
      toastKey('msg_pick_customer', 'warn');
      $('#f-customer')?.focus();
      return null;
    }

    const saving = { ...doc_, lines: meaningful.map((l) => ({ ...l })) };

    const numberBefore = String(doc_.number || '').trim();
    saving.number = await resolveNumber();
    if (numberBefore && numberBefore !== counterPreview) {
      const ok = await warnIfDuplicate(saving.number);
      if (!ok) return null;
    }

    recalc(saving, settings);

    try {
      const id = await saveRecord(cfg.collection, doc_.id, saving);

      // Stock: only invoices move inventory, and only items flagged to track it.
      if (type === 'invoice') {
        const deltas = new Map();
        for (const [itemId, qty] of stockDeltasForDoc({ lines: originalLines }, +1)) {
          deltas.set(itemId, (deltas.get(itemId) || 0) + qty);
        }
        const outgoing = saving.voided ? { lines: [] } : saving;
        for (const [itemId, qty] of stockDeltasForDoc(outgoing, -1)) {
          deltas.set(itemId, (deltas.get(itemId) || 0) + qty);
        }
        await applyStockDeltas(deltas).catch((err) => console.warn('Stock update skipped', err));
        originalLines = saving.lines.map((l) => ({ ...l }));
      }

      // If the quote/order was converted from something, close the loop.
      if (saving.convertedFromId && saving.convertedFromType && !doc_.id) {
        const srcCfg = DOC_TYPES[saving.convertedFromType];
        await saveRecord(srcCfg.collection, saving.convertedFromId, {
          ...(await loadOne(srcCfg.collection, saving.convertedFromId)),
          status: saving.convertedFromType === 'quote' ? 'converted' : 'invoiced',
          convertedToId: id,
          convertedToType: type,
        }).catch((err) => console.warn('Could not flag source document', err));
      }

      doc_.id = id;
      doc_.number = saving.number;
      Object.assign(doc_, { ...saving, id, lines: doc_.lines });
      counterPreview = '';
      dirty = false;
      toastKey('msg_saved');
      refreshTitle();
      $('#f-number').value = doc_.number;

      if (then === 'new') { location.href = `${cfg.editPage}?new=1`; return id; }
      if (!stay) { location.href = cfg.listPage; return id; }

      // Replace the URL so a refresh lands on the saved document.
      if (!p.id) history.replaceState({}, '', `${cfg.editPage}?id=${encodeURIComponent(id)}`);
      return id;
    } catch (err) {
      console.error('Save failed', err);
      toast(`Could not save.<br><small>${esc(err.message || '')}</small>`, 'err', 7000);
      return null;
    }
  }

  // =========================================================================
  // Other actions
  // =========================================================================

  async function doPrint() {
    if (dirty || !doc_.id) {
      const id = await save({ stay: true });
      if (!id) return;
    }
    location.href = `print.html?type=${type}&id=${encodeURIComponent(doc_.id)}`;
  }

  async function doEmail() {
    if (dirty || !doc_.id) {
      const id = await save({ stay: true });
      if (!id) return;
    }
    const customer = doc_.customerId ? await findCustomer(doc_.customerId) : null;
    const to = customer?.email || '';
    const label = `${T(cfg.titleKey)} ${doc_.number}`;
    const body = [
      `${customer?.name || doc_.customerName},`,
      '',
      `Please find ${T(cfg.titleKey).toLowerCase()} ${doc_.number} for ${money(doc_.totalCents)} attached.`,
      '',
      settings.businessName || '',
    ].join('\n');
    location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(label)}&body=${encodeURIComponent(body)}`;
    toast('Open the print view and save as PDF to attach it.', 'ok', 6000);
  }

  async function goPayment() {
    if (dirty || !doc_.id) {
      const id = await save({ stay: true });
      if (!id) return;
    }
    location.href = `payment.html?new=1&invoice=${encodeURIComponent(doc_.id)}&customer=${encodeURIComponent(doc_.customerId || '')}`;
  }

  async function convertTo(targetType) {
    if (dirty || !doc_.id) {
      const id = await save({ stay: true });
      if (!id) return;
    }
    location.href = `${DOC_TYPES[targetType].editPage}?new=1&from=${encodeURIComponent(doc_.id)}&fromType=${type}`;
  }

  async function duplicate() {
    const copy = { ...doc_ };
    delete copy.id;
    sessionStorage.setItem('doc-duplicate', JSON.stringify({
      ...copy, number: '', date: today(), paidCents: 0, balanceCents: copy.totalCents,
      status: type === 'invoice' ? 'draft' : 'open', voided: false,
      convertedToId: '', convertedToType: '', convertedFromId: '', convertedFromType: '', convertedFromNumber: '',
    }));
    location.href = `${cfg.editPage}?new=1&dup=1`;
  }

  async function toggleVoid() {
    if (!doc_.voided) {
      const ok = await confirmDialog(L('msg_confirm_void'), { danger: true, okKey: 'act_void' });
      if (!ok) return;
    }
    doc_.voided = !doc_.voided;
    markDirty();
    await save({ stay: true });
    location.reload();
  }

  async function destroy() {
    const ok = await confirmDialog(
      `${L('msg_confirm_delete')}<br><strong>${esc(doc_.number)}</strong> — ${money(doc_.totalCents)}` +
      (doc_.paidCents > 0
        ? `<br><span class="text-red">This invoice has payments applied.</span>`
        : ''),
      { danger: true, okKey: 'act_delete' },
    );
    if (!ok) return;
    try {
      if (type === 'invoice' && originalLines.length) {
        await applyStockDeltas(stockDeltasForDoc({ lines: originalLines }, +1))
          .catch((err) => console.warn('Stock restore skipped', err));
      }
      const deletedId = doc_.id;
      await removeRecord(cfg.collection, deletedId);
      if (type === 'invoice' && doc_.paidCents > 0) await releasePayments(deletedId);
      dirty = false;
      toastKey('msg_deleted');
      location.href = cfg.listPage;
    } catch (err) {
      console.error(err);
      toast('Could not delete.', 'err');
    }
  }

  /**
   * Frees any payments that were applied to an invoice that has just been
   * deleted.
   *
   * Without this the allocation outlives the invoice: the payment goes on
   * reporting the money as applied, to a document that no longer exists, so it
   * shows neither against an invoice nor as the credit it has become. The money
   * itself is untouched — only the link to the dead invoice goes, which turns
   * that part of the payment back into unapplied credit, ready to put against
   * something real.
   */
  async function releasePayments(invoiceId) {
    try {
      const payments = doc_.customerId
        ? await loadAll('payments', where('customerId', '==', doc_.customerId))
        : await loadAll('payments');
      for (const payment of payments) {
        const kept = (payment.allocations || []).filter((a) => a.invoiceId !== invoiceId);
        if (kept.length === (payment.allocations || []).length) continue;
        const applied = kept.reduce((sum, a) => sum + (Number(a.amountCents) || 0), 0);
        await saveRecord('payments', payment.id, {
          ...payment,
          allocations: kept,
          appliedCents: applied,
          unappliedCents: (Number(payment.amountCents) || 0) - applied,
        });
      }
    } catch (err) {
      // The invoice is already gone; a failure here leaves a stale link, not
      // lost money, and must not present itself as a failed delete.
      console.warn('Could not release payments from the deleted invoice', err);
    }
  }

  // ---- Quick "new customer" modal -------------------------------------------

  function openQuickCustomer(prefillName, targetInput) {
    const form = el('div', {});
    const nameInput = el('input', { type: 'text', value: prefillName || '' });
    const phoneInput = el('input', { type: 'tel' });
    const emailInput = el('input', { type: 'email' });
    const addressInput = el('textarea', { rows: 2 });

    form.append(
      el('div', { class: 'modal-head', html: L('act_new_customer') }),
      el('div', { class: 'modal-body' },
        field('cust_name', nameInput),
        el('div', { class: 'grid grid-2' },
          field('cust_phone', phoneInput),
          field('cust_email', emailInput),
        ),
        field('cust_address', addressInput),
      ),
    );

    const foot = el('div', { class: 'modal-foot' },
      el('button', { class: 'btn btn-default', type: 'button', html: L('act_cancel'), onclick: () => modal.close() }),
      el('button', {
        class: 'btn btn-primary', type: 'button', html: L('act_save'),
        onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { nameInput.focus(); return; }
          const record = {
            ...blankCustomer(),
            name,
            phone: phoneInput.value.trim(),
            email: emailInput.value.trim(),
            address: addressInput.value.trim(),
          };
          record.searchBlob = customerSearchBlob(record);
          try {
            const id = await saveRecord('customers', null, record);
            const created = { id, ...record, _blob: record.searchBlob, _label: name };
            customers.push(created);
            customers.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
            invalidateStore();
            attachCustomer(doc_, created, settings);
            targetInput.value = doc_.customerName;
            $('#f-billto').value = doc_.billTo;
            markDirty();
            refreshTotals();
            modal.close();
            toastKey('msg_saved');
          } catch (err) {
            console.error(err);
            toast('Could not create customer.', 'err');
          }
        },
      }),
    );
    form.append(foot);

    const modal = openModal(form);
    setTimeout(() => nameInput.focus(), 30);
  }

  // ---- Keyboard actions ------------------------------------------------------
  onAction('save', () => save({ stay: true }));
  onAction('saveNew', () => save({ then: 'new' }));
  onAction('saveClose', () => save({ stay: false }));
  onAction('print', () => doPrint());
  onAction('insertLine', () => {
    doc_.lines.splice(focusedRow + 1, 0, blankLine());
    markDirty();
    renderLines();
    focusCell(focusedRow + 1, 'code');
  });
  onAction('deleteLine', () => removeLine(focusedRow));
  onAction('moveLineUp', () => moveLine(focusedRow, -1));
  onAction('moveLineDown', () => moveLine(focusedRow, +1));

  // Focus the customer field on a fresh document, the way the desktop app did.
  if (isNew && !doc_.customerName) setTimeout(() => $('#f-customer')?.focus(), 60);
}
