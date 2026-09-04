// ---------------------------------------------------------------------------
// The workflow home screen.
//
// Express Invoice opened onto a flow chart of the sales cycle rather than a
// menu, and that picture is how the shop has thought about its own process for
// ten years: a quote becomes an order, an order becomes an invoice, an invoice
// gets paid, and the payment lands on a statement. This is that diagram, with
// two changes: every box is a link, and every box carries the live number that
// matters for it, so the picture doubles as the day's status.
//
// The boxes are laid out with CSS Grid. The connectors are drawn afterwards as
// SVG, measured from where the boxes actually ended up — so they stay correct
// when the window is resized or the font metrics differ, which hand-placed
// lines would not.
// ---------------------------------------------------------------------------

import { el, T, money } from './app.js';
import { icon } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// ---------------------------------------------------------------------------
// The diagram
//
// `row` / `col` are grid coordinates. Row 1 is what documents are made out of —
// a customer, some items, and the recurring templates that raise an invoice on
// their own. Row 2 is the pipeline those three feed. Two tiers, no third row of
// mostly-empty grid.
// ---------------------------------------------------------------------------

const NODES = [
  { id: 'customers', labelKey: 'nav_customers', href: 'customers.html', icon: 'users',
    row: 1, col: 1, tone: 'input', newHref: 'customer.html?new=1', newKey: 'act_new_customer' },
  { id: 'items', labelKey: 'nav_items', href: 'items.html', icon: 'box',
    row: 1, col: 2, tone: 'input', newHref: 'item.html?new=1', newKey: 'act_new_item' },
  { id: 'recurring', labelKey: 'nav_recurring', href: 'recurring.html', icon: 'refresh',
    row: 1, col: 3, tone: 'input' },

  { id: 'quotes', labelKey: 'nav_quotes', href: 'quotes.html', icon: 'tag',
    row: 2, col: 1, tone: 'flow', newHref: 'quote.html?new=1', newKey: 'act_new_quote', accel: 'F3' },
  { id: 'orders', labelKey: 'nav_orders', href: 'orders.html', icon: 'cart',
    row: 2, col: 2, tone: 'flow', newHref: 'order.html?new=1', newKey: 'act_new_order', accel: 'F4' },
  { id: 'invoices', labelKey: 'nav_invoices', href: 'invoices.html', icon: 'invoice',
    row: 2, col: 3, tone: 'hero', newHref: 'invoice.html?new=1', newKey: 'act_new_invoice', accel: 'F2' },
  { id: 'payments', labelKey: 'nav_payments', href: 'payments.html', icon: 'banknote',
    row: 2, col: 4, tone: 'flow', newHref: 'payment.html?new=1', newKey: 'act_new_payment', accel: 'F8' },
  { id: 'statements', labelKey: 'nav_statements', href: 'statements.html', icon: 'receipt',
    row: 2, col: 5, tone: 'flow' },
];

// Every link is a straight horizontal or vertical run between neighbours, which
// is what keeps the diagram readable — no diagonals, no crossings.
const LINKS = [
  ['customers', 'quotes'],
  ['items', 'orders'],
  ['quotes', 'orders'],
  ['orders', 'invoices'],
  ['invoices', 'payments'],
  ['payments', 'statements'],
  ['recurring', 'invoices'],
];

const TOOLS = [
  { labelKey: 'nav_reports', href: 'reports.html', icon: 'chart' },
  { labelKey: 'nav_import', href: 'import.html', icon: 'download' },
  { labelKey: 'nav_settings', href: 'settings.html', icon: 'gear' },
  { labelKey: 'nav_shortcuts', href: 'shortcuts.html', icon: 'keyboard' },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * metrics: { [nodeId]: { value, caption, alert } }
 *   value   the figure shown large — already formatted
 *   caption the word underneath it
 *   alert   optional { text } shown as a red pill
 */
export function renderWorkflow(metrics = {}) {
  const grid = el('div', { class: 'wf-grid' });
  const svg = svgEl('svg', { class: 'wf-links', 'aria-hidden': 'true', focusable: 'false' });
  const stage = el('div', { class: 'wf-stage' }, svg, grid);

  const byId = new Map();

  for (const node of NODES) {
    const m = metrics[node.id] || {};
    const tile = el('div', {
      class: `wf-node wf-node--${node.tone}`,
      style: `grid-row:${node.row};grid-column:${node.col}`,
      dataset: { id: node.id },
    });

    const main = el('a', { class: 'wf-node-main', href: node.href },
      el('span', { class: 'wf-node-icon', 'aria-hidden': 'true', html: icon(node.icon) }),
      el('span', { class: 'wf-node-label', text: T(node.labelKey) }),
      el('span', { class: 'wf-node-value', text: m.value ?? '' }),
      el('span', { class: 'wf-node-caption', text: m.caption ?? '' }),
    );
    tile.append(main);

    if (m.alert) {
      tile.append(el('span', { class: 'wf-node-alert', text: m.alert }));
    }

    // A second, separate anchor rather than a button inside the first one:
    // nesting interactive elements is invalid and breaks keyboard order.
    if (node.newHref) {
      tile.append(el('a', {
        class: 'wf-node-new',
        href: node.newHref,
        title: T(node.newKey) + (node.accel ? `  (${node.accel})` : ''),
        'aria-label': T(node.newKey),
        text: '+',
      }));
    }

    grid.append(tile);
    byId.set(node.id, tile);
  }

  const tools = el('div', { class: 'wf-tools' },
    ...TOOLS.map((t) => el('a', { class: 'wf-tool', href: t.href },
      el('span', { class: 'wf-tool-icon', 'aria-hidden': 'true', html: icon(t.icon) }),
      el('span', { text: T(t.labelKey) }),
    )),
  );

  const wrap = el('div', { class: 'wf' }, stage, tools);

  // The connectors can only be measured once the grid has been laid out, so
  // this runs after the node is in the document, and again on every resize.
  const draw = () => drawLinks(stage, svg, byId);
  requestAnimationFrame(draw);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(draw).observe(stage);
  } else {
    window.addEventListener('resize', draw);
  }
  // Web fonts can land after first paint and shift the boxes underneath the
  // lines; redraw once they have settled.
  document.fonts?.ready?.then(draw).catch(() => {});

  return wrap;
}

