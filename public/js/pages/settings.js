import {
  $, el, biInline, T, es, en, initShell, pageHeader, setPageTitle, parseRate,
  today, saveSettings, loadAll, peekCounter, setCounter, COUNTER_DEFAULTS,
  onAction, toast, toastKey, trackDirty, downloadFile, formatNumber,
} from '../app.js';
import { auth, updatePassword } from '../fb.js';
import { field, card, selectEl } from '../components.js';

setPageTitle('nav_settings');
const { user, settings } = await initShell('settings.html');

const page = $('#page');
const draft = { ...settings };
let dirty = false;
const markDirty = () => { dirty = true; };
trackDirty(() => dirty);

page.append(pageHeader('nav_settings', [
  { key: 'act_save', variant: 'primary', accel: 'Ctrl+S', onClick: () => save() },
]));

function bind(name, node, transform) {
  node.value = transform ? transform.out(draft[name]) : (draft[name] ?? '');
  node.addEventListener('input', () => {
    draft[name] = transform ? transform.in(node.value) : node.value;
    markDirty();
  });
  return node;
}

const rateT = { out: (v) => (v ? String(v) : ''), in: (v) => parseRate(v) };
const intT = { out: (v) => (v || v === 0 ? String(v) : ''), in: (v) => parseInt(v, 10) || 0 };

// ---------------------------------------------------------------------------
// Business details
// ---------------------------------------------------------------------------

const logoPreview = el('img', {
  style: 'max-width:220px;max-height:90px;display:block;margin-bottom:8px;' +
    (draft.logoDataUrl ? '' : 'display:none'),
  src: draft.logoDataUrl || '',
  alt: '',
});

const logoInput = el('input', { type: 'file', accept: 'image/*' });
logoInput.addEventListener('change', async () => {
  const file = logoInput.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await downscaleImage(file, 600, 240);
    draft.logoDataUrl = dataUrl;
    logoPreview.src = dataUrl;
    logoPreview.style.display = 'block';
    markDirty();
  } catch (err) {
    console.error(err);
    toast('No se pudo leer la imagen. <span class="bi-en-inline">Could not read the image.</span>', 'err');
  }
});

const logoClear = el('button', {
  class: 'btn btn-ghost btn-sm', type: 'button', html: biInline('act_clear'),
  onclick: () => {
    draft.logoDataUrl = '';
    logoPreview.style.display = 'none';
    logoInput.value = '';
    markDirty();
  },
});

page.append(card('set_business', el('div', {},
  el('div', { class: 'grid grid-2' },
    field('set_business_name', bind('businessName', el('input', { type: 'text' }))),
    field('cust_email', bind('email', el('input', { type: 'email' }))),
  ),
  el('div', { class: 'grid grid-2' },
    field('cust_address', bind('address', el('input', { type: 'text' }))),
    field('cust_address2', bind('address2', el('input', { type: 'text' }))),
  ),
  el('div', { class: 'grid grid-4' },
    field('cust_city', bind('city', el('input', { type: 'text' }))),
    field('cust_state', bind('state', el('input', { type: 'text' }))),
    field('cust_zip', bind('zip', el('input', { type: 'text' }))),
    field('cust_country', bind('country', el('input', { type: 'text' }))),
  ),
  el('div', { class: 'grid grid-4' },
    field('cust_phone', bind('phone', el('input', { type: 'tel' }))),
    field('cust_mobile', bind('mobile', el('input', { type: 'tel' }))),
    field('set_website', bind('website', el('input', { type: 'url', placeholder: 'https://' }))),
    field('set_tax_id', bind('taxId', el('input', { type: 'text', placeholder: 'RNC · Tax ID' }))),
  ),
  el('div', { class: 'field' },
    el('label', { class: 'field-label', html: biInline('set_logo') }),
    logoPreview,
    el('div', { class: 'form-row' }, logoInput, logoClear),
    el('p', { class: 'field-hint', html: `${es('set_logo_hint')} <span class="bi-en-inline">${en('set_logo_hint')}</span>` }),
  ),
)));

// ---------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------

const compoundBox = el('input', { type: 'checkbox', checked: !!draft.tax2Compound });
compoundBox.addEventListener('change', () => { draft.tax2Compound = compoundBox.checked; markDirty(); });

const inclusiveBox = el('input', { type: 'checkbox', checked: !!draft.taxInclusive });
inclusiveBox.addEventListener('change', () => { draft.taxInclusive = inclusiveBox.checked; markDirty(); });

