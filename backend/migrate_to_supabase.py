"""
One-time migration script.
Uploads coins and chunks to Supabase in two passes:
  Pass 1 — metadata without embeddings (fast, small payloads)
  Pass 2 — embeddings only, 1 row at a time with retries

Run AFTER executing schema.sql in the Supabase SQL Editor.

Usage:
    python migrate_to_supabase.py
"""

import json
import os
import sqlite3
import struct
import time

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DB_PATH = os.path.join(os.path.dirname(__file__), "coins.db")
CHAT_INDEX_PATH = os.path.join(os.path.dirname(__file__), "chat_index.db")

META_BATCH = 100   # rows per metadata batch (no embeddings, small payload)
EMB_BATCH = 5      # rows per embedding batch (large payload, keep small)
CHUNK_BATCH = 10   # chunk embedding batch size

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def unpack_embedding(blob):
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


def with_retry(fn, retries=4, delay=2.0):
    for attempt in range(retries):
        try:
            return fn()
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = delay * (2 ** attempt)
            print(f"    retrying in {wait:.0f}s ({e.__class__.__name__})")
            time.sleep(wait)


def already_migrated_objectids():
    try:
        result = supabase.table("coins").select("objectid").execute()
        return {r["objectid"] for r in (result.data or [])}
    except Exception:
        return set()


def already_embedded_objectids():
    """Return objectids that already have a non-null embedding."""
    try:
        # fetch all objectids where embedding IS NOT NULL
        result = supabase.table("coins").select("objectid").not_("embedding", "is", "null").execute()
        return {r["objectid"] for r in (result.data or [])}
    except Exception:
        return set()


def migrate_coins():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    total = conn.execute("SELECT COUNT(*) FROM coins").fetchone()[0]
    print(f"\n=== PASS 1: coin metadata ({total} rows) ===")

    done_ids = already_migrated_objectids()
    print(f"  Already in Supabase: {len(done_ids)}")

    rows = conn.execute(
        "SELECT objectid, data, text_blob, historical_significance, rarity, "
        "artistic_merit, auction_value, collector_interest FROM coins"
    ).fetchall()

    batch = []
    inserted = 0

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
            with_retry(lambda: supabase.table("coins").upsert(b).execute())
            inserted += len(b)
            print(f"  metadata {inserted}/{total - len(done_ids)}")
            batch = []
            time.sleep(0.05)

    if batch:
        b = batch[:]
        with_retry(lambda: supabase.table("coins").upsert(b).execute())
        inserted += len(b)
        print(f"  metadata {inserted}/{total - len(done_ids)}")

    print(f"Pass 1 done. Inserted {inserted} new rows.")

    # Pass 2: embeddings
    print(f"\n=== PASS 2: coin embeddings ===")
    embedded = already_embedded_objectids()
    print(f"  Already embedded: {len(embedded)}")

    emb_rows = conn.execute(
        "SELECT objectid, embedding FROM coins WHERE embedding IS NOT NULL"
    ).fetchall()

    pending = [r for r in emb_rows if r["objectid"] not in embedded]
    print(f"  Pending: {len(pending)}")

    batch = []
    done = 0
    for row in pending:
        emb = unpack_embedding(row["embedding"])
        batch.append({"objectid": row["objectid"], "embedding": emb})

        if len(batch) >= EMB_BATCH:
            b = batch[:]
            with_retry(lambda: supabase.table("coins").upsert(b).execute())
            done += len(b)
            if done % 100 == 0:
                print(f"  embeddings {done}/{len(pending)}")
            batch = []
            time.sleep(0.1)

    if batch:
        b = batch[:]
        with_retry(lambda: supabase.table("coins").upsert(b).execute())
        done += len(b)

    print(f"Pass 2 done. Embedded {done} coins.")
    conn.close()


def already_migrated_chunk_ids():
    try:
        result = supabase.table("chunks").select("reading_id, page_start, page_end").execute()
        return {(r["reading_id"], r["page_start"], r["page_end"]) for r in (result.data or [])}
    except Exception:
        return set()


def migrate_chunks():
    conn = sqlite3.connect(CHAT_INDEX_PATH)
    conn.row_factory = sqlite3.Row

    total = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    print(f"\n=== PASS 1: chunk metadata ({total} rows) ===")

    rows = conn.execute(
        "SELECT reading_id, file, citation, authors, title, week, "
        "page_start, page_end, text, embedding FROM chunks"
    ).fetchall()

    done_keys = already_migrated_chunk_ids()
    print(f"  Already in Supabase: {len(done_keys)}")

    # Insert metadata without embeddings first
    batch = []
    inserted = 0
    for row in rows:
        key = (row["reading_id"], row["page_start"], row["page_end"])
        if key in done_keys:
            continue
        batch.append({
            "reading_id": row["reading_id"],
            "file": row["file"],
            "citation": row["citation"],
            "authors": row["authors"],
            "title": row["title"],
            "week": row["week"],
            "page_start": row["page_start"],
            "page_end": row["page_end"],
            "text": row["text"],
        })
        if len(batch) >= META_BATCH:
            b = batch[:]
            with_retry(lambda: supabase.table("chunks").upsert(b).execute())
            inserted += len(b)
            print(f"  metadata {inserted}/{total - len(done_keys)}")
            batch = []
            time.sleep(0.05)

    if batch:
        b = batch[:]
        with_retry(lambda: supabase.table("chunks").upsert(b).execute())
        inserted += len(b)
        print(f"  metadata {inserted}/{total - len(done_keys)}")

    print(f"Pass 1 done. Inserted {inserted} chunk rows.")

    # Pass 2: embeddings
    print(f"\n=== PASS 2: chunk embeddings ===")

    # Get chunk IDs that need embeddings
    try:
        result = supabase.table("chunks").select("id, reading_id, page_start, page_end").not_("embedding", "is", "null").execute()
        already_emb = {(r["reading_id"], r["page_start"], r["page_end"]) for r in (result.data or [])}
    except Exception:
        already_emb = set()

    print(f"  Already embedded: {len(already_emb)}")

    # Fetch IDs from Supabase to match with SQLite rows
    all_sb = supabase.table("chunks").select("id, reading_id, page_start, page_end").execute()
    sb_id_map = {(r["reading_id"], r["page_start"], r["page_end"]): r["id"] for r in (all_sb.data or [])}

    batch = []
    done = 0
    for row in rows:
        key = (row["reading_id"], row["page_start"], row["page_end"])
        if key in already_emb or key not in sb_id_map:
            continue
        emb = unpack_embedding(row["embedding"]) if row["embedding"] else None
        if emb is None:
            continue
        batch.append({"id": sb_id_map[key], "embedding": emb})

        if len(batch) >= CHUNK_BATCH:
            b = batch[:]
            with_retry(lambda: supabase.table("chunks").upsert(b).execute())
            done += len(b)
            if done % 100 == 0:
                print(f"  embeddings {done}")
            batch = []
            time.sleep(0.1)

    if batch:
        b = batch[:]
        with_retry(lambda: supabase.table("chunks").upsert(b).execute())
        done += len(b)

    print(f"Pass 2 done. Embedded {done} chunks.")
    conn.close()


if __name__ == "__main__":
    migrate_coins()
    migrate_chunks()
    print("\nMigration complete!")
    print("\nNow run these indexes in the Supabase SQL Editor:")
    print("  create index on coins using ivfflat (embedding vector_cosine_ops) with (lists = 100);")
    print("  create index on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 10);")
