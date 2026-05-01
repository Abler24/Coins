const API_URL = import.meta.env.VITE_API_URL || '/api';

function readingHref(r) {
  if (r.file) return `${API_URL}/readings/pdf/${encodeURIComponent(r.file)}`;
  if (r.url) return r.url;
  return null;
}

export default function RelevantReadings({ readings, loading }) {
  if (loading) {
    return (
      <div className="relevant-readings">
        <div className="relevant-readings-label">
          <span className="relevant-readings-badge">HAA 73</span>
          Relevant readings
        </div>
        <div className="relevant-readings-skeleton">
          <div className="skeleton-line" style={{ width: '80%' }} />
          <div className="skeleton-line" style={{ width: '60%', marginTop: 6 }} />
          <div className="skeleton-line" style={{ width: '75%', marginTop: 14 }} />
          <div className="skeleton-line" style={{ width: '55%', marginTop: 6 }} />
        </div>
      </div>
    );
  }

  if (!readings || readings.length === 0) return null;

  return (
    <div className="relevant-readings">
      <div className="relevant-readings-label">
        <span className="relevant-readings-badge">HAA 73</span>
        Relevant readings
      </div>
      <div className="relevant-readings-list">
        {readings.map((r) => {
          const href = readingHref(r);
          return (
            <div key={r.id} className="relevant-reading-item">
              <div className="relevant-reading-citation">
                <span className="relevant-reading-week">Week {r.week}</span>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relevant-reading-link"
                  >
                    {r.citation}
                  </a>
                ) : (
                  <span className="relevant-reading-text">{r.citation}</span>
                )}
              </div>
              {r.relevance && (
                <div className="relevant-reading-relevance">{r.relevance}</div>
              )}
              {r.key_passage && (
                <blockquote className="relevant-reading-quote">
                  <p>"{r.key_passage}"</p>
                  {r.passage_source && (
                    <cite className="relevant-reading-quote-source">— {r.passage_source}</cite>
                  )}
                </blockquote>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
