// ---------------------------------------------------------------------------
// Single place where the Firebase SDK is imported.
//
// The whole app is plain ES modules loaded straight from the browser — there is
// no build step and no bundler. Keeping every Firebase import in this one file
// means the SDK version is a one-line change.
// ---------------------------------------------------------------------------

import {
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';

import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  sendPasswordResetEmail, updatePassword, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

import {
  getFirestore, collection, doc, getDoc, getDocs, getCountFromServer,
  setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  startAfter, runTransaction, writeBatch, serverTimestamp, increment,
  documentId, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

import {
  firebaseConfig, USE_EMULATORS,
} from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export {
  // auth
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  updatePassword,
  // firestore
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  runTransaction,
  writeBatch,
  serverTimestamp,
  increment,
  documentId,
};
