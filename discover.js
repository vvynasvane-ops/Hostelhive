import {
  requireAuth, db, auth, signOut, collection, getDocs, doc, getDoc, updateDoc, addDoc,
  serverTimestamp, arrayUnion, arrayRemove, increment
} from "./firebase-init.js";
import { openChat, closeChat } from "./chat.js";
import { initTheme } from "./theme.js";
import { renderNav } from "./nav.js";
import { escapeHtml, placeholderPhoto, hostelCardHtml, activityLabel, tagsHtml, loaderHtml, loaderTrackHtml, NECESSITIES } from "./common.js";
import { matchScore, hasPreferences } from "./recommend.js";
import { startPresence } from "./presence.js";
import { showToast, initNotifications } from "./notifications.js";

initTheme();
renderNav("discover");
document.body.insertAdjacentHTML("beforeend", loaderTrackHtml("Loading listings"));

const grid = document.querySelector("#grid");
const recommendedGrid = document.querySelector("#recommended-grid");
const likesGrid = document.querySelector("#likes-grid");
const noLikes = document.querySelector("#no-likes");
const noResults = document.querySelector("#no-results");
const noRecommended = document.querySelector("#no-recommended");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const filtersToggleBtn = document.querySelector("#filters-toggle-btn");
const filtersPanel = document.querySelector("#filters-panel");
const necessitiesBox = document.querySelector("#f-necessities");
const applyFiltersBtn = document.querySelector("#apply-filters");
const clearFiltersBtn = document.querySelector("#clear-filters");
const savePresetBtn = document.querySelector("#save-preset");
const presetList = document.querySelector("#preset-list");
const detail = document.querySelector("#detail-overlay");
const detailBody = document.querySelector("#detail-body");
const closeDetailBtn = document.querySelector("#close-detail");
const logoutBtn = document.querySelector("#logout-btn");

necessitiesBox.innerHTML = NECESSITIES.map((n, i) => `
  <label for="f-nec-${i}"><input type="checkbox" id="f-nec-${i}" value="${escapeHtml(n)}">${escapeHtml(n)}</label>
`).join("");

let me, myData, hostels = [];
let filters = { priceMin: null, priceMax: null, maxDistanceKm: null, area: "", necessities: [], hasPhoto: false };

async function load() {
  grid.innerHTML = loaderHtml("Fetching hostels");
  recommendedGrid.innerHTML = loaderHtml();
  me = await requireAuth();
  startPresence(me.uid);
  const meSnap = await getDoc(doc(db, "users", me.uid));
  myData = meSnap.data() || {};
  document.querySelector(".loader-page")?.remove();
  const blocked = new Set(myData.blockedUsers || []);

  const snap = await getDocs(collection(db, "hostels"));
  hostels = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.ownerUid === me.uid || blocked.has(data.ownerUid)) return;
    hostels.push({ id: d.id, ...data });
  });

  render();
  renderPresets();
  initNotifications(me.uid, myData.preferences);
}

function norm(v) { return (v || "").toString().trim().toLowerCase(); }

function passesFilters(h) {
  if (filters.priceMin && (!h.price || h.price < filters.priceMin)) return false;
  if (filters.priceMax && (!h.price || h.price > filters.priceMax)) return false;
  if (filters.maxDistanceKm && (h.distanceKm == null || h.distanceKm > filters.maxDistanceKm)) return false;
  if (filters.area && !norm(h.area).includes(norm(filters.area))) return false;
  if (filters.necessities.length && !filters.necessities.every(n => (h.necessities || []).includes(n))) return false;
  if (filters.hasPhoto && !(h.photos && h.photos.length)) return false;
  return true;
}

function matchesSearch(h, term) {
  if (!term) return true;
  const hay = `${h.name || ""} ${h.area || ""} ${h.description || ""} ${h.code || ""}`.toLowerCase();
  return hay.includes(term);
}

