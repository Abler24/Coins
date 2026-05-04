"""
Flask backend for CoinLens.
Provides /api/search and /api/coin/<id> endpoints backed by
a Supabase/pgvector database of Harvard Art Museums coins.
"""

import io
import json
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import anthropic
import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from openai import OpenAI
from supabase import create_client, Client

# PDF generation libs are large; only load if installed (not bundled on Vercel)
try:
    from PIL import Image as PILImage
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        Image as RLImage,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
    )
    from reportlab.platypus.flowables import HRFlowable, KeepTogether
    _PDF_LIBS_AVAILABLE = True
except ImportError:
    _PDF_LIBS_AVAILABLE = False

from readings_data import READINGS, READINGS_BY_ID, candidate_readings_for

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"), override=True)

app = Flask(__name__)
CORS(app)

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

EMBED_MODEL = "text-embedding-3-large"
GPT_MODEL = "gpt-4o-mini"
CHAT_MODEL = "claude-sonnet-4-5-20250929"

client = OpenAI(api_key=OPENAI_API_KEY)
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None
supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def _load_culture_labels():
    try:
        result = supabase_client.rpc("culture_counts").execute()
        return [(row["culture"], row["count"]) for row in result.data if row.get("culture")]
    except Exception:
        return []


# Culture list loaded lazily on first search — avoids a Supabase round-trip at cold-start
_PARSE_PROMPT_CACHE = None  # str, set on first search call


def _get_parse_system_prompt():
    global _PARSE_PROMPT_CACHE
    if _PARSE_PROMPT_CACHE is None:
        cultures = _load_culture_labels()
        culture_list_str = ", ".join(f"{c} ({n})" for c, n in cultures)
        _PARSE_PROMPT_CACHE = f"""You are a search query parser for the Harvard Art Museums numismatic collection. This collection contains primarily ancient and medieval coins (Greek, Roman, Byzantine, Islamic, Celtic, Persian, etc.) — NOT modern, American, or commemorative coins.

AVAILABLE CULTURE LABELS (exact strings in the catalog, with coin counts; you MUST pick from this list):
{culture_list_str}

Given a natural language query, extract THREE things:

1. **hard_filters**: Exact-match filters to narrow the SQL search. Only include filters the query clearly implies.
   - mint: string (optional) — extract ONLY when the query is primarily a mint-city name (e.g. "rome", "athens", "constantinople", "antioch", "carthage"). This triggers a title text-search that restricts results to coins actually struck at that city. Do NOT set for thematic queries even if a city is mentioned in passing (e.g. "roman coins", "zeus", "coins with portraits of Alexander" should NOT set mint).
   - culture: an ARRAY of culture label strings taken EXACTLY from the list above. Your job is to decide which of those labels match the user's intent — this is often more than one. Rules:
     * Regional or broad terms must expand to every label that plausibly fits. "African" -> ["Egyptian", "Carthaginian", "North African", "South African", "Berber", "Mauretanian", "Punic", "Vandalic", "Siculo-Punic"]. "Macedonian" -> ["Macedonian", "Greek", "Hellenistic", "Seleucid", "Graeco-Bactrian", "Indo-Greek"] (Alexander and his successors are mostly cataloged as Greek/Hellenistic). "Middle Eastern" -> ["Persian", "Sasanian", "Parthian", "Achaemenid", "Arab", "Islamic", "Judaean", "Jewish", "Nabataean", "Phoenician", "Assyrian", "Near Eastern"]. "British Isles" -> ["British", "British, Scottish", "Irish"].
     * Ambiguous / generic cultures in the list should be added when they could hold the user's intent: "Roman" matches should also include "Roman Provincial", "Roman Imperial", "Roman Republican", "Late Roman or Byzantine", "Graeco-Roman", "Hellenistic or Early Roman", "Roman?". "Greek" should include "Hellenistic", "Graeco-Roman", "Hellenistic or Early Roman", "Indo-Greek", "Greek?".
     * Narrow/specific terms should stay narrow. "Sasanian" -> ["Sasanian"]. A query that names one ruler or mint doesn't need expansion.
     * If the user's term does not map to anything in the list (e.g. "Klingon"), omit culture entirely.
     * OMIT the culture filter when the user's interest is a THEME across cultures ("coins with lions", "oldest coins") — do not constrain by culture just because a region was mentioned in passing.
   - medium: string (e.g. "Gold", "Silver", "Bronze", "Copper", "Electrum")
   - datebegin: number (start year, negative for BCE)
   - dateend: number (end year)

2. **semantic_query**: A rephrased version of the query optimized for semantic/vector search against coin descriptions. Include concrete details: subject matter, imagery, rulers, denominations, inscriptions, stylistic elements. Strip out vague terms like "famous", "best", "valuable", "rare".

For subjective queries, expand the semantic_query into concrete examples of what that means numismatically — use DIVERSE references across different cultures, periods, and metals. Aim for variety, not depth in one area.

3. **score_boost**: Which pre-computed expert scores to boost in ranking. Use when the query implies subjective qualities that embeddings can't capture. Available scores: "historical_significance", "rarity", "artistic_merit", "auction_value", "collector_interest". Provide as a list of strings, or empty list [] if the query is purely factual/descriptive.

Return ONLY valid JSON:
{{"hard_filters": {{...}}, "semantic_query": "...", "score_boost": [...]}}

Examples:
- "oldest Greek silver coins with owls" -> {{"hard_filters": {{"culture": ["Greek", "Hellenistic", "Graeco-Roman", "Hellenistic or Early Roman"], "medium": "Silver"}}, "semantic_query": "Greek silver coin featuring owl imagery, Athenian tetradrachm", "score_boost": []}}
- "Roman gold coins from the 1st century" -> {{"hard_filters": {{"culture": ["Roman", "Roman Imperial", "Roman Republican", "Roman Provincial", "Roman?"], "medium": "Gold", "datebegin": 1, "dateend": 100}}, "semantic_query": "Roman gold aureus from the 1st century CE", "score_boost": []}}
- "macedonian coins" -> {{"hard_filters": {{"culture": ["Macedonian", "Greek", "Hellenistic", "Seleucid", "Graeco-Bactrian", "Indo-Greek"]}}, "semantic_query": "coins of Macedon, Philip II, Alexander the Great, Antigonid kings, tetradrachm, stater", "score_boost": []}}
- "african coins" -> {{"hard_filters": {{"culture": ["Egyptian", "Carthaginian", "North African", "South African", "Berber", "Mauretanian", "Punic", "Vandalic", "Siculo-Punic"]}}, "semantic_query": "coins from Africa, Carthage, Ptolemaic Egypt, Numidia, Mauretania, Vandal kingdom", "score_boost": []}}
- "most famous coins" -> {{"hard_filters": {{}}, "semantic_query": "Athenian owl tetradrachm, Roman denarius of Julius Caesar, gold aureus, Alexander the Great stater, Byzantine solidus, Corinthian stater, EID MAR Brutus denarius, decadrachm of Syracuse", "score_boost": ["historical_significance", "collector_interest"]}}
- "rare Byzantine coins" -> {{"hard_filters": {{"culture": ["Byzantine", "Byzantine?", "Late Roman or Byzantine", "Arabo-Byzantine"]}}, "semantic_query": "rare Byzantine coin, solidus, follis, unusual types", "score_boost": ["rarity"]}}
- "coins with portraits of Alexander" -> {{"hard_filters": {{}}, "semantic_query": "coin with portrait of Alexander the Great, stater, tetradrachm", "score_boost": []}}
- "rome" -> {{"hard_filters": {{"mint": "rome", "culture": ["Roman", "Roman Imperial", "Roman Republican", "Roman Provincial", "Graeco-Roman", "Late Roman or Byzantine"]}}, "semantic_query": "coins struck at the Rome mint, Roman denarius aureus sestertius from Rome", "score_boost": []}}
- "athens" -> {{"hard_filters": {{"mint": "athens", "culture": ["Greek", "Hellenistic", "Graeco-Roman", "Hellenistic or Early Roman"]}}, "semantic_query": "coins struck at Athens, Athenian tetradrachm owl coinage", "score_boost": []}}
- "zeus" -> {{"hard_filters": {{}}, "semantic_query": "coin depicting Zeus, Greek god of thunder, thunderbolt eagle seated Zeus head of Zeus", "score_boost": []}}"""
    return _PARSE_PROMPT_CACHE


