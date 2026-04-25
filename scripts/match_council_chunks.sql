-- Supabase の SQL Editor で 1 度だけ実行する。
-- council_chunks テーブルが既に存在している前提。
-- 期待カラム: id, municipality, meeting_name, speaker, content, embedding vector(768)

create or replace function match_council_chunks(
  query_embedding vector(768),
  match_count int,
  filter_municipality text default null
)
returns table (
  id bigint,
  municipality text,
  meeting_name text,
  speaker text,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.municipality,
    c.meeting_name,
    c.speaker,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from council_chunks c
  where filter_municipality is null
     or c.municipality = filter_municipality
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- 件数が増えたら HNSW インデックスを推奨（pgvector >= 0.5）
-- create index if not exists council_chunks_embedding_hnsw
--   on council_chunks using hnsw (embedding vector_cosine_ops);
