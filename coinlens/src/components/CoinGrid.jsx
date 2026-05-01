import { useState } from 'react';
import CoinCard from './CoinCard';

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-image" />
      <div className="skeleton-info">
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </div>
    </div>
  );
}

const PREVIEW_COUNT = 3;
const PACK_MAX = 2; // groups with this many total coins or fewer get packed

function getDenomination(coin) {
  const nested = (coin.details?.coins?.denomination || '').trim();
  if (nested) return nested.charAt(0).toUpperCase() + nested.slice(1);
  const top = (coin.denomination || '').trim();
  if (top) return top.charAt(0).toUpperCase() + top.slice(1);
  return 'Other';
}

function groupByDenomination(coins) {
  const groups = [];
  const keyIndex = {};
  for (const coin of coins) {
    const key = getDenomination(coin);
    if (keyIndex[key] === undefined) {
      keyIndex[key] = groups.length;
      groups.push({ label: key, coins: [] });
    }
    groups[keyIndex[key]].coins.push(coin);
  }
  return groups;
}

// Builds a layout plan: large groups (>PACK_MAX coins) first in relevance order,
// then small groups greedy-packed into compact rows of exactly 3 columns at the end.
// Returns: Array of {type: 'full', group} | {type: 'compact', items: [{group, span}]}
function buildLayout(groups) {
  const large = groups.filter(g => g.coins.length > PACK_MAX);
  const small = groups.filter(g => g.coins.length <= PACK_MAX);

  const layout = large.map(group => ({ type: 'full', group }));

  let pending = [];
  let pendingWidth = 0;

  const flush = () => {
    if (pending.length === 0) return;
    if (pending.length === 1) {
      layout.push({ type: 'full', group: pending[0].group });
    } else {
      layout.push({ type: 'compact', items: [...pending] });
    }
    pending = [];
    pendingWidth = 0;
  };

  for (const group of small) {
    const size = group.coins.length;
    if (pendingWidth + size > 3) flush();
    pending.push({ group, span: size });
    pendingWidth += size;
    if (pendingWidth === 3) flush();
  }
  flush();

  return layout;
}

function FullGroup({ group, onCoinClick, selectable, selectedIds, onToggleSelect }) {
  const [expanded, setExpanded] = useState(false);
  const overflow = group.coins.length - PREVIEW_COUNT;
  const visible = expanded ? group.coins : group.coins.slice(0, PREVIEW_COUNT);

  return (
    <div className="denom-group">
      <div className="denom-group-header">
        <span className="denom-group-label">{group.label}</span>
        <span className="denom-group-count">{group.coins.length}</span>
      </div>
      <div className="coin-grid">
        {visible.map((coin) => (
          <CoinCard
            key={coin.objectid || coin.id}
            coin={coin}
            onClick={onCoinClick}
            selectable={selectable}
            selected={selectable && selectedIds?.has(coin.objectid)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
      {overflow > 0 && (
        <button
          className="denom-group-toggle"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show less' : `Show ${overflow} more`}
        </button>
      )}
    </div>
  );
}

function CompactRow({ items, onCoinClick, selectable, selectedIds, onToggleSelect }) {
  return (
    <div className="compact-row">
      {items.map(({ group, span }) => (
        <div key={group.label} className={`compact-item compact-item-${span}`}>
          <div className="compact-item-header">
            <span className="denom-group-label">{group.label}</span>
            <span className="denom-group-count">{group.coins.length}</span>
          </div>
          <div className="compact-item-cards">
            {group.coins.map((coin) => (
              <CoinCard
                key={coin.objectid || coin.id}
                coin={coin}
                onClick={onCoinClick}
                selectable={selectable}
                selected={selectable && selectedIds?.has(coin.objectid)}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CoinGrid({
  coins,
  loading,
  error,
  onCoinClick,
  selectable = false,
  selectedIds,
  onToggleSelect,
  grouped = false,
}) {
  if (error) {
    return (
      <div className="error-state">
        <div className="error-icon">⚠</div>
        <div className="error-title">Connection Error</div>
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="coin-grid">
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!coins || coins.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◎</div>
        <div className="empty-title">No Results</div>
        <div className="empty-subtitle">
          Try broadening your search or adjusting the filters
        </div>
      </div>
    );
  }

  if (grouped) {
    const groups = groupByDenomination(coins);
    if (groups.length > 1) {
      const layout = buildLayout(groups);
      return (
        <div className="denom-groups">
          {layout.map((item, i) =>
            item.type === 'full' ? (
              <FullGroup
                key={item.group.label}
                group={item.group}
                onCoinClick={onCoinClick}
                selectable={selectable}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
              />
            ) : (
              <CompactRow
                key={i}
                items={item.items}
                onCoinClick={onCoinClick}
                selectable={selectable}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
              />
            )
          )}
        </div>
      );
    }
  }

  return (
    <div className="coin-grid">
      {coins.map((coin) => (
        <CoinCard
          key={coin.objectid || coin.id}
          coin={coin}
          onClick={onCoinClick}
          selectable={selectable}
          selected={selectable && selectedIds?.has(coin.objectid)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
