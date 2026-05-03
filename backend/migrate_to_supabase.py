"""
One-time migration script.
Uploads coins and chunks to Supabase.

  Coins pass 1  — metadata rows (no embeddings), batch upsert
  Coins pass 2  — embeddings, concurrent individual update() calls
  Chunks        — full rows including embeddings, small batches

Run AFTER executing schema.sql in the Supabase SQL Editor.

Usage:
    python migrate_to_supabase.py
"""

import json
import os
import sqlite3
import struct
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests as http_requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DB_PATH = os.path.join(os.path.dirname(__file__), "coins.db")
CHAT_INDEX_PATH = os.path.join(os.path.dirname(__file__), "chat_index.db")

META_BATCH = 100    # metadata rows per request (no embeddings)
EMB_WORKERS = 3     # concurrent embedding update threads
CHUNK_BATCH = 5     # chunk rows per request (includes embedding)

REST_HEADERS = None  # set after env is loaded

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

REST_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def unpack_embedding(blob):
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


def clean_text(s):
    """Strip null bytes and other characters PostgreSQL rejects."""
    if s is None:
        return None
    return s.replace("\x00", "")


def with_retry(fn, retries=4, delay=2.0):
    for attempt in range(retries):
        try:
            return fn()
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = delay * (2 ** attempt)
            print(f"    retrying in {wait:.0f}s ({e.__class__.__name__}: {e})")
            time.sleep(wait)


def fetch_all_col(table, col, extra_filter=None):
    """Paginate and return a set of all values for one column."""
    vals = set()
    page_size = 1000
    offset = 0
    while True:
        q = supabase.table(table).select(col)
        if extra_filter:
            q = extra_filter(q)
        rows = (q.range(offset, offset + page_size - 1).execute().data or [])
        for r in rows:
            vals.add(r[col])
        if len(rows) < page_size:
            break
        offset += page_size
    return vals


# ---------------------------------------------------------------------------
# Coins
# ---------------------------------------------------------------------------

def migrate_coins():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    total = conn.execute("SELECT COUNT(*) FROM coins").fetchone()[0]

    # --- Pass 1: metadata (no embedding) ---
    print(f"\n=== COINS PASS 1: metadata ({total} rows) ===")
    done_ids = fetch_all_col("coins", "objectid")
    print(f"  Already in Supabase: {len(done_ids)}")

    rows = conn.execute(
        "SELECT objectid, data, text_blob, historical_significance, rarity, "
        "artistic_merit, auction_value, collector_interest FROM coins"
    ).fetchall()

    batch, inserted = [], 0
    for row in rows:
        if row["objectid"] in done_ids:
            continue
        data = json.loads(row["data"])
        denomination = data.get("denomination") or (
            (data.get("details") or {}).get("coins", {}) or {}
        ).get("denomination")
        batch.append({
            "objectid": row["objectid"],
            "data": data,
            "text_blob": row["text_blob"],
            "culture": data.get("culture"),
            "medium": data.get("medium"),
            "datebegin": data.get("datebegin"),
            "dateend": data.get("dateend"),
            "title_text": data.get("title"),
            "primaryimageurl": data.get("primaryimageurl"),
            "denomination": denomination,
            "period": data.get("period"),
            "technique": data.get("technique"),
            "rank": data.get("rank"),
            "accessionyear": data.get("accessionyear"),
            "historical_significance": row["historical_significance"],
            "rarity": row["rarity"],
            "artistic_merit": row["artistic_merit"],
            "auction_value": row["auction_value"],
            "collector_interest": row["collector_interest"],
        })
        if len(batch) >= META_BATCH:
            b = batch[:]
            with_retry(lambda: supabase.table("coins").upsert(b, on_conflict="objectid").execute())
            inserted += len(b)
            print(f"  {inserted}/{total - len(done_ids)}")
            batch = []
            time.sleep(0.05)

    if batch:
        b = batch[:]
        with_retry(lambda: supabase.table("coins").upsert(b, on_conflict="objectid").execute())
        inserted += len(b)

    print(f"Pass 1 done. Inserted {inserted} rows.")

    # --- Pass 2: embeddings via concurrent individual UPDATE calls ---
    print(f"\n=== COINS PASS 2: embeddings ===")
    embedded_ids = fetch_all_col(
        "coins", "objectid",
        extra_filter=lambda q: q.filter("embedding", "not.is", "null"),
    )
    print(f"  Already embedded: {len(embedded_ids)}")

    emb_rows = conn.execute(
        "SELECT objectid, embedding FROM coins WHERE embedding IS NOT NULL"
    ).fetchall()
    pending = [(r["objectid"], r["embedding"]) for r in emb_rows if r["objectid"] not in embedded_ids]
    print(f"  Pending: {len(pending)}")

    done_count = [0]
    session = http_requests.Session()
    session.headers.update(REST_HEADERS)

    def update_one(objectid, blob):
        emb = unpack_embedding(blob)
        url = f"{SUPABASE_URL}/rest/v1/coins?objectid=eq.{objectid}"
        def do():
            r = session.patch(url, json={"embedding": emb}, timeout=30)
            r.raise_for_status()
        with_retry(do)
        done_count[0] += 1
        if done_count[0] % 500 == 0:
            print(f"  embeddings {done_count[0]}/{len(pending)}")

    with ThreadPoolExecutor(max_workers=EMB_WORKERS) as ex:
        futures = [ex.submit(update_one, oid, blob) for oid, blob in pending]
        for f in as_completed(futures):
            f.result()

    print(f"Pass 2 done. Embedded {done_count[0]} coins.")
    conn.close()