page.append(card('set_tax', el('div', {},
  el('div', { class: 'grid grid-2' },
    field('set_tax1_name', bind('tax1Name', el('input', { type: 'text', placeholder: 'ITBIS · Sales Tax' }))),
    field('set_tax1_rate', bind('tax1Rate', el('input', { type: 'text', class: 'input-num', inputmode: 'decimal' }), rateT)),
  ),
  el('div', { class: 'grid grid-2' },
    field('set_tax2_name', bind('tax2Name', el('input', { type: 'text' }))),
    field('set_tax2_rate', bind('tax2Rate', el('input', { type: 'text', class: 'input-num', inputmode: 'decimal' }), rateT)),
  ),
  el('div', { class: 'form-row' },
    el('label', { class: 'check' }, compoundBox, el('span', { html: biInline('set_tax2_compound') })),
    el('label', { class: 'check' }, inclusiveBox, el('span', { html: biInline('set_tax_inclusive') })),
  ),
)));

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

const counterTypes = ['invoice', 'quote', 'order', 'payment'];
const counterState = {};
const counterPreviews = {};

const numberingBody = el('div', {});
for (const type of counterTypes) {
  counterState[type] = await peekCounter(type);

  const prefixInput = el('input', { type: 'text', class: 'input-mono', value: counterState[type].prefix || '' });
  const nextInput = el('input', { type: 'text', class: 'input-num', inputmode: 'numeric', value: String(counterState[type].next ?? 1) });
  const padInput = el('input', { type: 'text', class: 'input-num', inputmode: 'numeric', value: String(counterState[type].padding ?? 4) });
  const preview = el('span', { class: 'input-mono', style: 'font-weight:700' });
  counterPreviews[type] = preview;

  const update = () => {
    counterState[type] = {
      prefix: prefixInput.value,
      next: parseInt(nextInput.value, 10) || 1,
      padding: parseInt(padInput.value, 10) || 0,
    };
    preview.textContent = formatNumber(counterState[type].next, counterState[type].prefix, counterState[type].padding);
    markDirty();
  };
  [prefixInput, nextInput, padInput].forEach((n) => n.addEventListener('input', update));
  update();

  const labelKey = { invoice: 'doc_invoice', quote: 'doc_quote', order: 'doc_order', payment: 'doc_payment' }[type];

  numberingBody.append(el('div', { class: 'form-row', style: 'margin-bottom:12px' },
    el('div', { style: 'min-width:130px;font-weight:600', html: biInline(labelKey) }),
    el('div', { class: 'field', style: 'max-width:120px' },
      el('label', { class: 'field-label', html: biInline('set_prefix') }), prefixInput),
    el('div', { class: 'field', style: 'max-width:130px' },
      el('label', { class: 'field-label', html: biInline('set_next_number') }), nextInput),
    el('div', { class: 'field', style: 'max-width:90px' },
      el('label', { class: 'field-label', html: biInline('set_padding') }), padInput),
    el('div', { style: 'padding-bottom:8px' }, preview),
  ));
}
numberingBody.append(el('p', { class: 'field-hint',
  html: `${es('set_numbering_hint')} <span class="bi-en-inline">${en('set_numbering_hint')}</span>` }));

page.append(card('set_numbering', numberingBody));

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const dateFormatSelect = selectEl([
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY', selected: draft.dateFormat === 'MM/DD/YYYY' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY', selected: draft.dateFormat === 'DD/MM/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD', selected: draft.dateFormat === 'YYYY-MM-DD' },
]);
dateFormatSelect.addEventListener('change', () => { draft.dateFormat = dateFormatSelect.value; markDirty(); });

page.append(card('set_defaults', el('div', {},
  el('div', { class: 'grid grid-4' },
    field('set_currency_symbol', bind('currencySymbol', el('input', { type: 'text' }))),
    field('set_currency_code', bind('currencyCode', el('input', { type: 'text', class: 'input-mono' }))),
    field('set_date_format', dateFormatSelect),
    field('set_default_due_days', bind('defaultDueDays', el('input', { type: 'text', class: 'input-num', inputmode: 'numeric' }), intT)),
  ),
  el('div', { class: 'grid grid-2' },
    field('set_default_terms', bind('defaultTerms', el('input', { type: 'text', placeholder: 'Neto 30 / Net 30' }))),
    field('set_quote_valid_days', bind('quoteValidDays', el('input', { type: 'text', class: 'input-num', inputmode: 'numeric' }), intT)),
  ),
  el('div', { class: 'grid grid-2' },
    field('footer_message', bind('footerMessage', el('input', { type: 'text', placeholder: T('thank_you') }))),
    field('notes', bind('defaultNotes', el('input', { type: 'text' }))),
  ),
)));

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

