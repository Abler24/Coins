import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function GroupsPanel({
  groups,
  activeGroupId,
  onClose,
  onCreate,
  onDelete,
  onRename,
  onSetActive,
  onRemoveCoin,
  onStartBulkSelect,
}) {
  const [selectedId, setSelectedId] = useState(
    activeGroupId || (groups[0]?.id ?? null),
  );
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!groups.find((g) => g.id === selectedId)) {
      setSelectedId(groups[0]?.id ?? null);
    }
  }, [groups, selectedId]);

  const selected = groups.find((g) => g.id === selectedId) || null;

  const handleCreate = (e) => {
    e?.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const g = onCreate(name);
    setNewName('');
    if (g?.id) {
      onSetActive(g.id);
      onStartBulkSelect();
      onClose();
    }
  };

  const handleStartRename = () => {
    if (!selected) return;
    setRenameValue(selected.name);
    setRenaming(true);
  };

  const handleSaveRename = () => {
    if (selected && renameValue.trim()) {
      onRename(selected.id, renameValue.trim());
    }
    setRenaming(false);
  };

  const handleDownload = async () => {
    if (!selected || selected.coinIds.length === 0) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const resp = await fetch(`${API_URL}/groups/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_name: selected.name,
          coin_ids: selected.coinIds,
          include_summary: true,
        }),
      });
      if (!resp.ok) throw new Error(`PDF export failed (${resp.status})`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selected.name.replace(/[^\w\-. ]+/g, '') || 'group'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content groups-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="groups-layout">
          <aside className="groups-sidebar">
            <h2 className="groups-heading">Collections</h2>

            <form className="group-create-form" onSubmit={handleCreate}>
              <input
                type="text"
                className="group-create-input"
                placeholder="New collection name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                type="submit"
                className="group-create-btn"
                disabled={!newName.trim()}
              >
                + Create
              </button>
            </form>

            <div className="group-list">
              {groups.length === 0 && (
                <div className="group-empty">No collections yet.</div>
              )}
              {groups.map((g) => (
                <div
                  key={g.id}
                  className={`group-list-item${g.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(g.id)}
                >
                  <div className="group-list-name">{g.name}</div>
                  <div className="group-list-meta">
                    {g.coinIds.length} coin{g.coinIds.length === 1 ? '' : 's'} ·{' '}
                    {formatDate(g.createdAt)}
                  </div>
                  <button
                    className="group-list-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${g.name}"?`)) onDelete(g.id);
                    }}
                    aria-label="Delete collection"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <section className="groups-detail">
            {!selected && (
              <div className="groups-detail-empty">
                Create a collection to start curating coins.
              </div>
            )}

            {selected && (
              <>
                <div className="groups-detail-header">
                  {renaming ? (
                    <div className="groups-rename">
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename();
                          if (e.key === 'Escape') setRenaming(false);
                        }}
                      />
                      <button onClick={handleSaveRename}>Save</button>
                    </div>
                  ) : (
                    <h2 onClick={handleStartRename} title="Click to rename">
                      {selected.name}
                    </h2>
                  )}
                  <div className="groups-detail-sub">
                    {selected.coinIds.length} coin
                    {selected.coinIds.length === 1 ? '' : 's'}
                  </div>
                </div>

                <div className="groups-actions">
                  <button
                    className="groups-action-btn primary"
                    onClick={handleDownload}
                    disabled={selected.coinIds.length === 0 || downloading}
                  >
                    {downloading ? 'Generating PDF…' : '⬇ Download PDF'}
                  </button>
                  {downloading && (
                    <div
                      className="pdf-progress"
                      title={`~${Math.max(3, Math.ceil(selected.coinIds.length * 0.25))}s for ${selected.coinIds.length} coins`}
                    >
                      <div className="pdf-progress-bar" />
                      <div className="pdf-progress-label">
                        Fetching images and generating summaries for {selected.coinIds.length} coin
                        {selected.coinIds.length === 1 ? '' : 's'}…
                      </div>
                    </div>
                  )}
                  <button
                    className="groups-action-btn"
                    onClick={() => {
                      onSetActive(selected.id);
                      onStartBulkSelect();
                      onClose();
                    }}
                  >
                    ☐ Browse & select from search
                  </button>
                </div>

                {downloadError && (
                  <div className="groups-error">{downloadError}</div>
                )}

                <div className="groups-coins">
                  {selected.coinIds.length === 0 && (
                    <div className="groups-coins-empty">
                      <div className="groups-empty-heading">No coins yet</div>
                      <p className="groups-empty-sub">
                        Search and select coins to add to <strong>{selected.name}</strong>.
                      </p>
                      <div className="groups-empty-actions">
                        <button
                          className="groups-empty-btn primary"
                          onClick={() => {
                            onSetActive(selected.id);
                            onStartBulkSelect();
                            onClose();
                          }}
                        >
                          ☐ Search &amp; select coins for this collection
                        </button>
                      </div>
                    </div>
                  )}
                  {selected.coinIds.map((id) => {
                    const c = selected.coinsById?.[id];
                    if (!c) return null;
                    return (
                      <div className="groups-coin-card" key={id}>
                        <div className="groups-coin-image">
                          {c.primaryimageurl ? (
                            <img src={c.primaryimageurl} alt={c.title} />
                          ) : (
                            <div className="coin-placeholder">
                              <span className="coin-placeholder-text">NO IMAGE</span>
                            </div>
                          )}
                          <button
                            className="groups-coin-remove"
                            onClick={() => onRemoveCoin(selected.id, id)}
                            aria-label="Remove from collection"
                          >
                            ×
                          </button>
                        </div>
                        <div className="groups-coin-title">{c.title}</div>
                        {c.culture && (
                          <div className="groups-coin-meta">{c.culture}</div>
                        )}
                        {c.dated && (
                          <div className="groups-coin-meta">{c.dated}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
