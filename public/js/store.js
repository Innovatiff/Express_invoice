// ---------------------------------------------------------------------------
// Cached lookups for the two lists every screen needs: customers and items.
//
// A phone shop has hundreds of items and a few thousand customers, which is
// small enough to hold in memory and search instantly — the same way the
// desktop app felt. Lists are fetched once per page load.
// ---------------------------------------------------------------------------

import {
  loadAll, orderBy,
} from './app.js';
import {
  customerSearchBlob, itemSearchBlob, customerLabel,
} from './model.js';

let customersPromise = null;
let itemsPromise = null;

export function loadCustomers(force = false) {
  if (!customersPromise || force) {
    customersPromise = loadAll('customers', orderBy('name'))
      .then((list) => list.map((c) => ({ ...c, _blob: customerSearchBlob(c), _label: customerLabel(c) })))
      .catch((err) => {
        console.error('Could not load customers', err);
        customersPromise = null;
        throw err;
      });
  }
  return customersPromise;
}

export function loadItems(force = false) {
  if (!itemsPromise || force) {
    itemsPromise = loadAll('items', orderBy('code'))
      .then((list) => list.map((i) => ({ ...i, _blob: itemSearchBlob(i) })))
      .catch((err) => {
        console.error('Could not load items', err);
        itemsPromise = null;
        throw err;
      });
  }
  return itemsPromise;
}

export function invalidate() {
  customersPromise = null;
  itemsPromise = null;
}

export async function findCustomer(id) {
  if (!id) return null;
  return (await loadCustomers()).find((c) => c.id === id) || null;
}

export async function findItemByCode(code) {
  if (!code) return null;
  const needle = String(code).trim().toLowerCase();
  return (await loadItems()).find((i) => String(i.code || '').toLowerCase() === needle) || null;
}
