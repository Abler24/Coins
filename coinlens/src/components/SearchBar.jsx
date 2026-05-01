import { useState, useEffect, useRef } from 'react';

const EXAMPLE_QUERIES = [
  'oldest Roman gold coins',
  'Byzantine silver from the 9th century',
  'Greek coins featuring Zeus',
  'Islamic medieval bronze',
  'Egyptian gold coins with hieroglyphs',
  'Celtic electrum before 100 BCE',
];

export default function SearchBar({ onSearch, isParsing }) {
  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [queryIndex, setQueryIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const current = EXAMPLE_QUERIES[queryIndex];

    const timeout = setTimeout(() => {
      if (!isDeleting) {
        if (charIndex < current.length) {
          setPlaceholder(current.slice(0, charIndex + 1));
          setCharIndex(c => c + 1);
        } else {
          setTimeout(() => setIsDeleting(true), 2000);
        }
      } else {
        if (charIndex > 0) {
          setPlaceholder(current.slice(0, charIndex - 1));
          setCharIndex(c => c - 1);
        } else {
          setIsDeleting(false);
          setQueryIndex(i => (i + 1) % EXAMPLE_QUERIES.length);
        }
      }
    }, isDeleting ? 25 : 55);

    return () => clearTimeout(timeout);
  }, [charIndex, isDeleting, queryIndex]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  return (
    <div className="search-container">
      <form onSubmit={handleSubmit}>
        <div className="search-bar-wrapper">
          <span className="search-prefix">Search</span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder + '|'}
          />
          <button className="search-btn" type="submit" disabled={isParsing || !query.trim()}>
            {isParsing ? 'Parsing…' : 'Search'}
          </button>
        </div>
      </form>
    </div>
  );
}
