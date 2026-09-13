import { requireAuth, db, auth, signOut, doc, getDoc } from "./firebase-init.js";
import { openChat, closeChat, listThreads, isThreadLocked } from "./chat.js";
import { initTheme } from "./theme.js";
import { renderNav } from "./nav.js";
import { escapeHtml, placeholderPhoto, loaderHtml, loaderTrackHtml } from "./common.js";
import { startPresence } from "./presence.js";
import { initNotifications, getCachedSenderProfile } from "./notifications.js";

initTheme();
renderNav("messages");
document.body.insertAdjacentHTML("beforeend", loaderTrackHtml("Loading Messages"));

const convoList = document.querySelector("#convo-list");
const noConvos = document.querySelector("#no-convos");
const noNewConvos = document.querySelector("#no-new-convos");
const searchInput = document.querySelector("#inbox-search-input");
const filterTabs = document.querySelectorAll(".inbox-filter-tab");
const newCountBadge = document.querySelector("#new-count-badge");
const chatPanelWrap = document.querySelector("#chat-panel-wrap");
const chatPlaceholder = document.querySelector("#chat-placeholder");
const chatMount = document.querySelector("#chat-mount");
const inboxPanel = document.querySelector("#inbox-panel");
const logoutBtn = document.querySelector("#logout-btn");

let me;
const userCache = new Map(); // uid -> {name, photoURL}
let threads = [];
let activeTid = null;
let activeFilter = "all"; // "all" | "new"

async function otherUserOf(t) {
  const otherUid = t.participants.find(u => u !== me.uid);
  if (!userCache.has(otherUid)) {
    const snap = await getDoc(doc(db, "users", otherUid));
    // A missing doc here means that member deleted their account (see the
    // Danger zone in settings.html) — their profile is gone everywhere, but
    // this thread's messages still belong to *us*, so we keep showing the
    // conversation rather than hiding it, just with a clear "no longer here"
    // label instead of a confusing blank "Member".
    userCache.set(otherUid, { uid: otherUid, deleted: !snap.exists(), ...(snap.data() || {}) });
  }
  return userCache.get(otherUid);
}

function fmtRelative(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diffMin = (Date.now() - d.getTime()) / 60000;
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${Math.floor(diffMin)}m`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isUnread(t) {
  if (!t.lastAt || t.lastFrom === me.uid) return false;
  const mine = t.lastRead?.[me.uid];
  if (!mine) return true;
  return mine.toMillis() < t.lastAt.toMillis();
}

async function render() {
  const term = searchInput.value.trim().toLowerCase();
  const rows = await Promise.all(threads.map(async t => ({ t, other: await otherUserOf(t) })));

  // A "new responder" is anyone whose latest message in the thread is theirs
  // (not ours) and we haven't read it yet — covers both someone texting us
  // for the first time and someone texting back after we messaged them first.
  const newCount = rows.filter(({ t }) => isUnread(t)).length;
  newCountBadge.textContent = String(newCount);
  newCountBadge.style.display = newCount ? "inline-flex" : "none";

  let visible = rows.filter(({ other }) => !term || (other.name || "").toLowerCase().includes(term));
  if (activeFilter === "new") visible = visible.filter(({ t }) => isUnread(t));

  noConvos.style.display = threads.length ? "none" : "block";
  noNewConvos.style.display = (activeFilter === "new" && threads.length && !visible.length) ? "block" : "none";

  convoList.innerHTML = visible.map(({ t, other }) => {
    const unread = isUnread(t);
    const locked = isThreadLocked(t.id, me.uid);
    const preview = locked
      ? `&#128274; Locked chat`
      : `${t.lastFrom === me.uid ? "You: " : ""}${escapeHtml(t.lastText || "")}`;
    return `
      <div class="convo-row ${unread ? "unread" : ""} ${t.id === activeTid ? "active" : ""}" data-tid="${t.id}" data-uid="${other.uid}">
        <img src="${other.photoURL || placeholderPhoto()}" alt="">
        <div class="convo-text-col">
          <div class="convo-name">${escapeHtml(other.name || (other.deleted ? "Deleted account" : "Member"))} ${unread ? `<span class="convo-new-pill">New</span>` : ""}</div>
          <div class="convo-preview ${locked ? "locked" : ""}">${preview}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <span class="convo-time">${fmtRelative(t.lastAt)}</span>
          ${unread ? `<span class="convo-unread-dot"></span>` : ""}
        </div>
      </div>`;
  }).join("");

  convoList.querySelectorAll(".convo-row").forEach(row => {
    row.addEventListener("click", () => openConversation(row.dataset.tid, row.dataset.uid));
  });
}

filterTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    activeFilter = tab.dataset.filter;
    filterTabs.forEach(t => t.classList.toggle("active", t === tab));
    render();
  });
});

function openConversation(tid, otherUid) {
  activeTid = tid;
  const other = userCache.get(otherUid) || {};
  chatPlaceholder.style.display = "none";
  chatMount.style.display = "block";
  chatPanelWrap.classList.add("open");
  inboxPanel.classList.add("hide-on-mobile");
  openChat(chatMount, me.uid, otherUid, { name: other.name, photoURL: other.photoURL, deleted: other.deleted });
  render();

  if (!chatMount.querySelector(".chat-back-btn")) {
    const back = document.createElement("button");
    back.className = "chat-back-btn btn ghost small";
    back.type = "button";
    back.textContent = "\u2190 Back";
    back.style.margin = "8px 0 -4px 8px";
    back.addEventListener("click", () => {
      chatPanelWrap.classList.remove("open");
      inboxPanel.classList.remove("hide-on-mobile");
    });
    chatMount.prepend(back);
  }
}

/**
 * Notification taps arrive as messages.html?uid=<sender>&tid=<threadId>. Opening
 * the right conversation used to mean waiting on the whole pipeline — auth,
 * this member's own profile fetch, the notifications watcher, then the full
 * thread list plus a getDoc for every single thread's other person — before
 * the target row even existed to click. Instead, the moment auth resolves we
 * open that one conversation directly: first with whatever sender name/photo
 * the notification already cached (instant, no network wait), then again
 * with the live Firestore doc once it lands, in case the cache was stale or
 * this is the first time we're seeing that thread. The rest of the inbox
 * keeps loading in the background exactly as before.
 */
function openFromDeepLink(otherUid, tid) {
  const cached = getCachedSenderProfile(me.uid, otherUid);
  if (cached) userCache.set(otherUid, { uid: otherUid, ...cached });
  openConversation(tid, otherUid);

  getDoc(doc(db, "users", otherUid)).then(snap => {
    userCache.set(otherUid, { uid: otherUid, ...(snap.data() || {}) });
    if (activeTid === tid) openConversation(tid, otherUid);
  }).catch(() => {});
}

async function load() {
  convoList.innerHTML = loaderHtml("Loading conversations");
  me = await requireAuth();
  // Reveal the page as soon as auth resolves, instead of holding the
  // full-screen loader up through the own-profile fetch below too — every
  // section past this point (inbox list, chat panel) already has its own
  // in-place loading state, so there's no reason to keep the whole page
  // hidden behind an opaque overlay while those finish.
  document.querySelector(".loader-page")?.remove();
  startPresence(me.uid);

  const params = new URLSearchParams(window.location.search);
  const deepUid = params.get("uid");
  const deepTid = params.get("tid");
  if (deepUid && deepTid) openFromDeepLink(deepUid, deepTid);

  const meSnap = await getDoc(doc(db, "users", me.uid));
  initNotifications(me.uid, (meSnap.data() || {}).preferences);
  listThreads(
    me.uid,
    list => {
      threads = list;
      render();
    },
    () => {
      convoList.innerHTML = `<p class="muted" style="padding:20px;">Couldn't load your conversations — check your connection and refresh.</p>`;
    }
  );
}

searchInput.addEventListener("input", render);
logoutBtn.addEventListener("click", async () => {
  closeChat();
  await signOut(auth);
  window.location.href = "index.html";
});

load().catch(err => {
  console.error("Messages load failed:", err);
  document.querySelector(".loader-page")?.remove();
  convoList.innerHTML = `<p class="muted" style="padding:20px;">Couldn't load Messages — check your connection and refresh.</p>`;
});
