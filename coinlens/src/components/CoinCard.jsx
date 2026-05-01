import { useState, useCallback } from 'react';

function formatDate(coin) {
  if (coin.dated) return coin.dated;
  if (coin.datebegin && coin.dateend) {
    const begin = coin.datebegin < 0 ? `${Math.abs(coin.datebegin)} BCE` : `${coin.datebegin} CE`;
    const end = coin.dateend < 0 ? `${Math.abs(coin.dateend)} BCE` : `${coin.dateend} CE`;
    if (begin === end) return begin;
    return `${begin} – ${end}`;
  }
  if (coin.datebegin) {
    return coin.datebegin < 0 ? `${Math.abs(coin.datebegin)} BCE` : `${coin.datebegin} CE`;
  }
  return null;
}

function getImageUrl(coin) {
  if (coin.obverseurl) return coin.obverseurl;
  if (coin.primaryimageurl) return coin.primaryimageurl;
  if (coin.images?.length > 0) return coin.images[0].baseimageurl;
  return null;
}

// Sample the photo's backdrop along the very top + very bottom edge — only a
// few pixels deep so the cm scale bar doesn't intrude (it sits inset from the
// top/bottom margins). The full image width is read, so the sample is dense.
function sampleBackgroundColor(img) {
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    // 2px-thin strip at the absolute top + bottom — narrow enough that the cm
    // scale bar (which always has a margin from the photo edge) doesn't appear.
    const bandH = 2;
    const sampleW = 32; // downsampled horizontal resolution per strip
    const canvas = document.createElement('canvas');
    canvas.width = sampleW;
    canvas.height = bandH * 2;
    const ctx = canvas.getContext('2d');
    // Top edge band (full width)
    ctx.drawImage(img, 0, 0, w, bandH, 0, 0, sampleW, bandH);
    // Bottom edge band (full width)
    ctx.drawImage(img, 0, h - bandH, w, bandH, 0, bandH, sampleW, bandH);
    const data = ctx.getImageData(0, 0, sampleW, bandH * 2).data;

    // Median per channel — robust to any stray dark/light pixel.
    const reds = [], greens = [], blues = [];
    for (let i = 0; i < data.length; i += 4) {
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
    const median = (arr) => {
      arr.sort((a, b) => a - b);
      const m = arr.length >> 1;
      return arr.length % 2 ? arr[m] : Math.round((arr[m - 1] + arr[m]) / 2);
    };
    return `rgb(${median(reds)}, ${median(greens)}, ${median(blues)})`;
  } catch {
    // CORS-tainted canvas or other error — caller falls back to CSS default
    return null;
  }
}

export default function CoinCard({
  coin,
  onClick,
  oneLineSummary,
  summaryLoading,
  selectable = false,
  selected = false,
  onToggleSelect,
}) {
  const imageUrl = getImageUrl(coin);
  const date = formatDate(coin);
  const culture = coin.culture || null;
  const medium = coin.medium || null;
  const denomination = coin.denomination || null;

  const [bgColor, setBgColor] = useState(null);

  const handleImgLoad = useCallback((e) => {
    const color = sampleBackgroundColor(e.target);
    if (color) setBgColor(color);
  }, []);

  const handleClick = () => {
    if (selectable) {
      onToggleSelect?.(coin);
    } else {
      onClick?.(coin);
    }
  };

  return (
    <div
      className={`coin-card${selected ? ' selected' : ''}`}
      onClick={handleClick}
    >
      <div
        className="coin-image-container"
        style={bgColor ? { background: bgColor } : undefined}
      >
        {selectable && (
          <div
            className={`select-checkbox${selected ? ' checked' : ''}`}
            aria-hidden="true"
          >
            {selected ? '✓' : ''}
          </div>
        )}
        {imageUrl ? (
          <img
            className="coin-image"
            src={imageUrl}
            alt={coin.title || 'Coin'}
            loading="lazy"
            crossOrigin="anonymous"
            onLoad={handleImgLoad}
          />
        ) : (
          <div className="coin-placeholder">
            <div className="coin-placeholder-ring">
              <span className="coin-placeholder-text">NO IMAGE</span>
            </div>
          </div>
        )}
      </div>
      <div className="coin-info">
        <div className="coin-title">{coin.title || '[UNTITLED]'}</div>
        {date && <div className="coin-date">{date}</div>}
        <div className="coin-chips">
          {culture && <span className="coin-chip culture">{culture}</span>}
          {medium && <span className="coin-chip medium">{medium}</span>}
        </div>
        {denomination && <div className="coin-denomination">{denomination}</div>}
        {(oneLineSummary || summaryLoading) && (
          <div className="coin-one-line-summary">
            {summaryLoading ? 'Summarizing…' : oneLineSummary}
          </div>
        )}
      </div>
    </div>
  );
}
