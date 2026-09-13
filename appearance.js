// ------------------------------------------------------------------
// Wires up the Settings → Appearance controls (font, font color,
// background image, blur). The actual state and CSS-variable logic
// live in appearance-core.js — a plain classic script loaded first in
// <head> on every page, which applies the saved appearance before
// first paint (so there's never a flash of default styling) and
// exposes it all as window.LWAppearance. This module reuses that same
// state/functions rather than keeping a second copy.
// ------------------------------------------------------------------
import { showToast } from "./notifications.js";

const root = document.documentElement;

// window.LWAppearance is set by appearance-core.js, which must be a
// classic <script> placed before this module runs. Guard against it
// being missing (e.g. the tag got removed from a page by mistake) so a
// broken page doesn't also lose the rest of Settings.
const LW = window.LWAppearance || (function () {
  console.error("appearance-core.js didn't run before appearance.js — check its <script> tag is present in <head>.");
  const fallbackDefaults = { family: "rajdhani", size: 16, weight: 400, spacing: 0, lineHeight: 1.5, blur: 10, bg: "none", color: "" };
  return {
    STORE_KEY: "lw-appearance", CUSTOM_BG_KEY: "lw-appearance-bg-custom",
    FONT_STACKS: { rajdhani: "'Rajdhani', -apple-system, sans-serif" },
    BG_PRESETS: { none: "none" }, DEFAULTS: fallbackDefaults,
    load: () => ({ ...fallbackDefaults }), save: () => {}, apply: () => {},
    state: { ...fallbackDefaults }, customDataUrl: null
  };
})();

const { CUSTOM_BG_KEY, DEFAULTS, save, apply } = LW;

export const FONT_LABELS = {
  rajdhani: "Rajdhani (default)",
  poppins: "Poppins — clean & modern",
  playfair: "Playfair Display — elegant serif",
  quicksand: "Quicksand — soft & friendly",
  nunito: "Nunito — warm & rounded",
  dancing: "Dancing Script — flowing cursive",
  merriweather: "Merriweather — classic reading serif",
  spacegrotesk: "Space Grotesk — sleek & techy"
};
export const BG_PRESET_LABELS = { none: "None (default)", aurora: "Aurora Deep", rose: "Rosé Dusk", bloom: "Midnight Bloom", custom: "Your photo" };

/** Downscales an uploaded photo before it goes anywhere near localStorage
 *  (device storage quotas are typically 5–10MB total, shared with
 *  everything else the app stores) — long edge capped at 1600px, saved
 *  as a compressed JPEG data URL. */
function downscaleImage(file, maxEdge = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => { img.src = reader.result; };
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    reader.readAsDataURL(file);
  });
}

const clamp255 = n => Math.max(0, Math.min(255, Math.round(n)));
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(v => clamp255(v).toString(16).padStart(2, "0")).join("");
}

/** Call once per page (alongside initTheme()) to wire up the controls on
 *  pages that have them in the DOM. The appearance itself is already
 *  applied to the page by appearance-core.js before this ever runs — this
 *  just syncs the on-screen controls to match and attaches listeners.
 *  Safe to call on pages without any of these elements. */
