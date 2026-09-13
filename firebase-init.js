import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, reauthenticateWithPopup, EmailAuthProvider,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  initializeFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs,
  query, orderBy, limit, addDoc, onSnapshot, serverTimestamp, where,
  arrayUnion, arrayRemove, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Firestore's default transport is a streaming connection (WebChannel) that
// some networks, VPNs, and antivirus/firewall software reset mid-stream —
// that's what an "ERR_CONNECTION_RESET" on the .../Write/channel endpoint
// is. experimentalAutoDetectLongPolling makes the SDK detect that and fall
// back to plain long-polling automatically, without forcing the slower
// transport on connections that don't need it.
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
export const googleProvider = new GoogleAuthProvider();

export {
  onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, reauthenticateWithPopup, EmailAuthProvider,
  deleteUser,
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs,
  query, orderBy, limit, addDoc, onSnapshot, serverTimestamp, where,
  arrayUnion, arrayRemove, increment
};

/** Redirects to index.html if nobody is signed in. Resolves with the user otherwise. */
export function requireAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = "index.html";
      } else {
        resolve(user);
      }
    });
  });
}
