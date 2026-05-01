import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { locateCoin, buildCollectionMarkers } from '../utils/locateCoin';
import { MINTS } from '../data/mintLocations';

// Equirectangular projection. The viewport (lng/lat extents) is continuous —
// the user pans by dragging and zooms with the wheel; the named "tabs" become
// presets that animate to those extents instead of snapping.
const VIEW_PRESETS = {
  med: { name: 'Mediterranean', lng0: -15, lng1: 65, lat0: 12, lat1: 58, minCount: 5 },
  europe: { name: 'Europe', lng0: -15, lng1: 45, lat0: 30, lat1: 65, minCount: 3 },
  east: { name: 'Near East', lng0: 20, lng1: 80, lat0: 12, lat1: 50, minCount: 3 },
  world: { name: 'World', lng0: -180, lng1: 180, lat0: -60, lat1: 75, minCount: 25 },
};

const W = 1100;
const H = 620;

function project(lat, lng, view) {
  const x = ((lng - view.lng0) / (view.lng1 - view.lng0)) * W;
  const y = ((view.lat1 - lat) / (view.lat1 - view.lat0)) * H;
  return [x, y];
}

function unproject(x, y, view) {
  const lng = view.lng0 + (x / W) * (view.lng1 - view.lng0);
  const lat = view.lat1 - (y / H) * (view.lat1 - view.lat0);
  return [lat, lng];
}

// Deterministic jitter — returns offsets in (latΔ, lngΔ) so the displaced
// position is anchored to the geography, not the screen. With pixel jitter,
// coins visually drift relative to land when zooming; with geographic jitter
// they stay put and the cluster simply tightens or spreads as the user zooms.
function jitter(seed, radiusDeg = 0.6) {
  const a = Math.sin(seed * 12.9898) * 43758.5453;
  const b = Math.sin(seed * 78.233) * 24634.6345;
  const ang = (a - Math.floor(a)) * Math.PI * 2;
  const r = Math.sqrt(b - Math.floor(b)) * radiusDeg; // sqrt → uniform area
  return [Math.sin(ang) * r, Math.cos(ang) * r]; // [latΔ, lngΔ]
}

let _landPromise = null;
function loadLand() {
  if (!_landPromise) {
    _landPromise = fetch('/world-land-110m.json').then((r) => r.json());
  }
  return _landPromise;
}

// Project every point of every land polygon. We do NOT pre-filter points
// outside the viewport — that's what was causing the diagonal phantom lines
// when zooming. Dropping a midpoint of a ring leaves SVG to connect the
// surviving neighbors with a straight line, slicing across the visible map.
// Instead we project everything and rely on a <clipPath> at the viewBox
// boundary to clip the rendered geometry to the visible area.
function landPaths(geojson, view) {
  if (!geojson) return [];
  const out = [];
  for (const feat of geojson.features || []) {
    const g = feat.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const rings = poly
        .map((ring) => {
          if (ring.length < 3) return null;
          const pts = ring.map(([lng, lat]) => project(lat, lng, view));
          // No filtering — let the SVG <clipPath> on the wrapping <g> trim
          // anything outside the viewBox. Filtering here is what created the
          // diagonal phantom lines (a midpoint dropped outside the viewport
          // would let SVG connect its surviving neighbors with a straight L).
          return 'M ' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z';
        })
        .filter(Boolean);
      if (rings.length) out.push(rings.join(' '));
    }
  }
  return out;
}

const REGION_LABELS = [
  { name: 'Italia', lat: 42.5, lng: 12.5 },
  { name: 'Hellas', lat: 39.0, lng: 22.0 },
  { name: 'Asia Minor', lat: 39.0, lng: 32.0 },
  { name: 'Aegyptus', lat: 26.5, lng: 30.5 },
  { name: 'Africa', lat: 32.0, lng: 8.0 },
  { name: 'Hispania', lat: 40.0, lng: -4.5 },
  { name: 'Gallia', lat: 47.0, lng: 2.0 },
  { name: 'Britannia', lat: 53.0, lng: -2.0 },
  { name: 'Germania', lat: 51.0, lng: 11.0 },
  { name: 'Pannonia', lat: 46.0, lng: 18.0 },
  { name: 'Thracia', lat: 42.5, lng: 26.0 },
  { name: 'Phoenicia', lat: 34.5, lng: 36.0 },
  { name: 'Mesopotamia', lat: 34.0, lng: 43.5 },
  { name: 'Persia', lat: 32.5, lng: 53.5 },
  { name: 'Bactria', lat: 36.5, lng: 67.0 },
  { name: 'Arabia', lat: 22.0, lng: 45.0 },
  { name: 'India', lat: 22.0, lng: 78.0 },
  { name: 'Sina', lat: 35.0, lng: 110.0 },
  { name: 'Mare Nostrum', lat: 36.5, lng: 17.5, sea: true },
  { name: 'Mare Aegaeum', lat: 38.0, lng: 25.0, sea: true },
  { name: 'Pontus Euxinus', lat: 43.5, lng: 35.0, sea: true },
  { name: 'Mare Erythraeum', lat: 16.0, lng: 40.0, sea: true },
  { name: 'Oceanus Atlanticus', lat: 40.0, lng: -22.0, sea: true },
];

