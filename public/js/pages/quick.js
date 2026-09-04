// ---------------------------------------------------------------------------
// Quick Actions.
//
// The main app is a desk with every tool laid out. This is a single sheet of
// paper: the manager picks what they are doing, and is asked one thing at a
// time — who, what, how much — with Enter to move on and Esc to step back.
// Nothing here is a new way of doing things. Each action ends by writing the
// same record the full screens write, through the same model code, so an
// invoice made in twenty seconds at the counter is indistinguishable from one
// built in the editor.
// ---------------------------------------------------------------------------

import {
  $, el, esc, T, requireAuth, getSettings, money, moneyInput, parseMoney,
  parseQty, fmtQty, fmtDate, today, addMonths, monthStart, yearStart, loadAll,
  where, saveRecord, nextNumber, peekCounter, formatNumber, toast, byDateDesc,
} from '../app.js';
import {
  DOC_TYPES, blankDoc, blankLine, blankCustomer, blankPayment, recalc,
  attachCustomer, customerSearchBlob, autoAllocate, allocationDeltas,
  applyInvoiceDeltas, paymentTotals, stockDeltasForDoc, applyStockDeltas,
  PAYMENT_METHODS, displayStatus, statusKey,
} from '../model.js';
import {
  loadCustomers, loadItems, invalidate as invalidateStore,
} from '../store.js';
import {
  customerAutocomplete, itemAutocomplete,
} from '../components.js';

await requireAuth();
const settings = await getSettings();
document.title = `Quick Actions — ${settings.businessName || T('app_name')}`;

let customers = [];
let items = [];
try {
  [customers, items] = await Promise.all([loadCustomers(), loadItems()]);
} catch (err) {
  console.error(err);
}

// ===========================================================================
// Shell
// ===========================================================================

const root = $('#quick');
root.innerHTML = '';

const brand = settings.businessName || T('app_name');
root.append(el('div', { class: 'qa-top' },
  el('div', { class: 'qa-top-brand' },
    el('img', { src: 'img/icon-192.png', alt: '' }),
    el('span', { text: brand }),
  ),
  el('div', {},
    el('a', { href: 'dashboard.html', text: 'Open the full app' }),
  ),
));

const progress = el('div', { class: 'qa-progress' }, el('div', { style: 'width:0%' }));
const headLeft = el('span', {});
const headRight = el('span', { class: 'qa-count' });
const head = el('div', { class: 'qa-stage-head' }, headLeft, headRight);
const panelHost = el('div', {});
const stage = el('div', { class: 'qa-stage' }, progress, head, panelHost);
root.append(stage);

// ===========================================================================
// The wizard
//
// An action is a list of steps computed from its state, so a step list can
// grow (another line on an invoice) or shrink (no invoices to apply a payment
// to) as answers come in. Each step renders one control and knows how to read
// it back; the engine only moves between them.
// ===========================================================================

let run = null;   // { action, state, index }

function stepsOf() {
  return run.action.steps(run.state).filter((s) => !s.when || s.when(run.state));
}

function showMenu() {
  run = null;
  progress.firstChild.style.width = '0%';
  headLeft.textContent = 'Quick Actions';
  headRight.textContent = fmtDate(today());
  renderPanel(menuPanel(), 'forward');
}

async function start(action, preset = {}) {
  run = { action, state: action.init ? action.init(preset) : { ...preset }, index: 0 };
  // Arriving with the customer already known — from their balance screen, or
  // straight after saving their invoice — the first question has its answer.
  // Skip it, but still do whatever answering it would have done.
  const first = stepsOf()[0];
  if (first && first.kind === 'customer' && run.state.customer) {
    if (first.after) await first.after(run.state);
    run.index = 1;
  }
  renderStep('forward');
}

function renderStep(direction) {
  const steps = stepsOf();
  if (run.index >= steps.length) run.index = steps.length - 1;
  const step = steps[run.index];
  // The "done" screen is not a question, so it is not counted as one.
  const total = steps.length - (steps[steps.length - 1].kind === 'done' ? 1 : 0);
  progress.firstChild.style.width = step.kind === 'done' ? '100%' : `${Math.round(((run.index + 1) / total) * 100)}%`;
  headLeft.textContent = run.action.title;
  headRight.textContent = step.kind === 'done' ? '' : `${run.index + 1} / ${total}`;
  const view = renderers[step.kind](step, run.state);
  renderPanel(view.node, direction);
  requestAnimationFrame(() => view.focus?.());
  run.view = view;
  run.step = step;
}

function renderPanel(node, direction) {
  panelHost.innerHTML = '';
  node.classList.add('qa-panel', direction === 'back' ? 'qa-enter-back' : 'qa-enter');
  panelHost.append(node);
}

async function next() {
  const { view, step } = run;
  if (view.read) {
    const result = await view.read();
    if (result && result.error) { view.showError?.(result.error); return; }
    if (result && result.stay) return;
  }
  if (step.after) await step.after(run.state);
  // A step that changed the list of steps says where to land, since "the next
  // one along" no longer means anything once new steps have appeared before it.
  const target = step.jump ? step.jump(run.state) : null;
  if (target) { goTo(target, 'forward'); return; }
  const steps = stepsOf();
  if (run.index < steps.length - 1) { run.index += 1; renderStep('forward'); }
}