export function initAppearance() {
  const state = LW.state;
  let customDataUrl = LW.customDataUrl;

  const persistAndToast = (label) => {
    save(state);
    showToast(`${label} saved`, { type: "success", duration: 1800 });
  };

  // Font family
  const familySel = document.querySelector("#appearance-font-family");
  if (familySel) {
    familySel.value = state.family;
    familySel.addEventListener("change", () => {
      state.family = familySel.value;
      apply(state, customDataUrl);
      persistAndToast("Font");
    });
  }

  // Range-style controls: id -> [stateKey, unitSuffix for the live readout]
  const ranges = [
    ["appearance-font-size", "size", "px"],
    ["appearance-font-weight", "weight", ""],
    ["appearance-letter-spacing", "spacing", "px"],
    ["appearance-line-height", "lineHeight", ""],
    ["appearance-blur", "blur", "px"]
  ];
  ranges.forEach(([id, key, unit]) => {
    const input = document.querySelector(`#${id}`);
    const label = document.querySelector(`#${id}-val`);
    if (!input) return;
    input.value = state[key];
    if (label) label.textContent = state[key] + unit;
    input.addEventListener("input", () => {
      state[key] = key === "lineHeight" ? parseFloat(input.value) : Number(input.value);
      apply(state, customDataUrl);
      if (label) label.textContent = state[key] + unit;
    });
    input.addEventListener("change", () => persistAndToast("Appearance"));
  });

  // Font color — RGB sliders, same pattern as the accent color picker in
  // the Theme card, with a live swatch preview. An empty state.color means
  // "no override" (follow the theme's own text color, which still tracks
  // dark/light mode) — the default button restores that.
  const colorSwatch = document.querySelector("#font-color-swatch");
  const rInput = document.querySelector("#font-color-r");
  const gInput = document.querySelector("#font-color-g");
  const bInput = document.querySelector("#font-color-b");
  const rVal = document.querySelector("#font-color-r-val");
  const gVal = document.querySelector("#font-color-g-val");
  const bVal = document.querySelector("#font-color-b-val");
  const defaultBtn = document.querySelector("#font-color-default-btn");
  const paintColorSwatch = () => { if (colorSwatch) colorSwatch.style.background = state.color || "var(--text)"; };
  const setSliderReadouts = (r, g, b) => {
    if (rInput) rInput.value = r; if (rVal) rVal.textContent = r;
    if (gInput) gInput.value = g; if (gVal) gVal.textContent = g;
    if (bInput) bInput.value = b; if (bVal) bVal.textContent = b;
  };
  if (rInput && gInput && bInput) {
    const initRgb = hexToRgb(state.color) || { r: 245, g: 241, b: 230 }; // matches --text's warm cream, a sensible starting point when following the theme default
    setSliderReadouts(initRgb.r, initRgb.g, initRgb.b);
    paintColorSwatch();
    const updateFromSliders = () => {
      state.color = rgbToHex(+rInput.value, +gInput.value, +bInput.value);
      if (rVal) rVal.textContent = rInput.value;
      if (gVal) gVal.textContent = gInput.value;
      if (bVal) bVal.textContent = bInput.value;
      apply(state, customDataUrl);
      paintColorSwatch();
    };
    [rInput, gInput, bInput].forEach(input => {
      input.addEventListener("input", updateFromSliders);
      input.addEventListener("change", () => persistAndToast("Font color"));
    });
  }
  if (defaultBtn) {
    defaultBtn.addEventListener("click", () => {
      state.color = "";
      apply(state, customDataUrl);
      paintColorSwatch();
      persistAndToast("Font color");
    });
  }

  // Background image presets — a row of swatch buttons
  const bgButtons = document.querySelectorAll("[data-bg-preset]");
  const customSwatch = document.querySelector("#bg-custom-swatch");
  const customThumbIcon = document.querySelector("#bg-custom-thumb-icon");
  function markActiveSwatch() {
    bgButtons.forEach(b => b.classList.toggle("active", b.dataset.bgPreset === state.bg));
    if (customSwatch) customSwatch.classList.toggle("active", state.bg === "custom");
  }
  function paintCustomThumb() {
    if (!customSwatch) return;
    if (customDataUrl) {
      customSwatch.style.backgroundImage = `url("${customDataUrl}")`;
      customSwatch.style.backgroundSize = "cover";
      customSwatch.style.backgroundPosition = "center";
      if (customThumbIcon) customThumbIcon.style.display = "none";
    } else {
      customSwatch.style.backgroundImage = "none";
      if (customThumbIcon) customThumbIcon.style.display = "block";
    }
  }
  if (bgButtons.length) {
    bgButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        state.bg = btn.dataset.bgPreset;
        apply(state, customDataUrl);
        markActiveSwatch();
        persistAndToast("Background");
      });
    });
    markActiveSwatch();
  }

  // Background image from the user's own device
  const bgUpload = document.querySelector("#appearance-bg-upload");
  if (bgUpload) {
    paintCustomThumb();
    bgUpload.addEventListener("change", async () => {
      const file = bgUpload.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) { showToast("Pick an image file.", { type: "error" }); return; }
      try {
        const dataUrl = await downscaleImage(file);
        localStorage.setItem(CUSTOM_BG_KEY, dataUrl);
        customDataUrl = dataUrl;
        LW.customDataUrl = dataUrl;
        state.bg = "custom";
        apply(state, customDataUrl);
        markActiveSwatch();
        paintCustomThumb();
        save(state);
        showToast("Background photo saved to this device.", { type: "success" });
      } catch (err) {
        console.error("Background upload failed:", err);
        // Most likely cause: localStorage quota exceeded even after
        // downscaling (an old custom photo plus a new one, on a device
        // already near its storage limit).
        showToast("Couldn't save that photo — try a smaller image.", { type: "error" });
      } finally {
        bgUpload.value = "";
      }
    });
  }

  // Reset to defaults
  const resetBtn = document.querySelector("#appearance-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      Object.assign(state, DEFAULTS);
      customDataUrl = null;
      LW.customDataUrl = null;
      try { localStorage.removeItem(CUSTOM_BG_KEY); } catch {}
      apply(state, customDataUrl);
      save(state);
      if (familySel) familySel.value = state.family;
      ranges.forEach(([id, key, unit]) => {
        const input = document.querySelector(`#${id}`);
        const label = document.querySelector(`#${id}-val`);
        if (input) input.value = state[key];
        if (label) label.textContent = state[key] + unit;
      });
      const resetRgb = hexToRgb("#f5f1e6");
      setSliderReadouts(resetRgb.r, resetRgb.g, resetRgb.b);
      paintColorSwatch();
      markActiveSwatch();
      paintCustomThumb();
      showToast("Appearance reset to defaults", { type: "success", duration: 2000 });
    });
  }
}
