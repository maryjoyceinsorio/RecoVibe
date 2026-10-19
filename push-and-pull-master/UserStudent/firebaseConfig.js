import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBtWyBsV5RG9nAehlIE5Sz-6NgwwfFbwA0",
  authDomain: "recovibe-fad79.firebaseapp.com",
  databaseURL: "https://recovibe-fad79-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "recovibe-fad79",
  storageBucket: "recovibe-fad79.firebasestorage.app",
  messagingSenderId: "735898141986",
  appId: "1:735898141986:web:27afe3c09e9fa30dc8917b",
  measurementId: "G-NPG0PZMLB8"
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => value && !value.startsWith("YOUR_")
);

export const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

let rtdbInstance = null;
if (app) {
  try {
    rtdbInstance = getDatabase(app, firebaseConfig.databaseURL);
  } catch (err) {
    try {
      rtdbInstance = getDatabase(app);
    } catch (e) {
      console.warn("RTDB initialization error:", e);
    }
  }
}
export const rtdb = rtdbInstance;
export const isRtdbConfigured = Boolean(rtdbInstance);

let functionsInstance = null;
if (app) {
  try {
    functionsInstance = getFunctions(app, "asia-southeast1");
  } catch (err) {
    console.warn("Functions initialization error:", err);
  }
}
export const functions = functionsInstance;