function back() {
  if (!run) return;
  if (run.index === 0 || run.step?.kind === 'done') { showMenu(); return; }
  run.index -= 1;
  renderStep('back');
}

function goTo(stepId, direction = 'back') {
  const i = stepsOf().findIndex((s) => s.id === stepId);
  if (i >= 0) { run.index = i; renderStep(direction); }
}

function finish(donePanel) {
  run.state.done = donePanel;
  run.index = stepsOf().length - 1;
  renderStep('forward');
}

// ---------------------------------------------------------------------------
// Pieces every step shares
// ---------------------------------------------------------------------------

function question(step, state) {
  const frag = [];
  const context = typeof step.context === 'function' ? step.context(state) : step.context;
  if (context) frag.push(el('div', { class: 'qa-context', text: context }));
  frag.push(el('h1', { class: 'qa-q', text: typeof step.label === 'function' ? step.label(state) : step.label }));
  const hint = typeof step.hint === 'function' ? step.hint(state) : step.hint;
  if (hint) frag.push(el('p', { class: 'qa-hint', text: hint }));
  return frag;
}

function footer({ backLabel = 'Back', nextLabel = 'Continue', showNext = true, onNext = next } = {}) {
  return el('div', { class: 'qa-actions' },
    el('button', { class: 'btn btn-default', type: 'button', onclick: () => back(),
      html: `${esc(backLabel)}<span class="qa-kbd">Esc</span>` }),
    showNext ? el('button', { class: 'btn btn-primary', type: 'button', onclick: onNext,
      html: `${esc(nextLabel)}<span class="qa-kbd">Enter ↵</span>` }) : el('span'),
  );
}

function errorLine() {
  const node = el('p', { class: 'qa-error hidden' });
  return { node, show(msg) { node.textContent = msg; node.classList.toggle('hidden', !msg); } };
}

/**
 * A column of numbered cards. Click, press the number, or arrow to one and
 * press Enter — the same three ways everywhere a choice is offered.
 */
function choiceGrid(options, onPick, { columns = 1, selected } = {}) {
  const cards = options.map((opt, i) => el('button', {
    type: 'button',
    class: 'qa-choice' + (opt.value === selected ? ' is-selected' : ''),
    onclick: () => onPick(opt.value, opt),
  },
    el('span', { class: 'qa-choice-key', text: String(i + 1) }),
    el('span', { class: 'qa-choice-body' },
      el('div', { class: 'qa-choice-title', text: opt.title }),
      opt.desc ? el('div', { class: 'qa-choice-desc', text: opt.desc }) : null),
    opt.right ? el('span', { class: 'qa-choice-right', text: opt.right }) : null,
  ));
  const grid = el('div', { class: 'qa-choices' + (columns === 2 ? ' two' : '') }, ...cards);
  grid.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= cards.length) { e.preventDefault(); cards[n - 1].click(); return; }
    const idx = cards.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); cards[Math.min(cards.length - 1, idx + 1)]?.focus(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); cards[Math.max(0, idx - 1)]?.focus(); }
  });
  grid.focusFirst = () => (cards.find((c) => c.classList.contains('is-selected')) || cards[0])?.focus();
  return grid;
}

// ---------------------------------------------------------------------------
// Renderers, one per kind of step
// ---------------------------------------------------------------------------

