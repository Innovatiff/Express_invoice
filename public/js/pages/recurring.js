import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle, money, fmtDate,
  today, addDays, loadAll, loadOne, saveRecord, removeRecord, nextNumber,
  orderBy, where, onAction, toast, toastKey, confirmDialog, openModal,
  spinner,
} from '../app.js';
import {
  blankDoc, recalc, advanceDate, FREQUENCIES, stockDeltasForDoc,
  applyStockDeltas,
} from '../model.js';
import {
  loadCustomers,
} from '../store.js';
import {
  dataTable, selectEl, field, card, customerAutocomplete,
} from '../components.js';

setPageTitle('nav_recurring');
const { settings } = await initShell('recurring.html');

const page = $('#page');

page.append(pageHeader('nav_recurring', [
  { key: 'act_new', variant: 'primary', onClick: () => openEditor(null) },
  { key: 'rec_generate_now', onClick: () => generateDue() },
]));

const listHost = el('div', {});
page.append(el('div', { class: 'card' }, listHost));
page.append(el('p', { class: 'text-small text-muted', html:
  'A recurring template never bills on its own — you decide when to generate.' }));

let templates = [];
let customers = [];

await reload();

async function reload() {
  listHost.innerHTML = '';
  listHost.append(spinner());
  try {
    [templates, customers] = await Promise.all([
      loadAll('recurring', orderBy('nextDate')),
      loadCustomers(),
    ]);
  } catch (err) {
    console.error(err);
    toast('Could not load.', 'err');
    templates = [];
  }
  render();
}

function freqLabel(value) {
  const f = FREQUENCIES.find((x) => x.value === value);
  return f ? T(f.key) : (value || '');
}

function isDue(t) {
  return t.active !== false && t.nextDate && t.nextDate <= today();
}

function render() {
  listHost.innerHTML = '';
  listHost.append(dataTable({
    columns: [
      { key: 'customerName', labelKey: 'customer', sortable: false,
        html: (t) => `<strong>${esc(t.customerName || '—')}</strong>` +
          (t.description ? `<span class="cell-sub">${esc(t.description)}</span>` : '') },
      { key: 'frequency', labelKey: 'rec_frequency', className: 'nowrap', sortable: false,
        html: (t) => esc(freqLabel(t.frequency)) },
      { key: 'nextDate', labelKey: 'rec_next_date', className: 'nowrap', sortable: false,
        html: (t) => `${esc(fmtDate(t.nextDate))}` +
          (isDue(t) ? ' <span class="pill pill-overdue">Due</span>' : '') },
      { key: 'endDate', labelKey: 'rec_end_date', className: 'nowrap cell-muted', sortable: false,
        html: (t) => (t.endDate ? esc(fmtDate(t.endDate)) : `<span class="cell-muted">${T('never')}</span>`) },
      { key: 'total', labelKey: 'total', className: 'num', sortable: false,
        html: (t) => esc(money(t.template?.totalCents || 0)) },
      { key: 'active', labelKey: 'rec_active', className: 'nowrap', sortable: false,
        html: (t) => (t.active !== false
          ? `<span class="pill pill-paid">${L('rec_active')}</span>`
          : `<span class="pill pill-void">${L('st_cancelled')}</span>`) },
      { key: 'actions', label: '', className: 'col-narrow', sortable: false,
        html: () => `<span class="text-small text-muted">${T('act_edit')}</span>` },
    ],
    rows: templates,
    onRowClick: (t) => openEditor(t),
    emptyKey: 'msg_empty_list',
  }));
}

// ---------------------------------------------------------------------------
// Editor
//
// A template holds a whole invoice inside it. Rather than rebuild the line grid
// here, the template is seeded from an existing invoice: pick one, and its
// lines, totals and notes become the recurring shape.
// ---------------------------------------------------------------------------

