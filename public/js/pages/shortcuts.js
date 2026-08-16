import {
  $, el, esc, L, T, initShell, pageHeader, setPageTitle,
} from '../app.js';
import {
  card,
} from '../components.js';

setPageTitle('nav_shortcuts');
await initShell('shortcuts.html');

const page = $('#page');

page.append(pageHeader('nav_shortcuts', [], ''));

page.append(el('p', { class: 'text-muted mb-2',
  html: `${T('sc_hint')}` }));

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
      el('td', { html: L(labelKey) }),
    ));
  }
  table.append(tb);
  grid.append(card(group.titleKey, table, { flush: false }));
}

page.append(grid);

// A short note on the grid keys, which are the ones that carry the most muscle
// memory over from the desktop app.
page.append(card(null, el('div', {},
  el('p', { html: '<strong>In the line grid</strong>' }),
  el('ul', { style: 'margin:6px 0 0;padding-left:20px;line-height:1.8' },
    el('li', { html:
      '<kbd>Enter</kbd> moves to the next line, adding one when you are on the last.' }),
    el('li', { html:
      'Type an item code and pick from the list — description and price fill themselves in.' }),
    el('li', { html:
      'IMEI and serial numbers go in the description as free text.' }),
    el('li', { html:
      '<kbd>Alt</kbd>+<kbd>↑</kbd> and <kbd>Alt</kbd>+<kbd>↓</kbd> reorder the line.' }),
  ),
)));