const renderers = {

  // A line of text.
  text(step, state) {
    const input = el('input', { type: 'text', class: 'qa-input', value: step.get(state) || '',
      placeholder: step.placeholder || '', autocomplete: 'off', inputmode: step.inputmode || null });
    const err = errorLine();
    return {
      node: el('div', {}, ...question(step, state), input, err.node, footer()),
      focus: () => { input.focus(); input.select(); },
      showError: err.show,
      read() {
        const value = input.value.trim();
        const problem = step.validate ? step.validate(value, state) : '';
        if (problem) return { error: problem };
        step.set(state, value);
        return null;
      },
    };
  },

  // Several lines of text — an address, a note.
  textarea(step, state) {
    const input = el('textarea', { class: 'qa-textarea', placeholder: step.placeholder || '' });
    input.value = step.get(state) || '';
    return {
      node: el('div', {}, ...question(step, state), input,
        el('p', { class: 'qa-hint', style: 'margin-top:8px', text: 'Enter for a new line · Ctrl+Enter to continue' }),
        footer()),
      focus: () => input.focus(),
      read() { step.set(state, input.value.trim()); return null; },
    };
  },

  // An amount of money, in the shop's currency.
  money(step, state) {
    const current = step.get(state);
    const input = el('input', { type: 'text', class: 'qa-input qa-money', inputmode: 'decimal',
      value: current ? moneyInput(current) : '', placeholder: '0.00', autocomplete: 'off' });
    const err = errorLine();
    return {
      node: el('div', {}, ...question(step, state),
        el('div', { class: 'qa-prefix' }, el('span', { text: settings.currencySymbol || '$' }), input),
        err.node, footer()),
      focus: () => { input.focus(); input.select(); },
      showError: err.show,
      read() {
        const cents = parseMoney(input.value);
        const problem = step.validate ? step.validate(cents, state) : '';
        if (problem) return { error: problem };
        step.set(state, cents);
        return null;
      },
    };
  },

  // A quantity.
  qty(step, state) {
    const input = el('input', { type: 'text', class: 'qa-input qa-money', inputmode: 'decimal',
      value: fmtQty(step.get(state) || 1), autocomplete: 'off' });
    const err = errorLine();
    return {
      node: el('div', {}, ...question(step, state), input, err.node, footer()),
      focus: () => { input.focus(); input.select(); },
      showError: err.show,
      read() {
        const qty = parseQty(input.value);
        if (!qty) return { error: 'Enter a quantity.' };
        step.set(state, qty);
        return null;
      },
    };
  },

  // One of a few options, as cards. Picking one moves on by itself.
  choice(step, state) {
    const options = typeof step.options === 'function' ? step.options(state) : step.options;
    const grid = choiceGrid(options, (value, opt) => { step.set(state, value, opt); next(); },
      { columns: step.columns, selected: step.get ? step.get(state) : undefined });
    return {
      node: el('div', {}, ...question(step, state), grid, footer({ showNext: false })),
      focus: () => grid.focusFirst(),
      keys: true,
    };
  },

  // A customer, from the list — or a new one, made on the spot.
  customer(step, state) {
    const input = el('input', { type: 'text', class: 'qa-input', autocomplete: 'off',
      placeholder: 'Start typing a name…', value: state.customer ? (state.customer.name || state.customer.company || '') : '' });
    const err = errorLine();
    let picked = state.customer || null;
    let advancing = false;

    const advance = async () => {
      if (advancing) return;
      advancing = true;
      try { await next(); } finally { advancing = false; }
    };

    const create = async (name) => {
      const record = { ...blankCustomer(), name, terms: settings.defaultTerms || '' };
      record.searchBlob = customerSearchBlob(record);
      try {
        const id = await saveRecord('customers', null, record);
        const made = { id, ...record, _blob: record.searchBlob, _label: name };
        customers = [...customers, made].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        invalidateStore();
        picked = made;
        state.customer = made;
        toast(`Added ${name}`, 'ok');
        await advance();
      } catch (e) {
        console.error(e);
        err.show('Could not add the customer.');
      }
    };

    customerAutocomplete(input, () => customers, (c) => { picked = c; state.customer = c; advance(); }, create,
      { showAllOnFocus: false });

    const node = el('div', {}, ...question(step, state), input, err.node, footer());
    return {
      node,
      focus: () => { input.focus(); input.select(); },
      showError: err.show,
      async read() {
        const typed = input.value.trim();
        if (picked && (typed === (picked.name || '') || typed === (picked.company || '') || typed === picked._label)) {
          state.customer = picked;
          return null;
        }
        if (!typed) return { error: 'Type a customer’s name.' };
        const exact = customers.find((c) => String(c.name || '').toLowerCase() === typed.toLowerCase());
        if (exact) { picked = exact; state.customer = exact; return null; }
        // Nobody by that name. Offer to add them, right here, rather than
        // sending the manager off to a different screen mid-sale.
        err.show('');
        node.querySelector('.qa-ask')?.remove();
        const ask = choiceGrid([
          { value: 'add', title: `Add “${typed}” as a new customer`, desc: 'Just the name for now. Everything else can be filled in later.' },
          { value: 'retry', title: 'No, let me try the name again' },
        ], (value) => {
          if (value === 'add') create(typed);
          else { ask.remove(); input.focus(); input.select(); }
        });
        ask.classList.add('qa-ask');
        ask.style.marginTop = '12px';
        err.node.after(ask);
        ask.focusFirst();
        return { stay: true };
      },
    };
  },

  // An item, from the catalogue or typed fresh.
  item(step, state) {
    const line = step.line(state);
    const input = el('input', { type: 'text', class: 'qa-input', autocomplete: 'off',
      placeholder: 'Model, part or service…', value: line.code || '' });
    const err = errorLine();
    let advancing = false;
    const advance = async () => { if (advancing) return; advancing = true; try { await next(); } finally { advancing = false; } };

    itemAutocomplete(input, () => items, (item) => {
      line.itemId = item.id;
      line.code = item.code || '';
      if (!line.description) line.description = item.description || '';
      line.unitCents = Math.round(Number(item.priceCents) || 0);
      line.taxable = item.taxable !== false;
      advance();
    }, { showAllOnFocus: false });

    return {
      node: el('div', {}, ...question(step, state), input, err.node, footer()),
      focus: () => { input.focus(); input.select(); },
      showError: err.show,
      read() {
        const typed = input.value.trim();
        if (!typed) return { error: 'Type what is being sold.' };
        if (line.code !== typed) {
          // Typed, not picked: a fresh line with no catalogue link.
          const match = items.find((i) => String(i.code || '').toLowerCase() === typed.toLowerCase());
          if (match) {
            line.itemId = match.id; line.code = match.code || '';
            if (!line.description) line.description = match.description || '';
            line.unitCents = Math.round(Number(match.priceCents) || 0);
            line.taxable = match.taxable !== false;
          } else {
            line.itemId = ''; line.code = typed;
          }
        }
        return null;
      },
    };
  },

  // Look at everything before it is written.
  review(step, state) {
    const rows = step.rows(state);
    const list = el('div', { class: 'qa-review' });
    for (const row of rows) {
      list.append(el('div', { class: 'qa-review-row' + (row.total ? ' qa-total-row' : '') },
        el('div', { class: 'qa-review-label', text: row.label }),
        row.node
          ? el('div', { class: 'qa-review-value' }, row.node)
          : el('div', { class: 'qa-review-value', html: row.html || `<strong>${esc(row.value)}</strong>` }),
        row.step ? el('button', { class: 'qa-review-edit', type: 'button', text: 'Change', onclick: () => goTo(row.step) }) : el('span'),
      ));
    }
    const err = errorLine();
    let saving = false;
    const confirm = async () => {
      if (saving) return;
      saving = true;
      const btn = node.querySelector('.btn-primary');
      const label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="qa-spinner"></span>Saving…';
      try {
        const done = await step.commit(state);
        finish(done);
      } catch (e) {
        console.error(e);
        err.show(`Could not save. ${e.message || ''}`.trim());
        btn.disabled = false;
        btn.innerHTML = label;
      } finally { saving = false; }
    };
    const node = el('div', {}, ...question(step, state), list, err.node,
      footer({ nextLabel: step.confirmLabel || 'Save', onNext: confirm }));
    return {
      node,
      focus: () => node.querySelector('.btn-primary')?.focus(),
      read: async () => { await confirm(); return { stay: true }; },
    };
  },

  // The end of an action: what was made, and what to do next.
  done(step, state) {
    const d = state.done || {};
    const buttons = (d.next || []).map((b, i) => el('button', {
      type: 'button', class: 'btn ' + (i === 0 ? 'btn-primary' : 'btn-default'),
      onclick: b.onClick, html: esc(b.label),
    }));
    const node = el('div', {},
      el('div', { class: 'qa-done' },
        el('div', { class: 'qa-done-mark', html: '✓' }),
        el('h2', { text: d.title || 'Done' }),
        d.big ? el('div', { class: 'qa-done-big', text: d.big }) : null,
        d.text ? el('p', { text: d.text }) : null,
      ),
      el('div', { class: 'qa-next' }, ...buttons,
        el('button', { type: 'button', class: 'btn btn-default', text: 'Back to Quick Actions', onclick: () => showMenu() })),
    );
    return { node, focus: () => node.querySelector('.btn-primary')?.focus() };
  },

  // A read-only answer: a customer's position, in one glance.
  lookup(step, state) {
    const body = el('div', {}, el('p', { class: 'qa-hint' }, el('span', { class: 'qa-spinner' }), 'Looking…'));
    const node = el('div', {}, ...question(step, state), body, footer({ showNext: false }));
    step.load(state).then((content) => { body.innerHTML = ''; body.append(content); })
      .catch((e) => { console.error(e); body.innerHTML = `<p class="qa-error">${esc(e.message || 'Could not load.')}</p>`; });
    return { node, focus: () => node.querySelector('.btn')?.focus() };
  },
};