function inView(lat, lng, view) {
  return lat >= view.lat0 && lat <= view.lat1 && lng >= view.lng0 && lng <= view.lng1;
}

// Geometry for placing a coin source image inside a 2r × 2r dest box.
// Combined photos (`_dynmc` URLs) are 2:1 obverse|reverse — left-half slice
// shows just the obverse. Everything else is centered.
function coinImageProps(r, kind) {
  const isCombined = kind === 'combined';
  return {
    x: 0,
    y: 0,
    width: 2 * r,
    height: 2 * r,
    preserveAspectRatio: isCombined ? 'xMinYMid slice' : 'xMidYMid slice',
  };
}

// Compute a viewport that frames every (lat, lng) in `pts` with padding.
// Falls back to the Med preset if the points don't form a sensible bbox
// (single point, or all clustered to a degree of resolution).
function fitViewportTo(pts, padFrac = 0.18, minSpanLng = 3, minSpanLat = 2) {
  if (!pts.length) return VIEW_PRESETS.med;
  let lng0 = Infinity, lng1 = -Infinity, lat0 = Infinity, lat1 = -Infinity;
  for (const [lat, lng] of pts) {
    if (lng < lng0) lng0 = lng;
    if (lng > lng1) lng1 = lng;
    if (lat < lat0) lat0 = lat;
    if (lat > lat1) lat1 = lat;
  }
  let spanLng = lng1 - lng0;
  let spanLat = lat1 - lat0;
  // Keep aspect ratio roughly 1100:620 so the viewport doesn't stretch.
  const targetAspect = W / H; // ≈ 1.77
  // If the bbox is too narrow in either dimension, expand to a minimum.
  if (spanLng < minSpanLng) {
    const c = (lng0 + lng1) / 2;
    lng0 = c - minSpanLng / 2;
    lng1 = c + minSpanLng / 2;
    spanLng = minSpanLng;
  }
  if (spanLat < minSpanLat) {
    const c = (lat0 + lat1) / 2;
    lat0 = c - minSpanLat / 2;
    lat1 = c + minSpanLat / 2;
    spanLat = minSpanLat;
  }
  // Pad
  const padLng = spanLng * padFrac;
  const padLat = spanLat * padFrac;
  lng0 -= padLng; lng1 += padLng; lat0 -= padLat; lat1 += padLat;
  spanLng = lng1 - lng0;
  spanLat = lat1 - lat0;
  // Match aspect: if too narrow horizontally, widen lng; if too tall, widen lat.
  const aspect = spanLng / spanLat;
  if (aspect < targetAspect) {
    const targetSpanLng = spanLat * targetAspect;
    const c = (lng0 + lng1) / 2;
    lng0 = c - targetSpanLng / 2;
    lng1 = c + targetSpanLng / 2;
  } else if (aspect > targetAspect) {
    const targetSpanLat = spanLng / targetAspect;
    const c = (lat0 + lat1) / 2;
    lat0 = c - targetSpanLat / 2;
    lat1 = c + targetSpanLat / 2;
  }
  return { lng0, lng1, lat0, lat1, minCount: 1 };
}

