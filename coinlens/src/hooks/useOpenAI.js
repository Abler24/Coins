1import { useState, useCallback } from 'react';

const API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const MODEL = 'gpt-4o-mini';

const SEARCH_SYSTEM_PROMPT = `You are a professional search query parser for the Harvard Art Museums numismatic (coin) collection API. Your job is to convert natural language into precise API filters so users get relevant results.

## API fields (all optional; only include what the query implies)

- **culture**: string. Normalize empire/civilization/region to one canonical value. Examples: "Roman" (Roman Empire, Rome), "Greek", "Byzantine", "Islamic", "Egyptian", "Celtic", "Persian", "Chinese", "Indian", "Parthian", "Jewish", "Phoenician". Use title case.
- **medium**: string. Metal or material. Map: gold → "Gold", silver → "Silver", bronze → "Bronze", copper → "Copper", electrum → "Electrum". Use title case. For "precious metal" or "valuable" use "Gold" or leave broad.
- **datebegin**: number. Start year (negative = BCE, e.g. -500 for 500 BCE).
- **dateend**: number. End year.
- **keyword**: string. ONLY concrete searchable terms that appear in titles/descriptions: deity names (Zeus, Athena), animals (eagle, wolf), objects (portrait, wreath), places, ruler names, inscription words. Keep it short (a few words max).
- **denomination**: string. e.g. "denarius", "drachm", "solidus", "obol", "aureus", "sestertius", "follis".
- **hasimage**: boolean. Set true if user asks for coins "with images", "with photos", "that have pictures".
- **sortby**: "datebegin" | "accessionyear" | "rank".
- **sortorder**: "asc" | "desc".

## Critical rules (follow exactly)

1. **Never put these in keyword**: "famous", "notable", "important", "valuable", "best", "popular", "empire", "oldest", "newest", "rare", "common", "buying power", "worth". The API has no such fields—they would return zero results. For "most famous X" or "best X" use only culture + medium + sortby/sortorder; leave keyword empty or use only concrete subject terms.
2. **"Most famous / best / notable gold Roman coins"** → culture: "Roman", medium: "Gold", keyword: "" (empty), sortby: "rank", sortorder: "desc".
3. **Empire/civilization** → map to culture only. "Roman empire coins" → culture: "Roman". "Greek and Roman" → culture: "Roman" (or you could use one; API accepts one culture per query in our app).
4. **Metal** → always map to medium. "gold coins", "silver denarii" → medium: "Gold" or "Silver", plus denomination if stated.
5. **Time** → "oldest" → sortby "datebegin", sortorder "asc". "newest" / "latest" → sortby "datebegin", sortorder "desc". Add datebegin/dateend only if user gives a period (e.g. "1st century CE" → datebegin 1, dateend 100).
6. **Vague value terms** ("valuable", "expensive", "buying power") → do NOT put in keyword. Use medium "Gold" or "Silver" if they imply precious metal; otherwise omit.
7. Return ONLY valid JSON. No explanation, no markdown, no extra text.`;

const SUMMARY_SYSTEM_PROMPT = `You are a numismatics expert writing for the Harvard Art Museums coin collection. Given a coin's catalog data, write a short, engaging summary in 2–4 sentences. Cover: what the coin is (culture, period, material), what it shows (obverse/reverse if mentioned), and why it's historically or artistically notable. Use plain language for a general audience. Do not invent facts—only summarize or contextualize the information provided.`;

async function chat(systemPrompt, userContent) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from OpenAI');
  return text;
}

export function useOpenAI() {
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);

  const parseQuery = useCallback(async (query) => {
    if (!API_KEY) return { keyword: query };

    setParsing(true);
    setParseError(null);

    try {
      const text = await chat(SEARCH_SYSTEM_PROMPT, `User query: ${query}`);
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid response structure');
      return parsed;
    } catch (err) {
      setParseError(err.message);
      return { keyword: query };
    } finally {
      setParsing(false);
    }
  }, []);

  const generateCoinSummary = useCallback(async (coin) => {
    if (!API_KEY) return null;

    const parts = [
      coin.title && `Title: ${coin.title}`,
      coin.culture && `Culture: ${coin.culture}`,
      coin.period && `Period: ${coin.period}`,
      coin.dated && `Date: ${coin.dated}`,
      (coin.datebegin != null || coin.dateend != null) &&
        `Date range: ${coin.datebegin ?? '?'} to ${coin.dateend ?? '?'}`,
      coin.medium && `Medium: ${coin.medium}`,
      coin.denomination && `Denomination: ${coin.denomination}`,
      coin.description && `Description: ${coin.description}`,
      coin.details?.coins?.obverseinscription &&
        `Obverse inscription: ${coin.details.coins.obverseinscription}`,
      coin.details?.coins?.reverseinscription &&
        `Reverse inscription: ${coin.details.coins.reverseinscription}`,
    ].filter(Boolean);

    const userContent = parts.length ? parts.join('\n') : JSON.stringify(coin);
    return chat(SUMMARY_SYSTEM_PROMPT, userContent);
  }, []);

  const generateTopResultsSummaries = useCallback(async (coins) => {
    if (!API_KEY || !coins?.length) return [];
    const top = coins.slice(0, 5);
    const systemPrompt = `You are a numismatics expert. Given a list of coins from the Harvard Art Museums collection, write exactly one short sentence per coin summarizing what it is and why it matters (culture, period, metal, or notable feature). Be concise. Return valid JSON only: {"summaries": ["sentence for coin 1", "sentence for coin 2", ...]} with exactly ${top.length} strings in order. No markdown, no explanation.`;
    const lines = top.map((c, i) => {
      const t = c.title || 'Untitled';
      const cul = c.culture || '';
      const med = c.medium || '';
      const per = c.period || c.dated || '';
      return `${i + 1}. ${t} | ${cul} | ${med} | ${per}`;
    });
    const userContent = lines.join('\n');
    try {
      const text = await chat(systemPrompt, userContent);
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const data = JSON.parse(cleaned);
      const arr = Array.isArray(data.summaries) ? data.summaries : [];
      return top.map((_, i) => arr[i] || '').filter(Boolean);
    } catch {
      return [];
    }
  }, []);

  return { parseQuery, parsing, parseError, generateCoinSummary, generateTopResultsSummaries };
}
