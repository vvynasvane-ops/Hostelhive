import {
  db, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp,
  doc, setDoc, where
} from "./firebase-init.js";
import { loaderHtml, loaderStreamHtml, isOnlineNow, activityLabel, addPasswordToggle } from "./common.js";
import { showToast } from "./notifications.js";
import { hashPin } from "./crypto-utils.js";

let unsubMessages = null;
let unsubTyping = null;
let unsubPresence = null;
let typingTickInterval = null;
let statusTickInterval = null;
let lastTypingPingAt = 0;

export function threadId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

// ------------------------------------------------------------------
// Chat lock — a per-device PIN that hides a specific conversation's
// content (both here and in the inbox preview) until unlocked.
//
// Chosen over the plain "Clear chat" button as a more reliable, proven
// pattern (this is the same idea as WhatsApp's Chat Lock / Messenger's
// Vault): a native `window.confirm()` dialog is unreliable inside an
// embedded WebView (some never show it, some silently return false),
// so "Clear chat" could look broken to a user even when the underlying
// Firestore write is fine. Locking sidesteps that entirely — no native
// dialog required to protect the content — and a custom in-DOM confirm
// modal (below) replaces window.confirm() for the actual clear action.
//
// The PIN is hashed (SHA-256) before it ever touches localStorage, and
// everything is local to this device/browser — this is a privacy
// screen, not end-to-end security, same as the apps above.
// ------------------------------------------------------------------
function lockKey(tid, myUid) { return `lw-lock:${tid}:${myUid}`; }
const unlockedThisSession = new Set(); // tid values unlocked once already this tab session

export function isThreadLocked(tid, myUid) {
  return !!localStorage.getItem(lockKey(tid, myUid));
}
async function setThreadLock(tid, myUid, pin) {
  localStorage.setItem(lockKey(tid, myUid), await hashPin(pin));
}
function removeThreadLock(tid, myUid) {
  localStorage.removeItem(lockKey(tid, myUid));
}
async function checkThreadPin(tid, myUid, pin) {
  const stored = localStorage.getItem(lockKey(tid, myUid));
  return stored && stored === await hashPin(pin);
}

/** Custom confirm modal — replaces window.confirm(), which is unreliable
 *  inside embedded WebViews. Resolves true/false. Rendered into mountEl
 *  so it works wherever the chat panel itself works. */
