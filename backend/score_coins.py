"""
One-time scoring script.
Sends batches of coins to GPT-4o-mini to generate expert scores
(historical_significance, rarity, artistic_merit, auction_value, collector_interest)
on a 0-100 scale. Stores results in the coins.db database.

Usage:
    python score_coins.py
"""

import json
import os
import sqlite3
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
DB_PATH = os.path.join(os.path.dirname(__file__), "coins.db")
GPT_MODEL = "gpt-4o-mini"
BATCH_SIZE = 50

client = OpenAI(api_key=OPENAI_API_KEY)

SCORE_SYSTEM_PROMPT = """You are a world-class numismatics expert and auction specialist. You will be given a batch of ancient/medieval coins from the Harvard Art Museums collection.

For EACH coin, provide five scores from 0 to 100:

1. **historical_significance**: How important is this coin historically? Consider: famous rulers, major events (assassinations, conquests, religious shifts), pivotal periods, political significance. A generic unattributed bronze = 5-15. An EID MAR denarius of Brutus = 95+.

2. **rarity**: How scarce is this coin type? Consider: survival rate, mintage, how often this type appears at auction. Common Roman bronze = 5-15. Unique or nearly unique types = 90+.

3. **artistic_merit**: Quality of design and engraving. Consider: portraiture skill, composition, innovation, famous die engravers (Kimon, Euainetos). Mass-produced crude coins = 5-15. Syracuse decadrachms = 90+.

4. **auction_value**: Relative market value if sold at auction today. Consider: metal (gold > silver > bronze typically), rarity, demand, condition implications. Common small bronze = 5-15. Major gold rarities = 90+.

5. **collector_interest**: Overall desirability to collectors. Consider: visual appeal, completeness of attribution, having an image, famous series (owls, Alexander portraits, Roman imperial portraits). Generic unidentified coins = 1-5. Iconic series with clear images = 80+.

## Scoring guidelines
- Use the FULL 0-100 range. Most coins should be 10-50. Only truly exceptional coins should be 80+.
- Be discriminating — in a collection of 19,000 coins, only ~50-100 should score above 85 on any trait.
- If a coin's title is just "Coin" or "coin" with no other info, score all traits 1-5.
- Base scores on the information provided. Don't assume quality you can't see.

Return ONLY valid JSON — an array of objects in the SAME ORDER as the input:
[{"id": <objectid>, "historical_significance": N, "rarity": N, "artistic_merit": N, "auction_value": N, "collector_interest": N}, ...]"""


def ensure_columns(db):
    """Add score columns if they don't exist."""
    cols = {row[1] for row in db.execute("PRAGMA table_info(coins)").fetchall()}
    for col in ["historical_significance", "rarity", "artistic_merit", "auction_value", "collector_interest"]:
        if col not in cols:
            db.execute(f"ALTER TABLE coins ADD COLUMN {col} INTEGER DEFAULT NULL")
    db.commit()


def build_coin_summary(data):
    """Build a concise text summary of a coin for scoring."""
    parts = []
    if data.get("title"):
        parts.append(f"Title: {data['title']}")
    if data.get("culture"):
        parts.append(f"Culture: {data['culture']}")
    if data.get("period"):
        parts.append(f"Period: {data['period']}")
    if data.get("dated"):
        parts.append(f"Date: {data['dated']}")
    if data.get("medium"):
        parts.append(f"Medium: {data['medium']}")
    if data.get("denomination"):
        parts.append(f"Denomination: {data['denomination']}")
    if data.get("description"):
        desc = data["description"][:200]
        parts.append(f"Description: {desc}")
    if data.get("primaryimageurl"):
        parts.append("Has image: yes")
    else:
        parts.append("Has image: no")
    return " | ".join(parts)


def score_batch(coins):
    """Send a batch of coins to GPT and return scores."""
    lines = []
    for c in coins:
        lines.append(f"[ID={c['objectid']}] {c['summary']}")

    user_content = "\n".join(lines)

    for attempt in range(5):
        try:
            resp = client.chat.completions.create(
                model=GPT_MODEL,
                messages=[
                    {"role": "system", "content": SCORE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.2,
            )
            text = resp.choices[0].message.content.strip()
            cleaned = text.replace("```json\n", "").replace("```\n", "").replace("```", "").strip()
            result = json.loads(cleaned)
            return result
        except (json.JSONDecodeError, Exception) as e:
            if attempt < 4:
                wait = 2 ** attempt
                print(f"  Error: {e}. Retrying in {wait}s... (attempt {attempt + 1}/5)")
                time.sleep(wait)
            else:
                print(f"  Failed after 5 attempts: {e}")
                return None


def main():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    ensure_columns(db)

    # Fetch coins that haven't been scored yet
    rows = db.execute(
        "SELECT objectid, data FROM coins WHERE historical_significance IS NULL"
    ).fetchall()

    total = len(rows)
    print(f"Coins to score: {total}")

    if total == 0:
        print("All coins already scored!")
        return

    # Build summaries
    coins = []
    for row in rows:
        data = json.loads(row["data"])
        coins.append({
            "objectid": row["objectid"],
            "summary": build_coin_summary(data),
        })

    scored_count = 0
    batch_num = 0
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

    for i in range(0, len(coins), BATCH_SIZE):
        batch = coins[i : i + BATCH_SIZE]
        batch_num += 1
        print(f"Scoring batch {batch_num}/{total_batches} ({len(batch)} coins)...")

        result = score_batch(batch)
        if result is None:
            print(f"  Skipping batch {batch_num} due to errors")
            continue

        # Update database
        for score in result:
            oid = score.get("id")
            if oid is None:
                continue
            db.execute(
                """UPDATE coins SET
                    historical_significance = ?,
                    rarity = ?,
                    artistic_merit = ?,
                    auction_value = ?,
                    collector_interest = ?
                WHERE objectid = ?""",
                (
                    score.get("historical_significance", 0),
                    score.get("rarity", 0),
                    score.get("artistic_merit", 0),
                    score.get("auction_value", 0),
                    score.get("collector_interest", 0),
                    oid,
                ),
            )
            scored_count += 1

        db.commit()
        print(f"  Scored {scored_count}/{total} so far")

    print(f"\nDone! Scored {scored_count} coins total.")
    db.close()


if __name__ == "__main__":
    main()