function sortList(list) {
  const sorted = [...list];
  if (sortSelect.value === "price-asc") {
    sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  } else if (sortSelect.value === "price-desc") {
    sorted.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  } else if (sortSelect.value === "distance") {
    sorted.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  } else {
    sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  return sorted;
}

function isSaved(id) { return (myData.savedHostels || []).includes(id); }

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const visible = sortList(hostels.filter(h => passesFilters(h) && matchesSearch(h, term)));

  if (hasPreferences(myData.preferences)) {
    const scored = visible
      .map(h => ({ h, score: matchScore(myData.preferences, h) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    recommendedGrid.style.display = scored.length ? "grid" : "none";
    noRecommended.style.display = scored.length ? "none" : "block";
    recommendedGrid.innerHTML = scored.map(x => hostelCardHtml(x.h.id, x.h, true, isSaved(x.h.id))).join("");
    attachCardHandlers(recommendedGrid, visible);
  } else {
    recommendedGrid.style.display = "none";
    recommendedGrid.innerHTML = "";
    noRecommended.style.display = "block";
  }

  const saved = hostels.filter(h => isSaved(h.id));
  likesGrid.style.display = saved.length ? "grid" : "none";
  noLikes.style.display = saved.length ? "none" : "block";
  likesGrid.innerHTML = saved.map(h => hostelCardHtml(h.id, h, false, true)).join("");
  attachCardHandlers(likesGrid, saved);

  grid.innerHTML = visible.map(h => hostelCardHtml(h.id, h, false, isSaved(h.id))).join("");
  attachCardHandlers(grid, visible);
  noResults.style.display = visible.length ? "none" : "block";
}

function attachCardHandlers(container, list) {
  container.querySelectorAll(".person-card").forEach(card => {
    card.addEventListener("click", (e) => {
      const saveBtn = e.target.closest(".card-like-btn");
      if (saveBtn) { e.stopPropagation(); toggleSave(saveBtn.dataset.saveId); return; }
      const h = list.find(x => x.id === card.dataset.hostelId);
      if (h) openDetail(h.id, h);
    });
  });
}

async function toggleSave(id) {
  const saved = isSaved(id);
  myData.savedHostels = myData.savedHostels || [];
  if (saved) myData.savedHostels = myData.savedHostels.filter(u => u !== id);
  else myData.savedHostels.push(id);
  render();
  await updateDoc(doc(db, "users", me.uid), { savedHostels: saved ? arrayRemove(id) : arrayUnion(id) });
  showToast(saved ? "Removed from Saved." : "Saved.", { type: saved ? "info" : "success" });
}

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);
filtersToggleBtn.addEventListener("click", () => {
  filtersPanel.style.display = filtersPanel.style.display === "none" ? "block" : "none";
});
function readFiltersFromForm() {
  return {
    priceMin: Number(document.querySelector("#f-price-min").value) || null,
    priceMax: Number(document.querySelector("#f-price-max").value) || null,
    maxDistanceKm: Number(document.querySelector("#f-distance").value) || null,
    area: document.querySelector("#f-area").value.trim(),
    necessities: Array.from(necessitiesBox.querySelectorAll("input:checked")).map(cb => cb.value),
    hasPhoto: document.querySelector("#f-has-photo").checked
  };
}
function writeFiltersToForm(f) {
  document.querySelector("#f-price-min").value = f.priceMin || "";
  document.querySelector("#f-price-max").value = f.priceMax || "";
  document.querySelector("#f-distance").value = f.maxDistanceKm || "";
  document.querySelector("#f-area").value = f.area || "";
  const wanted = new Set(f.necessities || []);
  necessitiesBox.querySelectorAll("input").forEach(cb => { cb.checked = wanted.has(cb.value); });
  document.querySelector("#f-has-photo").checked = !!f.hasPhoto;
}
applyFiltersBtn.addEventListener("click", async () => {
  filters = readFiltersFromForm();
  render();
  // Filters double as the student's saved search — persisting them is what
  // powers "Recommended for you" here and the new-listing match notifications
  // (see notifications.js), not just this page's grid.
  myData.preferences = filters;
  try { await updateDoc(doc(db, "users", me.uid), { preferences: filters }); } catch (err) { console.error("Saving search filters failed:", err); }
});
clearFiltersBtn.addEventListener("click", () => {
  ["#f-price-min", "#f-price-max", "#f-distance", "#f-area"].forEach(sel => (document.querySelector(sel).value = ""));
  necessitiesBox.querySelectorAll("input").forEach(cb => { cb.checked = false; });
  document.querySelector("#f-has-photo").checked = false;
  filters = { priceMin: null, priceMax: null, maxDistanceKm: null, area: "", necessities: [], hasPhoto: false };
  render();
});

// ---- saved filter presets (per-device, via localStorage) ----
function presetsKey() { return `lw-presets-${me.uid}`; }
function loadPresets() { try { return JSON.parse(localStorage.getItem(presetsKey())) || []; } catch { return []; } }
function savePresets(list) { localStorage.setItem(presetsKey(), JSON.stringify(list)); }
function renderPresets() {
  const presets = loadPresets();
  presetList.innerHTML = presets.map((p, i) => `
    <span class="chip preset-chip" data-apply="${i}">${escapeHtml(p.name)} <button type="button" data-remove="${i}" title="Delete">&times;</button></span>
  `).join("");
  presetList.querySelectorAll("[data-apply]").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      const p = presets[Number(el.dataset.apply)];
      if (!p) return;
      writeFiltersToForm(p.filters);
      searchInput.value = p.term || "";
      filters = p.filters;
      filtersPanel.style.display = "block";
      render();
      showToast(`Applied "${p.name}".`, { type: "info" });
    });
  });
  presetList.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const list = loadPresets();
      list.splice(Number(btn.dataset.remove), 1);
      savePresets(list);
      renderPresets();
    });
  });
}
savePresetBtn.addEventListener("click", () => {
  const name = prompt("Name this filter preset (e.g. \"Near campus, under 8k\"):");
  if (!name) return;
  const list = loadPresets();
  list.push({ name: name.trim().slice(0, 30), filters: readFiltersFromForm(), term: searchInput.value.trim() });
  savePresets(list);
  renderPresets();
  showToast("Preset saved.", { type: "success" });
});

