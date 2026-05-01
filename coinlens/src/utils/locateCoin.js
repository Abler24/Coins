import { scanForMints } from '../data/mintLocations';
import { CULTURE_REGIONS } from '../data/cultureRegions';

// Words that often precede a real city in a Harvard title — used to bias
// which mint we pick when several appear.
const MINT_TRIGGERS = /\b(?:mint(?:ed)?|struck|coined?)\b/i;

/**
 * Best-effort location for a coin.
 * Returns { lat, lng, label, source, precision } or null.
 *
 * Strategy:
 *   1. Scan title for any known mint name. Prefer the LAST hit (mint usually
 *      comes after the ruler) and any hit immediately preceded by "minted at"
 *      / "struck at" / "from".
 *   2. Scan description if title yielded nothing.
 *   3. Fall back to the culture's heartland (precision='culture').
 */
export function locateCoin(coin) {
  const title = coin.title || '';
  const desc = coin.description || '';
  const culture = coin.culture || '';

  let pick = null;

  const titleHits = scanForMints(title);
  if (titleHits.length > 0) {
    // Bias toward "minted at X" patterns when present.
    const triggered = titleHits.find((h) => {
      const before = title.slice(Math.max(0, h.index - 20), h.index);
      return MINT_TRIGGERS.test(before);
    });
    pick = triggered || titleHits[titleHits.length - 1];
  } else {
    const descHits = scanForMints(desc);
    if (descHits.length > 0) {
      const triggered = descHits.find((h) => {
        const before = desc.slice(Math.max(0, h.index - 30), h.index);
        return MINT_TRIGGERS.test(before);
      });
      pick = triggered || descHits[0];
    }
  }

  if (pick) {
    const m = pick.mint;
    return {
      lat: m.lat,
      lng: m.lng,
      label: m.name,
      source: 'title',
      precision: m.kind, // 'city' | 'region'
    };
  }

  const region = CULTURE_REGIONS[culture];
  if (region) {
    return {
      lat: region.lat,
      lng: region.lng,
      label: region.label,
      source: 'culture',
      precision: 'culture',
    };
  }

  return null;
}

/**
 * Group an array of coins by their resolved location, then by coin "type"
 * (denomination + culture) within each location. Returns markers for the
 * collection-wide map view.
 *
 * Each marker carries:
 *   - { lat, lng, label, count, types[], topCoin }
 * where `types` is the list of distinct (culture, denomination) buckets at
 * that point, each with its own representative (highest-rank) coin.
 */
export function buildCollectionMarkers(coins) {
  const byLoc = new Map(); // key: "lat,lng" → { lat, lng, label, types: Map }

  for (const coin of coins) {
    const loc = locateCoin(coin);
    if (!loc) continue;
    const key = `${loc.lat.toFixed(3)},${loc.lng.toFixed(3)}`;
    let bucket = byLoc.get(key);
    if (!bucket) {
      bucket = {
        lat: loc.lat,
        lng: loc.lng,
        label: loc.label,
        types: new Map(),
      };
      byLoc.set(key, bucket);
    }

    const denom = (coin.details?.coins?.denomination || coin.denomination || '').trim();
    const typeKey = `${coin.culture || '?'}|${denom || coin.title || '?'}`;
    let t = bucket.types.get(typeKey);
    if (!t) {
      t = {
        culture: coin.culture || '',
        denomination: denom || '',
        rep: coin,
        count: 0,
      };
      bucket.types.set(typeKey, t);
    }
    t.count += 1;
    // Lowest rank number = most prominent — keep the best exemplar.
    if ((coin.rank ?? Infinity) < (t.rep.rank ?? Infinity)) {
      t.rep = coin;
    }
  }

  return Array.from(byLoc.values()).map((b) => ({
    lat: b.lat,
    lng: b.lng,
    label: b.label,
    types: Array.from(b.types.values()).sort((a, b) => b.count - a.count),
    count: Array.from(b.types.values()).reduce((s, t) => s + t.count, 0),
  }));
}