# ---------------------------------------------------------------------------
# GPT helpers
# ---------------------------------------------------------------------------

RERANK_SYSTEM_PROMPT = """You are a numismatics expert. Given a user's search query and a list of candidate coins, rerank them by relevance to the query.

Consider:
- How well each coin matches the user's intent (subject matter, time period, culture, material)
- Prioritize coins with images when the results are otherwise similar
- For subjective queries like "most famous" or "best examples", use your numismatic expertise
- STRONGLY deprioritize generic/unidentified coins whose title is just "Coin" or "coin" with no culture, period, or other identifying information. These are cataloging placeholders and are almost never what the user is looking for.
- DIVERSITY: Interleave different coin denominations and types so results are not clustered by denomination. If there are many Solidus coins, spread them out so other denominations (Follis, Miliaresion, Histamenon, etc.) appear early in the ranking rather than being buried at the end.

Return ONLY valid JSON: {"ranked_ids": [id1, id2, ...]} with the IDs ordered from most to least relevant.
Only include IDs from the provided list.
ACTIVELY FILTER: exclude any coin that does not genuinely match the query. For broad queries (e.g. "byzantine") returning 40-80 results is fine. For specific or niche queries (e.g. "gold coins with Christ Pantokrator" or "coins of Justinian II"), only return the coins that are actually a strong match — 5 to 20 results is better than 80 weak ones. Quality over quantity."""

SUMMARY_SYSTEM_PROMPT = """You are a numismatics expert writing for the Harvard Art Museums coin collection. Given a coin's catalog data, write a short, engaging summary in 2-4 sentences. Cover: what the coin is (culture, period, material), what it shows (obverse/reverse if mentioned), and why it's historically or artistically notable. Use plain language for a general audience. Do not invent facts -- only summarize or contextualize the information provided."""

SEARCH_SUMMARY_SYSTEM_PROMPT = """You are a numismatics curator presenting search results to a visitor of the Harvard Art Museums numismatic collection.

The results are grouped by denomination type. Write a 2-3 sentence summary that:
1. Opens by naming the denomination types found and how many coins of each type the collection has — e.g. "The collection holds 31 solidi, 6 histamena, and 5 hexagrams matching this search." Do NOT open with "It looks like...", "You seem to be looking for...", or any phrase that narrates the user's intent back to them.
2. Briefly contextualizes what makes these types historically or artistically significant — how they differ from each other, what periods or rulers they represent, why they matter.
3. Uses a direct, expert-guide tone — like a curator orienting a visitor to a cabinet of coins.

FORMATTING RULES:
- Output PLAIN TEXT only. No markdown — no asterisks, no underscores, no backticks, no hashes, no bullet points.
- One short paragraph, no bullet lists, no headings.
- Do not name individual coins. Focus on the types and what the collection offers.

Do not invent facts — only use the denomination and count data provided."""


READINGS_SYSTEM_PROMPT = """You are a teaching assistant for HAA 73: Money Matters at Harvard University.

Given metadata about one or more coins and a list of candidate course readings, select the 2-3 readings that are MOST directly relevant to understanding these specific coins. For each selected reading write ONE sentence explaining the direct connection between the reading and these coins — be specific (mention the coin's culture, denomination, imagery, or period by name).

Return ONLY valid JSON:
{"readings": [{"id": "reading-id", "relevance": "One specific sentence."}]}

Only use IDs from the candidate list. If fewer than 2 are clearly relevant, return fewer. Prioritize readings that discuss the SAME culture, period, or coin type — not just the same broad era."""


