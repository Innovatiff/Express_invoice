// Landing page: send the owner to the dashboard if they are already signed in,
// otherwise to the sign-in screen.
//
// This lives in a file rather than an inline <script> in index.html so that
// every page in the app loads its JavaScript the same way, and so a strict
// Content-Security-Policy can forbid inline script outright.

import { auth, onAuthStateChanged } from '../fb.js';
import { isConfigured } from '../firebase-config.js';

if (!isConfigured()) {
  location.replace('login.html');
} else {
  onAuthStateChanged(auth, (user) => {
    location.replace(user ? 'dashboard.html' : 'login.html');
  });
}
