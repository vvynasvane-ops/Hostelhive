// A small, transparent scoring function — no hidden ranking algorithm.
// Each stated search preference that a hostel fits adds points; a blank
// or unset preference simply doesn't filter anything out.

function norm(v) {
  return (v || "").toString().trim().toLowerCase();
}

export function matchScore(myPrefs, hostel) {
  if (!myPrefs) return 0;
  let score = 0;

  const priceMin = Number(myPrefs.priceMin) || 0;
  const priceMax = Number(myPrefs.priceMax) || 0;
  if (hostel.price && (priceMin || priceMax)) {
    const okMin = !priceMin || hostel.price >= priceMin;
    const okMax = !priceMax || hostel.price <= priceMax;
    if (okMin && okMax) score += 3;
  }

  const maxDist = Number(myPrefs.maxDistanceKm) || 0;
  if (maxDist && hostel.distanceKm != null && hostel.distanceKm <= maxDist) score += 2;

  if (myPrefs.area && norm(myPrefs.area) && norm(hostel.area).includes(norm(myPrefs.area))) score += 2;

  const wanted = Array.isArray(myPrefs.necessities) ? myPrefs.necessities : [];
  const has = Array.isArray(hostel.necessities) ? hostel.necessities : [];
  const overlap = wanted.filter(n => has.includes(n)).length;
  score += Math.min(overlap, 4); // one point per shared necessity, capped so one giant checklist can't drown out price/distance fit

  return score;
}

/** True once at least one search preference has been set. */
export function hasPreferences(myPrefs) {
  if (!myPrefs) return false;
  return !!(myPrefs.priceMin || myPrefs.priceMax || myPrefs.maxDistanceKm || myPrefs.area
    || (Array.isArray(myPrefs.necessities) && myPrefs.necessities.length));
}
