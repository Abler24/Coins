"""
Build a RAG index over all course PDFs in /backend/readings/.

Extracts text from each PDF, splits into ~600-token chunks with overlap,
embeds with text-embedding-3-large, and stores in chat_index.db.

Run:    python build_chat_index.py
Re-run: idempotent — drops and rebuilds the table.
"""

import os
import re
import sqlite3
import struct
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI
from pypdf import PdfReader

from readings_data import READINGS

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

DB_PATH = os.path.join(os.path.dirname(__file__), "chat_index.db")
READINGS_DIR = os.path.join(os.path.dirname(__file__), "readings")
EMBED_MODEL = "text-embedding-3-large"
EMBED_DIMS = 3072

# Chunking — characters, not tokens (rough approximation: 1 token ≈ 4 chars)
CHUNK_CHARS = 2400      # ~600 tokens
CHUNK_OVERLAP = 300     # ~75 tokens

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def file_to_reading_meta():
    """Map PDF filename → reading dict (id, citation, week, etc.)."""
    return {r["file"]: r for r in READINGS if r.get("file")}


def extract_text_by_page(path: str) -> list[tuple[int, str]]:
    """Return [(page_number, text)] for a PDF. Skips pages with no extractable text."""
    out = []
    try:
        reader = PdfReader(path)
    except Exception as e:
        print(f"  ! cannot open: {e}")
        return []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = text.strip()
        if len(text) >= 80:  # Skip near-empty pages (covers, blank, OCR junk)
            out.append((i, text))
    return out


def chunk_pages(pages: list[tuple[int, str]]) -> list[dict]:
    """Sliding-window chunks over the concatenated text, keeping page anchors."""
    if not pages:
        return []
    # Build a flat string with page markers we can locate later
    flat_parts = []
    page_offsets = []  # [(start_offset, page_num)]
    cursor = 0
    for pg, text in pages:
        page_offsets.append((cursor, pg))
        flat_parts.append(text)
        cursor += len(text) + 2  # +2 for the \n\n joiner
    flat = "\n\n".join(flat_parts)

    def offset_to_page(offset: int) -> int:
        last = page_offsets[0][1]
        for off, pg in page_offsets:
            if off > offset:
                break
            last = pg
        return last

    chunks = []
    start = 0
    while start < len(flat):
        end = min(start + CHUNK_CHARS, len(flat))
        # Try to extend to a sentence boundary
        if end < len(flat):
            window = flat[end : min(end + 200, len(flat))]
            m = re.search(r"[.!?]\s", window)
            if m:
                end += m.end()
        chunk_text = flat[start:end].strip()
        if len(chunk_text) >= 200:
            chunks.append({
                "text": chunk_text,
                "page_start": offset_to_page(start),
                "page_end": offset_to_page(end - 1),
            })
        if end >= len(flat):
            break
        start = end - CHUNK_OVERLAP
    return chunks


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed up to ~100 texts in one API call."""
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [d.embedding for d in resp.data]


def floats_to_blob(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        DROP TABLE IF EXISTS chunks;
        CREATE TABLE chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reading_id TEXT,
            file TEXT NOT NULL,
            citation TEXT,
            authors TEXT,
            title TEXT,
            week INTEGER,
            page_start INTEGER,
            page_end INTEGER,
            text TEXT NOT NULL,
            embedding BLOB NOT NULL
        );
        CREATE INDEX idx_chunks_reading ON chunks(reading_id);
        CREATE INDEX idx_chunks_file ON chunks(file);
    """)
    conn.commit()
    return conn


def main():
    if not os.path.isdir(READINGS_DIR):
        print(f"missing readings directory: {READINGS_DIR}")
        sys.exit(1)

    meta_by_file = file_to_reading_meta()
    pdfs = sorted(f for f in os.listdir(READINGS_DIR) if f.lower().endswith(".pdf"))
    print(f"found {len(pdfs)} PDFs in {READINGS_DIR}")
    print(f"of these, {sum(1 for f in pdfs if f in meta_by_file)} have reading metadata")

    conn = init_db()
    total_chunks = 0
    skipped = []

    for idx, fname in enumerate(pdfs, start=1):
        path = os.path.join(READINGS_DIR, fname)
        meta = meta_by_file.get(fname, {})
        rid = meta.get("id")
        citation = meta.get("citation", fname)
        authors = meta.get("authors", "")
        title = meta.get("title", os.path.splitext(fname)[0])
        week = meta.get("week")
        print(f"[{idx}/{len(pdfs)}] {fname}")

        pages = extract_text_by_page(path)
        if not pages:
            print("  · no extractable text (likely scanned image PDF) — skipping")
            skipped.append(fname)
            continue

        chunks = chunk_pages(pages)
        if not chunks:
            print("  · no chunks produced — skipping")
            skipped.append(fname)
            continue

        # Embed in batches of 64
        BATCH = 64
        embeddings: list[list[float]] = []
        for i in range(0, len(chunks), BATCH):
            batch_texts = [c["text"] for c in chunks[i : i + BATCH]]
            for attempt in range(3):
                try:
                    embeddings.extend(embed_batch(batch_texts))
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    print(f"  ! embed retry ({e}); sleeping")
                    time.sleep(2 ** attempt)

        # Insert
        rows = [
            (
                rid, fname, citation, authors, title, week,
                c["page_start"], c["page_end"], c["text"], floats_to_blob(emb),
            )
            for c, emb in zip(chunks, embeddings)
        ]
        conn.executemany(
            """INSERT INTO chunks
               (reading_id, file, citation, authors, title, week,
                page_start, page_end, text, embedding)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        conn.commit()
        total_chunks += len(chunks)
        print(f"  · {len(pages)} pages → {len(chunks)} chunks")

    print()
    print(f"done — {total_chunks} chunks across {len(pdfs) - len(skipped)} PDFs")
    if skipped:
        print(f"skipped (likely scanned): {len(skipped)}")
        for s in skipped:
            print(f"  - {s}")
    print(f"index: {DB_PATH}")
    conn.close()


if __name__ == "__main__":
    main()