def gpt_rank_readings(coin_descriptions: str, candidates: list[dict]) -> list[dict]:
    if not candidates:
        return []
    lines = []
    for r in candidates:
        lines.append(f'ID={r["id"]}: "{r["title"]}" by {r["authors"]} — {r["description"]}')
    candidate_text = "\n".join(lines)
    user_content = f"Coins:\n{coin_descriptions}\n\nCandidate readings:\n{candidate_text}"
    try:
        resp = client.chat.completions.create(
            model=GPT_MODEL,
            messages=[
                {"role": "system", "content": READINGS_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        result = json.loads(resp.choices[0].message.content)
        ranked = result.get("readings", [])
        output = []
        for item in ranked:
            rid = item.get("id")
            if rid and rid in READINGS_BY_ID:
                reading = dict(READINGS_BY_ID[rid])
                reading["relevance"] = item.get("relevance", "")
                output.append(reading)
        return output
    except Exception:
        return []


def gpt_parse_query(query):
    resp = client.chat.completions.create(
        model=GPT_MODEL,
        messages=[
            {"role": "system", "content": _get_parse_system_prompt()},
            {"role": "user", "content": query},
        ],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content)


def gpt_rerank(query, candidates):
    if not candidates:
        return []
    lines = []
    for c in candidates:
        data = c["data"]
        title = data.get("title", "Untitled")
        culture = data.get("culture", "")
        medium = data.get("medium", "")
        dated = data.get("dated", "")
        has_img = "yes" if data.get("primaryimageurl") else "no"
        lines.append(f"ID={c['objectid']}: {title} | {culture} | {medium} | {dated} | image:{has_img}")

    user_content = f"Query: {query}\n\nCandidates:\n" + "\n".join(lines)

    resp = client.chat.completions.create(
        model=GPT_MODEL,
        messages=[
            {"role": "system", "content": RERANK_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.1,
    )
    text = resp.choices[0].message.content.strip()
    cleaned = text.replace("```json\n", "").replace("```\n", "").replace("```", "").strip()
    result = json.loads(cleaned)
    return result.get("ranked_ids", [])


def embed_text(text):
    resp = client.embeddings.create(model=EMBED_MODEL, input=[text])
    return resp.data[0].embedding


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/api/search", methods=["POST"])
def search():
    body = request.get_json(force=True)
    query = body.get("query", "").strip()
    manual_filters = body.get("filters", {})
    page = max(1, body.get("page", 1))
    size = min(200, max(1, body.get("size", 12)))
    sort = body.get("sort", "rank")
    sortorder = body.get("sortorder", "asc")

    ai_parsed = None

    if query:
        try:
            ai_parsed = gpt_parse_query(query)
        except Exception:
            ai_parsed = {"hard_filters": {}, "semantic_query": query}

    hard_filters = {}
    if ai_parsed:
        hard_filters = ai_parsed.get("hard_filters", {})

    if manual_filters.get("cultures"):
        hard_filters["culture"] = manual_filters["cultures"]
    elif hard_filters.get("culture") and isinstance(hard_filters["culture"], str):
        hard_filters["culture"] = [hard_filters["culture"]]

    if manual_filters.get("mediums"):
        hard_filters["medium"] = manual_filters["mediums"]
    elif hard_filters.get("medium") and isinstance(hard_filters["medium"], str):
        hard_filters["medium"] = [hard_filters["medium"]]

    if manual_filters.get("datebegin") is not None and manual_filters["datebegin"] != -600:
        hard_filters["datebegin"] = manual_filters["datebegin"]
    if manual_filters.get("dateend") is not None and manual_filters["dateend"] != 1900:
        hard_filters["dateend"] = manual_filters["dateend"]
    if manual_filters.get("denomination"):
        hard_filters["denomination"] = manual_filters["denomination"]
    if manual_filters.get("hasimage"):
        hard_filters["hasimage"] = True
    if manual_filters.get("period"):
        hard_filters["period"] = manual_filters["period"]
    if manual_filters.get("technique"):
        hard_filters["technique"] = manual_filters["technique"]

    semantic_query = ai_parsed.get("semantic_query", query) if ai_parsed else ""
    score_boost = ai_parsed.get("score_boost", []) if ai_parsed else []
    VALID_SCORES = {"historical_significance", "rarity", "artistic_merit", "auction_value", "collector_interest"}
    score_boost = [s for s in score_boost if s in VALID_SCORES]

    SPARSE_THRESHOLD = 20
    notice = None
    culture_filter_applied = bool(hard_filters.get("culture"))

    if query and semantic_query:
        try:
            query_embedding = embed_text(semantic_query)
        except Exception as e:
            import traceback
            return jsonify({"error": f"embedding failed: {e}", "trace": traceback.format_exc()}), 500

        culture_list = hard_filters.get("culture")
        if isinstance(culture_list, str):
            culture_list = [culture_list]

        medium_list = hard_filters.get("medium")
        if isinstance(medium_list, str):
            medium_list = [medium_list]

        try:
            rpc_result = supabase_client.rpc("match_coins", {
                "query_embedding": query_embedding,
                "filter_culture": culture_list,
                "filter_medium": medium_list,
                "filter_datebegin": hard_filters.get("datebegin"),
                "filter_dateend": hard_filters.get("dateend"),
                "filter_denomination": hard_filters.get("denomination"),
                "filter_hasimage": hard_filters.get("hasimage", False),
                "filter_period": hard_filters.get("period"),
                "filter_technique": hard_filters.get("technique"),
                "filter_mint": hard_filters.get("mint"),
                "match_count": 80,
            }).execute()
        except Exception as e:
            import traceback
            return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500

        rows = rpc_result.data or []

        if culture_filter_applied and len(rows) < SPARSE_THRESHOLD:
            cultures = hard_filters["culture"]
            culture_label = ", ".join(cultures) if isinstance(cultures, list) else cultures
            if not rows:
                notice = (
                    f"The Harvard Art Museums numismatic collection contains no coins "
                    f"matching culture \"{culture_label}\". This collection is primarily "
                    f"ancient and medieval (Greek, Roman, Byzantine, Islamic, etc.) and "
                    f"does not hold modern national coinage."
                )
            else:
                notice = (
                    f"Only {len(rows)} coin{'s' if len(rows) != 1 else ''} in the "
                    f"collection match culture \"{culture_label}\". The Harvard numismatic "
                    f"holdings are primarily ancient and medieval, so modern national "
                    f"coinage is sparsely represented. Showing all matches."
                )

        if not rows:
            return jsonify({
                "results": [],
                "total": 0,
                "page": page,
                "pages": 0,
                "ai_parsed": ai_parsed,
                "notice": notice,
            })

        scored = []
        for row in rows:
            data = row["data"]
            sim = row["similarity"]

            title = (data.get("title") or "").strip().lower()
            if title in ("coin", "coins", ""):
                sim *= 0.5
            if any(t in title for t in ("electrotype", "replica", "reproduction", "cast of", "copy of")):
                sim *= 0.35

            if score_boost:
                boost_vals = [row.get(s) for s in score_boost if row.get(s) is not None]
                if boost_vals:
                    avg_score = sum(boost_vals) / len(boost_vals) / 100.0
                    sim = 0.6 * sim + 0.4 * avg_score

            scored.append({"objectid": row["objectid"], "data": data, "similarity": sim})

        scored.sort(key=lambda x: x["similarity"], reverse=True)

        STOPWORDS = {
            "of", "the", "a", "an", "from", "by", "at", "in", "on", "under",
            "with", "and", "or",
        }
        TITLE_NOISE = {
            "king", "queen", "emperor", "empress", "great", "signed", "time",
            "period", "hoard", "uncertain", "ca", "type", "coin", "coins",
            "attributed", "to",
            "ii", "iii", "iv", "ix", "vi", "vii", "viii", "xi", "xii",
        }

        def title_tokens(t):
            lower = re.sub(r"\([^)]*\)", "", t.lower())
            lower = re.sub(r"\s+by\s+\w+.*$", "", lower)
            return {
                w for w in re.findall(r"[a-z]+", lower)
                if w not in STOPWORDS and w not in TITLE_NOISE and len(w) > 1
            }

        def is_fuzzy_dup(new_toks, seen_sets):
            if len(new_toks) < 2:
                return False
            for prev in seen_sets:
                overlap = new_toks & prev
                if len(overlap) < 2:
                    continue
                smaller = min(len(new_toks), len(prev))
                if smaller == 0:
                    continue
                if len(overlap) / smaller >= 0.6:
                    return True
            return False

        seen_titles = set()
        seen_token_sets = []
        deduped = []
        for s in scored:
            d = s["data"]
            title = (d.get("title") or "").strip().lower()
            if not title or title in ("coin", "coins"):
                deduped.append(s)
                continue
            if title in seen_titles:
                continue
            if score_boost:
                toks = title_tokens(title)
                if is_fuzzy_dup(toks, seen_token_sets):
                    continue
                seen_token_sets.append(toks)
            seen_titles.add(title)
            deduped.append(s)

        top_candidates = deduped[:80]

        try:
            ranked_ids = gpt_rerank(query, top_candidates)
            candidate_map = {c["objectid"]: c for c in top_candidates}
            reranked = []
            for oid in ranked_ids:
                if oid in candidate_map:
                    reranked.append(candidate_map.pop(oid))
            for c in top_candidates:
                if c["objectid"] in candidate_map:
                    reranked.append(c)
        except Exception:
            reranked = top_candidates

        total = len(reranked)
        pages = math.ceil(total / size)
        start = (page - 1) * size
        page_results = reranked[start: start + size]

        results = []
        for r in page_results:
            data = r["data"]
            data["_similarity"] = round(r["similarity"], 4)
            results.append(data)

        return jsonify({
            "results": results,
            "total": total,
            "page": page,
            "pages": pages,
            "ai_parsed": ai_parsed,
            "notice": notice,
        })

    else:
        # No semantic query — filter + sort via Supabase
        q = supabase_client.table("coins").select("data", count="exact")

        culture_list = hard_filters.get("culture")
        if isinstance(culture_list, str):
            culture_list = [culture_list]
        if culture_list:
            q = q.in_("culture", culture_list)

        medium_list = hard_filters.get("medium")
        if isinstance(medium_list, str):
            medium_list = [medium_list]
        if medium_list:
            q = q.in_("medium", medium_list)

        if hard_filters.get("datebegin") is not None:
            q = q.gte("datebegin", hard_filters["datebegin"])
        if hard_filters.get("dateend") is not None:
            q = q.lte("dateend", hard_filters["dateend"])
        if hard_filters.get("denomination"):
            q = q.ilike("denomination", f"%{hard_filters['denomination']}%")
        if hard_filters.get("hasimage"):
            q = q.filter("primaryimageurl", "not.is", "null").neq("primaryimageurl", "")
        if hard_filters.get("period"):
            q = q.ilike("period", f"%{hard_filters['period']}%")
        if hard_filters.get("technique"):
            q = q.ilike("technique", f"%{hard_filters['technique']}%")
        if hard_filters.get("mint"):
            q = q.ilike("title_text", f"%{hard_filters['mint']}%")

        sort_col_map = {
            "datebegin": "datebegin",
            "accessionyear": "accessionyear",
            "rank": "rank",
        }
        sort_col = sort_col_map.get(sort, "rank")
        q = q.order(sort_col, desc=(sortorder == "desc"))

        offset = (page - 1) * size
        q = q.range(offset, offset + size - 1)

        result = q.execute()
        total = result.count or 0
        pages = math.ceil(total / size) if total else 0
        results = [row["data"] for row in (result.data or [])]

        return jsonify({
            "results": results,
            "total": total,
            "page": page,
            "pages": pages,
            "ai_parsed": None,
        })


@app.route("/api/coin/<int:objectid>", methods=["GET"])
def get_coin(objectid):
    result = supabase_client.table("coins").select("data").eq("objectid", objectid).maybe_single().execute()
    if not result.data:
        return jsonify({"error": "Coin not found"}), 404
    return jsonify(result.data["data"])


def build_coin_summary(coin):
    parts = []
    if coin.get("title"):
        parts.append(f"Title: {coin['title']}")
    if coin.get("culture"):
        parts.append(f"Culture: {coin['culture']}")
    if coin.get("period"):
        parts.append(f"Period: {coin['period']}")
    if coin.get("dated"):
        parts.append(f"Date: {coin['dated']}")
    if coin.get("datebegin") is not None or coin.get("dateend") is not None:
        parts.append(f"Date range: {coin.get('datebegin', '?')} to {coin.get('dateend', '?')}")
    if coin.get("medium"):
        parts.append(f"Medium: {coin['medium']}")
    if coin.get("denomination"):
        parts.append(f"Denomination: {coin['denomination']}")
    if coin.get("description"):
        parts.append(f"Description: {coin['description']}")

    details = coin.get("details")
    if isinstance(details, dict) and details.get("coins"):
        cd = details["coins"]
        if cd.get("obverseinscription"):
            parts.append(f"Obverse inscription: {cd['obverseinscription']}")
        if cd.get("reverseinscription"):
            parts.append(f"Reverse inscription: {cd['reverseinscription']}")

    user_content = "\n".join(parts) if parts else json.dumps(coin)

    resp = client.chat.completions.create(
        model=GPT_MODEL,
        messages=[
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.3,
    )
    return resp.choices[0].message.content.strip()


def build_search_summary(query, coins, groups=None):
    if not coins:
        return ""
    if groups:
        group_lines = "\n".join(
            f"- {g['denomination']}: {g['count']} coin{'s' if g['count'] != 1 else ''}"
            for g in groups
        )
        user_content = f"User query: {query}\n\nDenomination types in results (sorted by count):\n{group_lines}"
    else:
        lines = []
        for i, c in enumerate(coins, 1):
            bits = [
                c.get("title") or "Untitled",
                c.get("culture") or "",
                c.get("medium") or "",
                c.get("dated") or "",
                c.get("denomination") or "",
            ]
            bits = [b for b in bits if b]
            lines.append(f"{i}. {' | '.join(bits)}")
        user_content = f"User query: {query}\n\nTop matching coins:\n" + "\n".join(lines)
    resp = client.chat.completions.create(
        model=GPT_MODEL,
        messages=[
            {"role": "system", "content": SEARCH_SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.4,
    )
    text = resp.choices[0].message.content.strip()
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    return text


@app.route("/api/search/summary", methods=["POST"])
def search_summary():
    body = request.get_json(force=True)
    query = (body.get("query") or "").strip()
    coin_ids = body.get("coin_ids") or []
    groups = body.get("groups") or []
    if not query or not coin_ids:
        return jsonify({"summary": ""})

    coin_ids = coin_ids[:5]
    result = supabase_client.table("coins").select("objectid, data").in_("objectid", coin_ids).execute()
    by_id = {r["objectid"]: r["data"] for r in (result.data or [])}
    coins = [by_id[i] for i in coin_ids if i in by_id]

    if not coins:
        return jsonify({"summary": ""})

    try:
        summary = build_search_summary(query, coins, groups or None)
    except Exception as e:
        return jsonify({"summary": "", "error": str(e)}), 200

    return jsonify({"summary": summary})


@app.route("/api/readings/relevant", methods=["POST"])
def relevant_readings():
    body = request.get_json(force=True)
    cultures = body.get("cultures") or []
    query = (body.get("query") or "").strip()
    coins = body.get("coins") or []

    if not cultures and coins:
        seen_c = set()
        for c in coins:
            cult = (c.get("culture") or "").strip()
            if cult and cult not in seen_c:
                cultures.append(cult)
                seen_c.add(cult)

    candidates = candidate_readings_for(cultures, query)
    if not candidates:
        candidates = READINGS[:6]

    coin_lines = []
    for c in coins[:8]:
        parts = [
            c.get("title") or "Untitled",
            c.get("culture") or "",
            c.get("medium") or "",
            c.get("denomination") or "",
            c.get("dated") or "",
        ]
        coin_lines.append(" | ".join(p for p in parts if p))
    if query:
        coin_lines.insert(0, f"Search query: {query}")
    coin_desc = "\n".join(coin_lines) if coin_lines else query or "Unknown coins"

    readings = gpt_rank_readings(coin_desc, candidates)
    return jsonify({"readings": readings})


READINGS_DIR = os.path.join(os.path.dirname(__file__), "readings")


@app.route("/api/readings/pdf/<path:filename>", methods=["GET"])
def serve_reading_pdf(filename):
    from flask import redirect
    local_path = os.path.join(READINGS_DIR, filename)
    if os.path.exists(local_path):
        return send_from_directory(READINGS_DIR, filename, as_attachment=False)
    # Serverless fallback: redirect to GitHub raw content
    from urllib.parse import quote
    safe_name = quote(filename, safe="/")
    github_url = f"https://raw.githubusercontent.com/Abler24/Coins/main/backend/readings/{safe_name}"
    return redirect(github_url)


# ---------------------------------------------------------------------------
# Coin Chat — RAG over course PDFs
# ---------------------------------------------------------------------------

CHAT_SYSTEM_PROMPT = """You are CoinChat, the research assistant for Harvard's HAA 73: Money Matters course. You answer questions about ancient and medieval coinage, monetary systems, numismatic methodology, and the cultural meaning of money — strictly from the course readings provided to you as context.

NON-NEGOTIABLE RULES (this is a tool used by faculty and graduate students; hallucination is the failure mode you must avoid):
- Treat the provided source list as the ONLY authoritative source. If a claim cannot be supported by one of the numbered excerpts, do not make it.
- Every substantive claim must carry an inline citation in the form [N] or [N, M] referring to the numbered source list. Do not invent source numbers — only cite numbers that appear in the provided context.
- If the retrieved excerpts do not contain enough information to answer, say so plainly: "The retrieved readings don't directly address this." Then offer to refine the search, or briefly mark any general knowledge you add as "(outside the assigned readings)" so the user knows it isn't grounded.
- Do not fabricate quotations. When you put text in quotation marks, it must appear in the cited excerpt. When in doubt, paraphrase and cite.
- Prefer the specific over the generic: name authors, dates, denominations, mints, weights, iconography, line numbers when the readings give them.

Style:
- Scholarly prose with the depth of a graduate seminar — clear, precise, intellectually generous.
- Default to flowing paragraphs (2–5), not bullet lists or headings, unless the user asks for structure.
- One short opening sentence that states the answer, then the sourced argument."""


def _retrieve_chunks(query: str, k: int = 8, week: int | None = None) -> list[dict]:
    qvec = embed_text(query)

    rpc_result = supabase_client.rpc("match_chunks", {
        "query_embedding": qvec,
        "filter_week": week,
        "match_count": k * 3,
    }).execute()

    rows = rpc_result.data or []

    out = []
    seen_files: dict[str, int] = {}
    for r in rows:
        f = r["file"]
        if seen_files.get(f, 0) >= 2:
            continue
        seen_files[f] = seen_files.get(f, 0) + 1
        out.append({
            "id": r["id"],
            "reading_id": r["reading_id"],
            "file": r["file"],
            "citation": r["citation"],
            "authors": r["authors"],
            "title": r["title"],
            "week": r["week"],
            "page_start": r["page_start"],
            "page_end": r["page_end"],
            "text": r["text"],
            "score": r["similarity"],
        })
        if len(out) >= k:
            break
    return out


def _format_context(chunks: list[dict]) -> str:
    lines = []
    for i, c in enumerate(chunks, start=1):
        page = (
            f"p. {c['page_start']}"
            if c["page_start"] == c["page_end"]
            else f"pp. {c['page_start']}–{c['page_end']}"
        )
        header = f"[{i}] {c['authors'] or c['title']} — {c['title']} ({page})"
        lines.append(f"{header}\n{c['text']}")
    return "\n\n---\n\n".join(lines)


@app.route("/api/chat", methods=["POST"])
def chat():
    if anthropic_client is None:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured"}), 500

    body = request.get_json(force=True)
    messages = body.get("messages") or []
    if not messages or messages[-1].get("role") != "user":
        return jsonify({"error": "messages must end with a user turn"}), 400

    last_user = messages[-1]["content"]
    if len(messages) > 1:
        recent = " ".join(
            m["content"] for m in messages[-4:-1] if m.get("role") in ("user", "assistant")
        )
        retrieval_query = f"{recent}\n\n{last_user}".strip()[:2000]
    else:
        retrieval_query = last_user

    chunks = _retrieve_chunks(retrieval_query, k=8)

    citations = [
        {
            "n": i + 1,
            "reading_id": c["reading_id"],
            "file": c["file"],
            "citation": c["citation"],
            "authors": c["authors"],
            "title": c["title"],
            "week": c["week"],
            "page_start": c["page_start"],
            "page_end": c["page_end"],
        }
        for i, c in enumerate(chunks)
    ]

    context_block = _format_context(chunks) if chunks else "(No course readings retrieved for this query.)"

    full_system = (
        CHAT_SYSTEM_PROMPT
        + "\n\n=== COURSE READING EXCERPTS (cite by [N]) ===\n\n"
        + context_block
    )

    convo = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]

    def generate():
        yield f"event: citations\ndata: {json.dumps(citations)}\n\n"
        try:
            with anthropic_client.messages.stream(
                model=CHAT_MODEL,
                max_tokens=1500,
                system=full_system,
                messages=convo,
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        yield f"event: token\ndata: {json.dumps(text)}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps(str(e))}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


CHAT_TO_QUERY_PROMPT = """You convert a course-discussion conversation into a single coin-collection search query for the Harvard Art Museums numismatic collection.

Input: a back-and-forth conversation about money, coinage, and economic history. Your job is to extract what coins from the collection a curious student would want to look at after this discussion.

Output ONLY a JSON object: {"query": "..."} — a 4–14 word natural-language coin search query naming concrete numismatic things (cultures, periods, denominations, rulers, imagery, mints). Skip generic words like "famous" or "best".

Examples:
- Conversation about Aristotle on money / chrematistike → {"query": "Greek silver tetradrachms and Athenian owl coins of the classical period"}
- Conversation about Byzantine solidus → {"query": "Byzantine gold solidus from Constantine through Justinian II"}
- Conversation about Roman propaganda → {"query": "Roman imperial denarii and aurei with emperor portraits and military reverses"}
- Conversation about Islamic aniconic coinage → {"query": "Umayyad and Abbasid dinars and dirhams with Arabic kufic inscriptions"}"""


def chat_to_search_query(messages: list[dict]) -> str:
    convo_text = "\n".join(
        f"{m.get('role', 'user').upper()}: {m.get('content', '')}"
        for m in messages
        if m.get("content")
    )[:4000]
    try:
        resp = client.chat.completions.create(
            model=GPT_MODEL,
            messages=[
                {"role": "system", "content": CHAT_TO_QUERY_PROMPT},
                {"role": "user", "content": convo_text},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        result = json.loads(resp.choices[0].message.content)
        return (result.get("query") or "").strip()
    except Exception:
        for m in reversed(messages):
            if m.get("role") == "user" and m.get("content"):
                return m["content"][:200]
        return ""


@app.route("/api/chat/query", methods=["POST"])
def chat_query():
    body = request.get_json(force=True)
    messages = body.get("messages") or []
    if not messages:
        return jsonify({"query": ""})
    return jsonify({"query": chat_to_search_query(messages)})


@app.route("/api/chat/sources", methods=["GET"])
def chat_sources():
    result = supabase_client.rpc("chat_sources_list").execute()
    return jsonify({"sources": result.data or []})


@app.route("/api/coin/<int:objectid>/summary", methods=["GET"])
def get_coin_summary(objectid):
    result = supabase_client.table("coins").select("data").eq("objectid", objectid).maybe_single().execute()
    if not result.data:
        return jsonify({"error": "Coin not found"}), 404
    coin = result.data["data"]
    return jsonify({"summary": build_coin_summary(coin)})


# ---------------------------------------------------------------------------
# Atlas — whole-collection feed for the world map
# ---------------------------------------------------------------------------

@app.route("/api/atlas", methods=["GET"])
def atlas():
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        result = supabase_client.table("coins").select("data").range(offset, offset + page_size - 1).execute()
        batch = result.data or []
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    out = []
    for r in all_rows:
        d = r["data"]
        if d.get("objectid") is None:
            continue
        obverse = None
        for img in (d.get("images") or []):
            if img.get("displayorder") == 2 and img.get("baseimageurl"):
                obverse = img["baseimageurl"]
                break
        out.append({
            "objectid": d.get("objectid"),
            "title": d.get("title"),
            "culture": d.get("culture"),
            "dated": d.get("dated"),
            "datebegin": d.get("datebegin"),
            "dateend": d.get("dateend"),
            "medium": d.get("medium"),
            "rank": d.get("rank"),
            "primaryimageurl": d.get("primaryimageurl"),
            "obverseurl": obverse,
            "details": {"coins": {"denomination": (d.get("details") or {}).get("coins", {}).get("denomination")}},
        })
    return jsonify({"coins": out, "total": len(out)})


# ---------------------------------------------------------------------------
# Random coins (swipe mode)
# ---------------------------------------------------------------------------

@app.route("/api/random-coins", methods=["GET"])
def random_coins():
    count = min(200, max(1, int(request.args.get("count", 20))))
    with_image = request.args.get("with_image", "1") in ("1", "true", "yes")

    result = supabase_client.rpc("random_coins", {
        "match_count": count,
        "require_image": with_image,
    }).execute()

    results = [r["data"] for r in (result.data or [])]
    return jsonify({"results": results, "total": len(results)})


# ---------------------------------------------------------------------------
# PDF export (coin groups)
# ---------------------------------------------------------------------------

def _fetch_image_bytes(url):
    if not url:
        return None
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        pil = PILImage.open(io.BytesIO(r.content))
        if pil.mode not in ("RGB", "L"):
            pil = pil.convert("RGB")
        max_px = 800
        if pil.width > max_px:
            ratio = max_px / pil.width
            pil = pil.resize((max_px, int(pil.height * ratio)), PILImage.LANCZOS)
        out = io.BytesIO()
        pil.save(out, format="JPEG", quality=82, optimize=True)
        return out.getvalue()
    except Exception:
        return None


def _build_image_flowable(img_bytes, max_width=None):
    if max_width is None:
        max_width = 3.0 * inch  # only reached when reportlab is loaded
    if not img_bytes:
        return None
    try:
        buf = io.BytesIO(img_bytes)
        img = RLImage(buf)
        iw, ih = img.imageWidth, img.imageHeight
        if iw > max_width:
            scale = max_width / iw
            img.drawWidth = iw * scale
            img.drawHeight = ih * scale
        else:
            img.drawWidth = iw
            img.drawHeight = ih
        return img
    except Exception:
        return None


def _safe_build_summary(coin):
    try:
        return build_coin_summary(coin)
    except Exception:
        return ""


def _coin_origin_line(coin):
    culture = (coin.get("culture") or "").strip()
    place_parts = []
    places = coin.get("places") or []
    if isinstance(places, list) and places:
        p = places[0]
        if isinstance(p, dict):
            for k in ("displayname", "city", "country"):
                v = p.get(k)
                if v:
                    place_parts.append(str(v))
                    break
    place = place_parts[0] if place_parts else ""
    if culture and place:
        return f"{culture} — {place}"
    return culture or place or ""


def _coin_date_line(coin):
    if coin.get("dated"):
        return str(coin["dated"])
    db_, de_ = coin.get("datebegin"), coin.get("dateend")
    if db_ is not None and de_ is not None:
        return f"{db_} to {de_}"
    return ""


def _escape_html(text):
    if text is None:
        return ""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _safe_filename(name):
    cleaned = re.sub(r"[^\w\-. ]+", "", name or "coin-group").strip()
    return cleaned or "coin-group"


@app.route("/api/groups/pdf", methods=["POST"])
def group_pdf():
    if not _PDF_LIBS_AVAILABLE:
        return jsonify({"error": "PDF export is not available in this deployment."}), 503
    body = request.get_json(force=True)
    group_name = (body.get("group_name") or "Untitled Group").strip()
    coin_ids = body.get("coin_ids") or []
    include_summary = bool(body.get("include_summary", True))

    if not coin_ids:
        return jsonify({"error": "No coins provided"}), 400

    result = supabase_client.table("coins").select("objectid, data").in_("objectid", coin_ids).execute()
    by_id = {r["objectid"]: r["data"] for r in (result.data or [])}
    coins = [by_id[i] for i in coin_ids if i in by_id]

    if not coins:
        return jsonify({"error": "No matching coins found"}), 404

    urls = [c.get("primaryimageurl") for c in coins]

    def _fetch_readings():
        cultures = list({c.get("culture", "") for c in coins if c.get("culture")})
        candidates = candidate_readings_for(cultures)
        coin_descs = [
            " | ".join(filter(None, [
                c.get("title"), c.get("culture"), c.get("medium"),
                c.get("denomination"), c.get("dated"),
            ]))
            for c in coins[:8]
        ]
        return gpt_rank_readings("\n".join(coin_descs), candidates)

    with ThreadPoolExecutor(max_workers=16) as ex:
        image_bytes_list = list(ex.map(_fetch_image_bytes, urls))
        if include_summary:
            summaries = list(ex.map(_safe_build_summary, coins))
        else:
            summaries = [""] * len(coins)
        readings_future = ex.submit(_fetch_readings)

    try:
        collection_readings = readings_future.result()
    except Exception:
        collection_readings = []

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.9 * inch,
        rightMargin=0.9 * inch,
        topMargin=0.9 * inch,
        bottomMargin=0.9 * inch,
        title=group_name,
        author="CoinLens",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "GroupTitle", parent=styles["Title"], fontSize=22, alignment=TA_LEFT,
        spaceAfter=6, textColor=colors.HexColor("#1f1f1f"),
    )
    subtitle_style = ParagraphStyle(
        "GroupSubtitle", parent=styles["Normal"], fontSize=11,
        textColor=colors.HexColor("#666666"), spaceAfter=14,
    )
    readings_heading_style = ParagraphStyle(
        "ReadingsHeading", parent=styles["Normal"], fontSize=10,
        fontName="Helvetica-Bold", textColor=colors.HexColor("#7a1025"),
        spaceBefore=4, spaceAfter=6, letterSpacing=0.5,
    )
    reading_citation_style = ParagraphStyle(
        "ReadingCitation", parent=styles["Normal"], fontSize=9.5,
        textColor=colors.HexColor("#111111"), leading=13, spaceAfter=2,
    )
    reading_relevance_style = ParagraphStyle(
        "ReadingRelevance", parent=styles["Normal"], fontSize=9,
        textColor=colors.HexColor("#444444"), leading=13, spaceAfter=4,
        leftIndent=12,
    )
    reading_quote_style = ParagraphStyle(
        "ReadingQuote", parent=styles["Normal"], fontSize=8.5,
        textColor=colors.HexColor("#555555"), leading=12, spaceAfter=8,
        leftIndent=20, rightIndent=12,
        fontName="Helvetica-Oblique",
        borderPadding=(4, 0, 4, 8),
    )
    coin_title_style = ParagraphStyle(
        "CoinTitle", parent=styles["Heading2"], fontSize=13,
        spaceBefore=8, spaceAfter=4, textColor=colors.HexColor("#1f1f1f"),
    )
    meta_style = ParagraphStyle(
        "CoinMeta", parent=styles["Normal"], fontSize=10,
        textColor=colors.HexColor("#333333"), leading=13, spaceAfter=2,
    )
    url_style = ParagraphStyle(
        "CoinUrl", parent=styles["Normal"], fontSize=9,
        textColor=colors.HexColor("#0b6bb0"), leading=12, spaceAfter=6,
    )
    summary_style = ParagraphStyle(
        "CoinSummary", parent=styles["Normal"], fontSize=10.5,
        textColor=colors.HexColor("#222222"), leading=14, spaceAfter=10,
    )

    story = []

    story.append(Paragraph(f"Object list for {_escape_html(group_name)}", title_style))
    story.append(Paragraph(
        f"CoinLens — Harvard Art Museums numismatic collection · "
        f"{len(coins)} coin{'s' if len(coins) != 1 else ''} · "
        f"generated {datetime.now().strftime('%B %d, %Y')}",
        subtitle_style,
    ))
    story.append(HRFlowable(width="100%", thickness=0.75,
                            color=colors.HexColor("#cccccc"), spaceAfter=14))

    if collection_readings:
        story.append(Paragraph("SUGGESTED COURSE READINGS — HAA 73", readings_heading_style))
        for r in collection_readings:
            citation = _escape_html(r.get("citation", ""))
            reading_file = r.get("file")
            reading_url = r.get("url")
            if reading_file:
                link_url = f"/api/readings/pdf/{reading_file}"
            elif reading_url:
                link_url = reading_url
            else:
                link_url = None
            if link_url:
                citation_para = Paragraph(
                    f'<a href="{_escape_html(link_url)}">{citation}</a>',
                    reading_citation_style,
                )
            else:
                citation_para = Paragraph(citation, reading_citation_style)
            story.append(citation_para)
            if r.get("relevance"):
                story.append(Paragraph(
                    f"↳ {_escape_html(r['relevance'])}", reading_relevance_style,
                ))
            if r.get("key_passage"):
                src = r.get("passage_source", "")
                src_text = f" ({_escape_html(src)})" if src else ""
                story.append(Paragraph(
                    f'"{_escape_html(r["key_passage"])}"{src_text}',
                    reading_quote_style,
                ))
        story.append(HRFlowable(width="100%", thickness=0.4,
                                color=colors.HexColor("#e2e2e2"),
                                spaceBefore=4, spaceAfter=16))

    for idx, coin in enumerate(coins):
        block = []

        img = _build_image_flowable(image_bytes_list[idx])
        if img is not None:
            block.append(img)
            block.append(Spacer(1, 6))
        else:
            block.append(Paragraph(
                "<i>[image unavailable]</i>",
                ParagraphStyle("NoImg", parent=meta_style,
                               textColor=colors.HexColor("#999999")),
            ))
            block.append(Spacer(1, 4))

        title = coin.get("title") or "Untitled"
        block.append(Paragraph(f"<b>{_escape_html(title)}</b>", coin_title_style))

        if coin.get("objectnumber"):
            block.append(Paragraph(_escape_html(coin["objectnumber"]), meta_style))
        origin = _coin_origin_line(coin)
        if origin:
            block.append(Paragraph(_escape_html(origin), meta_style))
        if coin.get("medium"):
            medium_line = coin["medium"]
            if coin.get("denomination"):
                medium_line += f" — {coin['denomination']}"
            block.append(Paragraph(_escape_html(medium_line), meta_style))
        date_line = _coin_date_line(coin)
        if date_line:
            block.append(Paragraph(_escape_html(date_line), meta_style))

        url = coin.get("url") or (
            f"https://harvardartmuseums.org/collections/object/{coin.get('objectid')}"
            if coin.get("objectid") else None
        )
        if url:
            block.append(Paragraph(
                f'<a href="{_escape_html(url)}">{_escape_html(url)}</a>', url_style,
            ))

        if include_summary and summaries[idx]:
            block.append(Paragraph(_escape_html(summaries[idx]), summary_style))

        story.append(KeepTogether(block))

        if idx < len(coins) - 1:
            story.append(HRFlowable(width="100%", thickness=0.4,
                                    color=colors.HexColor("#e2e2e2"),
                                    spaceBefore=6, spaceAfter=12))

    doc.build(story)
    buf.seek(0)

    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"{_safe_filename(group_name)}.pdf",
    )


if __name__ == "__main__":
    app.run(debug=True, port=5001)
