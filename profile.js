import {
  requireAuth, db, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, signOut, auth,
  collection, getDocs, query, where, serverTimestamp
} from "./firebase-init.js";
import { fileToCompressedDataURL } from "./img-utils.js";
import { initTheme } from "./theme.js";
import { renderNav } from "./nav.js";
import { generateListingCode, loaderTrackHtml, loaderPhotoHtml, escapeHtml, NECESSITIES, placeholderPhoto } from "./common.js";
import { startPresence } from "./presence.js";
import { showToast, savedToast, initNotifications } from "./notifications.js";

initTheme();
renderNav("profile");
document.body.insertAdjacentHTML("beforeend", loaderTrackHtml("Loading your listings"));

const nameEl = document.querySelector("#name");
const phoneEl = document.querySelector("#phone");
const photoPreview = document.querySelector("#photo-preview");
const photoFileInput = document.querySelector("#photoFile");
const uploadHint = document.querySelector(".upload-hint");
const showOnlineStatusEl = document.querySelector("#show-online-status");
const saveAccountBtn = document.querySelector("#save-account");
const logoutBtn = document.querySelector("#logout-btn");
const feedbackCard = document.querySelector("#feedback-card");
const feedbackSummary = document.querySelector("#feedback-summary");
const feedbackList = document.querySelector("#feedback-list");
const clearFeedbackBtn = document.querySelector("#clear-feedback");

const listingFormTitle = document.querySelector("#listing-form-title");
const hNameEl = document.querySelector("#h-name");
const hPriceEl = document.querySelector("#h-price");
const hDistanceEl = document.querySelector("#h-distance");
const hAreaEl = document.querySelector("#h-area");
const hAddressEl = document.querySelector("#h-address");
const hNecessitiesBox = document.querySelector("#h-necessities");
const hDescriptionEl = document.querySelector("#h-description");
const hContactEl = document.querySelector("#h-contact");
const hPhotosFile = document.querySelector("#h-photos-file");
const hPhotosPreview = document.querySelector("#h-photos-preview");
const saveListingBtn = document.querySelector("#save-listing");
const cancelEditBtn = document.querySelector("#cancel-edit");
const myListingsGrid = document.querySelector("#my-listings-grid");
const noListings = document.querySelector("#no-listings");

hNecessitiesBox.innerHTML = NECESSITIES.map((n, i) => `
  <label for="h-nec-${i}"><input type="checkbox" id="h-nec-${i}" value="${escapeHtml(n)}">${escapeHtml(n)}</label>
`).join("");

let user, userRef, pendingPhotoURL = null, myListings = [], editingId = null, pendingPhotos = [];

async function load() {
  user = await requireAuth();
  startPresence(user.uid);
  userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  let data = snap.data();

  // The auth-time doc creation didn't happen (deleted doc, manual Firebase
  // Auth account, or an interrupted signup). Rebuild it here instead of
  // crashing, so this page — and the Save buttons below, which use
  // updateDoc() and require the doc to already exist — work again.
  if (!data) {
    data = {
      name: user.displayName || "New student", photoURL: user.photoURL || "", phone: "",
      showOnlineStatus: true,
      savedHostels: [], blockedUsers: [],
      preferences: { priceMin: null, priceMax: null, maxDistanceKm: null, area: "", necessities: [] },
      createdAt: Date.now()
    };
    await setDoc(userRef, data);
    showToast("We had to rebuild your account record — please double-check your details below.", { type: "info" });
  }

  document.querySelector(".loader-page")?.remove();
  nameEl.value = data.name || "";
  phoneEl.value = data.phone || "";
  pendingPhotoURL = data.photoURL || "";
  photoPreview.src = data.photoURL || placeholderPhoto();
  showOnlineStatusEl.checked = data.showOnlineStatus !== false;

  initNotifications(user.uid, data.preferences);
  await loadMyListings(user.uid);
  await loadFeedback(user.uid, data.feedbackClearedAt || 0);
}

async function loadMyListings(uid) {
  try {
    const snap = await getDocs(query(collection(db, "hostels"), where("ownerUid", "==", uid)));
    myListings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    myListings.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderMyListings();
  } catch (err) {
    console.error("Couldn't load your listings:", err);
    myListingsGrid.innerHTML = `<p class="muted">Couldn't load your listings — check your connection and refresh.</p>`;
  }
}

