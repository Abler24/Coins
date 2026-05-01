"""
One-time indexing script.
Fetches all coins from the Harvard Art Museums API, builds a text blob per coin,
embeds them with OpenAI text-embedding-3-large, and stores everything in SQLite.

Usage:
    python index_coins.py
"""

import json
import os
import sqlite3
import struct
import time

import requests
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

HAM_API_KEY = os.environ["HAM_API_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
DB_PATH = os.path.join(os.path.dirname(__file__), "coins.db")

HAM_BASE = "https://api.harvardartmuseums.org/object"
EMBED_MODEL = "text-embedding-3-large"
EMBED_DIMS = 3072
EMBED_BATCH_SIZE = 100  # OpenAI supports up to 2048, but keep batches manageable
HAM_PAGE_SIZE = 100

client = OpenAI(api_key=OPENAI_API_KEY)


def init_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS coins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            objectid INTEGER UNIQUE,
            data TEXT,
            text_blob TEXT,
            embedding BLOB
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_objectid ON coins(objectid)")
    conn.commit()


def build_text_blob(coin):
    """Build a searchable text blob from coin metadata."""
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
        begin = coin.get("datebegin", "?")
        end = coin.get("dateend", "?")
        parts.append(f"Date range: {begin} to {end}")
    if coin.get("medium"):
        parts.append(f"Medium: {coin['medium']}")
    if coin.get("technique"):
        parts.append(f"Technique: {coin['technique']}")
    if coin.get("denomination"):
        parts.append(f"Denomination: {coin['denomination']}")
    if coin.get("description"):
        parts.append(f"Description: {coin['description']}")
    if coin.get("dimensions"):
        parts.append(f"Dimensions: {coin['dimensions']}")
    if coin.get("provenance"):
        parts.append(f"Provenance: {coin['provenance']}")
    if coin.get("creditline"):
        parts.append(f"Credit line: {coin['creditline']}")
    if coin.get("creationplace"):
        parts.append(f"Creation place: {coin['creationplace']}")

    # Inscriptions from details
    details = coin.get("details")
    if isinstance(details, dict) and details.get("coins"):
        cd = details["coins"]
        if cd.get("obverseinscription"):
            parts.append(f"Obverse inscription: {cd['obverseinscription']}")
        if cd.get("reverseinscription"):
            parts.append(f"Reverse inscription: {cd['reverseinscription']}")
        if cd.get("denomination"):
            parts.append(f"Denomination detail: {cd['denomination']}")

    # People / issuers
    people = coin.get("people", [])
    if people:
        names = [p.get("displayname", "") for p in people if p.get("displayname")]
        if names:
            parts.append(f"People: {', '.join(names)}")

    return "\n".join(parts) if parts else coin.get("title", "Unknown coin")


def embed_batch(texts):
    """Embed a batch of texts, returns list of float lists."""
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [item.embedding for item in resp.data]


def pack_embedding(embedding):
    """Pack a list of floats into bytes."""
    return struct.pack(f"{len(embedding)}f", *embedding)


def fetch_all_coins():
    """Fetch all coins from the HAM API, yielding pages of records."""
    page = 1
    total_pages = None

    while True:
        params = {
            "apikey": HAM_API_KEY,
            "classification": "Coins",
            "size": HAM_PAGE_SIZE,
            "page": page,
        }
        for attempt in range(5):
            try:
                resp = requests.get(HAM_BASE, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                break
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                if attempt < 4:
                    wait = 2 ** attempt
                    print(f"  Timeout on page {page}, retrying in {wait}s... (attempt {attempt + 1}/5)")
                    time.sleep(wait)
                else:
                    raise

        if total_pages is None:
            total_pages = data.get("info", {}).get("pages", 0)
            total_records = data.get("info", {}).get("totalrecords", 0)
            print(f"Total coins: {total_records}, pages: {total_pages}")

        records = data.get("records", [])
        if not records:
            break

        yield records

        print(f"  Fetched page {page}/{total_pages} ({len(records)} records)")
        page += 1
        if page > total_pages:
            break

        time.sleep(0.5)  # Be nice to the API


def main():
    print("Initializing database...")
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    # Check how many coins we already have
    existing = conn.execute("SELECT COUNT(*) FROM coins").fetchone()[0]
    if existing > 0:
        print(f"Database already has {existing} coins.")
        resp = input("Drop and re-index? (y/N): ").strip().lower()
        if resp != "y":
            print("Aborted.")
            conn.close()
            return
        conn.execute("DELETE FROM coins")
        conn.commit()
        print("Cleared existing data.")

    # Fetch and store all coins
    all_coins = []
    all_blobs = []

    print("Fetching coins from Harvard Art Museums API...")
    for page_records in fetch_all_coins():
        for coin in page_records:
            blob = build_text_blob(coin)
            all_coins.append(coin)
            all_blobs.append(blob)

    print(f"\nTotal coins fetched: {len(all_coins)}")
    print("Generating embeddings (this may take a few minutes)...")

    # Embed in batches
    all_embeddings = []
    for i in range(0, len(all_blobs), EMBED_BATCH_SIZE):
        batch = all_blobs[i : i + EMBED_BATCH_SIZE]
        embeddings = embed_batch(batch)
        all_embeddings.extend(embeddings)
        print(f"  Embedded {min(i + EMBED_BATCH_SIZE, len(all_blobs))}/{len(all_blobs)}")
        time.sleep(0.2)  # Rate limit courtesy

    # Insert into database
    print("Storing in database...")
    for i, (coin, blob, emb) in enumerate(zip(all_coins, all_blobs, all_embeddings)):
        objectid = coin.get("objectid") or coin.get("id")
        conn.execute(
            "INSERT OR REPLACE INTO coins (objectid, data, text_blob, embedding) VALUES (?, ?, ?, ?)",
            (objectid, json.dumps(coin), blob, pack_embedding(emb)),
        )
        if (i + 1) % 500 == 0:
            conn.commit()
            print(f"  Stored {i + 1}/{len(all_coins)}")

    conn.commit()
    final_count = conn.execute("SELECT COUNT(*) FROM coins").fetchone()[0]
    print(f"\nDone! {final_count} coins indexed in {DB_PATH}")
    conn.close()


if __name__ == "__main__":
    main()
