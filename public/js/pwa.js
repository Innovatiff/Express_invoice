// ---------------------------------------------------------------------------
// Installing the app onto the machine.
//
// Loaded by every screen, deliberately outside the rest of the module graph:
// registering the worker must not depend on Firebase being reachable, or the
// app would stop being installable exactly when it is most useful.
//
// Chrome decides for itself when to offer installation and fires
// beforeinstallprompt when it does. That event is the only way to open the
// install dialog from a button, and it can only be used once — so it is kept
// here and any screen that wants an Install button can ask for it.
// ---------------------------------------------------------------------------

let deferredPrompt = null;
const listeners = new Set();

const announce = () => { for (const fn of listeners) { try { fn(canInstall()); } catch { /* a bad listener is not fatal */ } } };

window.addEventListener('beforeinstallprompt', (event) => {
  // Without this Chrome shows its own mini-infobar and the button below would
  // have nothing left to open.
  event.preventDefault();
  deferredPrompt = event;
  announce();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  announce();
});

export function canInstall() {
  return Boolean(deferredPrompt);
}

/** True when the app is already running in its own window rather than a tab. */
export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true;
}

/** Opens Chrome's install dialog. Resolves to 'accepted', 'dismissed' or ''. */
export async function promptInstall() {
  if (!deferredPrompt) return '';
  const event = deferredPrompt;
  deferredPrompt = null;      // a prompt event is good for one use only
  announce();
  event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

/** Calls back whenever installability changes, and once immediately. */
export function onInstallable(fn) {
  listeners.add(fn);
  fn(canInstall());
  return () => listeners.delete(fn);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Offline support unavailable', err);
    });
  });
}