function renderMyListings() {
  noListings.style.display = myListings.length ? "none" : "block";
  myListingsGrid.innerHTML = myListings.map(h => `
    <div class="person-card" data-hostel-id="${h.id}" style="cursor:default;">
      <img class="person-photo" src="${(h.photos && h.photos[0]) || placeholderPhoto()}" alt="${escapeHtml(h.name || "Hostel")}">
      <div class="person-meta">
        <div class="person-name">${escapeHtml(h.name || "Hostel")}</div>
        <div class="person-sub">${h.price ? `KES ${Number(h.price).toLocaleString()}/mo` : "Price on request"}</div>
        <div class="person-sub">${h.viewCount || 0} view${h.viewCount === 1 ? "" : "s"} · Listing ${escapeHtml(h.code || "")}</div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button type="button" class="btn ghost small" data-edit="${h.id}">Edit</button>
          <button type="button" class="btn ghost small" data-delete="${h.id}">Delete</button>
        </div>
      </div>
    </div>`).join("");
  myListingsGrid.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => startEdit(btn.dataset.edit)));
  myListingsGrid.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => deleteListing(btn.dataset.delete)));
}

/** Live-watches the `feedback` collection for docs on any hostel this member
 * owns (see discover.js's quick-feedback chips). `clearedAt` (my own doc's
 * own field, so I can write it myself) hides anything left before the last
 * time I hit "Clear all" — the underlying docs stay put, only my own view
 * of them changes; other students still see feedback on the listing itself. */
async function loadFeedback(uid, clearedAt) {
  try {
    const snap = await getDocs(query(collection(db, "feedback"), where("ownerUid", "==", uid)));
    let list = snap.docs.map(d => d.data());
    if (clearedAt) list = list.filter(f => (f.createdAt?.toMillis?.() || 0) > clearedAt);
    list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    renderFeedback(list);
  } catch (err) {
    console.error("Couldn't load feedback:", err);
  }
}

function renderFeedback(list) {
  if (!list.length) { feedbackCard.style.display = "none"; return; }
  feedbackCard.style.display = "block";
  feedbackSummary.textContent = `${list.length} student${list.length === 1 ? "" : "s"} left feedback on your listings.`;
  feedbackList.innerHTML = list.slice(0, 10).map(f => `
    <div class="appreciation-item">
      <div class="appreciation-from">${escapeHtml(f.hostelName || "A listing")}</div>
      <div>${escapeHtml(f.text || "")}</div>
    </div>`).join("");
}

clearFeedbackBtn.addEventListener("click", async () => {
  if (!confirm("Clear all feedback from this view? This only clears your view — it can't be undone, and it stays visible to students on the listing itself.")) return;
  clearFeedbackBtn.disabled = true;
  try {
    const clearedAt = Date.now();
    await updateDoc(userRef, { feedbackClearedAt: clearedAt });
    renderFeedback([]);
    showToast("Cleared.", { type: "success" });
  } catch (err) {
    console.error("Clear feedback failed:", err);
    showToast("Couldn't clear those — try again.", { type: "error" });
  } finally {
    clearFeedbackBtn.disabled = false;
  }
});

photoFileInput.addEventListener("change", async () => {
  const file = photoFileInput.files[0];
  if (!file) return;
  const hintText = uploadHint.textContent;
  uploadHint.innerHTML = loaderPhotoHtml() + ` <span style="vertical-align:middle;">Processing photo…</span>`;
  try {
    const dataUrl = await fileToCompressedDataURL(file, 480, 0.65);
    pendingPhotoURL = dataUrl;
    photoPreview.src = dataUrl;
    showToast("Photo ready — hit Save account to keep it.", { type: "info" });
  } catch (err) {
    showToast(err.message || "Couldn't process that image.", { type: "error" });
  } finally {
    uploadHint.textContent = hintText;
  }
});

saveAccountBtn.addEventListener("click", async () => {
  saveAccountBtn.disabled = true;
  try {
    await updateDoc(userRef, {
      name: nameEl.value.trim(),
      phone: phoneEl.value.trim(),
      photoURL: pendingPhotoURL || "",
      showOnlineStatus: showOnlineStatusEl.checked
    });
    savedToast("Account");
  } finally {
    saveAccountBtn.disabled = false;
  }
});

// ---- Add / edit a hostel listing ----
function renderListingPhotos() {
  hPhotosPreview.innerHTML = pendingPhotos.map((src, i) => `
    <div class="extra-photo-thumb">
      <img src="${src}" alt="">
      <button type="button" data-remove="${i}" title="Remove">×</button>
    </div>`).join("");
  hPhotosPreview.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      pendingPhotos.splice(Number(btn.dataset.remove), 1);
      renderListingPhotos();
    });
  });
}