const passwordInput = el('input', { type: 'password', autocomplete: 'new-password' });

page.append(card('set_account', el('div', {},
  el('div', { class: 'grid grid-2' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: biInline('login_email') }),
      el('input', { type: 'text', value: user.email || '', readonly: true }),
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', html: biInline('set_uid') }),
      el('input', { type: 'text', class: 'input-mono', value: user.uid, readonly: true,
        onclick: (e) => e.currentTarget.select() }),
      el('p', { class: 'field-hint', html:
        'Péguelo en <code>firestore.rules</code> para dejar la base a nombre de esta cuenta únicamente. ' +
        '<span class="bi-en-inline">Paste it into firestore.rules to lock the database to this account alone.</span>' }),
    ),
  ),
  el('div', { class: 'form-row' },
    el('div', { class: 'field flex-1', style: 'max-width:320px' },
      el('label', { class: 'field-label', html: biInline('set_new_password') }), passwordInput),
    el('button', {
      class: 'btn btn-default', type: 'button', html: biInline('set_change_password'),
      onclick: async () => {
        const value = passwordInput.value;
        if (value.length < 6) {
          toast('Use al menos 6 caracteres. <span class="bi-en-inline">Use at least 6 characters.</span>', 'warn');
          return;
        }
        try {
          await updatePassword(auth.currentUser, value);
          passwordInput.value = '';
          toastKey('msg_saved');
        } catch (err) {
          console.error(err);
          toast(err.code === 'auth/requires-recent-login'
            ? 'Vuelva a iniciar sesión y reintente. <span class="bi-en-inline">Sign in again, then retry.</span>'
            : 'No se pudo cambiar. <span class="bi-en-inline">Could not change it.</span>', 'err');
        }
      },
    }),
  ),
)));

// ---------------------------------------------------------------------------
// Data / backup
// ---------------------------------------------------------------------------

page.append(card('set_data', el('div', {},
  el('p', { class: 'text-small text-muted',
    html: `${es('set_backup_hint')} <span class="bi-en-inline">${en('set_backup_hint')}</span>` }),
  el('div', { class: 'form-row' },
    el('button', {
      class: 'btn btn-default', type: 'button', html: biInline('set_backup'),
      onclick: () => backup(),
    }),
    el('a', { class: 'btn btn-default', href: 'import.html', html: biInline('nav_import') }),
  ),
)));

// ---------------------------------------------------------------------------

async function save() {
  try {
    await saveSettings(draft);
    for (const type of counterTypes) {
      await setCounter(type, counterState[type]);
    }
    dirty = false;
    toastKey('msg_saved');
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar. <span class="bi-en-inline">Could not save.</span>', 'err');
  }
}

async function backup() {
  toast('Preparando el respaldo… <span class="bi-en-inline">Preparing the backup…</span>');
  try {
    const [customers, items, invoices, quotes, orders, payments, recurring] = await Promise.all([
      loadAll('customers'), loadAll('items'), loadAll('invoices'),
      loadAll('quotes'), loadAll('orders'), loadAll('payments'), loadAll('recurring'),
    ]);
    const counters = {};
    for (const type of Object.keys(COUNTER_DEFAULTS)) counters[type] = await peekCounter(type);

    const payload = {
      exportedAt: new Date().toISOString(),
      settings: draft,
      counters,
      customers, items, invoices, quotes, orders, payments, recurring,
    };
    downloadFile(`respaldo-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`${invoices.length} ${T('nav_invoices')} · ${customers.length} ${T('nav_customers')}`, 'ok', 5000);
  } catch (err) {
    console.error(err);
    toast('No se pudo generar el respaldo. <span class="bi-en-inline">Could not build the backup.</span>', 'err');
  }
}

/**
 * Logos live inside the settings document, so they have to stay small —
 * Firestore caps a document at 1 MB and a phone photo would blow past that.
 */
function downscaleImage(file, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = el('canvas', { width: w, height: h });
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // PNG keeps a transparent background; fall back to JPEG when the PNG
        // comes out too heavy for a Firestore field.
        let out = canvas.toDataURL('image/png');
        if (out.length > 480000) out = canvas.toDataURL('image/jpeg', 0.85);
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

onAction('save', () => save());
