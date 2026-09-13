// ------------------------------------------------------------------
// Applies the saved appearance (font, font color, background, blur) to
// the page BEFORE first paint, so a device that has customized any of
// these never sees a flash of the app's default styling first.
//
// This only works because it's a plain classic script — no
// type="module", no defer, no async — placed as the very first thing
// in <head>, before the stylesheet. Classic head scripts are
// parser-blocking, so it runs and sets the CSS variables on
// documentElement.style before the browser has anything to paint yet.
// (An ES module, by contrast, is always deferred — it would run too
// late to prevent the flash, which is exactly why this logic isn't
// just part of appearance.js.)
//
// Exposes window.LWAppearance so appearance.js (the ES module that
// wires up the Settings → Appearance controls, loaded later on pages
// that have them) reuses this exact state/logic instead of keeping a
// second copy that could quietly drift out of sync.
// ------------------------------------------------------------------
(function () {
  "use strict";
  var root = document.documentElement;
  var STORE_KEY = "lw-appearance";
  var CUSTOM_BG_KEY = "lw-appearance-bg-custom";

  var FONT_STACKS = {
    rajdhani: "'Rajdhani', -apple-system, sans-serif",
    poppins: "'Poppins', -apple-system, sans-serif",
    playfair: "'Playfair Display', Georgia, serif",
    quicksand: "'Quicksand', -apple-system, sans-serif",
    nunito: "'Nunito', -apple-system, sans-serif",
    dancing: "'Dancing Script', cursive",
    merriweather: "'Merriweather', Georgia, serif",
    spacegrotesk: "'Space Grotesk', -apple-system, sans-serif"
  };

  // Gradient-only "photos" tuned to the app's own palette — no external
  // images to fetch, license, or have fail to load.
  var BG_PRESETS = {
    none: "none",
    aurora: "radial-gradient(ellipse 60% 50% at 18% 15%, hsl(265 85% 42% / .38), transparent 60%)," +
            "radial-gradient(ellipse 55% 45% at 82% 25%, hsl(189 85% 45% / .3), transparent 60%)," +
            "radial-gradient(ellipse 70% 55% at 50% 95%, hsl(265 80% 22% / .45), transparent 65%)",
    rose:   "radial-gradient(ellipse 60% 50% at 20% 12%, hsl(332 78% 46% / .35), transparent 60%)," +
            "radial-gradient(ellipse 55% 50% at 85% 78%, hsl(18 82% 50% / .28), transparent 60%)," +
            "radial-gradient(ellipse 70% 55% at 50% 100%, hsl(285 55% 28% / .4), transparent 65%)",
    bloom:  "radial-gradient(circle at 14% 82%, hsl(302 82% 46% / .32), transparent 45%)," +
            "radial-gradient(circle at 86% 14%, hsl(255 78% 46% / .32), transparent 45%)," +
            "radial-gradient(circle at 50% 50%, hsl(200 75% 40% / .16), transparent 62%)"
  };

  var DEFAULTS = {
    family: "rajdhani", size: 16, weight: 400, spacing: 0, lineHeight: 1.5,
    blur: 10, bg: "none", color: ""
  };

  function load() {
    var state = {};
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { saved = {}; }
    for (var key in DEFAULTS) {
      state[key] = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : DEFAULTS[key];
    }
    return state;
  }

  function save(state) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or unavailable — nothing to do */ }
  }

  function apply(state, customDataUrl) {
    root.style.setProperty("--user-font-family", FONT_STACKS[state.family] || FONT_STACKS.rajdhani);
    root.style.setProperty("--user-font-size", state.size + "px");
    root.style.setProperty("--user-font-weight", state.weight);
    root.style.setProperty("--user-letter-spacing", state.spacing + "px");
    root.style.setProperty("--user-line-height", state.lineHeight);
    root.style.setProperty("--user-font-color", state.color || "var(--text)");
    // Blurs the whole fixed background layer (body::before/::after in
    // styles.css), not just whatever happens to sit behind a card.
    root.style.setProperty("--glass-blur", state.blur + "px");

    // A photo from the user's own device gets two layers: a blurred,
    // full-bleed "ambient" copy (::before) and a sharp, uncropped copy
    // sized with `contain` (::after) so the photo itself is never zoomed,
    // cropped, or stretched — only centered and scaled to fit the screen.
    var isCustomPhoto = state.bg === "custom" && !!customDataUrl;
    var ambientImage = isCustomPhoto ? ('url("' + customDataUrl + '")') : (BG_PRESETS[state.bg] || BG_PRESETS.none);
    root.style.setProperty("--bg-preset-image", ambientImage);
    root.style.setProperty("--bg-photo-image", isCustomPhoto ? ('url("' + customDataUrl + '")') : "none");
    root.style.setProperty("--bg-ambient-blur", isCustomPhoto ? "46px" : "0px");
  }

  var state = load();
  var customDataUrl = null;
  try { customDataUrl = localStorage.getItem(CUSTOM_BG_KEY); } catch (e) { customDataUrl = null; }
  apply(state, customDataUrl);

  window.LWAppearance = {
    STORE_KEY: STORE_KEY,
    CUSTOM_BG_KEY: CUSTOM_BG_KEY,
    FONT_STACKS: FONT_STACKS,
    BG_PRESETS: BG_PRESETS,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    apply: apply,
    state: state,
    customDataUrl: customDataUrl
  };
})();