hPhotosFile.addEventListener("change", async () => {
  const files = Array.from(hPhotosFile.files || []);
  hPhotosFile.value = "";
  if (!files.length) return;
  hPhotosPreview.innerHTML = `<div class="loader-wrap" style="padding:12px;">${loaderPhotoHtml()}<div class="loader-label">Processing photos</div></div>`;
  for (const file of files.slice(0, 6 - pendingPhotos.length)) {
    try {
      const dataUrl = await fileToCompressedDataURL(file, 640, 0.6);
      pendingPhotos.push(dataUrl);
    } catch (err) {
      showToast(err.message || "Couldn't process one of those images.", { type: "error" });
    }
  }
  renderListingPhotos();
  showToast("Photos ready — hit Publish/Save to keep them.", { type: "info" });
});

function resetListingForm() {
  editingId = null;
  pendingPhotos = [];
  listingFormTitle.textContent = "Add a hostel";
  saveListingBtn.textContent = "Publish listing";
  cancelEditBtn.style.display = "none";
  hNameEl.value = ""; hPriceEl.value = ""; hDistanceEl.value = ""; hAreaEl.value = "";
  hAddressEl.value = ""; hDescriptionEl.value = ""; hContactEl.value = "";
  hNecessitiesBox.querySelectorAll("input").forEach(cb => (cb.checked = false));
  renderListingPhotos();
}

function startEdit(id) {
  const h = myListings.find(x => x.id === id);
  if (!h) return;
  editingId = id;
  pendingPhotos = [...(h.photos || [])];
  listingFormTitle.textContent = `Editing ${h.name || "listing"}`;
  saveListingBtn.textContent = "Save changes";
  cancelEditBtn.style.display = "inline-flex";
  hNameEl.value = h.name || "";
  hPriceEl.value = h.price || "";
  hDistanceEl.value = h.distanceKm ?? "";
  hAreaEl.value = h.area || "";
  hAddressEl.value = h.address || "";
  hDescriptionEl.value = h.description || "";
  hContactEl.value = h.contact || "";
  const wanted = new Set(h.necessities || []);
  hNecessitiesBox.querySelectorAll("input").forEach(cb => (cb.checked = wanted.has(cb.value)));
  renderListingPhotos();
  document.querySelector("#listing-form-title").scrollIntoView({ behavior: "smooth", block: "start" });
}
cancelEditBtn.addEventListener("click", resetListingForm);

saveListingBtn.addEventListener("click", async () => {
  const name = hNameEl.value.trim();
  if (!name) { showToast("Give the listing a name first.", { type: "error" }); return; }
  saveListingBtn.disabled = true;
  try {
    const fields = {
      name,
      price: hPriceEl.value ? Number(hPriceEl.value) : null,
      distanceKm: hDistanceEl.value ? Number(hDistanceEl.value) : null,
      area: hAreaEl.value.trim(),
      address: hAddressEl.value.trim(),
      necessities: Array.from(hNecessitiesBox.querySelectorAll("input:checked")).map(cb => cb.value),
      description: hDescriptionEl.value.trim(),
      contact: hContactEl.value.trim(),
      photos: pendingPhotos
    };
    if (editingId) {
      await updateDoc(doc(db, "hostels", editingId), fields);
      showToast("Listing updated.", { type: "success" });
    } else {
      await addDoc(collection(db, "hostels"), {
        ...fields,
        ownerUid: user.uid,
        code: generateListingCode(),
        viewCount: 0,
        createdAt: Date.now()
      });
      showToast("Listing published — students can find it in Browse now.", { type: "success" });
    }
    resetListingForm();
    await loadMyListings(user.uid);
  } catch (err) {
    console.error("Saving listing failed:", err);
    showToast("Couldn't save that listing — try again.", { type: "error" });
  } finally {
    saveListingBtn.disabled = false;
  }
});

async function deleteListing(id) {
  const h = myListings.find(x => x.id === id);
  if (!confirm(`Delete "${h?.name || "this listing"}"? It disappears from Browse and everyone's Saved list right away — this can't be undone.`)) return;
  try {
    await deleteDoc(doc(db, "hostels", id));
    if (editingId === id) resetListingForm();
    await loadMyListings(user.uid);
    showToast("Listing deleted.", { type: "success" });
  } catch (err) {
    console.error("Delete listing failed:", err);
    showToast("Couldn't delete that — try again.", { type: "error" });
  }
}

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

load().catch(err => {
  console.error("My Listings load failed:", err);
  document.querySelector(".loader-page")?.remove();
  showToast("Couldn't load your listings — check your connection and refresh.", { type: "error" });
});