// ===========================================================================
// Line items, shared by invoices and quotes
// ===========================================================================

function newLine() {
  return { ...blankLine(), qty: 1, unitCents: 0, taxable: true };
}

function meaningfulLines(state) {
  return state.lines.filter((l) => l.code || String(l.description || '').trim() || l.unitCents);
}

function lineSteps(state) {
  const out = [];
  state.lines.forEach((line, i) => {
    const n = state.lines.length > 1 ? `Item ${i + 1}` : '';
    out.push(
      { id: `item:${i}`, kind: 'item', label: i === 0 ? 'What are they buying?' : 'And what else?',
        hint: 'Pick from the catalogue, or type anything.', context: n, line: () => state.lines[i] },
      { id: `desc:${i}`, kind: 'text', label: 'Description — IMEI, serial, colour',
        hint: 'This prints on the invoice under the item. Leave it as it is if nothing needs adding.',
        context: () => state.lines[i].code, placeholder: 'imei:35…',
        get: () => state.lines[i].description, set: (s, v) => { s.lines[i].description = v; } },
      { id: `qty:${i}`, kind: 'qty', label: 'How many?', context: () => state.lines[i].code,
        get: () => state.lines[i].qty, set: (s, v) => { s.lines[i].qty = v; } },
      { id: `price:${i}`, kind: 'money', label: 'Price each', context: () => state.lines[i].code,
        hint: (s) => (s.lines[i].itemId ? 'Taken from the catalogue. Change it if this sale is different.' : ''),
        get: () => state.lines[i].unitCents, set: (s, v) => { s.lines[i].unitCents = v; },
        validate: (cents) => (cents > 0 ? '' : 'Enter a price.') },
    );
  });
  out.push({
    id: 'more', kind: 'choice', label: 'Anything else on this one?',
    hint: (s) => {
      const doc = previewDoc(s);
      return `${meaningfulLines(s).length} item${meaningfulLines(s).length === 1 ? '' : 's'} so far · ${money(doc.subtotalCents)} before tax`;
    },
    options: [
      { value: 'done', title: 'No, that’s everything', desc: 'Go to the summary and save.' },
      { value: 'more', title: 'Add another item', desc: 'One more line on the same document.' },
    ],
    set: (s, v) => { s.moreChoice = v; if (v === 'more') s.lines.push(newLine()); },
    jump: (s) => (s.moreChoice === 'more' ? `item:${s.lines.length - 1}` : null),
  });
  return out;
}

