import {
  auth, signInWithEmailAndPassword, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  sendPasswordResetEmail,
} from '../fb.js';
import { isConfigured } from '../firebase-config.js';
import { $, el, biInline, T } from '../app.js';

const form = $('#login-form');
const messageHost = $('#login-message');
const btn = $('#login-btn');

function nextUrl() {
  const next = new URLSearchParams(location.search).get('next');
  // Only ever bounce back to a path inside this app.
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return 'dashboard.html';
}

function show(kind, html) {
  messageHost.innerHTML = '';
  messageHost.append(el('div', { class: kind === 'ok' ? 'login-note' : 'login-error', html }));
}

if (!isConfigured()) {
  show('err', biInline('msg_config_missing'));
  form.querySelectorAll('input, button').forEach((n) => { n.disabled = true; });
} else {
  onAuthStateChanged(auth, (user) => {
    if (user) location.replace(nextUrl());
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isConfigured()) return;

  const email = $('#email').value.trim();
  const password = $('#password').value;
  const remember = $('#remember').checked;

  btn.disabled = true;
  messageHost.innerHTML = '';

  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, password);
    location.replace(nextUrl());
  } catch (err) {
    console.warn('Sign-in failed', err.code);
    // Firebase distinguishes "no such user" from "wrong password"; the UI does
    // not, so an outsider cannot use this form to discover the owner's address.
    const tooMany = err.code === 'auth/too-many-requests';
    show('err', tooMany
      ? 'Demasiados intentos. Espere un momento. <span class="bi-en-inline">Too many attempts. Wait a moment.</span>'
      : biInline('login_failed'));
    btn.disabled = false;
    $('#password').value = '';
    $('#password').focus();
  }
});

$('#forgot').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) {
    show('err', 'Escriba su correo primero. <span class="bi-en-inline">Enter your email first.</span>');
    $('#email').focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    console.warn('Reset failed', err.code);
    // Deliberately silent about whether the address exists.
  }
  show('ok', biInline('login_reset_sent'));
});

document.title = `${T('login_title')} — ${T('app_name')}`;
