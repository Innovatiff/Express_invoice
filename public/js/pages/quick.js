// ---------------------------------------------------------------------------
// Quick Actions: the gate.
//
// Quick Actions is the counter computer's tool — the till, the printer, the
// customer standing there. It is kept off phones on purpose: a phone screen
// turns "one question at a time" into scrolling, and the shop's rule is that
// invoices and payments are written at the counter, not from a pocket.
//
// One switch. Set QUICK_ON_PHONES to true and the app loads everywhere.
// ---------------------------------------------------------------------------

import { $, el } from '../app.js';

const QUICK_ON_PHONES = false;

// A phone is a narrow screen. Tablets at the counter pass; a desktop window
// dragged narrower than this is treated the same, and widens back to life.
const phone = window.matchMedia('(max-width: 720px)');

if (!QUICK_ON_PHONES && phone.matches) {
  const root = $('#quick');
  root.innerHTML = '';
  root.append(
    el('header', { class: 'qa-bar' },
      el('a', { class: 'qa-exit', href: 'dashboard.html', html: '‹&nbsp; Exit' }),
      el('div', { class: 'qa-bar-title' }, el('img', { src: 'img/icon-192.png', alt: '' }), el('span', { text: 'Quick Actions' })),
    ),
    el('main', { class: 'qa-main' },
      el('div', { class: 'qa-notice' },
        el('div', { class: 'qa-notice-mark', html: '🖥' }),
        el('h1', { text: 'Quick Actions is for the counter computer' }),
        el('p', { text: 'It is kept off phones on purpose: invoices and payments are written at the counter, where the printer is. Everything else is in the full app.' }),
        el('a', { class: 'btn btn-primary', href: 'dashboard.html', text: 'Open the full app' }),
      ),
    ),
  );
  phone.addEventListener('change', (e) => { if (!e.matches) location.reload(); });
} else {
  await import('./quick-app.js');
}