function previewDoc(state) {
  const doc = blankDoc(state.type, settings);
  if (state.customer) attachCustomer(doc, state.customer, settings);
  doc.lines = meaningfulLines(state).map((l) => ({ ...blankLine(), ...l }));
  recalc(doc, settings);
  return doc;
}

function linesTable(doc) {
  const table = el('table', { class: 'qa-lines' });
  for (const l of doc.lines) {
    table.append(el('tr', {},
      el('td', { html: `<strong>${esc(l.code || l.description || '—')}</strong>`
        + (l.code && l.description ? `<div class="muted">${esc(l.description)}</div>` : '') }),
      el('td', { class: 'n', text: `${fmtQty(l.qty)} × ${money(l.unitCents)}` }),
      el('td', { class: 'n', html: `<strong>${esc(money(l.amountCents))}</strong>` }),
    ));
  }
  return table;
}

function documentReviewRows(state) {
  const doc = previewDoc(state);
  const rows = [
    { label: 'Customer', value: doc.customerName, step: 'customer' },
    { label: 'Items', node: linesTable(doc), step: 'item:0' },
  ];
  if (doc.taxCents) rows.push({ label: settings.tax1Name || T('tax'), html: money(doc.taxCents) });
  rows.push({ label: T('total'), html: money(doc.totalCents), total: true });
  return rows;
}

async function saveDocument(state) {
  const cfg = DOC_TYPES[state.type];
  const doc = previewDoc(state);
  if (!doc.lines.length) throw new Error('There is nothing on it.');
  doc.status = state.type === 'invoice' ? 'sent' : 'open';
  doc.number = await nextNumber(cfg.counter);
  recalc(doc, settings);
  const id = await saveRecord(cfg.collection, null, doc);
  if (state.type === 'invoice') {
    await applyStockDeltas(stockDeltasForDoc(doc, -1)).catch((e) => console.warn('Stock update skipped', e));
  }
  return { id, doc };
}

async function nextNumberPreview(counter) {
  try {
    const c = await peekCounter(counter);
    return formatNumber(Number(c.next) || 1, c.prefix, c.padding);
  } catch { return ''; }
}

// ===========================================================================
// Customer data for payments and look-ups
// ===========================================================================

const live = (inv) => !inv.voided && inv.status !== 'draft';