async function openEditor(existing) {
  const record = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
      customerId: '', customerName: '', description: '',
      frequency: 'monthly', nextDate: today(), endDate: '', active: true,
      template: null, sourceInvoiceId: '', generatedCount: 0, lastGenerated: '',
    };

  const customerInput = el('input', { type: 'text', value: record.customerName || '' });
  const descriptionInput = el('input', { type: 'text', value: record.description || '' });
  const freqSelect = selectEl(FREQUENCIES.map((f) => ({
    value: f.value, labelKey: f.key, selected: record.frequency === f.value,
  })));
  const nextInput = el('input', { type: 'date', value: record.nextDate || today() });
  const endInput = el('input', { type: 'date', value: record.endDate || '' });
  const activeBox = el('input', { type: 'checkbox', checked: record.active !== false });

  const sourceHost = el('div', { class: 'field' });
  const sourceLabel = el('div', { class: 'text-small' });
  const sourceSelect = el('select', {});

  sourceHost.append(
    el('label', { class: 'field-label', html:
      'Based on invoice' }),
    sourceSelect,
    sourceLabel,
  );

  customerAutocomplete(customerInput, () => customers, async (c) => {
    record.customerId = c.id;
    record.customerName = c.name || c.company || '';
    await fillSourceInvoices();
  });

  async function fillSourceInvoices() {
    sourceSelect.innerHTML = '';
    sourceLabel.textContent = '';
    if (!record.customerId) {
      sourceSelect.append(el('option', { value: '' }, T('msg_pick_customer')));
      return;
    }
    const invoices = await loadAll('invoices',
      where('customerId', '==', record.customerId), orderBy('date', 'desc'));
    if (!invoices.length) {
      sourceSelect.append(el('option', { value: '' }, T('msg_empty_list')));
      return;
    }
    sourceSelect.append(el('option', { value: '' }, `— ${T('act_select')} —`));
    for (const inv of invoices.slice(0, 50)) {
      sourceSelect.append(el('option', {
        value: inv.id,
        selected: inv.id === record.sourceInvoiceId,
      }, `${inv.number} · ${fmtDate(inv.date)} · ${money(inv.totalCents)}`));
    }
    if (record.template) {
      sourceLabel.innerHTML =
        `<strong>${(record.template.lines || []).length}</strong> ${T('line_item')} · ` +
        `<strong>${esc(money(record.template.totalCents || 0))}</strong>`;
    }
  }

  sourceSelect.addEventListener('change', async () => {
    const id = sourceSelect.value;
    if (!id) { record.template = null; record.sourceInvoiceId = ''; sourceLabel.textContent = ''; return; }
    const invoice = await loadOne('invoices', id);
    if (!invoice) return;
    record.sourceInvoiceId = id;
    record.template = {
      lines: (invoice.lines || []).map((l) => ({ ...l })),
      billTo: invoice.billTo, shipTo: invoice.shipTo, terms: invoice.terms,
      salesPerson: invoice.salesPerson, notes: invoice.notes,
      footerMessage: invoice.footerMessage, privateNotes: invoice.privateNotes,
      discountPct: invoice.discountPct, discountCents: invoice.discountCents,
      shippingCents: invoice.shippingCents, shippingTaxable: invoice.shippingTaxable,
      taxExempt: invoice.taxExempt, currencyCode: invoice.currencyCode,
      totalCents: invoice.totalCents,
    };
    sourceLabel.innerHTML =
      `<strong>${(record.template.lines || []).length}</strong> ${T('line_item')} · ` +
      `<strong>${esc(money(record.template.totalCents || 0))}</strong>`;
  });

  const body = el('div', {},
    el('div', { class: 'modal-head', html: L('nav_recurring') }),
    el('div', { class: 'modal-body' },
      field('customer', customerInput),
      field('line_description', descriptionInput),
      sourceHost,
      el('div', { class: 'grid grid-2' },
        field('rec_frequency', freqSelect),
        field('rec_next_date', nextInput),
      ),
      el('div', { class: 'grid grid-2' },
        field('rec_end_date', endInput),
        el('div', { class: 'field' },
          el('label', { class: 'field-label', html: L('rec_active') }),
          el('label', { class: 'check' }, activeBox, el('span', { html: L('rec_active') })),
        ),
      ),
    ),
    el('div', { class: 'modal-foot' },
      existing ? el('button', {
        class: 'btn btn-danger', type: 'button', html: L('act_delete'),
        onclick: async () => {
          const ok = await confirmDialog(L('msg_confirm_delete'), { danger: true, okKey: 'act_delete' });
          if (!ok) return;
          await removeRecord('recurring', existing.id);
          modal.close();
          toastKey('msg_deleted');
          reload();
        },
      }) : null,
      el('div', { style: 'flex:1' }),
      el('button', { class: 'btn btn-default', type: 'button', html: L('act_cancel'), onclick: () => modal.close() }),
      el('button', {
        class: 'btn btn-primary', type: 'button', html: L('act_save'),
        onclick: async () => {
          if (!record.customerId) { toast(T('msg_pick_customer'), 'warn'); return; }
          if (!record.template) {
            toast('Pick a source invoice.', 'warn');
            return;
          }
          record.description = descriptionInput.value;
          record.frequency = freqSelect.value;
          record.nextDate = nextInput.value || today();
          record.endDate = endInput.value;
          record.active = activeBox.checked;
          try {
            await saveRecord('recurring', existing?.id, record);
            modal.close();
            toastKey('msg_saved');
            reload();
          } catch (err) {
            console.error(err);
            toast('Could not save.', 'err');
          }
        },
      }),
    ),
  );

  const modal = openModal(body);
  await fillSourceInvoices();
}

