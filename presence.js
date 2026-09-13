import { db, doc, updateDoc, serverTimestamp } from "./firebase-init.js";

/**
 * Keeps a user's `lastActive` timestamp fresh while they have the app open,
 * which is what powers the "Online now" dot and filter. Pings immediately,
 * then every 60s, then again whenever the tab regains focus.
 */
export function startPresence(uid) {
  const ref = doc(db, "users", uid);
  const ping = () => updateDoc(ref, { lastActive: serverTimestamp() }).catch(() => {});
  ping();
  const interval = setInterval(ping, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ping();
  });
  window.addEventListener("beforeunload", () => clearInterval(interval));
}
