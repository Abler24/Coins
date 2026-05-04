-- Run this entire file in Supabase SQL Editor before migrating data.

-- 1. Enable pgvector
create extension if not exists vector;

-- 2. Coins table
create table if not exists coins (
    id bigserial primary key,
    objectid integer unique not null,
    data jsonb not null,
    text_blob text,
    embedding vector(3072),
    culture text,
    medium text,
    datebegin integer,
    dateend integer,
    title_text text,
    primaryimageurl text,
    denomination text,
    period text,
    technique text,
    rank integer,
    accessionyear integer,
    historical_significance integer,
    rarity integer,
    artistic_merit integer,
    auction_value integer,
    collector_interest integer
);

-- 3. Chunks table (chat index)
create table if not exists chunks (
    id bigserial primary key,
    reading_id text,
    file text not null,
    citation text,
    authors text,
    title text,
    week integer,
    page_start integer,
    page_end integer,
    text text not null,
    embedding vector(3072) not null
);

-- 4. Vector search function for coins
create or replace function match_coins(
    query_embedding vector(3072),
    filter_culture text[] default null,
    filter_medium text[] default null,
    filter_datebegin integer default null,
    filter_dateend integer default null,
    filter_denomination text default null,
    filter_hasimage boolean default false,
    filter_period text default null,
    filter_technique text default null,
    filter_mint text default null,
    match_count integer default 80
)
returns table (
    objectid integer,
    data jsonb,
    historical_significance integer,
    rarity integer,
    artistic_merit integer,
    auction_value integer,
    collector_interest integer,
    similarity float8
)
language plpgsql
as $$
begin
    return query
    select
        c.objectid,
        c.data,
        c.historical_significance,
        c.rarity,
        c.artistic_merit,
        c.auction_value,
        c.collector_interest,
        1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
    from coins c
    where
        (filter_culture is null or c.culture = any(filter_culture))
        and (filter_medium is null or c.medium = any(filter_medium))
        and (filter_datebegin is null or c.datebegin >= filter_datebegin)
        and (filter_dateend is null or c.dateend <= filter_dateend)
        and (not filter_hasimage or (c.primaryimageurl is not null and c.primaryimageurl != ''))
        and (filter_denomination is null or lower(coalesce(c.denomination, '')) like '%' || lower(filter_denomination) || '%')
        and (filter_period is null or lower(coalesce(c.period, '')) like '%' || lower(filter_period) || '%')
        and (filter_technique is null or lower(coalesce(c.technique, '')) like '%' || lower(filter_technique) || '%')
        and (filter_mint is null or lower(coalesce(c.title_text, '')) like '%' || lower(filter_mint) || '%')
    order by c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    limit match_count;
end;
$$;

-- 5. Vector search function for chat chunks
create or replace function match_chunks(
    query_embedding vector(3072),
    filter_week integer default null,
    match_count integer default 24
)
returns table (
    id integer,
    reading_id text,
    file text,
    citation text,
    authors text,
    title text,
    week integer,
    page_start integer,
    page_end integer,
    text text,
    similarity float8
)
language plpgsql
as $$
begin
    return query
    select
        c.id::integer,
        c.reading_id,
        c.file,
        c.citation,
        c.authors,
        c.title,
        c.week,
        c.page_start,
        c.page_end,
        c.text,
        1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
    from chunks c
    where (filter_week is null or c.week = filter_week)
    order by c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    limit match_count;
end;
$$;

-- 6. Random coins function
create or replace function random_coins(
    match_count integer default 20,
    require_image boolean default true
)
returns table (data jsonb)
language plpgsql
as $$
begin
    return query
    select c.data from coins c
    where (not require_image or (c.primaryimageurl is not null and c.primaryimageurl != ''))
    order by random()
    limit match_count;
end;
$$;

-- 7. Culture frequency counts (used at app startup)
create or replace function culture_counts()
returns table (culture text, count bigint)
language sql
as $$
    select c.culture, count(*) as count
    from coins c
    where c.culture is not null
    group by c.culture
    order by count desc;
$$;

-- 8. Chat sources list (distinct readings in chunks table)
create or replace function chat_sources_list()
returns table (
    file text,
    citation text,
    authors text,
    title text,
    week integer,
    chunks bigint
)
language sql
as $$
    select
        c.file,
        min(c.citation) as citation,
        min(c.authors) as authors,
        min(c.title) as title,
        min(c.week) as week,
        count(*) as chunks
    from chunks c
    group by c.file
    order by min(c.week), min(c.authors);
$$;

-- NOTE: Run these via psql (not SQL Editor — takes too long for the UI timeout).
-- ivfflat won't work (2000 dim limit). Use HNSW with halfvec cast instead.
-- create index if not exists coins_embedding_hnsw_idx on coins using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
-- create index if not exists chunks_embedding_hnsw_idx on chunks using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
