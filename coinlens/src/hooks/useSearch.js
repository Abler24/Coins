import { useState, useCallback, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export function useSearch() {
  const [results, setResults] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [aiParsed, setAiParsed] = useState(null);
  const [notice, setNotice] = useState(null);
  const abortRef = useRef(null);

  const search = useCallback(async ({ query = '', filters = {}, page: pageNum = 1, size = 12, sort = 'rank', sortorder = 'asc' } = {}) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(`${API_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, filters, page: pageNum, size, sort, sortorder }),
        signal: controller.signal,
      });

      if (!resp.ok) throw new Error(`API returned ${resp.status}`);
      const data = await resp.json();

      setResults(data.results || []);
      setTotalResults(data.total || 0);
      setTotalPages(data.pages || 0);
      setPage(data.page || pageNum);
      setAiParsed(data.ai_parsed || null);
      setNotice(data.notice || null);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Connection failed');
        setResults([]);
        setTotalResults(0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCoinSummary = useCallback(async (objectid) => {
    const resp = await fetch(`${API_URL}/coin/${objectid}/summary`);
    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const data = await resp.json();
    return data.summary;
  }, []);

  const fetchSearchSummary = useCallback(async (query, coinIds, groups) => {
    const resp = await fetch(`${API_URL}/search/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, coin_ids: coinIds, groups }),
    });
    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const data = await resp.json();
    return data.summary || '';
  }, []);

  const fetchRandomCoins = useCallback(async (count = 50) => {
    const resp = await fetch(`${API_URL}/random-coins?count=${count}&with_image=1`);
    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const data = await resp.json();
    return data.results || [];
  }, []);

  // Side-effect-free search used for "swipe through current results" and
  // other places that need the full result set without touching the visible grid.
  const searchAll = useCallback(async (params) => {
    const resp = await fetch(`${API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, size: 200, page: 1 }),
    });
    if (!resp.ok) throw new Error(`API returned ${resp.status}`);
    const data = await resp.json();
    return data.results || [];
  }, []);

  return { results, totalResults, loading, error, page, totalPages, search, setPage, aiParsed, notice, fetchCoinSummary, fetchSearchSummary, fetchRandomCoins, searchAll };
}
