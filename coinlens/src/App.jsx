import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import SearchBar from './components/SearchBar';
import FilterSidebar from './components/FilterSidebar';
import CoinGrid from './components/CoinGrid';
import CoinDetail from './components/CoinDetail';
import ResultsHeader from './components/ResultsHeader';
import GroupsPanel from './components/GroupsPanel';
import RelevantReadings from './components/RelevantReadings';
import CoinChat from './components/CoinChat';
import WorldMap from './components/WorldMap';
import { useSearch } from './hooks/useSearch';
import { useGroups } from './hooks/useGroups';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const DEFAULT_FILTERS = {
  cultures: [],
  mediums: [],
  denomination: '',
  datebegin: -600,
  dateend: 1900,
  period: '',
  technique: '',
  hasimage: false,
  sortby: 'rank',
  sortorder: 'asc',
  size: 12,
  keyword: '',
};

function getPageNumbers(page, totalPages) {
  const delta = 2;
  const pages = [];
  const left = Math.max(2, page - delta);
  const right = Math.min(totalPages - 1, page + delta);
  pages.push(1);
  if (left > 2) pages.push('...');
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < totalPages - 1) pages.push('...');
  if (totalPages > 1) pages.push(totalPages);
  return pages;
}

function buildSearchParams(filters, query = '', pageNum = 1) {
  const isAI = Boolean(query);
  return {
    query,
    filters: {
      cultures: filters.cultures || [],
      mediums: filters.mediums || [],
      denomination: filters.denomination || '',
      datebegin: filters.datebegin,
      dateend: filters.dateend,
      period: filters.period || '',
      technique: filters.technique || '',
      hasimage: filters.hasimage || false,
    },
    // AI searches fetch all 80 reranked results at once — the backend already
    // computes all 80 regardless, so there's no extra cost, and it avoids
    // denominations being split across pages.
    page: isAI ? 1 : pageNum,
    size: isAI ? 80 : (filters.size || 12),
    sort: filters.sortby || 'rank',
    sortorder: filters.sortorder || 'asc',
  };
}

