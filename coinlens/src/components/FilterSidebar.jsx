import { useState } from 'react';

const CULTURES = [
  'Greek', 'Roman', 'Byzantine', 'Islamic', 'Egyptian', 'Celtic',
  'Persian', 'Ottoman', 'Mughal', 'Chinese', 'Indian',
  'Medieval European', 'Renaissance', 'Other',
];

const MEDIUMS = [
  'Gold', 'Silver', 'Bronze', 'Copper', 'Electrum',
  'Lead', 'Billon', 'Tin', 'Other',
];

const PERIODS = [
  '', 'Ancient', 'Classical', 'Hellenistic', 'Roman Imperial',
  'Late Antique', 'Byzantine', 'Medieval', 'Islamic Golden Age',
  'Renaissance', 'Early Modern',
];

const TECHNIQUES = ['', 'Struck', 'Cast', 'Hammered', 'Milled'];

const SORT_OPTIONS = [
  { value: 'datebegin|asc', label: 'Oldest First' },
  { value: 'datebegin|desc', label: 'Newest First' },
  { value: 'accessionyear|desc', label: 'Accession Year' },
  { value: 'rank|asc', label: 'Relevance' },
];

const SIZE_OPTIONS = [12, 24, 48];

function formatYear(y) {
  if (y < 0) return `${Math.abs(y)} BCE`;
  return `${y} CE`;
}

export default function FilterSidebar({ filters, onFiltersChange, onApply, onClear }) {
  const updateFilter = (key, value) => {
    onFiltersChange(prev => ({ ...prev, [key]: value }));
  };

  const toggleChip = (key, value) => {
    onFiltersChange(prev => {
      const current = prev[key] || [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  return (
    <aside className="filter-sidebar">
      {/* Culture */}
      <div className="filter-section">
        <label className="filter-label">Culture</label>
        <div className="chip-group">
          {CULTURES.map(c => (
            <button
              key={c}
              className={`chip ${(filters.cultures || []).includes(c) ? 'active' : ''}`}
              onClick={() => toggleChip('cultures', c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Medium */}
      <div className="filter-section">
        <label className="filter-label">Medium</label>
        <div className="chip-group">
          {MEDIUMS.map(m => (
            <button
              key={m}
              className={`chip ${(filters.mediums || []).includes(m) ? 'active' : ''}`}
              onClick={() => toggleChip('mediums', m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Denomination */}
      <div className="filter-section">
        <label className="filter-label">Denomination</label>
        <input
          className="filter-input"
          type="text"
          placeholder="e.g. denarius, drachm, obol..."
          value={filters.denomination || ''}
          onChange={e => updateFilter('denomination', e.target.value)}
        />
      </div>

      {/* Date Range */}
      <div className="filter-section">
        <label className="filter-label">Date Range</label>
        <div className="range-slider-container">
          <div className="range-labels">
            <span>{formatYear(filters.datebegin ?? -600)}</span>
            <span>{formatYear(filters.dateend ?? 1900)}</span>
          </div>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <label style={{ fontSize: '0.6rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>From</label>
            <input
              type="range"
              min={-600}
              max={1900}
              step={10}
              value={filters.datebegin ?? -600}
              onChange={e => updateFilter('datebegin', Number(e.target.value))}
              style={{ position: 'relative', width: '100%' }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: '0.6rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>To</label>
            <input
              type="range"
              min={-600}
              max={1900}
              step={10}
              value={filters.dateend ?? 1900}
              onChange={e => updateFilter('dateend', Number(e.target.value))}
              style={{ position: 'relative', width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* Period */}
      <div className="filter-section">
        <label className="filter-label">Period</label>
        <select
          className="filter-select"
          value={filters.period || ''}
          onChange={e => updateFilter('period', e.target.value)}
        >
          <option value="">All Periods</option>
          {PERIODS.filter(Boolean).map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Technique */}
      <div className="filter-section">
        <label className="filter-label">Technique</label>
        <select
          className="filter-select"
          value={filters.technique || ''}
          onChange={e => updateFilter('technique', e.target.value)}
        >
          <option value="">All Techniques</option>
          {TECHNIQUES.filter(Boolean).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Has Image */}
      <div className="filter-section">
        <label className="filter-label">Image Availability</label>
        <div
          className="toggle-switch"
          onClick={() => updateFilter('hasimage', !filters.hasimage)}
        >
          <div className={`toggle-track ${filters.hasimage ? 'active' : ''}`}>
            <div className="toggle-thumb" />
          </div>
          <span className="toggle-label-text">Only with images</span>
        </div>
      </div>

      {/* Sort */}
      <div className="filter-section">
        <label className="filter-label">Sort By</label>
        <select
          className="filter-select"
          value={`${filters.sortby || 'rank'}|${filters.sortorder || 'asc'}`}
          onChange={e => {
            const [sortby, sortorder] = e.target.value.split('|');
            onFiltersChange(prev => ({ ...prev, sortby, sortorder }));
          }}
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Results per page */}
      <div className="filter-section">
        <label className="filter-label">Results Per Page</label>
        <select
          className="filter-select"
          value={filters.size || 12}
          onChange={e => updateFilter('size', Number(e.target.value))}
        >
          {SIZE_OPTIONS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Actions */}
      <div className="filter-actions">
        <button className="filter-apply-btn" onClick={onApply}>
          Apply Filters
        </button>
        <button className="filter-clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>
    </aside>
  );
}
