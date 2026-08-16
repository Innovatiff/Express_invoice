import {
  $, el, esc, biInline, es, en, initShell, pageHeader, setPageTitle,
} from '../app.js';
import { card } from '../components.js';

setPageTitle('nav_shortcuts');
await initShell('shortcuts.html');

const page = $('#page');

page.append(pageHeader('nav_shortcuts', [], ''));

page.append(el('p', { class: 'text-muted mb-2',
  html: `${es('sc_hint')} <span class="bi-en-inline">${en('sc_hint')}</span>` }));

/**
 * Ctrl+N is missing on purpose: browsers keep it for "new window" and will not
 * hand it over, so the new-document keys live on F2–F4 where they are always
 * available, in fields and out.
 */
const GROUPS = [
  {
    titleKey: 'sc_global',
    rows: [
      [['F2'], 'act_new_invoice'],
      [['F3'], 'act_new_quote'],
      [['F4'], 'act_new_order'],
      [['F8'], 'act_new_payment'],
      [['Ctrl', 'S'], 'act_save'],
      [['Ctrl', 'Shift', 'S'], 'act_save_new'],
      [['Ctrl', 'Enter'], 'act_save_close'],
      [['Ctrl', 'P'], 'act_print'],
      [['/'], 'act_search'],
      [['?'], 'nav_shortcuts'],
    ],
  },
  {
    titleKey: 'sc_goto',
    rows: [
      [['G', 'H'], 'nav_home'],
      [['G', 'F'], 'nav_invoices'],
      [['G', 'Q'], 'nav_quotes'],
      [['G', 'O'], 'nav_orders'],
      [['G', 'P'], 'nav_payments'],
      [['G', 'C'], 'nav_customers'],
      [['G', 'A'], 'nav_items'],
      [['G', 'E'], 'nav_statements'],
      [['G', 'R'], 'nav_reports'],
      [['G', 'S'], 'nav_settings'],
    ],
  },
  {
    titleKey: 'sc_lists',
    rows: [
      [['N'], 'act_new'],
      [['/'], 'act_search'],
      [['Enter'], 'act_edit'],
    ],
  },
  {
    titleKey: 'sc_grid',
    rows: [
      [['Enter'], 'act_add_line'],
      [['Tab'], 'line_description'],
      [['Alt', 'I'], 'act_add_line'],
      [['Alt', 'D'], 'act_remove_line'],
      [['Alt', '↑'], 'act_back'],
      [['Alt', '↓'], 'act_back'],
      [['Esc'], 'act_cancel'],
    ],
  },
];

const grid = el('div', { class: 'sc-grid' });

for (const group of GROUPS) {
  const table = el('table', { class: 'sc-table' });
  const tb = el('tbody');
  for (const [keys, labelKey] of group.rows) {
    tb.append(el('tr', {},
      el('td', { html: keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' <span class="text-muted">+</span> ') }),
      el('td', { html: biInline(labelKey) }),
    ));
  }
  table.append(tb);
  grid.append(card(group.titleKey, table, { flush: false }));
}

page.append(grid);

// A short note on the grid keys, which are the ones that carry the most muscle
// memory over from the desktop app.
page.append(card(null, el('div', {},
  el('p', { html:
    '<strong>En la tabla de líneas</strong> <span class="bi-en-inline">In the line grid</span>' }),
  el('ul', { style: 'margin:6px 0 0;padding-left:20px;line-height:1.8' },
    el('li', { html:
      '<kbd>Enter</kbd> salta a la línea siguiente y crea una nueva si está en la última. ' +
      '<span class="bi-en-inline">Enter moves to the next line, adding one when you are on the last.</span>' }),
    el('li', { html:
      'Escriba el código del artículo y elija de la lista: descripción y precio se llenan solos. ' +
      '<span class="bi-en-inline">Type an item code and pick from the list — description and price fill themselves in.</span>' }),
    el('li', { html:
      'El IMEI y el número de serie van en la descripción, como texto libre. ' +
      '<span class="bi-en-inline">IMEI and serial numbers go in the description as free text.</span>' }),
    el('li', { html:
      '<kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>Alt</kbd>+<kbd>↓</kbd> mueven la línea de lugar. ' +
      '<span class="bi-en-inline">Alt+Up / Alt+Down reorder the line.</span>' }),
  ),
)));