// Cubic ease-in-out, returns 0..1 for input 0..1
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function CoinMedallion({ coin, x, y, r, renderUrl, renderKind, isHover, onMouseEnter, onMouseMove, onClick }) {
  const [detectedKind, setDetectedKind] = useState(renderKind);
  useEffect(() => { setDetectedKind(renderKind); }, [renderUrl, renderKind]);

  const handleLoad = useCallback((e) => {
    const url = e.target.href?.baseVal || e.target.getAttribute('href');
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > img.naturalHeight * 1.6) setDetectedKind('combined');
    };
    img.src = url;
  }, []);

  const imgProps = coinImageProps(r, detectedKind);
  return (
    <g
      className="search-coin-medallion"
      transform={`translate(${x - r} ${y - r})`}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onClick={onClick}
    >
      {renderUrl ? (
        <image href={renderUrl} clipPath="url(#coinClip)" {...imgProps} onLoad={handleLoad} />
      ) : (
        <circle cx={r} cy={r} r={r} fill="#b8861f" />
      )}
      <circle cx={r} cy={r} r={r} fill="transparent" style={{ cursor: 'pointer' }} />
    </g>
  );
}

export default function WorldMap({
  coins = [],
  mode = 'search',
  onCoinClick,
  defaultView = 'med',
  totalKnown,
}) {
  const [view, setView] = useState(() => ({ ...VIEW_PRESETS[defaultView] }));
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const [presetKey, setPresetKey] = useState(defaultView);
  const [land, setLand] = useState(null);
  const [hover, setHover] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);
  const [minCountOverride, setMinCountOverride] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const animRef = useRef(null);

  const effectiveMinCount = minCountOverride ?? (VIEW_PRESETS[presetKey]?.minCount ?? 5);
  const renderView = useMemo(
    () => ({ ...view, minCount: effectiveMinCount }),
    [view, effectiveMinCount],
  );

  // ── Animation ──────────────────────────────────────────────────────
  // Smoothly tween the viewport to a target over `duration` ms.
  const animateTo = useCallback((target, duration = 700) => {
    const start = { ...view };
    const t0 = performance.now();
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const k = easeInOut(t);
      const v = {
        lng0: start.lng0 + (target.lng0 - start.lng0) * k,
        lng1: start.lng1 + (target.lng1 - start.lng1) * k,
        lat0: start.lat0 + (target.lat0 - start.lat0) * k,
        lat1: start.lat1 + (target.lat1 - start.lat1) * k,
      };
      setView(v);
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, [view]);

  // ── Resolve coins to mint locations ────────────────────────────────
  const located = useMemo(
    () => coins.map((coin) => ({ coin, loc: locateCoin(coin) })).filter((x) => x.loc),
    [coins],
  );
  const collectionMarkers = useMemo(
    () => (mode === 'collection' ? buildCollectionMarkers(coins) : []),
    [coins, mode],
  );

  // ── Auto-animate to fit the search results ─────────────────────────
  // On each new search, first zoom out to the full world view, then swoop
  // into the region containing the results. Uses a direct two-phase RAF
  // loop so the "from world" start is reliable regardless of current view.
  const lastCoinsKeyRef = useRef('');
  useEffect(() => {
    if (mode !== 'search') return;
    if (located.length === 0) return;
    const key = located.map(({ coin }) => coin.objectid).join(',');
    if (key === lastCoinsKeyRef.current) return;
    lastCoinsKeyRef.current = key;
    const target = fitViewportTo(located.map(({ loc }) => [loc.lat, loc.lng]));
    const worldView = VIEW_PRESETS.world;
    const phase1Ms = 420;  // zoom out to world
    const phase2Ms = 950;  // zoom into result region
    const phase1Start = { ...viewRef.current };
    const t0 = performance.now();
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const step = (now) => {
      const elapsed = now - t0;
      if (elapsed < phase1Ms) {
        const k = easeInOut(Math.min(1, elapsed / phase1Ms));
        setView({
          lng0: phase1Start.lng0 + (worldView.lng0 - phase1Start.lng0) * k,
          lng1: phase1Start.lng1 + (worldView.lng1 - phase1Start.lng1) * k,
          lat0: phase1Start.lat0 + (worldView.lat0 - phase1Start.lat0) * k,
          lat1: phase1Start.lat1 + (worldView.lat1 - phase1Start.lat1) * k,
        });
        animRef.current = requestAnimationFrame(step);
      } else {
        const k = easeInOut(Math.min(1, (elapsed - phase1Ms) / phase2Ms));
        setView({
          lng0: worldView.lng0 + (target.lng0 - worldView.lng0) * k,
          lng1: worldView.lng1 + (target.lng1 - worldView.lng1) * k,
          lat0: worldView.lat0 + (target.lat0 - worldView.lat0) * k,
          lat1: worldView.lat1 + (target.lat1 - worldView.lat1) * k,
        });
        if (elapsed < phase1Ms + phase2Ms) animRef.current = requestAnimationFrame(step);
      }
    };
    animRef.current = requestAnimationFrame(step);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, located]);

  // ── Initial land load ──────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    loadLand().then((g) => { if (live) setLand(g); });
    return () => { live = false; };
  }, []);

  // ── Reset when changing presets ────────────────────────────────────
  const choosePreset = useCallback((key) => {
    setPresetKey(key);
    setMinCountOverride(null);
    setExpandedKey(null);
    animateTo(VIEW_PRESETS[key], 600);
  }, [animateTo]);

  const paths = useMemo(() => (land ? landPaths(land, view) : []), [land, view]);

  const handleCoinClick = (coin) => {
    setHover(null);
    onCoinClick?.(coin);
  };

  const updateHover = (e, payload) => {
    if (isDragging) return; // suppress tooltips during a drag
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    setHover({ x, y, ...payload });
  };

  // ── Pan & Zoom ─────────────────────────────────────────────────────
  // Pan: shift the lng/lat extents by the dragged screen distance, converted
  // to lng/lat units via the current scale.
  const dragRef = useRef(null);

  const onMouseDown = (e) => {
    // Only left button; ignore clicks on interactive children (markers, panels).
    if (e.button !== 0) return;
    const target = e.target;
    if (target.closest?.('.mark-stamp, .mint-panel, foreignObject')) return;
    dragRef.current = {
      x0: e.clientX,
      y0: e.clientY,
      startView: { ...view },
      moved: false,
    };
    setIsDragging(true);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  };

  const onMouseMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dxPx = e.clientX - drag.x0;
    const dyPx = e.clientY - drag.y0;
    if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) drag.moved = true;
    const lngPerPx = (drag.startView.lng1 - drag.startView.lng0) / rect.width;
    const latPerPx = (drag.startView.lat1 - drag.startView.lat0) / rect.height;
    const dLng = -dxPx * lngPerPx;
    const dLat = dyPx * latPerPx;
    setView({
      lng0: drag.startView.lng0 + dLng,
      lng1: drag.startView.lng1 + dLng,
      lat0: drag.startView.lat0 + dLat,
      lat1: drag.startView.lat1 + dLat,
    });
  };

  const onMouseUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    // If the user actually moved, swallow the click so nothing else fires.
    if (drag?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Zoom: scale around the cursor position so points under the mouse stay
  // put. Critically, this uses the FUNCTIONAL form of setView so rapid wheel
  // events compose correctly — reading `view` from closure here drifts.
  const onWheel = (e) => {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const yFrac = (e.clientY - rect.top) / rect.height;
    const factor = Math.pow(1.0015, e.deltaY); // > 1 zoom out, < 1 zoom in
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setView((prev) => {
      const lngC = prev.lng0 + xFrac * (prev.lng1 - prev.lng0);
      const latC = prev.lat1 - yFrac * (prev.lat1 - prev.lat0);
      let lng0 = lngC + (prev.lng0 - lngC) * factor;
      let lng1 = lngC + (prev.lng1 - lngC) * factor;
      let lat0 = latC + (prev.lat0 - latC) * factor;
      let lat1 = latC + (prev.lat1 - latC) * factor;
      const spanLng = lng1 - lng0;
      const spanLat = lat1 - lat0;
      if (spanLng < 1.5 || spanLat < 1) return prev;
      if (spanLng > 360 || spanLat > 170) return prev;
      return { lng0, lng1, lat0, lat1 };
    });
  };

  // Keyboard: + / − zoom around center
  useEffect(() => {
    const onKey = (e) => {
      if (!wrapRef.current) return;
      const focused = document.activeElement;
      const tag = focused?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key !== '+' && e.key !== '=' && e.key !== '-' && e.key !== '_') return;
      const factor = e.key === '-' || e.key === '_' ? 1.25 : 0.8;
      const cLng = (view.lng0 + view.lng1) / 2;
      const cLat = (view.lat0 + view.lat1) / 2;
      const newLng0 = cLng + (view.lng0 - cLng) * factor;
      const newLng1 = cLng + (view.lng1 - cLng) * factor;
      const newLat0 = cLat + (view.lat0 - cLat) * factor;
      const newLat1 = cLat + (view.lat1 - cLat) * factor;
      if (newLng1 - newLng0 < 1.5 || newLng1 - newLng0 > 360) return;
      animateTo({ lng0: newLng0, lng1: newLng1, lat0: newLat0, lat1: newLat1 }, 200);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, animateTo]);

  // Disable native page zoom on the wheel inside the map area.
  // React's onWheel passive flag is true by default; preventDefault won't
  // work there. Attach a non-passive listener to the wrapper. Bound once —
  // the handler reads the latest `view` via the functional setState inside
  // onWheel, so we don't need to rebind on every state change.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const handler = (e) => {
      if (e.target.closest?.('.mint-panel')) return;
      onWheel(e);
    };
    wrap.addEventListener('wheel', handler, { passive: false });
    return () => wrap.removeEventListener('wheel', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [unmappedCount, mappedCount] = useMemo(() => {
    const u = coins.length - located.length;
    return [u, located.length];
  }, [coins.length, located.length]);

  // Marker scale factor: when zoomed in, markers proportionally shrink so they
  // don't dominate; when zoomed way out, we shrink them a tad too.
  const baseSpan = (view.lng1 - view.lng0) + (view.lat1 - view.lat0);
  const refSpan = 80 + 46; // mediterranean default span
  const markerScale = Math.max(0.6, Math.min(1.6, Math.sqrt(refSpan / baseSpan)));

  // Coin medallion size for search mode (px in viewBox units).
  const medRadius = Math.max(9, Math.min(18, 13 * markerScale));

  // Density-cull search mode coins: project all located coins (with tightened
  // jitter so coastal mints don't land in water), sort by result rank (coins
  // arrive pre-sorted by relevance so index = rank proxy), then greedily keep
  // only coins whose screen position doesn't overlap an already-placed one.
  // This prevents an overwhelming mass of overlapping markers when zoomed out.
  const visibleCoins = useMemo(() => {
    if (mode !== 'search') return [];
    const withPos = located.map(({ coin, loc }, i) => {
      const [dLat, dLng] = jitter(
        coin.objectid || i,
        loc.precision === 'culture' ? 0.7 : 0.3, // tighter than before → fewer water placements
      );
      const lat = loc.lat + dLat;
      const lng = loc.lng + dLng;
      if (!inView(lat, lng, view)) return null;
      const [x, y] = project(lat, lng, view);
      return { coin, loc, x, y, rank: i }; // index = relevance rank
    }).filter(Boolean);

    // Higher-relevance coins win disputed cells.
    withPos.sort((a, b) => a.rank - b.rank);

    const minSpacing = medRadius * 2.4;
    const visible = [];
    for (const item of withPos) {
      if (!visible.some((p) => Math.hypot(p.x - item.x, p.y - item.y) < minSpacing)) {
        visible.push(item);
      }
    }
    return visible;
  }, [mode, located, view, medRadius]);

  return (
    <div className="world-map">
      <div className="world-map-header">
        <div className="world-map-title">
          <span className="map-glyph">⌘</span>
          <span>{mode === 'collection' ? 'Atlas of the Collection' : 'Where these coins were struck'}</span>
        </div>
        <div className="world-map-controls">
          {mode === 'collection' && (
            <label className="map-density">
              <span className="map-density-label">min coins / mint</span>
              <input
                type="range"
                min="1"
                max="200"
                step="1"
                value={effectiveMinCount}
                onChange={(e) => setMinCountOverride(parseInt(e.target.value, 10))}
              />
              <span className="map-density-value">{effectiveMinCount}</span>
            </label>
          )}
          <div className="world-map-tabs">
            {Object.entries(VIEW_PRESETS).map(([k, v]) => (
              <button
                key={k}
                className={`map-tab${presetKey === k ? ' active' : ''}`}
                onClick={() => choosePreset(k)}
              >{v.name}</button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={wrapRef}
        className={`world-map-svg-wrap${isDragging ? ' dragging' : ' grab'}`}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="world-map-svg"
          onMouseDown={onMouseDown}
          onMouseMove={(e) => { onMouseMove(e); }}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { dragRef.current = null; setIsDragging(false); setHover(null); }}
          onClick={(e) => {
            if (dragRef.current?.moved) return;
            // Background click — close the expanded panel.
            if (!e.target.closest('.mark-stamp, .mint-panel, .search-coin-medallion')) {
              setExpandedKey(null);
            }
          }}
        >
          <defs>
            <radialGradient id="parchmentGradient" cx="50%" cy="50%" r="75%">
              <stop offset="0%" stopColor="#f7ecd2" />
              <stop offset="60%" stopColor="#ecdcb3" />
              <stop offset="100%" stopColor="#cdb286" />
            </radialGradient>
            <pattern id="parchmentNoise" patternUnits="userSpaceOnUse" width="160" height="160">
              <rect width="160" height="160" fill="url(#parchmentGradient)" />
              <g opacity="0.18">
                {Array.from({ length: 60 }).map((_, i) => (
                  <circle
                    key={i}
                    cx={(i * 47) % 160}
                    cy={(i * 89) % 160}
                    r={(i % 3) * 0.4 + 0.3}
                    fill="#7d5a2c"
                  />
                ))}
              </g>
            </pattern>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="g" />
              <feMerge>
                <feMergeNode in="g" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* one circular clip per medallion size — keeps the coin image
                cropped to a perfect circle. Single shared id is fine because
                we re-position via transform. */}
            <clipPath id="coinClip" clipPathUnits="objectBoundingBox">
              <circle cx="0.5" cy="0.5" r="0.5" />
            </clipPath>
            {/* Confines the land polygons to the visible viewBox so off-screen
                portions don't render as long diagonal connecting lines when
                they extend far past the canvas during a zoom. */}
            <clipPath id="mapBounds">
              <rect x="0" y="0" width={W} height={H} />
            </clipPath>
          </defs>

          <rect x="0" y="0" width={W} height={H} fill="url(#parchmentNoise)" />

          <g transform={`translate(${W - 90} ${H - 90})`} opacity="0.4">
            <circle r="42" fill="none" stroke="#6b4a14" strokeWidth="0.6" />
            <circle r="32" fill="none" stroke="#6b4a14" strokeWidth="0.4" />
            <g stroke="#6b4a14" strokeWidth="0.7" fill="#6b4a14">
              <polygon points="0,-40 4,0 0,40 -4,0" />
              <polygon points="-40,0 0,4 40,0 0,-4" />
            </g>
            <text y="-46" textAnchor="middle" fontSize="9" fill="#6b4a14" fontFamily="Cormorant Garamond, serif">N</text>
            <text y="54" textAnchor="middle" fontSize="9" fill="#6b4a14" fontFamily="Cormorant Garamond, serif">S</text>
            <text x="50" y="3" textAnchor="middle" fontSize="9" fill="#6b4a14" fontFamily="Cormorant Garamond, serif">E</text>
            <text x="-50" y="3" textAnchor="middle" fontSize="9" fill="#6b4a14" fontFamily="Cormorant Garamond, serif">O</text>
          </g>

          <g clipPath="url(#mapBounds)">
            {paths.map((d, i) => (
              <path key={i} d={d} fill="#dcb572" stroke="#5a3e08" strokeWidth="0.8" strokeLinejoin="round" />
            ))}
          </g>
          <g opacity="0.35" clipPath="url(#mapBounds)">
            {paths.map((d, i) => (
              <path key={'s' + i} d={d} fill="none" stroke="#3d2a08" strokeWidth="0.4" />
            ))}
          </g>

          <g className="map-labels">
            {REGION_LABELS.filter((l) => inView(l.lat, l.lng, view)).map((l, i) => {
              const [x, y] = project(l.lat, l.lng, view);
              return (
                <text
                  key={i}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  className={`map-label${l.sea ? ' sea' : ''}`}
                  fontSize={11 * markerScale}
                >{l.name.toUpperCase()}</text>
              );
            })}
          </g>

          {/* City labels — tiered by importance and culled greedily so they
              don't pile on top of each other. As the user zooms in, more
              labels (and lesser cities) become visible. */}
          {(() => {
            const spanLng = view.lng1 - view.lng0;
            // Tier threshold by zoom: tier 1 always, tier 2 at Med-zoom or
            // closer, tier 3 only when zoomed in.
            const maxTier = spanLng > 220 ? 1 : spanLng > 95 ? 2 : 3;
            const candidates = MINTS
              .filter((m) => m.kind === 'city' && (m.tier ?? 3) <= maxTier && inView(m.lat, m.lng, view))
              .map((m) => {
                const [x, y] = project(m.lat, m.lng, view);
                return { ...m, x, y };
              })
              // tier 1 first, then by lat (north-first reads naturally)
              .sort((a, b) => (a.tier - b.tier) || (b.lat - a.lat));
            const placed = [];
            const minSpacing = spanLng > 95 ? 64 : spanLng > 30 ? 48 : 36;
            for (const c of candidates) {
              const tooClose = placed.some((p) =>
                Math.hypot(p.x - c.x, p.y - c.y) < minSpacing,
              );
              if (!tooClose) placed.push(c);
            }
            return (
              <g className="city-labels">
                {placed.map((c) => (
                  <g key={c.name}>
                    {/* tiny diamond marker behind the label */}
                    <path
                      d={`M ${c.x} ${c.y - 2.5} L ${c.x + 2.5} ${c.y} L ${c.x} ${c.y + 2.5} L ${c.x - 2.5} ${c.y} Z`}
                      fill="#5a3e08"
                      opacity={c.tier === 1 ? 0.85 : c.tier === 2 ? 0.65 : 0.45}
                    />
                    <text
                      x={c.x + 5}
                      y={c.y + 3}
                      className={`city-label tier-${c.tier}`}
                      fontSize={c.tier === 1 ? 12 : c.tier === 2 ? 10.5 : 9.5}
                    >{c.name}</text>
                  </g>
                ))}
              </g>
            );
          })()}

          {/* SEARCH MODE: cropped circular obverse images, tied to mint
              location with a small jitter so coins from the same mint
              fan into a small constellation. */}
          {mode === 'search' && (
            <g className="map-markers">
              {visibleCoins.map(({ coin, loc, x, y }) => {
                const isHov = hover?.coinId === coin.objectid;
                const r = isHov ? medRadius * 1.35 : medRadius;
                const obverseFromImages = (coin.images || []).find((im) => im.displayorder === 2)?.baseimageurl;
                const obverseUrl = coin.obverseurl || obverseFromImages;
                const fallbackUrl = coin.primaryimageurl;
                const isCombined = !obverseUrl && !!fallbackUrl && /_dynmc(?:\b|$)/i.test(fallbackUrl);
                const renderUrl = obverseUrl || fallbackUrl;
                const renderKind = obverseUrl ? 'single' : (isCombined ? 'combined' : 'single');
                return (
                  <CoinMedallion
                    key={coin.objectid}
                    coin={coin}
                    x={x}
                    y={y}
                    r={r}
                    renderUrl={renderUrl}
                    renderKind={renderKind}
                    isHover={isHov}
                    onMouseEnter={(e) => updateHover(e, { coinId: coin.objectid, coin, loc })}
                    onMouseMove={(e) => updateHover(e, { coinId: coin.objectid, coin, loc })}
                    onClick={() => handleCoinClick(coin)}
                  />
                );
              })}
            </g>
          )}

          {/* COLLECTION MODE: one wax-stamp disc per mint, sized by count. */}
          {mode === 'collection' && (
            <g className="map-markers">
              {collectionMarkers.map((m, idx) => {
                if (!inView(m.lat, m.lng, view)) return null;
                if (m.count < effectiveMinCount) return null;
                const [bx, by] = project(m.lat, m.lng, view);
                const radius = Math.max(3.5, Math.min(20, (2.2 + Math.sqrt(m.count) * 0.7) * markerScale));
                const isExpanded = expandedKey === `${idx}`;
                const isHover = hover?.placeKey === `${idx}` && !isExpanded;
                const isProminent = m.count >= 80;
                return (
                  <g key={idx}>
                    <circle
                      cx={bx}
                      cy={by}
                      r={radius}
                      className={`mark-stamp place${isProminent ? ' prominent' : ''}${isHover ? ' hover' : ''}${isExpanded ? ' expanded' : ''}`}
                      onMouseEnter={(e) => updateHover(e, { placeKey: `${idx}`, place: m })}
                      onMouseMove={(e) => updateHover(e, { placeKey: `${idx}`, place: m })}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (dragRef.current?.moved) return;
                        setExpandedKey(isExpanded ? null : `${idx}`);
                      }}
                    />
                    {isProminent && (
                      <circle cx={bx} cy={by} r={radius + 2.2} fill="none" stroke="#5a3e08" strokeWidth="0.45" opacity="0.55" />
                    )}
                  </g>
                );
              })}
              {collectionMarkers.map((m, idx) => {
                if (!inView(m.lat, m.lng, view)) return null;
                if (m.count < Math.max(effectiveMinCount, 12)) return null;
                const [bx, by] = project(m.lat, m.lng, view);
                const radius = Math.max(3.5, Math.min(20, (2.2 + Math.sqrt(m.count) * 0.7) * markerScale));
                return (
                  <text
                    key={'pn' + idx}
                    x={bx}
                    y={by + radius + 11}
                    textAnchor="middle"
                    className="place-label"
                    fontSize={10 * markerScale}
                  >
                    {m.label}
                  </text>
                );
              })}
            </g>
          )}

          {mode === 'collection' && expandedKey && (() => {
            const idx = parseInt(expandedKey, 10);
            const m = collectionMarkers[idx];
            if (!m || !inView(m.lat, m.lng, view)) return null;
            const [bx, by] = project(m.lat, m.lng, view);
            const panelW = 240;
            const types = m.types.slice(0, 10);
            const panelH = 50 + types.length * 22;
            const px = Math.min(W - panelW - 8, bx + 14);
            const py = Math.min(H - panelH - 8, Math.max(8, by - panelH / 2));
            return (
              <foreignObject x={px} y={py} width={panelW} height={panelH}>
                <div className="mint-panel" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <div className="mint-panel-head">
                    <span className="mint-panel-name">{m.label}</span>
                    <span className="mint-panel-count">{m.count}</span>
                    <button
                      className="mint-panel-close"
                      onClick={() => setExpandedKey(null)}
                    >✕</button>
                  </div>
                  <div className="mint-panel-types">
                    {types.map((t, ti) => (
                      <button
                        key={ti}
                        className="mint-panel-row"
                        onClick={() => handleCoinClick(t.rep)}
                      >
                        <span className="mint-panel-row-name">
                          {t.denomination || (t.rep.title || '').replace(/^Coin of\s+/i, '').slice(0, 28)}
                        </span>
                        <span className="mint-panel-row-meta">
                          <span className="mint-panel-culture">{t.culture}</span>
                          <span className="mint-panel-row-count">{t.count}</span>
                        </span>
                      </button>
                    ))}
                    {m.types.length > types.length && (
                      <div className="mint-panel-more">
                        + {m.types.length - types.length} more type{m.types.length - types.length === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                </div>
              </foreignObject>
            );
          })()}

          {hover?.coin && !isDragging && (
            <foreignObject
              x={Math.min(W - 220, Math.max(0, hover.x + 12))}
              y={Math.min(H - 120, Math.max(0, hover.y + 12))}
              width={210}
              height={120}
              style={{ pointerEvents: 'none' }}
            >
              <div className="map-tooltip">
                <div className="map-tooltip-title">{hover.coin.title || 'Untitled coin'}</div>
                <div className="map-tooltip-sub">
                  {[hover.coin.culture, hover.coin.dated].filter(Boolean).join(' · ')}
                </div>
                <div className="map-tooltip-loc">
                  ⌖ {hover.loc?.label}
                  {hover.loc?.source === 'culture' && (
                    <span className="map-tooltip-precision">(culture)</span>
                  )}
                </div>
              </div>
            </foreignObject>
          )}
          {hover?.placeKey && hover.place && !expandedKey && !isDragging && (
            <foreignObject
              x={Math.min(W - 230, Math.max(0, hover.x + 12))}
              y={Math.min(H - 90, Math.max(0, hover.y + 12))}
              width={220}
              height={88}
              style={{ pointerEvents: 'none' }}
            >
              <div className="map-tooltip">
                <div className="map-tooltip-title">{hover.place.label}</div>
                <div className="map-tooltip-sub">
                  {hover.place.types.length} type{hover.place.types.length === 1 ? '' : 's'} · {hover.place.count} coin{hover.place.count === 1 ? '' : 's'}
                </div>
                <div className="map-tooltip-cta">click to see types</div>
              </div>
            </foreignObject>
          )}
        </svg>
        {!land && (
          <div className="world-map-loading">Drawing the world…</div>
        )}
        <div className="world-map-help">drag to pan · scroll to zoom · + / − keys</div>
      </div>

      <div className="world-map-footer">
        {mode === 'search'
          ? <>{mappedCount} of {totalKnown ?? coins.length} coin{coins.length === 1 ? '' : 's'} placed{unmappedCount > 0 ? ` · ${unmappedCount} unmapped` : ''}</>
          : <>{collectionMarkers.filter((m) => m.count >= effectiveMinCount).length} of {collectionMarkers.length} mint location{collectionMarkers.length === 1 ? '' : 's'} shown · drag to pan, scroll to zoom</>
        }
      </div>
    </div>
  );
}