function showConfirmModal(mountEl, { title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "chat-modal-backdrop";
    wrap.innerHTML = `
      <div class="chat-modal">
        <div class="chat-modal-title">${escapeHtml(title)}</div>
        <div class="chat-modal-body">${escapeHtml(body)}</div>
        <div class="chat-modal-actions">
          <button type="button" class="btn ghost small" data-act="cancel">Cancel</button>
          <button type="button" class="btn small ${danger ? "danger" : ""}" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    mountEl.appendChild(wrap);
    const done = val => { wrap.remove(); resolve(val); };
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", () => done(false));
    wrap.querySelector('[data-act="ok"]').addEventListener("click", () => done(true));
    wrap.addEventListener("click", e => { if (e.target === wrap) done(false); });
  });
}

/** Small prompt modal for entering/setting a PIN. Resolves the PIN string, or null if cancelled. */
function showPinModal(mountEl, { title, body, confirmLabel = "Continue" }) {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "chat-modal-backdrop";
    wrap.innerHTML = `
      <div class="chat-modal">
        <div class="chat-modal-title">${escapeHtml(title)}</div>
        <div class="chat-modal-body">${escapeHtml(body)}</div>
        <input type="password" inputmode="numeric" maxlength="8" class="chat-pin-input" placeholder="PIN (4\u20138 digits)">
        <div class="chat-modal-error" style="display:none;">Wrong PIN \u2014 try again.</div>
        <div class="chat-modal-actions">
          <button type="button" class="btn ghost small" data-act="cancel">Cancel</button>
          <button type="button" class="btn small" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    mountEl.appendChild(wrap);
    const input = wrap.querySelector(".chat-pin-input");
    addPasswordToggle(input);
    input.focus();
    const done = val => { wrap.remove(); resolve(val); };
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", () => done(null));
    const submit = () => {
      const v = input.value.trim();
      if (v.length < 4) { input.classList.add("shake"); setTimeout(() => input.classList.remove("shake"), 300); return; }
      done(v);
    };
    wrap.querySelector('[data-act="ok"]').addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDay(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

/**
 * Mounts a full, real-messaging-style chat panel into `mountEl`.
 * otherUser: { name, photoURL } — used for the header and their bubbles' avatar.
 */
export function openChat(mountEl, myUid, otherUid, otherUser = {}) {
  closeChat();
  lastTypingPingAt = 0; // don't carry a previous conversation's throttle window into this one
  const otherName = otherUser.name || (otherUser.deleted ? "Deleted account" : "them");
  const otherPhoto = otherUser.photoURL || placeholderAvatar();

  mountEl.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-header">
        <img src="${otherPhoto}" alt="">
        <div>
          <div class="chat-header-name">${escapeHtml(otherName)}</div>
          <div class="chat-header-status" id="chat-header-status"><span class="status-dot offline"></span>…</div>
        </div>
        <div class="chat-menu-wrap">
          <button id="chat-menu-btn" class="btn ghost small chat-menu-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Chat options">Options &#9662;</button>
          <div id="chat-menu" class="chat-menu">
            <button type="button" id="chat-lock-toggle" class="chat-menu-item"></button>
            <button type="button" id="chat-clear-btn" class="chat-menu-item danger">Clear conversation</button>
          </div>
        </div>
      </div>
      <div id="chat-lock-screen" class="chat-lock-screen" style="display:none;">
        <div class="chat-lock-icon">&#128274;</div>
        <div class="chat-lock-title">This chat is locked</div>
        <input type="password" inputmode="numeric" maxlength="8" class="chat-pin-input" id="chat-lock-input" placeholder="Enter PIN">
        <div class="chat-modal-error" id="chat-lock-error" style="display:none;">Wrong PIN — try again.</div>
        <button type="button" class="btn small" id="chat-lock-unlock-btn">Unlock</button>
      </div>
      <div id="chat-log" class="chat-log"></div>
      <div id="chat-send-status" class="chat-send-status"></div>
      <div class="chat-input-row">
        <textarea id="chat-text" rows="1" placeholder="${otherUser.deleted ? "This account has been deleted" : `Message ${escapeHtml(otherName)}…`}" ${otherUser.deleted ? "disabled" : ""}></textarea>
        <button id="chat-send" class="chat-send-btn" type="button" aria-label="Send" disabled>&#10148;</button>
      </div>
    </div>`;

  const tid = threadId(myUid, otherUid);
  const logEl = mountEl.querySelector("#chat-log");
  const input = mountEl.querySelector("#chat-text");
  const sendBtn = mountEl.querySelector("#chat-send");
  const sendStatus = mountEl.querySelector("#chat-send-status");
  const lockScreen = mountEl.querySelector("#chat-lock-screen");
  const chatWrap = mountEl.querySelector(".chat-wrap");

  // ---- Options menu (Lock chat / Clear conversation) ----
  const menuBtn = mountEl.querySelector("#chat-menu-btn");
  const menu = mountEl.querySelector("#chat-menu");
  const lockToggleBtn = mountEl.querySelector("#chat-lock-toggle");
  menuBtn.addEventListener("click", e => {
    e.stopPropagation();
    const opening = !menu.classList.contains("open");
    menu.classList.toggle("open", opening);
    menuBtn.setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", e => {
    if (!mountEl.contains(e.target)) return;
    if (!menu.contains(e.target) && e.target !== menuBtn) menu.classList.remove("open");
  });

  function refreshLockToggleLabel() {
    lockToggleBtn.textContent = isThreadLocked(tid, myUid) ? "Unlock this chat" : "Lock this chat";
  }
  refreshLockToggleLabel();

  lockToggleBtn.addEventListener("click", async () => {
    menu.classList.remove("open");
    if (isThreadLocked(tid, myUid)) {
      const ok = await showConfirmModal(mountEl, {
        title: "Remove chat lock?",
        body: "This chat will no longer require a PIN to view.",
        confirmLabel: "Remove lock", danger: true
      });
      if (!ok) return;
      removeThreadLock(tid, myUid);
      unlockedThisSession.delete(tid);
      refreshLockToggleLabel();
      showToast("Chat lock removed.", { type: "success" });
    } else {
      const pin = await showPinModal(mountEl, {
        title: "Set a PIN for this chat",
        body: "You'll need this PIN to open this conversation on this device. It's stored only on this device, not on the server.",
        confirmLabel: "Set lock"
      });
      if (!pin) return;
      await setThreadLock(tid, myUid, pin);
      unlockedThisSession.add(tid); // no need to immediately re-prompt in the same session
      refreshLockToggleLabel();
      showToast("Chat locked.", { type: "success" });
    }
  });

  // ---- Lock screen gate ----
  function showLockGate() {
    chatWrap.classList.add("is-locked");
    lockScreen.style.display = "flex";
    const pinInput = lockScreen.querySelector("#chat-lock-input");
    const errEl = lockScreen.querySelector("#chat-lock-error");
    const unlockBtn = lockScreen.querySelector("#chat-lock-unlock-btn");
    addPasswordToggle(pinInput);
    setTimeout(() => pinInput.focus(), 50);
    const tryUnlock = async () => {
      const ok = await checkThreadPin(tid, myUid, pinInput.value.trim());
      if (ok) {
        unlockedThisSession.add(tid);
        chatWrap.classList.remove("is-locked");
        lockScreen.style.display = "none";
      } else {
        errEl.style.display = "block";
        pinInput.classList.add("shake");
        setTimeout(() => pinInput.classList.remove("shake"), 300);
        pinInput.value = "";
      }
    };
    unlockBtn.addEventListener("click", tryUnlock);
    pinInput.addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });
  }
  if (isThreadLocked(tid, myUid) && !unlockedThisSession.has(tid)) showLockGate();

  // Auto-grow the textarea like a real chat input.
  const autoGrow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 100) + "px"; };
  input.addEventListener("input", () => {
    autoGrow();
    sendBtn.disabled = !input.value.trim();
    // Throttle: writing a typing ping to Firestore on every single keystroke
    // was excessive (a full write per character) and did nothing to prevent
    // it. Once every 2s while actively typing is plenty to keep the other
    // side's indicator alive.
    const now = Date.now();
    if (now - lastTypingPingAt > 2000) {
      lastTypingPingAt = now;
      pingTyping(tid, myUid);
    }
  });

  // Mark this thread read by me as soon as I open it. This also has to be the
  // call that creates the thread doc on a brand-new conversation (before any
  // message has been sent) — it must include `participants`, because the
  // Firestore rules require request.resource.data.participants to allow the
  // write, and require resource.data.participants to allow the *read* the
  // typing-indicator listener below does. Without participants here, this
  // write silently failed (caught by .catch), the thread doc never got
  // created, and the typing listener's read on a nonexistent doc was denied.
  setDoc(doc(db, "threads", tid), {
    participants: [myUid, otherUid],
    [`lastRead.${myUid}`]: serverTimestamp()
  }, { merge: true }).catch(() => {});

  // `theirTypingUntil` is the local source of truth for whether to show the
  // indicator; syncTypingIndicator() paints it in or out of the DOM.
  // Two things used to break this:
  //  1. Every new/changed message replaced logEl's whole innerHTML, silently
  //     wiping out the indicator element until the *next* Firestore typing
  //     write happened to arrive — it wouldn't come back on its own.
  //  2. The indicator was only ever added/removed inside the typing
  //     listener's callback, which only fires when the typing doc field
  //     changes. If the other person stopped typing and never sent another
  //     keystroke, nothing re-ran the "has this gone stale?" check, so the
  //     indicator could stay stuck on screen forever.
  // Keeping the state in a variable and re-syncing it both after every
  // message render and on a 1s tick (below) fixes both.
  let theirTypingUntil = 0;
  function syncTypingIndicator() {
    const isTyping = Date.now() < theirTypingUntil;
    const existing = logEl.querySelector(".typing-indicator");
    if (isTyping && !existing) {
      logEl.insertAdjacentHTML("beforeend", `<div class="typing-indicator"><span></span><span></span><span></span></div>`);
      logEl.scrollTop = logEl.scrollHeight;
    } else if (!isTyping && existing) {
      existing.remove();
    }
  }

  logEl.innerHTML = loaderHtml("Loading messages");
  let latestDocs = [];
  let myClearedAtMs = 0;
  function renderMessages() {
    const visible = myClearedAtMs
      ? latestDocs.filter(m => {
          // A just-sent message hasn't round-tripped to the server yet, so
          // its serverTimestamp() createdAt reads as null in our own local
          // snapshot — treat that as "now" (definitely after any clear
          // point) rather than 0, or it would flicker invisible right after
          // sending until the server ack arrives.
          const ms = m.createdAt?.toMillis ? m.createdAt.toMillis() : Date.now();
          return ms > myClearedAtMs;
        })
      : latestDocs;
    logEl.innerHTML = renderLog(visible, myUid, otherPhoto) || emptyState(otherName);
    syncTypingIndicator();
    logEl.scrollTop = logEl.scrollHeight;
  }
  const q = query(collection(db, "threads", tid, "messages"), orderBy("createdAt", "asc"));
  unsubMessages = onSnapshot(
    q,
    snap => {
      latestDocs = snap.docs.map(d => d.data());
      renderMessages();
      // Keep the thread's read marker fresh while the panel stays open.
      if (latestDocs.length) setDoc(doc(db, "threads", tid), { [`lastRead.${myUid}`]: serverTimestamp() }, { merge: true }).catch(() => {});
    },
    err => {
      // A failed listener (offline, a missing index, rules) used to leave the
      // panel stuck on its loading spinner forever — show a retry state instead.
      console.error("Chat message listener failed:", err);
      logEl.innerHTML = `<div class="chat-empty">Couldn't load this conversation. <button type="button" class="btn ghost small" id="chat-retry">Retry</button></div>`;
      const retryBtn = logEl.querySelector("#chat-retry");
      if (retryBtn) retryBtn.addEventListener("click", () => openChat(mountEl, myUid, otherUid, otherUser), { once: true });
    }
  );

  unsubTyping = onSnapshot(doc(db, "threads", tid), snap => {
    const data = snap.data();
    const theirTypingAt = data?.typing?.[otherUid]?.toMillis?.();
    theirTypingUntil = theirTypingAt ? theirTypingAt + 4000 : 0;
    // `clearedAt.{myUid}` — set by the Clear chat button below — hides any
    // message sent before that point, for me only; the other person's view
    // of the same thread is untouched. Stored as a plain number (Date.now()),
    // not serverTimestamp() — a pending serverTimestamp() write reads back as
    // null in our *own* local snapshot until the server round-trip completes,
    // which made clicking Clear look like it did nothing for a beat (or
    // indefinitely, offline). A plain number is correct in the very first
    // local snapshot, no round-trip needed.
    // Re-render on every thread-doc update (not just when I click Clear) so
    // this stays correct if the clear was triggered from another open tab.
    const rawCleared = data?.clearedAt?.[myUid];
    const clearedAt = typeof rawCleared === "number" ? rawCleared : (rawCleared?.toMillis?.() || 0);
    if (clearedAt !== myClearedAtMs) {
      myClearedAtMs = clearedAt;
      renderMessages();
    } else {
      syncTypingIndicator();
    }
  }, err => console.error("Typing indicator listener failed:", err));

  // Ticks the indicator's expiry independently of Firestore events, so it
  // reliably disappears ~4s after their last keystroke even if they never
  // send another typing update or a message.
  typingTickInterval = setInterval(syncTypingIndicator, 1000);

  // The header used to hardcode "Active on HostelHive" for every
  // conversation regardless of whether the other person was actually
  // online — a real presence label, sourced from the same lastActive
  // timestamp Browse already uses, replaces that static, misleading text.
  const statusEl = mountEl.querySelector("#chat-header-status");
  let lastPresenceData = null;
  function paintStatus(data) {
    if (!statusEl) return;
    const showStatus = data?.showOnlineStatus !== false;
    const online = showStatus && isOnlineNow(data?.lastActive);
    statusEl.innerHTML = `<span class="status-dot ${online ? "" : "offline"}"></span>${
      showStatus ? activityLabel(data?.lastActive) : "HostelHive member"
    }`;
  }
  // A deleted account has no doc left to watch — skip the listener entirely
  // and just say so plainly, instead of quietly showing a blank status line.
  if (otherUser.deleted) {
    if (statusEl) statusEl.innerHTML = `<span class="status-dot offline"></span>No longer on HostelHive`;
  } else {
    unsubPresence = onSnapshot(doc(db, "users", otherUid), snap => {
      lastPresenceData = snap.data();
      paintStatus(lastPresenceData);
    }, err => console.error("Presence listener failed:", err));
    // activityLabel() phrases like "Active 3m ago" go stale without a
    // repaint of their own — nothing else re-renders this line as time passes.
    statusTickInterval = setInterval(() => paintStatus(lastPresenceData), 30000);
  }

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; autoGrow(); sendBtn.disabled = true;
    sendStatus.innerHTML = loaderStreamHtml();
    try {
      await Promise.all([
        addDoc(collection(db, "threads", tid, "messages"), { from: myUid, to: otherUid, text, createdAt: serverTimestamp() }),
        setDoc(doc(db, "threads", tid), {
          participants: [myUid, otherUid],
          lastText: text, lastFrom: myUid, lastAt: serverTimestamp(),
          [`lastRead.${myUid}`]: serverTimestamp()
        }, { merge: true })
      ]);
    } catch (err) {
      // Don't lose the message or brick the compose box on a failed send —
      // put the text back and let the person try again.
      console.error("Send failed:", err);
      input.value = text;
      autoGrow();
      showToast("Message didn't send — check your connection and try again.", { type: "error" });
    } finally {
      sendStatus.innerHTML = "";
      sendBtn.disabled = !input.value.trim();
    }
  };
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  mountEl.querySelector("#chat-clear-btn").addEventListener("click", async () => {
    menu.classList.remove("open");
    // A native window.confirm() is unreliable inside embedded WebViews (some
    // never surface it, some auto-dismiss as "cancel"), which is why Clear
    // chat could look broken. This in-DOM modal doesn't depend on the host
    // shell supporting JS dialogs at all.
    const ok = await showConfirmModal(mountEl, {
      title: "Clear this conversation?",
      body: `It'll disappear from your view — ${otherName} will still see their copy.`,
      confirmLabel: "Clear", danger: true
    });
    if (!ok) return;
    // Apply locally first — don't wait on the round-trip to feel instant,
    // and this is also what actually makes it work at all on a slow or
    // momentarily-offline connection (the write below still queues and
    // syncs once reconnected; Firestore's offline cache handles that part).
    myClearedAtMs = Date.now();
    renderMessages();
    try {
      // Same field shape as `lastRead.${myUid}` above — a per-user map field
      // on the thread doc, so this write only ever touches my own key in it
      // and the other participant's messages are untouched on their side.
      await setDoc(doc(db, "threads", tid), { [`clearedAt.${myUid}`]: myClearedAtMs }, { merge: true });
    } catch (err) {
      console.error("Clear chat failed:", err);
      showToast("Couldn't clear that chat — try again.", { type: "error" });
    }
  });
}