/** Draws one straight run per link, from box edge to box edge. */
function drawLinks(stage, svg, byId) {
  const stageBox = stage.getBoundingClientRect();
  if (!stageBox.width) return;

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 ${stageBox.width} ${stageBox.height}`);
  svg.setAttribute('width', stageBox.width);
  svg.setAttribute('height', stageBox.height);

  // Below the stacking breakpoint the grid collapses to one column and the
  // diagram becomes a plain list, where connectors would only be noise.
  const stacked = stage.classList.contains('is-stacked')
    || getComputedStyle(stage).getPropertyValue('--wf-stacked').trim() === '1';
  if (stacked) return;

  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'wf-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5',
    markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
  });
  marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'wf-arrowhead' }));
  defs.append(marker);
  svg.append(defs);

  const rectOf = (id) => {
    const box = byId.get(id).getBoundingClientRect();
    return {
      left: box.left - stageBox.left,
      right: box.right - stageBox.left,
      top: box.top - stageBox.top,
      bottom: box.bottom - stageBox.top,
      midX: box.left - stageBox.left + box.width / 2,
      midY: box.top - stageBox.top + box.height / 2,
    };
  };

  const GAP = 5; // breathing room so the arrow does not touch the box

  for (const [fromId, toId] of LINKS) {
    if (!byId.has(fromId) || !byId.has(toId)) continue;
    const a = rectOf(fromId);
    const b = rectOf(toId);

    let x1; let y1; let x2; let y2;
    if (b.left >= a.right) {            // to the right
      x1 = a.right + GAP; y1 = a.midY; x2 = b.left - GAP; y2 = b.midY;
    } else if (a.left >= b.right) {     // to the left
      x1 = a.left - GAP; y1 = a.midY; x2 = b.right + GAP; y2 = b.midY;
    } else if (b.top >= a.bottom) {     // below
      x1 = a.midX; y1 = a.bottom + GAP; x2 = b.midX; y2 = b.top - GAP;
    } else {                            // above
      x1 = a.midX; y1 = a.top - GAP; x2 = b.midX; y2 = b.bottom + GAP;
    }

    // Skip degenerate runs — they happen mid-reflow and draw as a stray dot.
    if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) < 1) continue;

    svg.append(svgEl('line', {
      x1, y1, x2, y2,
      class: 'wf-link',
      'marker-end': 'url(#wf-arrow)',
    }));
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Turns the dashboard's already-loaded data into the figure shown on each box.
 * Everything here is a count or a total the owner would otherwise have to open
 * a screen to find out.
 */
export function workflowMetrics({
  customers = [], items = [], openInvoices = [], overdueInvoices = [],
  openQuotes = [], openOrders = [], monthPaymentsCents = 0, recurringDue = [],
} = {}) {
  const outstanding = openInvoices.reduce((sum, i) => sum + (Number(i.balanceCents) || 0), 0);
  const withBalance = new Set(openInvoices.map((i) => i.customerId).filter(Boolean)).size;

  return {
    customers: { value: String(customers.length), caption: T('wf_on_file') },
    items: { value: String(items.length), caption: T('wf_in_catalog') },
    quotes: { value: String(openQuotes.length), caption: T('wf_open') },
    orders: { value: String(openOrders.length), caption: T('wf_open') },
    invoices: {
      value: money(outstanding),
      caption: T('wf_outstanding'),
      alert: overdueInvoices.length
        ? `${overdueInvoices.length} ${T('st_overdue').toLowerCase()}`
        : '',
    },
    payments: { value: money(monthPaymentsCents), caption: T('wf_this_month') },
    statements: { value: String(withBalance), caption: T('wf_with_balance') },
    recurring: {
      value: String(recurringDue.length),
      caption: T('wf_due'),
      alert: recurringDue.length ? T('wf_ready') : '',
    },
  };
}
