import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const SUGGESTED_PROMPTS = [
  'Why was the Byzantine solidus the dollar of the Middle Ages?',
  'How did the invention of coinage change Greek society?',
  'What does the iconography on Roman imperial coins reveal about propaganda?',
  'Compare Islamic aniconic coinage with Byzantine figural types.',
  'What does Aristotle say about money in the Politics?',
  'How did Athens fund the Peloponnesian War through coinage?',
];

function citationsByNumber(citations) {
  const map = new Map();
  for (const c of citations) map.set(c.n, c);
  return map;
}

function CitationChip({ n, citation, onClick }) {
  return (
    <button
      type="button"
      className="cite-chip"
      onClick={() => onClick(citation)}
      title={citation ? `${citation.authors || citation.title} — pp. ${citation.page_start}–${citation.page_end}` : `Source ${n}`}
    >
      {n}
    </button>
  );
}

// Lightweight inline markdown for **bold** and *italic*. Returns nodes.
function renderInline(s, keyPrefix) {
  const out = [];
  // Combined regex for bold and italic
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[2]) out.push(<strong key={`${keyPrefix}-b${i}`}>{m[2]}</strong>);
    else if (m[4]) out.push(<em key={`${keyPrefix}-i${i}`}>{m[4]}</em>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// Renders text with [1], [1,2] tokens replaced by interactive citation chips.
function MessageBody({ text, citations, onOpenCitation }) {
  const map = useMemo(() => citationsByNumber(citations || []), [citations]);
  // Split into paragraphs first, then within each paragraph handle citations + inline markdown.
  // Preserve single newlines as <br />.
  const paragraphs = useMemo(() => text.split(/\n{2,}/), [text]);

  return (
    <div className="chat-msg-body">
      {paragraphs.map((para, pi) => {
        const segments = [];
        const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
        let last = 0;
        let m;
        let si = 0;
        while ((m = re.exec(para)) !== null) {
          if (m.index > last) {
            segments.push(
              <span key={`${pi}-t${si}`}>{renderInline(para.slice(last, m.index), `${pi}-${si}`)}</span>
            );
          }
          const nums = m[1].split(/\s*,\s*/).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
          segments.push(
            <span key={`${pi}-c${si}`} className="cite-chip-group">
              {nums.map((n, k) => (
                <CitationChip
                  key={`${pi}-${si}-${k}`}
                  n={n}
                  citation={map.get(n)}
                  onClick={onOpenCitation}
                />
              ))}
            </span>
          );
          last = m.index + m[0].length;
          si++;
        }
        if (last < para.length) {
          segments.push(
            <span key={`${pi}-tend`}>{renderInline(para.slice(last), `${pi}-end`)}</span>
          );
        }
        return <p key={pi} className="chat-para">{segments}</p>;
      })}
    </div>
  );
}

function SourceCard({ citation, onOpen }) {
  const pages = citation.page_start === citation.page_end
    ? `p. ${citation.page_start}`
    : `pp. ${citation.page_start}–${citation.page_end}`;
  return (
    <button type="button" className="chat-source-card" onClick={() => onOpen(citation)}>
      <div className="chat-source-num">[{citation.n}]</div>
      <div className="chat-source-meta">
        <div className="chat-source-title">{citation.title}</div>
        <div className="chat-source-author">
          {citation.authors || '—'}
          {citation.week ? ` · Week ${citation.week}` : ''}
          {' · '}{pages}
        </div>
      </div>
    </button>
  );
}

function CoinResultCard({ coin, onOpen }) {
  const img = coin.primaryimageurl || coin.images?.[0]?.baseimageurl;
  const date = coin.dated || (
    coin.datebegin && coin.datebegin < 0
      ? `${Math.abs(coin.datebegin)} BCE`
      : coin.datebegin
  );
  return (
    <button type="button" className="chat-coin-card" onClick={() => onOpen(coin)}>
      <div className="chat-coin-img-wrap">
        {img ? (
          <img className="chat-coin-img" src={img} alt={coin.title || 'Coin'} />
        ) : (
          <div className="chat-coin-img-placeholder">no image</div>
        )}
      </div>
      <div className="chat-coin-meta">
        <div className="chat-coin-title">{coin.title || 'Untitled'}</div>
        <div className="chat-coin-sub">
          {coin.culture || ''}{date ? ` · ${date}` : ''}{coin.medium ? ` · ${coin.medium}` : ''}
        </div>
      </div>
    </button>
  );
}

export default function CoinChat({ onOpenCoin } = {}) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(null);
  const [sources, setSources] = useState([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [coins, setCoins] = useState([]);
  const [coinsLoading, setCoinsLoading] = useState(false);
  const [coinsQuery, setCoinsQuery] = useState('');
  const [pdfBuilding, setPdfBuilding] = useState(false);
  const [actionError, setActionError] = useState('');
  const transcriptRef = useRef(null);
  const textareaRef = useRef(null);

  // Load source list once for the sidebar
  useEffect(() => {
    fetch(`${API_URL}/chat/sources`)
      .then((r) => r.json())
      .then((data) => setSources(data.sources || []))
      .catch(() => setSources([]));
  }, []);

  // Auto-scroll transcript on new tokens
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [draft]);

  const sendMessage = useCallback(async (text) => {
    const trimmed = (text ?? draft).trim();
    if (!trimmed || streaming) return;

    const next = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setDraft('');
    setStreaming(true);

    // Add an empty assistant placeholder we'll fill via streaming
    setMessages((m) => [...m, { role: 'assistant', content: '', citations: [], streaming: true }]);

    try {
      const resp = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Parse SSE: events separated by \n\n
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = 'message';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (event === 'citations') {
            try {
              const cites = JSON.parse(data);
              setMessages((m) => {
                const idx = m.length - 1;
                if (idx < 0 || m[idx].role !== 'assistant') return m;
                const next = m.slice();
                next[idx] = { ...m[idx], citations: cites };
                return next;
              });
            } catch {}
          } else if (event === 'token') {
            try {
              const tok = JSON.parse(data);
              setMessages((m) => {
                const idx = m.length - 1;
                if (idx < 0 || m[idx].role !== 'assistant') return m;
                const next = m.slice();
                next[idx] = { ...m[idx], content: m[idx].content + tok };
                return next;
              });
            } catch {}
          } else if (event === 'error') {
            const err = (() => { try { return JSON.parse(data); } catch { return data; } })();
            setMessages((m) => {
              const idx = m.length - 1;
              if (idx < 0 || m[idx].role !== 'assistant') return m;
              const next = m.slice();
              next[idx] = { ...m[idx], content: `Sorry — ${err}`, error: true };
              return next;
            });
          }
        }
      }
    } catch (e) {
      setMessages((m) => {
        const idx = m.length - 1;
        if (idx < 0 || m[idx].role !== 'assistant') return m;
        const next = m.slice();
        next[idx] = { ...m[idx], content: `Sorry — ${e.message || 'request failed'}`, error: true };
        return next;
      });
    } finally {
      setStreaming(false);
      setMessages((m) => {
        const idx = m.length - 1;
        if (idx < 0 || m[idx].role !== 'assistant') return m;
        const next = m.slice();
        const { streaming: _, ...rest } = m[idx];
        next[idx] = rest;
        return next;
      });
    }
  }, [draft, streaming, messages]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const openCitation = (c) => {
    if (!c?.file) return;
    setPdfOpen(c);
  };

  const newChat = () => {
    setMessages([]);
    setDraft('');
    setCoins([]);
    setCoinsQuery('');
    setActionError('');
  };

  const findCoins = useCallback(async () => {
    if (messages.length === 0 || coinsLoading) return;
    setCoinsLoading(true);
    setActionError('');
    try {
      // Step 1: distill conversation → coin search query (uses chat context)
      const qResp = await fetch(`${API_URL}/chat/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const { query } = await qResp.json();
      if (!query) throw new Error('Could not derive a search query');
      setCoinsQuery(query);
      // Step 2: same /api/search the AI Search box uses
      const sResp = await fetch(`${API_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          filters: { hasimage: true },
          page: 1,
          size: 8,
          sort: 'rank',
        }),
      });
      const data = await sResp.json();
      setCoins(data.results || data.coins || []);
    } catch (e) {
      setActionError(e.message || 'Failed to find coins');
    } finally {
      setCoinsLoading(false);
    }
  }, [messages, coinsLoading]);

  const exportPdf = useCallback(async () => {
    if (coins.length === 0 || pdfBuilding) return;
    setPdfBuilding(true);
    setActionError('');
    try {
      const firstQ = messages.find((m) => m.role === 'user')?.content || 'Coin Chat';
      const groupName = `Coin Chat — ${firstQ.slice(0, 60)}${firstQ.length > 60 ? '…' : ''}`;
      const resp = await fetch(`${API_URL}/groups/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_name: groupName,
          coin_ids: coins.map((c) => c.objectid).filter(Boolean),
          include_summary: true,
        }),
      });
      if (!resp.ok) throw new Error(`PDF export failed (${resp.status})`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${groupName.replace(/[^a-zA-Z0-9 \-_]/g, '').slice(0, 80)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setActionError(e.message || 'Failed to build PDF');
    } finally {
      setPdfBuilding(false);
    }
  }, [coins, messages, pdfBuilding]);

  return (
    <div className="chat-shell">
      <div className="chat-main">
        <div className="chat-header">
          <div className="chat-header-top">
            <div className="chat-eyebrow">HAA 73 · Money Matters</div>
            <div className="chat-header-actions">
              <button
                className="chat-toolbtn"
                onClick={() => setSourcesOpen((v) => !v)}
              >
                {sourcesOpen ? 'Hide' : 'Show'} sources
              </button>
              {messages.length > 0 && (
                <button className="chat-toolbtn" onClick={newChat}>
                  New chat
                </button>
              )}
            </div>
          </div>
          <div className="chat-header-title-row">
            <h2 className="chat-title">Coin Chat</h2>
            <div className="chat-trust-row">
              <span className="chat-trust-pill"><span className="dot" />Grounded in {sources.length || 46} course PDFs</span>
              <span className="chat-trust-pill"><span className="dot" />Inline citations to page numbers</span>
              <span className="chat-trust-pill"><span className="dot" />Refuses to invent sources</span>
            </div>
          </div>
        </div>

        <div className="chat-transcript" ref={transcriptRef}>
          {messages.length === 0 && (
            <div className="chat-empty">

              <h3 className="chat-empty-heading">Built so it can't make things up</h3>
              <p className="chat-empty-lead">
                Every answer is grounded in the HAA 73 readings — each claim links to the exact page. If the syllabus doesn't cover your question, it says so.
              </p>
              <div className="chat-empty-trust">
                <span className="chat-trust-pill"><span className="dot" />2,784 indexed passages</span>
                <span className="chat-trust-pill"><span className="dot" />Top-8 retrieval per turn</span>
                <span className="chat-trust-pill"><span className="dot" />Claude Sonnet 4.5</span>
              </div>
              <div className="chat-suggestions-label">Try one of these</div>
              <div className="chat-suggestions">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    className="chat-suggestion"
                    onClick={() => sendMessage(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`chat-msg chat-msg-${m.role}`}>
              <div className="chat-msg-role">{m.role === 'user' ? 'You' : 'CoinChat'}</div>
              {m.role === 'assistant' ? (
                <>
                  <MessageBody
                    text={m.content || (m.streaming ? '' : '…')}
                    citations={m.citations}
                    onOpenCitation={openCitation}
                  />
                  {m.streaming && !m.content && (
                    <div className="chat-typing">
                      <span /><span /><span />
                    </div>
                  )}
                  {m.citations && m.citations.length > 0 && !m.streaming && (
                    <div className="chat-sources">
                      <div className="chat-sources-label">Sources cited</div>
                      <div className="chat-sources-grid">
                        {m.citations.map((c) => (
                          <SourceCard key={c.n} citation={c} onOpen={openCitation} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="chat-msg-user-text">{m.content}</p>
              )}
            </div>
          ))}

          {messages.some((m) => m.role === 'assistant' && m.content && !m.streaming) && (
            <div className="chat-actions-panel">
              <div className="chat-actions-row">
                <button
                  className="chat-action-btn primary"
                  onClick={findCoins}
                  disabled={coinsLoading}
                >
                  {coinsLoading
                    ? 'Searching collection…'
                    : coins.length > 0
                      ? '↻ Refresh coins from this conversation'
                      : '⚲ Find coins from this conversation'}
                </button>
                {coins.length > 0 && (
                  <button
                    className="chat-action-btn"
                    onClick={exportPdf}
                    disabled={pdfBuilding}
                  >
                    {pdfBuilding ? 'Building PDF…' : '⤓ Export PDF'}
                  </button>
                )}
              </div>
              {actionError && (
                <div className="chat-action-error">{actionError}</div>
              )}
              {coinsQuery && coins.length > 0 && (
                <div className="chat-coins-query">
                  Searched: <em>{coinsQuery}</em>
                </div>
              )}
              {coins.length > 0 && (
                <div className="chat-coins-grid">
                  {coins.map((c) => (
                    <CoinResultCard
                      key={c.objectid || c.id}
                      coin={c}
                      onOpen={(coin) => onOpenCoin && onOpenCoin(coin)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="chat-composer">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about a coin, a reading, a concept…"
            rows={1}
            disabled={streaming}
          />
          <button
            className="chat-send"
            onClick={() => sendMessage()}
            disabled={!draft.trim() || streaming}
          >
            {streaming ? '…' : 'Send'}
          </button>
        </div>
        <div className="chat-disclaimer">
          Each answer is generated only after retrieving relevant passages from the indexed PDFs; click any [N] to verify the source. For citations in academic work, always confirm against the original page.
        </div>
      </div>

      {sourcesOpen && (
        <aside className="chat-sources-panel">
          <div className="chat-sources-panel-head">
            <div>
              <div className="chat-sources-panel-eyebrow">Indexed</div>
              <div className="chat-sources-panel-title">Course readings</div>
            </div>
            <button className="chat-toolbtn" onClick={() => setSourcesOpen(false)}>×</button>
          </div>
          <div className="chat-sources-panel-list">
            {sources.length === 0 && (
              <div className="chat-sources-panel-empty">No sources indexed yet.</div>
            )}
            {sources.map((s) => (
              <a
                key={s.file}
                href={`${API_URL}/readings/pdf/${encodeURIComponent(s.file)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="chat-sources-panel-item"
              >
                <div className="chat-sources-panel-week">
                  {s.week ? `Week ${s.week}` : '—'}
                </div>
                <div className="chat-sources-panel-meta">
                  <div className="chat-sources-panel-name">{s.title || s.file}</div>
                  <div className="chat-sources-panel-author">{s.authors || ''}</div>
                </div>
              </a>
            ))}
          </div>
        </aside>
      )}

      {pdfOpen && (
        <div className="chat-pdf-overlay" onClick={() => setPdfOpen(null)}>
          <div className="chat-pdf-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chat-pdf-head">
              <div className="chat-pdf-title">
                <div className="chat-pdf-eyebrow">{pdfOpen.authors || ''}</div>
                <div>{pdfOpen.title || pdfOpen.file}</div>
              </div>
              <button className="chat-pdf-close" onClick={() => setPdfOpen(null)}>×</button>
            </div>
            <iframe
              title={pdfOpen.title || pdfOpen.file}
              src={`${API_URL}/readings/pdf/${encodeURIComponent(pdfOpen.file)}#page=${pdfOpen.page_start || 1}`}
              className="chat-pdf-frame"
            />
          </div>
        </div>
      )}
    </div>
  );
}