function pingTyping(tid, myUid) {
  setDoc(doc(db, "threads", tid), { [`typing.${myUid}`]: serverTimestamp() }, { merge: true }).catch(() => {});
}

function renderLog(docs, myUid, otherPhoto) {
  let html = "";
  let lastDay = "";
  docs.forEach((m, i) => {
    const dayLabel = m.createdAt ? fmtDay(m.createdAt) : "";
    if (dayLabel && dayLabel !== lastDay) {
      html += `<div class="date-divider">${dayLabel}</div>`;
      lastDay = dayLabel;
    }
    const mine = m.from === myUid;
    const next = docs[i + 1];
    const chainLast = !next || next.from !== m.from;
    html += `
      <div class="msg-row ${mine ? "mine" : "theirs"} ${chainLast ? "chain-last" : ""}">
        ${!mine ? `<img class="msg-avatar" src="${otherPhoto}" alt="">` : ""}
        <div class="msg ${mine ? "mine" : "theirs"}">
          ${escapeHtml(m.text)}
          <div class="msg-meta">
            <span>${fmtTime(m.createdAt)}</span>
            ${mine ? `<span class="msg-tick">&#10003;</span>` : ""}
          </div>
        </div>
      </div>`;
  });
  return html;
}

function emptyState(otherName) {
  return `<div class="chat-empty"><span class="lock-icon">&#10084;</span>Say hello to ${escapeHtml(otherName)} — this is the start of your conversation.</div>`;
}

function placeholderAvatar() {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='100%' height='100%' fill='#10282c'/></svg>`
  );
}

export function closeChat() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubTyping) { unsubTyping(); unsubTyping = null; }
  if (unsubPresence) { unsubPresence(); unsubPresence = null; }
  if (typingTickInterval) { clearInterval(typingTickInterval); typingTickInterval = null; }
  if (statusTickInterval) { clearInterval(statusTickInterval); statusTickInterval = null; }
}

/**
 * Lists my conversation threads, most recent first. Used by the Messages inbox.
 * cb(list) fires on every update. onError(err), if given, fires if the listener
 * itself fails (e.g. a missing Firestore index, permissions, or being offline) —
 * without it, a failed listener used to leave the inbox stuck on its loading
 * state forever with only a console error to show for it.
 * Returns an unsubscribe function.
 */
export function listThreads(myUid, cb, onError) {
  const q = query(
    collection(db, "threads"),
    where("participants", "array-contains", myUid),
    orderBy("lastAt", "desc")
  );
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error("listThreads listener failed:", err);
      if (onError) onError(err);
    }
  );
}