# ---------------------------------------------------------------------------
# Chunks
# ---------------------------------------------------------------------------

def migrate_chunks():
    conn = sqlite3.connect(CHAT_INDEX_PATH)
    conn.row_factory = sqlite3.Row
    total = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    print(f"\n=== CHUNKS ({total} rows) ===")

    # Build set of already-migrated (reading_id, page_start, page_end) keys
    done_keys = set()
    page_size = 1000
    offset = 0
    while True:
        rows = (supabase.table("chunks")
                .select("reading_id, page_start, page_end")
                .range(offset, offset + page_size - 1)
                .execute().data or [])
        for r in rows:
            done_keys.add((r["reading_id"], r["page_start"], r["page_end"]))
        if len(rows) < page_size:
            break
        offset += page_size
    print(f"  Already in Supabase: {len(done_keys)}")

    rows = conn.execute(
        "SELECT reading_id, file, citation, authors, title, week, "
        "page_start, page_end, text, embedding FROM chunks"
    ).fetchall()

    batch, inserted = [], 0
    for row in rows:
        key = (row["reading_id"], row["page_start"], row["page_end"])
        if key in done_keys:
            continue
        emb = unpack_embedding(row["embedding"]) if row["embedding"] else None
        batch.append({
            "reading_id": row["reading_id"],
            "file": clean_text(row["file"]),
            "citation": clean_text(row["citation"]),
            "authors": clean_text(row["authors"]),
            "title": clean_text(row["title"]),
            "week": row["week"],
            "page_start": row["page_start"],
            "page_end": row["page_end"],
            "text": clean_text(row["text"]),
            "embedding": emb,
        })
        if len(batch) >= CHUNK_BATCH:
            b = batch[:]
            with_retry(lambda: supabase.table("chunks").insert(b).execute())
            inserted += len(b)
            if inserted % 100 == 0:
                print(f"  {inserted}/{total - len(done_keys)}")
            batch = []
            time.sleep(0.1)

    if batch:
        b = batch[:]
        with_retry(lambda: supabase.table("chunks").insert(b).execute())
        inserted += len(b)

    print(f"Chunks done. Inserted {inserted} rows.")
    conn.close()


if __name__ == "__main__":
    migrate_coins()
    migrate_chunks()
    print("\nMigration complete!")
    print("\nNow run these indexes in the Supabase SQL Editor:")
    print("  create index on coins using ivfflat (embedding vector_cosine_ops) with (lists = 100);")
    print("  create index on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 10);")
