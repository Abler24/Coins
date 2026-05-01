// Async background removal via canvas pixel manipulation.
// Detects the background color by sampling corners/edges, then flood-fills
// from every edge pixel inward, making background-colored pixels transparent.
// Finally crops to the bounding box of remaining opaque content.
//
// Falls back to the original URL on CORS failures or if no content survives.

const _cache = new Map();

// leftHalf: only process the left half of the image — used for combined
// obverse+reverse photos (2:1 ratio) so we extract just the obverse face.
export function removeBackground(url, { leftHalf = false } = {}) {
  if (!url) return Promise.resolve(url);
  const cacheKey = leftHalf ? url + '\x00left' : url;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);
  const p = _process(url, leftHalf);
  _cache.set(cacheKey, p);
  return p;
}

function _process(url, leftHalf) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const fullW = img.naturalWidth;
        const h = img.naturalHeight;
        // For combined (obverse|reverse) images only process the left half.
        const w = leftHalf ? Math.floor(fullW / 2) : fullW;
        if (!w || !h) { resolve(url); return; }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // Explicitly draw only the left-w portion (no-op for full-width images).
        ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // ── Detect background color ──────────────────────────────────
        // Sample corners + edge midpoints; use per-channel median so a
        // single bright pixel (ruler tick, watermark) doesn't skew the result.
        const pts = [
          [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
          [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
          [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
          [2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3],
        ];
        const rs = [], gs = [], bs = [];
        for (const [x, y] of pts) {
          const i = (y * w + x) * 4;
          rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
        }
        const med = (a) => {
          const s = a.slice().sort((x, y) => x - y);
          const m = s.length >> 1;
          return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
        };
        const bgR = med(rs), bgG = med(gs), bgB = med(bs);
        const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

        // Tolerance: dark backgrounds are easy to distinguish → generous.
        // Light/gray backgrounds are hard (silver coin on gray) → tight.
        const tol = bgLum < 20 ? 45 : bgLum < 60 ? 32 : bgLum < 120 ? 18 : 12;

        // ── Flood fill from all edges ────────────────────────────────
        // Mark edge pixels as visited immediately so they go onto the
        // stack only once even if their color doesn't match (the check
        // happens at pop time, not push time).
        const visited = new Uint8Array(w * h);
        const stack = [];

        const enqueue = (x, y) => {
          if (x < 0 || x >= w || y < 0 || y >= h) return;
          const pos = y * w + x;
          if (visited[pos]) return;
          visited[pos] = 1;
          stack.push(pos);
        };

        for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
        for (let y = 1; y < h - 1; y++) { enqueue(0, y); enqueue(w - 1, y); }

        while (stack.length) {
          const pos = stack.pop();
          const x = pos % w;
          const y = (pos / w) | 0;
          const i = pos * 4;
          const dist = Math.sqrt(
            (data[i] - bgR) ** 2 +
            (data[i + 1] - bgG) ** 2 +
            (data[i + 2] - bgB) ** 2,
          );
          if (dist > tol) continue; // hit the coin edge — stop here
          data[i + 3] = 0;          // transparent
          enqueue(x - 1, y); enqueue(x + 1, y);
          enqueue(x, y - 1); enqueue(x, y + 1);
        }

        // ── Erosion pass ─────────────────────────────────────────────
        // JPEG-compressed museum photos have fringe pixels at the
        // background/coin boundary whose color is a blend of background
        // and coin (compression artifact). The flood-fill stopped at those
        // pixels because their color distance from the background exceeded
        // `tol`, but they still look like blurry dark halos when the black
        // background becomes transparent. One erosion pass removes any
        // still-opaque pixel adjacent to a transparent pixel whose color
        // is close enough to the background with a slightly wider tolerance.
        const erosionTol = Math.min(tol * 1.6, bgLum < 60 ? 70 : 40);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const pos = y * w + x;
            const i = pos * 4;
            if (data[i + 3] === 0) continue; // already transparent
            // Is this pixel adjacent to a transparent one?
            const adj =
              (x > 0     && data[(pos - 1) * 4 + 3] === 0) ||
              (x < w - 1 && data[(pos + 1) * 4 + 3] === 0) ||
              (y > 0     && data[(pos - w) * 4 + 3] === 0) ||
              (y < h - 1 && data[(pos + w) * 4 + 3] === 0);
            if (!adj) continue;
            const dist = Math.sqrt(
              (data[i] - bgR) ** 2 +
              (data[i + 1] - bgG) ** 2 +
              (data[i + 2] - bgB) ** 2,
            );
            if (dist <= erosionTol) data[i + 3] = 0;
          }
        }

        // ── Find bounding box of surviving opaque pixels ─────────────
        let x0 = w, x1 = 0, y0 = h, y1 = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 0) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }

        if (x1 < x0) { resolve(url); return; } // nothing survived — fall back

        // If < 3% of pixels became transparent the fill likely had no effect
        // (gray-on-gray edge case). Fall back so we don't silently degrade.
        const totalPx = w * h;
        let transparentPx = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparentPx++;
        if (transparentPx / totalPx < 0.03) { resolve(url); return; }

        // Pad crop rect a tiny bit and make it square so the coin is centred.
        const pad = Math.max(2, Math.floor(Math.min(x1 - x0, y1 - y0) * 0.03));
        x0 = Math.max(0, x0 - pad); x1 = Math.min(w - 1, x1 + pad);
        y0 = Math.max(0, y0 - pad); y1 = Math.min(h - 1, y1 + pad);
        const cw = x1 - x0 + 1;
        const ch = y1 - y0 + 1;
        const dim = Math.max(cw, ch);
        const ox = Math.floor((dim - cw) / 2);
        const oy = Math.floor((dim - ch) / 2);

        // Write processed pixels back, then draw cropped square onto output canvas.
        ctx.putImageData(imgData, 0, 0);
        const out = document.createElement('canvas');
        out.width = dim;
        out.height = dim;
        out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, ox, oy, cw, ch);
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(url); // CORS-tainted or other error — show original
      }
    };

    img.onerror = () => resolve(url);
    img.src = url;
  });
}