async function loadCustomerBooks(customerId) {
  const [invoices, payments] = await Promise.all([
    loadAll('invoices', where('customerId', '==', customerId)),
    loadAll('payments', where('customerId', '==', customerId)),
  ]);
  const open = invoices.filter((i) => live(i) && (Number(i.balanceCents) || 0) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { invoices: byDateDesc(invoices), payments: byDateDesc(payments), open };
}

// ===========================================================================
// The actions
// ===========================================================================

function documentAction(type) {
  const isInvoice = type === 'invoice';
  const noun = isInvoice ? 'invoice' : 'quote';
  return {
    id: isInvoice ? 'invoice' : 'quote',
    title: isInvoice ? 'New Invoice' : 'New Quote',
    icon: isInvoice ? '▤' : '◇',
    blurb: isInvoice ? 'A sale, ready to print or pay.' : 'A price for a customer to think about.',
    init: (preset) => ({ type, customer: preset.customer || null, lines: [newLine()] }),
    steps: (state) => [
      { id: 'customer', kind: 'customer', label: `Who is this ${noun} for?`,
        hint: 'Pick a customer. If they are new, type their name and add them.' },
      ...lineSteps(state),
      { id: 'review', kind: 'review', label: 'Everything right?',
        hint: (s) => (s.numberPreview ? `This will be ${noun} #${s.numberPreview}.` : ''),
        rows: documentReviewRows, confirmLabel: isInvoice ? 'Save invoice' : 'Save quote',
        commit: async (s) => {
          const { id, doc } = await saveDocument(s);
          const customer = s.customer;
          return {
            title: `${isInvoice ? 'Invoice' : 'Quote'} #${doc.number} saved`,
            big: money(doc.totalCents),
            text: `for ${doc.customerName}`,
            next: [
              { label: `Print ${noun}`, onClick: () => window.open(`print.html?type=${type}&id=${encodeURIComponent(id)}`, '_blank') },
              isInvoice
                ? { label: 'Record a payment on it now', onClick: () => start(ACTIONS.payment, { customer, invoiceId: id }) }
                : { label: 'Open it in the full app', onClick: () => { location.href = `quote.html?id=${encodeURIComponent(id)}`; } },
              { label: `Another ${noun} for ${customer.name || customer.company || 'them'}`, onClick: () => start(ACTIONS[isInvoice ? 'invoice' : 'quote'], { customer }) },
            ],
          };
        } },
      { id: 'done', kind: 'done' },
    ],
  };
}

const ACTIONS = {};

ACTIONS.invoice = documentAction('invoice');
ACTIONS.quote = documentAction('quote');

ACTIONS.payment = {
  id: 'payment',
  title: 'Record Payment',
  icon: '⛁',
  blurb: 'Money in, put against what they owe.',
  init: (preset) => ({ customer: preset.customer || null, invoiceId: preset.invoiceId || '', amountCents: 0, method: 'cash', applyTo: 'auto', books: null }),
  steps: (state) => [
    { id: 'customer', kind: 'customer', label: 'Who is paying?',
      after: async (s) => { s.books = await loadCustomerBooks(s.customer.id); } },
    { id: 'amount', kind: 'money', label: 'How much did they pay?',
      hint: (s) => {
        if (!s.books) return '';
        const owed = s.books.open.reduce((t, i) => t + (Number(i.balanceCents) || 0), 0);
        return owed ? `They owe ${money(owed)} across ${s.books.open.length} invoice${s.books.open.length === 1 ? '' : 's'}.` : 'They have no open invoices — this will be kept as credit.';
      },
      get: (s) => s.amountCents, set: (s, v) => { s.amountCents = v; },
      validate: (cents) => (cents > 0 ? '' : 'Enter the amount received.') },
    { id: 'method', kind: 'choice', label: 'How did they pay?', columns: 2,
      options: PAYMENT_METHODS.map((m) => ({ value: m.value, title: T(m.key) })),
      get: (s) => s.method, set: (s, v) => { s.method = v; } },
    { id: 'apply', kind: 'choice', label: 'Put it against which invoice?',
      when: (s) => s.books && s.books.open.length > 0,
      hint: (s) => (s.books.open.length > 1 ? 'Oldest first is how the shop has always done it.' : ''),
      options: (s) => {
        const opts = [];
        if (s.books.open.length > 1) {
          const spread = autoAllocate(s.amountCents, s.books.open);
          opts.push({ value: 'auto', title: 'Oldest invoices first',
            desc: spread.map((a) => `#${a.invoiceNumber} ${money(a.amountCents)}`).join(' · ') || 'Nothing to apply' });
        }
        for (const inv of s.books.open.slice(0, 8)) {
          opts.push({ value: inv.id, title: `Invoice #${inv.number}`,
            desc: `${fmtDate(inv.date)} · ${T(statusKey(displayStatus(inv)))}`,
            right: money(inv.balanceCents) });
        }
        opts.push({ value: 'none', title: 'Keep it as credit', desc: 'Apply it to an invoice later.' });
        return opts;
      },
      get: (s) => (s.invoiceId && s.books.open.some((i) => i.id === s.invoiceId) ? s.invoiceId : s.applyTo),
      set: (s, v) => { s.applyTo = v; } },
    { id: 'review', kind: 'review', label: 'Everything right?', confirmLabel: 'Save payment',
      rows: (s) => {
        const allocations = plannedAllocations(s);
        const applied = allocations.reduce((t, a) => t + a.amountCents, 0);
        return [
          { label: 'Customer', value: s.customer.name || s.customer.company || '', step: 'customer' },
          { label: 'Amount', value: money(s.amountCents), step: 'amount' },
          { label: 'Method', value: T(PAYMENT_METHODS.find((m) => m.value === s.method)?.key || 'pay_other'), step: 'method' },
          { label: 'Applied to',
            html: allocations.length
              ? allocations.map((a) => `<strong>#${esc(a.invoiceNumber)}</strong> ${esc(money(a.amountCents))}`).join('<br>')
                + (applied < s.amountCents ? `<br><span class="text-muted">${esc(money(s.amountCents - applied))} kept as credit</span>` : '')
              : '<span class="text-muted">Kept as credit</span>',
            step: s.books && s.books.open.length ? 'apply' : undefined },
        ];
      },
      commit: async (s) => {
        const allocations = plannedAllocations(s);
        const payment = {
          ...blankPayment(),
          customerId: s.customer.id,
          customerName: s.customer.name || s.customer.company || '',
          method: s.method,
          amountCents: s.amountCents,
          allocations,
        };
        Object.assign(payment, paymentTotals(payment));
        payment.number = await nextNumber('payment');
        // Invoices first, then the record — the same order as the payment
        // screen, for the same reason: a payment that never reached its
        // invoices would be worse than a retry.
        await applyInvoiceDeltas(allocationDeltas(null, payment), settings);
        const id = await saveRecord('payments', null, payment);
        const customer = s.customer;
        return {
          title: `Payment #${payment.number} recorded`,
          big: money(payment.amountCents),
          text: `from ${payment.customerName}${payment.unappliedCents > 0 ? ` · ${money(payment.unappliedCents)} kept as credit` : ''}`,
          next: [
            { label: 'Print receipt', onClick: () => window.open(`print.html?type=payment&id=${encodeURIComponent(id)}`, '_blank') },
            { label: `See what ${customer.name || 'they'} still owe${customer.name ? 's' : ''}`, onClick: () => start(ACTIONS.balance, { customer }) },
            { label: 'Another payment', onClick: () => start(ACTIONS.payment) },
          ],
        };
      } },
    { id: 'done', kind: 'done' },
  ],
};

function plannedAllocations(s) {
  if (!s.books || !s.books.open.length || s.applyTo === 'none') return [];
  const target = s.invoiceId && s.applyTo === 'auto' && s.books.open.some((i) => i.id === s.invoiceId)
    ? s.invoiceId : s.applyTo;
  if (target === 'auto') return autoAllocate(s.amountCents, s.books.open);
  const inv = s.books.open.find((i) => i.id === target);
  if (!inv) return autoAllocate(s.amountCents, s.books.open);
  const take = Math.min(s.amountCents, Math.max(0, Number(inv.balanceCents) || 0));
  return take > 0 ? [{ invoiceId: inv.id, invoiceNumber: inv.number, amountCents: take }] : [];
}

ACTIONS.customer = {
  id: 'customer',
  title: 'New Customer',
  icon: '☺',
  blurb: 'Name, phone and address — thirty seconds.',
  init: () => ({ name: '', phone: '', address: '', terms: settings.defaultTerms || 'Net 30' }),
  steps: () => [
    { id: 'name', kind: 'text', label: 'What is the customer’s name?', placeholder: 'First and last name',
      get: (s) => s.name, set: (s, v) => { s.name = v; },
      validate: (v) => (v ? '' : 'A name is the one thing a customer has to have.') },
    { id: 'phone', kind: 'text', label: 'Phone number', hint: 'Skip it if you do not have one.',
      inputmode: 'tel', placeholder: '519 …', get: (s) => s.phone, set: (s, v) => { s.phone = v; } },
    { id: 'address', kind: 'textarea', label: 'Address', hint: 'As it should print on the invoice.',
      get: (s) => s.address, set: (s, v) => { s.address = v; } },
    { id: 'terms', kind: 'choice', label: 'Payment terms', columns: 2,
      options: [
        { value: 'Due on receipt', title: 'Due on receipt' },
        { value: 'Net 15', title: 'Net 15' },
        { value: 'Net 30', title: 'Net 30' },
        { value: 'Net 60', title: 'Net 60' },
      ],
      get: (s) => s.terms, set: (s, v) => { s.terms = v; } },
    { id: 'review', kind: 'review', label: 'Everything right?', confirmLabel: 'Save customer',
      rows: (s) => [
        { label: 'Name', value: s.name, step: 'name' },
        { label: 'Phone', value: s.phone || '—', step: 'phone' },
        { label: 'Address', value: s.address || '—', step: 'address' },
        { label: 'Terms', value: s.terms, step: 'terms' },
      ],
      commit: async (s) => {
        const record = { ...blankCustomer(), name: s.name, phone: s.phone, address: s.address, terms: s.terms };
        record.searchBlob = customerSearchBlob(record);
        const id = await saveRecord('customers', null, record);
        const made = { id, ...record, _blob: record.searchBlob, _label: s.name };
        customers = [...customers, made].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        invalidateStore();
        return {
          title: 'Customer added',
          big: s.name,
          text: s.phone || '',
          next: [
            { label: `New invoice for ${s.name}`, onClick: () => start(ACTIONS.invoice, { customer: made }) },
            { label: 'Another customer', onClick: () => start(ACTIONS.customer) },
          ],
        };
      } },
    { id: 'done', kind: 'done' },
  ],
};

ACTIONS.balance = {
  id: 'balance',
  title: 'What Do They Owe?',
  icon: '◪',
  blurb: 'A customer’s balance and open invoices, at a glance.',
  init: (preset) => ({ customer: preset.customer || null }),
  steps: () => [
    { id: 'customer', kind: 'customer', label: 'Which customer?' },
    { id: 'result', kind: 'lookup', label: (s) => s.customer.name || s.customer.company || '',
      load: async (s) => {
        const books = await loadCustomerBooks(s.customer.id);
        const owed = books.open.reduce((t, i) => t + (Number(i.balanceCents) || 0), 0);
        const paidIn = books.payments.reduce((t, p) => t + (Number(p.amountCents) || 0), 0);
        const applied = books.payments.reduce((t, p) => t + (p.allocations || []).reduce((u, a) => u + (Number(a.amountCents) || 0), 0), 0);
        const credit = paidIn - applied;
        const lastPay = books.payments.find((p) => (Number(p.amountCents) || 0) > 0);
        const wrap = el('div', {});
        wrap.append(el('div', { class: 'qa-stats' },
          el('div', { class: 'qa-stat' + (owed > 0 ? ' warn' : ' good') },
            el('div', { class: 'qa-stat-label', text: 'Owes' }),
            el('div', { class: 'qa-stat-value', text: money(owed) })),
          el('div', { class: 'qa-stat' + (credit > 0 ? ' good' : '') },
            el('div', { class: 'qa-stat-label', text: 'Credit' }),
            el('div', { class: 'qa-stat-value', text: money(credit) })),
          el('div', { class: 'qa-stat' },
            el('div', { class: 'qa-stat-label', text: 'Last payment' }),
            el('div', { class: 'qa-stat-value', style: 'font-size:16px',
              text: lastPay ? `${fmtDate(lastPay.date)} · ${money(lastPay.amountCents)}` : 'Never' })),
        ));
        if (books.open.length) {
          const table = el('table', { class: 'qa-lines' });
          for (const inv of books.open) {
            table.append(el('tr', {},
              el('td', { html: `<strong>#${esc(inv.number)}</strong> <span class="muted">${esc(fmtDate(inv.date))} · ${esc(T(statusKey(displayStatus(inv))))}</span>` }),
              el('td', { class: 'n', text: money(inv.totalCents) }),
              el('td', { class: 'n', html: `<strong>${esc(money(inv.balanceCents))}</strong>` }),
            ));
          }
          wrap.append(el('div', { class: 'qa-review' }, el('div', { class: 'qa-review-row' }, el('div', { class: 'qa-review-value' }, table))));
        } else {
          wrap.append(el('p', { class: 'qa-hint', text: 'No open invoices. Nothing owed.' }));
        }
        const customer = s.customer;
        wrap.append(el('div', { class: 'qa-next' },
          owed > 0 ? el('button', { type: 'button', class: 'btn btn-primary', text: 'Record a payment', onclick: () => start(ACTIONS.payment, { customer }) }) : null,
          el('button', { type: 'button', class: 'btn btn-default', text: 'Print a statement', onclick: () => start(ACTIONS.statement, { customer }) }),
          el('button', { type: 'button', class: 'btn btn-default', text: 'New invoice', onclick: () => start(ACTIONS.invoice, { customer }) }),
        ));
        return wrap;
      } },
  ],
};

ACTIONS.statement = {
  id: 'statement',
  title: 'Print Statement',
  icon: '☰',
  blurb: 'Everything a customer was charged and paid.',
  init: (preset) => ({ customer: preset.customer || null, period: 'year' }),
  steps: () => [
    { id: 'customer', kind: 'customer', label: 'Whose statement?' },
    { id: 'period', kind: 'choice', label: 'For what period?', columns: 2,
      options: [
        { value: 'month', title: 'This month', desc: `Since ${fmtDate(monthStart())}` },
        { value: 'quarter', title: 'Last 3 months', desc: `Since ${fmtDate(addMonths(today(), -3))}` },
        { value: 'year', title: 'This year', desc: `Since ${fmtDate(yearStart())}` },
        { value: 'all', title: 'Everything', desc: 'The whole history' },
      ],
      get: (s) => s.period,
      set: (s, v) => {
        s.period = v;
        const from = { month: monthStart(), quarter: addMonths(today(), -3), year: yearStart(), all: '2000-01-01' }[v];
        const url = `print.html?type=statement&customer=${encodeURIComponent(s.customer.id)}&from=${from}&to=${today()}`;
        window.open(url, '_blank');
        s.done = {
          title: 'Statement opened',
          text: 'It is in a new tab, ready to print.',
          next: [
            { label: 'Open it again', onClick: () => window.open(url, '_blank') },
            { label: `Record a payment from ${s.customer.name || 'them'}`, onClick: () => start(ACTIONS.payment, { customer: s.customer }) },
          ],
        };
      } },
    { id: 'done', kind: 'done' },
  ],
};

const MENU = [ACTIONS.invoice, ACTIONS.payment, ACTIONS.customer, ACTIONS.quote, ACTIONS.balance, ACTIONS.statement];

function menuPanel() {
  const cards = MENU.map((a, i) => el('button', { type: 'button', class: 'qa-action', onclick: () => start(a) },
    el('div', { class: 'qa-action-top' },
      el('span', { class: 'qa-action-icon', html: a.icon }),
      el('span', { class: 'qa-choice-key', text: String(i + 1) })),
    el('div', { class: 'qa-action-title', text: a.title }),
    el('div', { class: 'qa-action-desc', text: a.blurb }),
  ));
  const node = el('div', {},
    el('h1', { class: 'qa-q', text: 'What are you doing?' }),
    el('p', { class: 'qa-hint', text: 'Pick one. You will be asked one thing at a time.' }),
    el('div', { class: 'qa-menu' }, ...cards),
  );
  node.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= cards.length && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
      e.preventDefault(); cards[n - 1].click();
    }
  });
  requestAnimationFrame(() => cards[0].focus());
  return node;
}

// ===========================================================================
// Keyboard: Enter moves on, Esc steps back. Everywhere.
// ===========================================================================

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.ac-list.is-open')) return;   // the dropdown closes itself first
    e.preventDefault();
    back();
    return;
  }
  if (e.key !== 'Enter' || !run || e.defaultPrevented) return;
  const tag = document.activeElement?.tagName || '';
  if (tag === 'BUTTON' || tag === 'A') return;                 // the button handles itself
  if (tag === 'TEXTAREA' && !e.ctrlKey) return;               // Enter wraps; Ctrl+Enter continues
  if (run.view?.keys) return;                                 // choice cards have their own keys
  e.preventDefault();
  next();
});

showMenu();
