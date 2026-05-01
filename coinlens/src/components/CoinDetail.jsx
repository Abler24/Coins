import { useState, useEffect, useRef } from 'react';
import RelevantReadings from './RelevantReadings';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function val(v) {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function displayVal(v) {
  const s = val(v);
  if (!s) return <span className="detail-field-value unclassified">—</span>;
  return <span className="detail-field-value">{s}</span>;
}

function formatDate(coin) {
  if (coin.dated) return coin.dated;
  if (coin.datebegin) {
    const b = coin.datebegin < 0 ? `${Math.abs(coin.datebegin)} BCE` : `${coin.datebegin} CE`;
    if (coin.dateend && coin.dateend !== coin.datebegin) {
      const e = coin.dateend < 0 ? `${Math.abs(coin.dateend)} BCE` : `${coin.dateend} CE`;
      return `${b} – ${e}`;
    }
    return b;
  }
  return null;
}

function getImageUrl(coin) {
  if (coin.primaryimageurl) return coin.primaryimageurl;
  if (coin.images && coin.images.length > 0) return coin.images[0].baseimageurl;
  return null;
}

function extractInscription(coin, side) {
  if (!coin.details) return null;
  const details = typeof coin.details === 'string' ? {} : coin.details;
  if (details.coins) {
    if (side === 'obverse') return details.coins.obverseinscription;
    if (side === 'reverse') return details.coins.reverseinscription;
  }
  return null;
}

function extractDenomination(coin) {
  if (coin.denomination) return coin.denomination;
  if (coin.details?.coins?.denomination) return coin.details.coins.denomination;
  return null;
}

function extractDieAxis(coin) {
  if (coin.details?.coins?.dieaxis) return coin.details.coins.dieaxis;
  return null;
}

export default function CoinDetail({ coin, onClose, generateSummary }) {
  const [pubOpen, setPubOpen] = useState(false);
  const [exhOpen, setExhOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const summaryFetchedRef = useRef(null);

  const [readings, setReadings] = useState([]);
  const [readingsLoading, setReadingsLoading] = useState(false);
  const readingsFetchedRef = useRef(null);

  useEffect(() => {
    if (!coin?.objectnumber || !generateSummary) return;
    if (summaryFetchedRef.current === coin.objectnumber) return;
    summaryFetchedRef.current = coin.objectnumber;
    setSummary(null);
    setSummaryError(null);
    setSummaryLoading(true);
    generateSummary(coin)
      .then((text) => {
        setSummary(text);
      })
      .catch((err) => {
        setSummaryError(err.message || 'Failed to load summary');
      })
      .finally(() => {
        setSummaryLoading(false);
      });
  }, [coin, generateSummary]);

  useEffect(() => {
    if (!coin?.objectnumber) return;
    if (readingsFetchedRef.current === coin.objectnumber) return;
    readingsFetchedRef.current = coin.objectnumber;
    setReadings([]);
    setReadingsLoading(true);
    fetch(`${API_URL}/readings/relevant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cultures: coin.culture ? [coin.culture] : [],
        coins: [coin],
      }),
    })
      .then((r) => r.json())
      .then((data) => setReadings(data.readings || []))
      .catch(() => setReadings([]))
      .finally(() => setReadingsLoading(false));
  }, [coin]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (!coin) return null;

  const imageUrl = getImageUrl(coin);
  const obverse = extractInscription(coin, 'obverse');
  const reverse = extractInscription(coin, 'reverse');
  const denomination = extractDenomination(coin);
  const dieAxis = extractDieAxis(coin);

  const people = coin.people || [];
  const publications = coin.publications || [];
  const exhibitions = coin.exhibitions || [];

  const hamUrl = `https://www.harvardartmuseums.org/collections/object/${coin.objectnumber}`;

  const fields = [
    { label: 'Object Number', value: coin.objectnumber },
    { label: 'Date', value: formatDate(coin) },
    { label: 'Period', value: coin.period },
    { label: 'Culture', value: coin.culture },
    { label: 'Medium', value: coin.medium },
    { label: 'Technique', value: coin.technique },
    { label: 'Denomination', value: denomination },
    { label: 'Die Axis', value: dieAxis },
    { label: 'Dimensions', value: coin.dimensions },
    { label: 'Creation Place', value: coin.creationplace || coin.provenance },
    { label: 'Accession Year', value: coin.accessionyear },
    { label: 'Credit Line', value: coin.creditline },
    { label: 'Standard Reference', value: coin.standardreferencenumber },
    {
      label: 'People / Issuer',
      value: people.length > 0
        ? people.map(p => `${p.displayname}${p.displaydate ? ` (${p.displaydate})` : ''}`).join('; ')
        : null,
    },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="detail-image-section">
          <div className="detail-image-wrapper">
            {imageUrl ? (
              <img className="detail-coin-image" src={imageUrl} alt={coin.title || 'Coin'} />
            ) : (
              <div className="coin-placeholder coin-placeholder-rect" style={{ width: '100%', height: '100%' }}>
                <div className="coin-placeholder-ring">
                  <span className="coin-placeholder-text">No image</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="detail-body">
          <h2 className="detail-title">{coin.title || 'Untitled'}</h2>
          <div className="detail-object-number">#{coin.objectnumber || 'N/A'}</div>

          <div className="detail-grid">
            {fields.map(f => (
              <div key={f.label} className="detail-field">
                <div className="detail-field-label">{f.label}</div>
                {displayVal(f.value)}
              </div>
            ))}
          </div>

          {/* Inscriptions */}
          {(obverse || reverse) && (
            <div className="detail-inscriptions">
              {obverse && (
                <div className="inscription-block">
                  <div className="inscription-label">Obverse Inscription</div>
                  <div className="inscription-text">{obverse}</div>
                </div>
              )}
              {reverse && (
                <div className="inscription-block">
                  <div className="inscription-label">Reverse Inscription</div>
                  <div className="inscription-text">{reverse}</div>
                </div>
              )}
            </div>
          )}

          {/* Publications */}
          {publications.length > 0 && (
            <div className="detail-collapsible">
              <div className="collapsible-header" onClick={() => setPubOpen(!pubOpen)}>
                <span className="collapsible-title">PUBLICATION HISTORY ({publications.length})</span>
                <span className={`collapsible-arrow ${pubOpen ? 'open' : ''}`}>▼</span>
              </div>
              {pubOpen && (
                <div className="collapsible-body">
                  {publications.map((p, i) => (
                    <p key={i}>{p.citation || p.title || '[Untitled publication]'}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Exhibitions */}
          {exhibitions.length > 0 && (
            <div className="detail-collapsible">
              <div className="collapsible-header" onClick={() => setExhOpen(!exhOpen)}>
                <span className="collapsible-title">EXHIBITION HISTORY ({exhibitions.length})</span>
                <span className={`collapsible-arrow ${exhOpen ? 'open' : ''}`}>▼</span>
              </div>
              {exhOpen && (
                <div className="collapsible-body">
                  {exhibitions.map((e, i) => (
                    <p key={i}>{e.citation || e.title || '[Untitled exhibition]'}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Summary */}
          <div className="ai-summary-section">
            <div className="ai-summary-title">AI Summary</div>
            {summaryLoading && (
              <div className="ai-summary-loading">Generating summary…</div>
            )}
            {summaryError && (
              <div className="ai-summary-error">{summaryError}</div>
            )}
            {summary && !summaryLoading && (
              <p className="ai-summary-text">{summary}</p>
            )}
            {!generateSummary && !summaryLoading && !summary && (
              <div className="ai-summary-unavailable">Add an OpenAI API key to enable summaries.</div>
            )}
          </div>

          {/* Course readings */}
          <RelevantReadings readings={readings} loading={readingsLoading} />

          {/* External link */}
          <a
            className="detail-external-link"
            href={hamUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Harvard Art Museums →
          </a>
        </div>
      </div>
    </div>
  );
}