async function openDetail(id, h) {
  detail.style.display = "flex";
  detailBody.innerHTML = loaderHtml("Loading listing");

  // Best-effort view counter for the owner's benefit (see profile.js's My
  // Listings, where it shows as "N students have viewed this"). Never blocks
  // the detail view from opening if it fails.
  updateDoc(doc(db, "hostels", id), { viewCount: increment(1) }).catch(() => {});

  const [ownerSnap, feedbackSnap] = await Promise.all([
    getDoc(doc(db, "users", h.ownerUid)).catch(() => null),
    getDocs(collection(db, "feedback")).catch(() => null) // filtered client-side below by hostelId
  ]);
  const owner = ownerSnap?.data() || {};
  const feedback = [];
  feedbackSnap?.forEach(d => { const f = d.data(); if (f.hostelId === id) feedback.push(f); });

  const priceLabel = h.price ? `KES ${Number(h.price).toLocaleString()}/mo` : "Price on request";
  const distLabel = h.distanceKm != null && h.distanceKm !== "" ? `${h.distanceKm} km to campus` : "";
  const activity = owner.showOnlineStatus !== false ? activityLabel(owner.lastActive) : "";
  const photos = (h.photos && h.photos.length ? h.photos : [placeholderPhoto()]);
  const saved = isSaved(id);

  detailBody.innerHTML = `
    <div class="detail-wrap">
      <div>
        <img class="person-photo" style="border-radius:var(--radius-lg);" src="${photos[0]}" alt="${escapeHtml(h.name || "Hostel")}">
        ${photos.length > 1 ? `<div class="photo-strip" style="margin-top:8px;">${photos.slice(1).map(url => `<img src="${url}" alt="">`).join("")}</div>` : ""}
        <h2 style="margin-top:14px;">${escapeHtml(h.name || "Hostel")}</h2>
        <p class="muted" style="font-size:13px;">${escapeHtml(priceLabel)}${distLabel ? " · " + escapeHtml(distLabel) : ""}</p>
        ${h.area ? `<p class="muted" style="font-size:13px;">${escapeHtml(h.area)}</p>` : ""}
        ${activity ? `<p class="muted" style="font-size:12px;">Owner ${escapeHtml(activity.toLowerCase())}</p>` : ""}
        ${h.code ? `<p class="muted" style="font-size:12px;">Listing ${escapeHtml(h.code)}</p>` : ""}
        <div style="display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap;">
          <button type="button" class="like-btn ${saved ? "liked" : ""}" id="detail-like-btn" data-save-id="${id}" title="${saved ? "Remove from Saved" : "Save"}">${saved ? "&#10084;" : "&#9825;"}</button>
          <button type="button" id="feedback-btn" class="btn subtle small">&#10024; Leave feedback</button>
        </div>
        <div id="feedback-picker" class="appreciate-picker" hidden></div>
      </div>
      <div>
        <p>${escapeHtml(h.description || "No description yet.")}</p>
        ${(h.necessities && h.necessities.length) ? `<div style="margin-top:10px;"><label class="mt-0" style="margin:0 0 4px;">Necessities</label>${tagsHtml(h.necessities)}</div>` : ""}
        ${h.contact ? `<p style="margin-top:10px; font-size:13px;"><strong>Contact:</strong> ${escapeHtml(h.contact)}</p>` : ""}

        ${feedback.length ? `
          <div class="gilt-rule"></div>
          <h3>What students say</h3>
          <div class="appreciate-picker">${feedback.slice(0, 12).map(f => `<span class="chip">${escapeHtml(f.text)}</span>`).join("")}</div>
        ` : ""}

        <div class="gilt-rule"></div>
        <h3>Message the owner</h3>
        <div id="chat-mount"></div>

        <div class="gilt-rule"></div>
        <div style="display:flex; gap:10px;">
          <button id="block-btn" class="btn ghost small" type="button">Block owner</button>
          <button id="report-btn" class="btn ghost small" type="button">Report listing</button>
        </div>
        <p id="safety-note" class="muted" style="font-size:12px; margin-top:6px;"></p>
      </div>
    </div>`;

  document.querySelector("#detail-like-btn").addEventListener("click", async () => {
    await toggleSave(id);
    openDetail(id, hostels.find(x => x.id === id) || h);
  });

  const feedbackBtn = document.querySelector("#feedback-btn");
  const feedbackPicker = document.querySelector("#feedback-picker");
  feedbackBtn.addEventListener("click", () => {
    const opening = feedbackPicker.hidden;
    feedbackPicker.hidden = !opening;
    if (opening && !feedbackPicker.innerHTML) {
      feedbackPicker.innerHTML = FEEDBACK_PRESETS.map(text => `<button type="button" class="chip appreciate-chip" data-text="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("");
      feedbackPicker.querySelectorAll(".appreciate-chip").forEach(chip => {
        chip.addEventListener("click", () => sendFeedback(id, h, chip.dataset.text, feedbackBtn, feedbackPicker));
      });
    }
  });

  document.querySelector("#block-btn").addEventListener("click", async () => {
    if (!confirm(`Block this owner? You won't see their listings in Browse anymore.`)) return;
    await updateDoc(doc(db, "users", me.uid), { blockedUsers: arrayUnion(h.ownerUid) });
    hostels = hostels.filter(x => x.ownerUid !== h.ownerUid);
    detail.style.display = "none";
    closeChat();
    render();
    showToast("Blocked.", { type: "success" });
  });

  document.querySelector("#report-btn").addEventListener("click", async () => {
    const reason = prompt("What's the issue with this listing? (a short reason helps us review it)");
    if (reason === null) return;
    await addDoc(collection(db, "reports"), {
      reportedHostelId: id, reportedUid: h.ownerUid, reporterUid: me.uid, reason: reason.trim() || "No reason given", createdAt: serverTimestamp()
    });
    document.querySelector("#safety-note").textContent = "Thanks — this has been reported for review. You can also reach us directly at artyourtaste@gmail.com.";
    showToast("Report submitted.", { type: "success" });
  });

  openChat(document.querySelector("#chat-mount"), me.uid, h.ownerUid, { name: owner.name, photoURL: owner.photoURL });
}

// A quick, low-pressure way for a student who's visited or messaged about a
// place to leave a signal for others — separate from Saving (private, just
// for you) and from messaging (asks the owner for a reply). Feedback is
// public on the listing, like a mini review, but kept to short presets
// instead of open text so it can't turn into a slow-moving complaints thread.
const FEEDBACK_PRESETS = [
  "Clean & tidy", "Great value", "Fast to respond", "As pictured",
  "Feels safe", "Good WiFi", "Noisy area", "Overpriced for what you get"
];

async function sendFeedback(hostelId, h, text, btn, picker) {
  picker.hidden = true;
  btn.disabled = true;
  btn.textContent = "Sent ✓";
  try {
    // A separate collection, not a field on the hostel doc itself — like
    // "reports", the sender creates a doc about someone else's listing
    // rather than writing onto it directly, which Firestore rules correctly
    // refuse to allow for any client but the owner.
    await addDoc(collection(db, "feedback"), {
      hostelId, ownerUid: h.ownerUid, hostelName: h.name || "a listing",
      fromUid: me.uid, fromName: myData.name || "A student", text, createdAt: serverTimestamp()
    });
    showToast("Feedback posted — thanks for helping other students.", { type: "success" });
  } catch (err) {
    console.error("Feedback failed:", err);
    btn.disabled = false;
    btn.textContent = "\u2728 Leave feedback";
    showToast("Couldn't post that — try again.", { type: "error" });
  }
}

closeDetailBtn.addEventListener("click", () => {
  detail.style.display = "none";
  closeChat();
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

load().catch(err => {
  console.error("Browse load failed:", err);
  document.querySelector(".loader-page")?.remove();
  grid.innerHTML = `<p class="muted">Couldn't load listings — check your connection and refresh.</p>`;
});