// ---------------------------------------------------------------------------
// Generating
// ---------------------------------------------------------------------------

async function generateDue() {
  const due = templates.filter(isDue).filter((t) => !t.endDate || t.nextDate <= t.endDate);
  if (!due.length) {
    toast('Nothing recurring is due.', 'ok');
    return;
  }

  const ok = await confirmDialog(
    `Se generarán <strong>${due.length}</strong> facturas.` +
    `<br>${due.length} invoices will be generated.` +
    `<ul style="margin:10px 0 0;padding-left:18px">${due.slice(0, 8)
      .map((t) => `<li>${esc(t.customerName)} — ${esc(money(t.template?.totalCents || 0))}</li>`).join('')}</ul>`,
    { okKey: 'act_run' },
  );
  if (!ok) return;

  let created = 0;
  const failures = [];

  for (const t of due) {
    try {
      const invoice = blankDoc('invoice', settings);
      Object.assign(invoice, t.template, {
        customerId: t.customerId,
        customerName: t.customerName,
        date: t.nextDate,
        dueDate: addDays(t.nextDate, Number(settings.defaultDueDays) || 0),
        status: 'sent',
        paidCents: 0,
        recurringId: t.id,
      });
      invoice.number = await nextNumber('invoice');
      recalc(invoice, settings);

      await saveRecord('invoices', null, invoice);
      await applyStockDeltas(stockDeltasForDoc(invoice, -1)).catch(() => {});

      const nextDate = advanceDate(t.nextDate, t.frequency);
      const exhausted = t.endDate && nextDate > t.endDate;
      await saveRecord('recurring', t.id, {
        ...t,
        nextDate,
        active: exhausted ? false : t.active !== false,
        lastGenerated: today(),
        generatedCount: (Number(t.generatedCount) || 0) + 1,
      });
      created += 1;
    } catch (err) {
      console.error('Recurring generation failed for', t.id, err);
      failures.push(t.customerName || t.id);
    }
  }

  if (failures.length) {
    toast(`${created} generadas, ${failures.length} con error: ${esc(failures.join(', '))}` +
      `${created} generated, ${failures.length} failed`, 'err', 8000);
  } else {
    toast(`${created} ${T('nav_invoices')} · ${T('msg_saved')}`, 'ok');
  }
  reload();
}

onAction('new', () => openEditor(null));