export default function App() {
  const [view, setView] = useState('chat'); // 'browse' | 'chat'
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [selectedCoin, setSelectedCoin] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  const { results, totalResults, loading, error, page, totalPages, search, notice, fetchCoinSummary, fetchSearchSummary, fetchRandomCoins, searchAll } = useSearch();

  const [searchSummary, setSearchSummary] = useState('');
  const [searchSummaryLoading, setSearchSummaryLoading] = useState(false);
  const summaryRequestRef = useRef(0);

  const [searchReadings, setSearchReadings] = useState([]);
  const [searchReadingsLoading, setSearchReadingsLoading] = useState(false);
  const readingsRequestRef = useRef(0);

  const {
    groups,
    activeGroupId,
    activeGroup,
    createGroup,
    deleteGroup,
    renameGroup,
    addCoinToGroup,
    addCoinsToGroup,
    removeCoinFromGroup,
    setActiveGroup,
  } = useGroups();

  const [groupsPanelOpen, setGroupsPanelOpen] = useState(false);
const [selectionMode, setSelectionMode] = useState(false);
  const [searchMapOpen, setSearchMapOpen] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [atlasCoins, setAtlasCoins] = useState(null);
  const [atlasLoading, setAtlasLoading] = useState(false);
  const [searchMapCoins, setSearchMapCoins] = useState(null);
  const [searchMapLoading, setSearchMapLoading] = useState(false);
  // Map<objectid, coin> — stores full snapshots so selections persist across
  // pagination and new searches. Set would lose the coin data the moment the
  // grid re-renders with different results.
  const [selectedCoins, setSelectedCoins] = useState(() => new Map());
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const toggleSelected = useCallback((coin) => {
    setSelectedCoins((prev) => {
      const next = new Map(prev);
      if (next.has(coin.objectid)) next.delete(coin.objectid);
      else next.set(coin.objectid, coin);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedCoins(new Map());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedCoins(new Map());
    setAddMenuOpen(false);
  }, []);

  const selectedCoinObjects = useMemo(
    () => Array.from(selectedCoins.values()),
    [selectedCoins],
  );

  // Back-compat: CoinCard/CoinGrid expect a `.has(objectid)` API. Map satisfies it.
  const selectedIds = selectedCoins;

  const handleAddSelectedToGroup = useCallback((groupId) => {
    if (selectedCoinObjects.length === 0) return;
    addCoinsToGroup(groupId, selectedCoinObjects);
    setAddMenuOpen(false);
    exitSelectionMode();
    setActiveGroup(groupId);
  }, [selectedCoinObjects, addCoinsToGroup, exitSelectionMode, setActiveGroup]);

  const handleCreateGroupFromSelection = useCallback((name) => {
    const g = createGroup(name);
    if (g?.id && selectedCoinObjects.length > 0) {
      addCoinsToGroup(g.id, selectedCoinObjects);
    }
    setAddMenuOpen(false);
    exitSelectionMode();
  }, [createGroup, selectedCoinObjects, addCoinsToGroup, exitSelectionMode]);

  const selectAllOnPage = useCallback(() => {
    setSelectedCoins((prev) => {
      const next = new Map(prev);
      results.forEach((c) => next.set(c.objectid, c));
      return next;
    });
  }, [results]);

  const allOnPageSelected = useMemo(
    () => results.length > 0 && results.every((c) => selectedCoins.has(c.objectid)),
    [results, selectedCoins],
  );

  // "Select all N matching" — refetch with a large size so the grid shows
  // every matching coin, then auto-select them once the results land.
  // Pending flag lets us do it in one user gesture.
  const [pendingSelectAll, setPendingSelectAll] = useState(false);

  const selectAllMatching = useCallback(() => {
    // If everything is already visible, just check them all.
    if (totalResults <= results.length) {
      selectAllOnPage();
      return;
    }
    const queryToUse = aiUsed ? lastQuery : '';
    const params = buildSearchParams(filters, queryToUse, 1);
    params.size = Math.min(200, totalResults || 100);
    search(params);
    setPendingSelectAll(true);
  }, [totalResults, results.length, filters, aiUsed, lastQuery, search, selectAllOnPage]);

  // When a pending-select-all refetch completes, store every result in the map.
  // Additive (not replacing) so existing selections from other pages/searches
  // still persist.
  useEffect(() => {
    if (!pendingSelectAll || loading) return;
    if (results.length === 0) return;
    setSelectedCoins((prev) => {
      const next = new Map(prev);
      results.forEach((c) => next.set(c.objectid, c));
      return next;
    });
    setPendingSelectAll(false);
  }, [pendingSelectAll, loading, results]);

  // Keyboard: Cmd/Ctrl+A selects all matching while in selection mode.
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        selectAllMatching();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionMode, selectAllMatching]);

  // After each AI search's results land, fetch a short GPT summary of the
  // top 5 results explaining why they match the query. Filter-only searches
  // are skipped — "show me all Roman gold" doesn't need an explanation.
  useEffect(() => {
    if (!aiUsed || !lastQuery || loading || results.length === 0) {
      if (!aiUsed) {
        setSearchSummary('');
        setSearchSummaryLoading(false);
      }
      return;
    }
    const requestId = ++summaryRequestRef.current;
    setSearchSummaryLoading(true);
    const topIds = results.slice(0, 5).map((c) => c.objectid);
    // Build denomination group counts for the type-oriented summary
    const groupMap = {};
    for (const coin of results) {
      const raw = (coin.details?.coins?.denomination || coin.denomination || '').trim();
      const key = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Other';
      groupMap[key] = (groupMap[key] || 0) + 1;
    }
    const groups = Object.entries(groupMap)
      .filter(([k]) => k !== 'Other')
      .sort((a, b) => b[1] - a[1])
      .map(([denomination, count]) => ({ denomination, count }));
    fetchSearchSummary(lastQuery, topIds, groups)
      .then((s) => {
        if (requestId !== summaryRequestRef.current) return; // stale
        setSearchSummary(s);
      })
      .catch(() => {
        if (requestId !== summaryRequestRef.current) return;
        setSearchSummary('');
      })
      .finally(() => {
        if (requestId !== summaryRequestRef.current) return;
        setSearchSummaryLoading(false);
      });
  }, [aiUsed, lastQuery, loading, results, fetchSearchSummary]);

  // Fetch relevant HAA 73 readings whenever an AI search result lands.
  useEffect(() => {
    if (!aiUsed || !lastQuery || loading || results.length === 0) {
      if (!aiUsed) {
        setSearchReadings([]);
        setSearchReadingsLoading(false);
      }
      return;
    }
    const requestId = ++readingsRequestRef.current;
    setSearchReadingsLoading(true);
    const cultures = [...new Set(results.slice(0, 12).map((c) => c.culture).filter(Boolean))];
    fetch(`${API_URL}/readings/relevant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cultures, query: lastQuery, coins: results.slice(0, 8) }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (requestId !== readingsRequestRef.current) return;
        setSearchReadings(data.readings || []);
      })
      .catch(() => {
        if (requestId !== readingsRequestRef.current) return;
        setSearchReadings([]);
      })
      .finally(() => {
        if (requestId !== readingsRequestRef.current) return;
        setSearchReadingsLoading(false);
      });
  }, [aiUsed, lastQuery, loading, results]);

  // When the search-map is open and a new search lands, auto-refetch all
  // matching coins so the map's auto-fit animates to the new region instead
  // of staying frozen on the previous query.
  useEffect(() => {
    if (!searchMapOpen) return;
    if (loading) return;
    if (searchMapCoins) return;
    if (!hasSearched) return;
    let cancelled = false;
    (async () => {
      try {
        if (totalResults > results.length) {
          setSearchMapLoading(true);
          const queryToUse = aiUsed ? lastQuery : '';
          const all = await searchAll(buildSearchParams(filters, queryToUse, 1));
          if (!cancelled) setSearchMapCoins(all);
        } else {
          if (!cancelled) setSearchMapCoins(results);
        }
      } catch {
        if (!cancelled) setSearchMapCoins(results);
      } finally {
        if (!cancelled) setSearchMapLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [searchMapOpen, searchMapCoins, hasSearched, loading, totalResults, results, filters, aiUsed, lastQuery, searchAll]);

  // Close the add-to-collection dropdown on outside click or Escape.
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDocClick = (e) => {
      if (!e.target.closest?.('.add-to-group-wrap')) {
        setAddMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [addMenuOpen]);

  const doSearch = useCallback((overrides = {}, pageNum = 1, query = '') => {
    const merged = { ...filters, ...overrides };
    search(buildSearchParams(merged, query, pageNum));
    setHasSearched(true);
  }, [filters, search]);

  const handleAISearch = useCallback(async (query) => {
    setAiUsed(true);
    setLastQuery(query);
    // Reset filters to defaults for AI search -- the backend handles filter extraction
    const newFilters = { ...DEFAULT_FILTERS };
    setFilters(newFilters);
    search(buildSearchParams(newFilters, query, 1));
    setHasSearched(true);
    // Clear any previous summary/readings so stale content doesn't flash.
    setSearchSummary('');
    setSearchSummaryLoading(true);
    setSearchReadings([]);
    setSearchReadingsLoading(true);
    // Stale map data from the last search would auto-fit to the wrong region.
    setSearchMapCoins(null);
  }, [search]);

  const handleApplyFilters = useCallback(() => {
    setAiUsed(false);
    setLastQuery('');
    const current = filtersRef.current;
    search(buildSearchParams(current, '', 1));
    setHasSearched(true);
    setSearchMapCoins(null);
  }, [search]);

  const handleClearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setAiUsed(false);
    setLastQuery('');
    setSearchMapCoins(null);
    search(buildSearchParams(DEFAULT_FILTERS, '', 1));
    setHasSearched(true);
  }, [search]);

  const handleRemoveFilter = useCallback((key, value) => {
    const next = { ...filters };
    if (Array.isArray(next[key])) {
      next[key] = value ? next[key].filter(v => v !== value) : [];
    } else if (key === 'hasimage') {
      next[key] = false;
    } else if (key === 'datebegin') {
      next[key] = -600;
    } else if (key === 'dateend') {
      next[key] = 1900;
    } else {
      next[key] = '';
    }
    setFilters(next);
    search(buildSearchParams(next, aiUsed ? lastQuery : '', 1));
  }, [filters, search, aiUsed, lastQuery]);

  const handlePageChange = useCallback((newPage) => {
    search(buildSearchParams(filters, aiUsed ? lastQuery : '', newPage));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [filters, search, aiUsed, lastQuery]);

  // Generate summary via backend
  const generateCoinSummary = useCallback(async (coin) => {
    const objectid = coin.objectid || coin.id;
    if (!objectid) return null;
    return fetchCoinSummary(objectid);
  }, [fetchCoinSummary]);

  useEffect(() => {
    doSearch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="grid-bg" />

      <div className="app-container">
        <header className="app-header">
          <div className="app-header-text">
            <h1 className="app-logo">CoinLens</h1>
            <p className="app-subtitle">Harvard Art Museums — Numismatic Collection</p>
          </div>
          <div className="header-actions">
            <div className="view-toggle" role="tablist" aria-label="View">
              <button
                role="tab"
                aria-selected={view === 'chat'}
                className={`view-toggle-btn${view === 'chat' ? ' active' : ''}`}
                onClick={() => setView('chat')}
              >
                Coin Chat
              </button>
              <button
                role="tab"
                aria-selected={view === 'browse'}
                className={`view-toggle-btn${view === 'browse' ? ' active' : ''}`}
                onClick={() => setView('browse')}
              >
                Browse
              </button>
            </div>
            <button
              className="groups-btn"
              onClick={() => setAtlasOpen(true)}
              title="Atlas of where every coin in the collection was struck"
            >
              ⌖ Atlas
            </button>
            <button
              className="groups-btn"
              onClick={() => setGroupsPanelOpen(true)}
              title="View your collections"
            >
              ♦ Collections
              {groups.length > 0 && (
                <span className="groups-btn-count">{groups.length}</span>
              )}
            </button>
          </div>
        </header>

        {view === 'chat' ? (
          <CoinChat onOpenCoin={setSelectedCoin} />
        ) : (
        <>
        <div className="browse-header">
          <h2 className="browse-header-title">Browse the Collection</h2>
          <p className="browse-header-subtitle">Explore 3,000+ coins from the Harvard Art Museums numismatic holdings — search by keyword or filter by culture, period, medium, and denomination.</p>
        </div>
        <SearchBar
          onSearch={handleAISearch}
          isParsing={loading && aiUsed}
        />

        <div className="search-toolbar">
          <button
            className={`filter-toggle-btn${filtersOpen ? ' active' : ''}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            {filtersOpen ? 'Hide Filters' : 'Advanced Filters'}
          </button>
          <div className="gemini-badge">
            <span className="gemini-dot" />
            AI-Powered Search
          </div>
          {hasSearched && (
            <>
              <span className="toolbar-sep" />
              <span className="toolbar-count">
                {loading ? <>Searching<span className="loading-dots" /></> : <><span className="number">{totalResults.toLocaleString()}</span> coins</>}
              </span>
              {aiUsed && !loading && (
                <span className="gemini-badge">
                  <span className="gemini-dot" />
                  AI-parsed
                </span>
              )}
            </>
          )}
          <div className="toolbar-spacer" />
          {hasSearched && !loading && results.length > 0 && (
            <button
              className={`map-toggle-btn${searchMapOpen ? ' open' : ''}`}
              onClick={async () => {
                if (searchMapOpen) { setSearchMapOpen(false); return; }
                setSearchMapOpen(true);
                if (!searchMapCoins || searchMapCoins.length < totalResults) {
                  if (totalResults > results.length) {
                    try {
                      setSearchMapLoading(true);
                      const all = await searchAll(buildSearchParams(filters, aiUsed ? lastQuery : '', 1));
                      setSearchMapCoins(all);
                    } catch { setSearchMapCoins(results); }
                    finally { setSearchMapLoading(false); }
                  } else { setSearchMapCoins(results); }
                }
              }}
            >
              {searchMapOpen ? '▾ Hide map' : '⌖ View on map'}
              <span className="map-toggle-count">{totalResults}</span>
            </button>
          )}
          {hasSearched && !loading && !selectionMode && (
            <button className="selection-toggle" onClick={() => setSelectionMode(true)}>
              ☐ Select coins
            </button>
          )}
        </div>

        <div className="main-content">
          {filtersOpen && (
            <FilterSidebar
              filters={filters}
              onFiltersChange={setFilters}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
            />
          )}

          <div className="content-area">
            {hasSearched && (
              <ResultsHeader
                filters={filters}
                onRemoveFilter={handleRemoveFilter}
                onClearAll={handleClearFilters}
              />
            )}

            {notice && !loading && (
              <div className="search-notice">{notice}</div>
            )}

            {hasSearched && aiUsed && !loading && (searchSummaryLoading || searchSummary) && (
              <div className="search-summary">
                <div className="search-summary-label">
                  <span className="search-summary-badge">AI</span>
                  Curator's take
                </div>
                {searchSummaryLoading ? (
                  <div className="search-summary-skeleton">
                    <div className="skeleton-line" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                  </div>
                ) : (
                  <p className="search-summary-body">{searchSummary}</p>
                )}
              </div>
            )}

            {hasSearched && searchMapOpen && !loading && (
              <WorldMap
                coins={searchMapCoins || results}
                mode="search"
                totalKnown={totalResults}
                onCoinClick={setSelectedCoin}
                defaultView="med"
              />
            )}
            {searchMapOpen && searchMapLoading && (
              <div className="map-loading-note">Loading every match for the map…</div>
            )}

            {hasSearched && !loading && selectionMode && (
              <div className="selection-bar">
                  <div className="selection-toolbar">
                    <div className="selection-left">
                      <span className="selection-count">
                        {selectedCoins.size} selected
                      </span>
                      {activeGroup && (
                        <span className="selection-for-group">
                          — building <strong>{activeGroup.name}</strong>
                        </span>
                      )}
                    </div>
                    <div className="selection-actions">
                      <button
                        className="selection-btn"
                        onClick={
                          allOnPageSelected && totalResults <= results.length
                            ? clearSelection
                            : selectAllOnPage
                        }
                      >
                        {allOnPageSelected && totalResults <= results.length
                          ? 'Deselect all'
                          : `Select page (${results.length})`}
                      </button>
                      {totalResults > results.length && (
                        <button
                          className="selection-btn"
                          onClick={selectAllMatching}
                          title={
                            totalResults > 200
                              ? `Too many matches to select all (${totalResults}). Adds the first 200.`
                              : 'Refetches the full result set and selects every match'
                          }
                        >
                          {totalResults > 200
                            ? 'Select first 200'
                            : `Select all ${totalResults}`}
                        </button>
                      )}
                      <div className="add-to-group-wrap">
                        <button
                          className="selection-btn primary"
                          disabled={selectedCoins.size === 0}
                          onClick={() => setAddMenuOpen((o) => !o)}
                        >
                          + Add to collection ({selectedCoins.size}) ▾
                        </button>
                        {addMenuOpen && (
                          <div className="add-to-group-menu">
                            {groups.length === 0 && (
                              <div className="add-menu-empty">
                                No collections yet
                              </div>
                            )}
                            {[...groups]
                              .sort((a, b) =>
                                a.id === activeGroupId ? -1 : b.id === activeGroupId ? 1 : 0
                              )
                              .map((g) => (
                                <button
                                  key={g.id}
                                  className={`add-menu-item${g.id === activeGroupId ? ' active' : ''}`}
                                  onClick={() => handleAddSelectedToGroup(g.id)}
                                >
                                  <span className="add-menu-item-name">
                                    {g.id === activeGroupId && <span className="add-menu-active-dot" />}
                                    {g.name}
                                  </span>
                                  <span className="add-menu-count">
                                    {g.coinIds.length}
                                  </span>
                                </button>
                              ))}
                            <form
                              className="add-menu-create"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const name = e.target.elements.name.value.trim();
                                if (name) handleCreateGroupFromSelection(name);
                                e.target.reset();
                              }}
                            >
                              <input
                                name="name"
                                type="text"
                                placeholder="New collection…"
                              />
                              <button type="submit">Create</button>
                            </form>
                          </div>
                        )}
                      </div>
                      <button
                        className="selection-btn"
                        onClick={clearSelection}
                        disabled={selectedCoins.size === 0}
                      >
                        Clear
                      </button>
                      <button
                        className="selection-btn"
                        onClick={exitSelectionMode}
                      >
                        Done
                      </button>
                    </div>
                  </div>
              </div>
            )}

            <CoinGrid
              coins={results}
              loading={loading}
              error={error}
              onCoinClick={setSelectedCoin}
              selectable={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelected}
              grouped={aiUsed}
            />

            {hasSearched && aiUsed && !loading && (searchReadingsLoading || searchReadings.length > 0) && (
              <RelevantReadings readings={searchReadings} loading={searchReadingsLoading} />
            )}

            {totalPages > 1 && !loading && (
              <div className="pagination">
                <button
                  className="page-btn"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  ← Previous
                </button>
                <div className="page-numbers">
                  {getPageNumbers(page, totalPages).map((p, i) =>
                    p === '...' ? (
                      <span key={`ellipsis-${i}`} className="page-ellipsis">…</span>
                    ) : (
                      <button
                        key={p}
                        className={`page-num-btn${p === page ? ' active' : ''}`}
                        onClick={() => p !== page && handlePageChange(p)}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
                <button
                  className="page-btn"
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      {selectedCoin && (
        <CoinDetail
          coin={selectedCoin}
          onClose={() => setSelectedCoin(null)}
          generateSummary={generateCoinSummary}
        />
      )}

      {groupsPanelOpen && (
        <GroupsPanel
          groups={groups}
          activeGroupId={activeGroupId}
          onClose={() => setGroupsPanelOpen(false)}
          onCreate={createGroup}
          onDelete={deleteGroup}
          onRename={renameGroup}
          onSetActive={setActiveGroup}
          onRemoveCoin={removeCoinFromGroup}
onStartBulkSelect={() => {
            setSelectionMode(true);
          }}
        />
      )}

{atlasOpen && (
        <AtlasModal
          coins={atlasCoins}
          loading={atlasLoading}
          onClose={() => setAtlasOpen(false)}
          onCoinClick={(c) => setSelectedCoin(c)}
          onLoad={async () => {
            if (atlasCoins) return;
            setAtlasLoading(true);
            try {
              const r = await fetch(`${API_URL}/atlas`);
              const data = await r.json();
              setAtlasCoins(data.coins || []);
            } catch {
              setAtlasCoins([]);
            } finally {
              setAtlasLoading(false);
            }
          }}
        />
      )}
    </>
  );
}

function AtlasModal({ coins, loading, onClose, onCoinClick, onLoad }) {
  useEffect(() => { onLoad?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="atlas-overlay" onClick={onClose}>
      <div className="atlas-modal" onClick={(e) => e.stopPropagation()}>
        <div className="atlas-modal-head">
          <div>
            <div className="atlas-modal-eyebrow">All coins · grouped by mint and type</div>
            <div className="atlas-modal-title">Atlas of the Collection</div>
          </div>
          <button className="atlas-close" onClick={onClose}>✕</button>
        </div>
        {loading || !coins ? (
          <div className="atlas-loading">Charting {coins ? coins.length : ''} coins…</div>
        ) : (
          <WorldMap
            coins={coins}
            mode="collection"
            onCoinClick={onCoinClick}
            defaultView="med"
            totalKnown={coins.length}
          />
        )}
      </div>
    </div>
  );
}
