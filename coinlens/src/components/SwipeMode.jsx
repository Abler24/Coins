import { useEffect, useState, useCallback } from 'react';

function formatDate(coin) {
  if (coin.dated) return coin.dated;
  if (coin.datebegin != null && coin.dateend != null) {
    const b = coin.datebegin < 0 ? `${Math.abs(coin.datebegin)} BCE` : `${coin.datebegin} CE`;
    const e = coin.dateend < 0 ? `${Math.abs(coin.dateend)} BCE` : `${coin.dateend} CE`;
    return b === e ? b : `${b} – ${e}`;
  }
  return null;
}

export default function SwipeMode({
  activeGroup,
  onClose,
  onAddCoin,
  currentResults,
  totalResults,
  fetchAllMatching,
  fetchRandomCoins,
  fetchCoinSummary,
  onCreateGroup,
  onSetActiveGroup,
}) {
  const [phase, setPhase] = useState('start'); // 'start' | 'swiping' | 'done'
  const [deck, setDeck] = useState([]);
  const [index, setIndex] = useState(0);
  const [addedCount, setAddedCount] = useState(0);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (phase !== 'swiping') return;
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'y') handleAdd();
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'n') handleSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, deck]);

  const current = deck[index];

  useEffect(() => {
    if (phase !== 'swiping' || !current) return;
    let cancelled = false;
    setSummary('');
    setSummaryLoading(true);
    fetchCoinSummary(current.objectid)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        if (!cancelled) setSummary('');
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, current, fetchCoinSummary]);

  const startWithDeck = (coins) => {
    const filtered = (coins || []).filter((c) => c.primaryimageurl);
    if (filtered.length === 0) {
      setErr('No coins with images available.');
      return;
    }
    setDeck(filtered);
    setIndex(0);
    setAddedCount(0);
    setPhase('swiping');
  };

  const handleStartSearch = async () => {
    if (!currentResults || currentResults.length === 0) return;
    // If the current search has more matches than are visible, grab the full set.
    if (totalResults > currentResults.length && fetchAllMatching) {
      setLoading(true);
      setErr(null);
      try {
        const full = await fetchAllMatching();
        startWithDeck(full);
      } catch (e) {
        setErr(e.message || 'Failed to load full result set');
      } finally {
        setLoading(false);
      }
      return;
    }
    startWithDeck(currentResults);
  };

  const handleStartRandom = async () => {
    setLoading(true);
    setErr(null);
    try {
      const coins = await fetchRandomCoins(50);
      startWithDeck(coins);
    } catch (e) {
      setErr(e.message || 'Failed to load coins');
    } finally {
      setLoading(false);
    }
  };

  const advance = useCallback(() => {
    setIndex((i) => {
      const next = i + 1;
      if (next >= deck.length) {
        setPhase('done');
      }
      return next;
    });
  }, [deck.length]);

  const handleAdd = () => {
    if (!current || !activeGroup) return;
    onAddCoin(activeGroup.id, current);
    setAddedCount((n) => n + 1);
    advance();
  };

  const handleSkip = () => {
    advance();
  };

  const handleCreateAndStart = (e) => {
    e?.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    const g = onCreateGroup(name);
    if (g?.id) onSetActiveGroup(g.id);
    setNewGroupName('');
  };

  // --- Render ---
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content swipe-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {!activeGroup && (
          <div className="swipe-start">
            <h2>Pick a collection first</h2>
            <p className="swipe-sub">
              Swipe mode adds coins to a collection. Create one to get started:
            </p>
            <form className="swipe-create-form" onSubmit={handleCreateAndStart}>
              <input
                type="text"
                placeholder="Collection name…"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                autoFocus
              />
              <button type="submit" disabled={!newGroupName.trim()}>
                Create
              </button>
            </form>
          </div>
        )}

        {activeGroup && phase === 'start' && (
          <div className="swipe-start">
            <h2>Swipe to curate</h2>
            <p className="swipe-sub">
              Adding to <strong>{activeGroup.name}</strong>. Pick a source:
            </p>
            <div className="swipe-source-buttons">
              <button
                className="swipe-source-btn"
                onClick={handleStartSearch}
                disabled={!currentResults || currentResults.length === 0 || loading}
              >
                <div className="swipe-source-title">Current search results</div>
                <div className="swipe-source-sub">
                  {!currentResults?.length
                    ? 'No active search'
                    : totalResults > currentResults.length
                    ? `${Math.min(200, totalResults)} matching coins`
                    : `${currentResults.length} coins in view`}
                </div>
              </button>
              <button
                className="swipe-source-btn"
                onClick={handleStartRandom}
                disabled={loading}
              >
                <div className="swipe-source-title">
                  {loading ? 'Loading…' : 'Random from collection'}
                </div>
                <div className="swipe-source-sub">50 random coins with images</div>
              </button>
            </div>
            {err && <div className="swipe-error">{err}</div>}
          </div>
        )}

        {activeGroup && phase === 'swiping' && current && (
          <div className="swipe-card-wrap">
            <div className="swipe-progress">
              Card {index + 1} of {deck.length} · {addedCount} added to{' '}
              <strong>{activeGroup.name}</strong>
            </div>

            <div className="swipe-card" key={current.objectid}>
              <div className="swipe-image">
                {current.primaryimageurl ? (
                  <img src={current.primaryimageurl} alt={current.title} />
                ) : (
                  <div className="coin-placeholder">
                    <span className="coin-placeholder-text">NO IMAGE</span>
                  </div>
                )}
              </div>
              <div className="swipe-info">
                <div className="swipe-title">{current.title || 'Untitled'}</div>
                <div className="swipe-meta">
                  {[current.culture, current.medium, current.denomination, formatDate(current)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="swipe-summary">
                  {summaryLoading ? (
                    <span className="swipe-summary-loading">Summarizing…</span>
                  ) : (
                    summary || <span className="swipe-summary-loading">No summary available.</span>
                  )}
                </div>
              </div>
            </div>

            <div className="swipe-actions">
              <button className="swipe-btn skip" onClick={handleSkip} aria-label="Skip">
                ✕
                <span>Skip</span>
              </button>
              <button className="swipe-btn add" onClick={handleAdd} aria-label="Add">
                ✓
                <span>Add</span>
              </button>
            </div>
            <div className="swipe-hint">← skip · → add · esc close</div>
          </div>
        )}

        {activeGroup && phase === 'done' && (
          <div className="swipe-start">
            <h2>All done</h2>
            <p className="swipe-sub">
              Added <strong>{addedCount}</strong> coin{addedCount === 1 ? '' : 's'} to{' '}
              <strong>{activeGroup.name}</strong>.
            </p>
            <div className="swipe-source-buttons">
              <button
                className="swipe-source-btn"
                onClick={() => setPhase('start')}
              >
                <div className="swipe-source-title">Swipe another deck</div>
              </button>
              <button className="swipe-source-btn" onClick={onClose}>
                <div className="swipe-source-title">Close</div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
