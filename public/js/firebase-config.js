// ---------------------------------------------------------------------------
// Firebase project configuration.
//
// These values are NOT secrets. A Firebase web config identifies the project;
// it does not grant access to it. Every Firebase web app ships these in plain
// JavaScript that anyone can read. What actually protects the data is:
//
//   1. Email/Password sign-in with sign-up disabled, so exactly one account
//      exists, and
//   2. firestore.rules, which only lets that one account read or write.
//
// Worth doing once, in Google Cloud Console -> APIs & Services -> Credentials:
// restrict this API key to your Hosting domains (HTTP referrers). It does not
// protect the data — the rules do that — but it stops anyone else pointing
// their own page at your key and spending your quota.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: 'AIzaSyDaJWcAijxE9DppYASW8v_ZoV1pYBJOGXM',
  authDomain: 'expressinvoice-b91c4.firebaseapp.com',
  projectId: 'expressinvoice-b91c4',
  storageBucket: 'expressinvoice-b91c4.firebasestorage.app',
  messagingSenderId: '706512851378',
  appId: '1:706512851378:web:5b9658902b00991bbbd4ab',
};

// Set to true to point at the local Firebase emulators (firebase emulators:start).
export const USE_EMULATORS = false;

export function isConfigured() {
  return !String(firebaseConfig.projectId || '').includes('REPLACE_ME');
}
