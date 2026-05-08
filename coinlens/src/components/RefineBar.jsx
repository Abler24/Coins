import { useState, useRef, useEffect } from 'react';

export default function RefineBar({ activeRefinement, onRefine, onClearRefinement, isRefining }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!activeRefinement) {
      inputRef.current?.focus();
    }
  }, [activeRefinement]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const val = text.trim();
    if (!val || isRefining) return;
    onRefine(val);
    setText('');
  };

  return (
    <div className="refine-bar-wrap">
      {activeRefinement && (
        <div className="refine-active-chip">
          <span className="refine-chip-label">Refined by</span>
          <span className="refine-chip-text">"{activeRefinement}"</span>
          <button className="refine-chip-clear" onClick={onClearRefinement} title="Clear refinement">
            ×
          </button>
        </div>
      )}
      <form className="refine-bar" onSubmit={handleSubmit}>
        <span className="refine-prefix">↳ Refine</span>
        <input
          ref={inputRef}
          className="refine-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='narrow these results… e.g. "only silver" or "before 400 BCE"'
          disabled={isRefining}
        />
        <button
          className="refine-btn"
          type="submit"
          disabled={isRefining || !text.trim()}
        >
          {isRefining ? <span className="refine-btn-dots"><span /><span /><span /></span> : '→'}
        </button>
      </form>
    </div>
  );
}
