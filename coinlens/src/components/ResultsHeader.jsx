export default function ResultsHeader({ filters, onRemoveFilter, onClearAll }) {
  const activeFilters = [];

  if (filters.cultures?.length) {
    filters.cultures.forEach(c =>
      activeFilters.push({ key: 'cultures', value: c, label: `Culture: ${c}` })
    );
  }
  if (filters.mediums?.length) {
    filters.mediums.forEach(m =>
      activeFilters.push({ key: 'mediums', value: m, label: `Medium: ${m}` })
    );
  }
  if (filters.denomination) {
    activeFilters.push({ key: 'denomination', value: null, label: `Denom: ${filters.denomination}` });
  }
  if (filters.period) {
    activeFilters.push({ key: 'period', value: null, label: `Period: ${filters.period}` });
  }
  if (filters.technique) {
    activeFilters.push({ key: 'technique', value: null, label: `Technique: ${filters.technique}` });
  }
  if (filters.keyword) {
    activeFilters.push({ key: 'keyword', value: null, label: `Search: ${filters.keyword}` });
  }
  if (filters.hasimage) {
    activeFilters.push({ key: 'hasimage', value: null, label: 'Has Image' });
  }
  if (filters.datebegin != null && filters.datebegin !== -600) {
    const yr = filters.datebegin < 0 ? `${Math.abs(filters.datebegin)} BCE` : `${filters.datebegin} CE`;
    activeFilters.push({ key: 'datebegin', value: null, label: `From: ${yr}` });
  }
  if (filters.dateend != null && filters.dateend !== 1900) {
    const yr = filters.dateend < 0 ? `${Math.abs(filters.dateend)} BCE` : `${filters.dateend} CE`;
    activeFilters.push({ key: 'dateend', value: null, label: `To: ${yr}` });
  }

  return (
    <div className="results-header">
      {activeFilters.length > 0 && (
        <div className="active-filters">
          {activeFilters.map((f, i) => (
            <span key={`${f.key}-${f.value || ''}-${i}`} className="active-filter-chip">
              {f.label}
              <button onClick={() => onRemoveFilter(f.key, f.value)}>×</button>
            </span>
          ))}
          <button className="clear-all-btn" onClick={onClearAll}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
