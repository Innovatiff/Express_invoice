// ---------------------------------------------------------------------------
// Firebase project configuration.
//
// Paste the config object from:
//   Firebase console -> Project settings -> General -> Your apps -> Web app
//
// These values are NOT secrets — they identify the project, they do not grant
// access. Access is controlled by Firebase Auth plus firestore.rules.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

// Set to true to point at the local Firebase emulators (firebase emulators:start).
export const USE_EMULATORS = false;

export function isConfigured() {
  return !String(firebaseConfig.projectId || '').includes('REPLACE_ME');
}
