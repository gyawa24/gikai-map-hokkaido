-- Supabase の SQL Editor で 1 度だけ実行する。
-- council_chunks テーブルが既に存在している前提。
-- 期待カラム:
-- id, municipality, slug, meeting_name, council_id, schedule_id, minute_id,
-- speaker, speaker_name, speaker_role, agenda_title, content, embedding vector(768)

create or replace function match_council_chunks(
  query_embedding vector(768),
  match_count int,
  filter_municipality text default null
)
returns table (
  id bigint,
  municipality text,
  slug text,
  meeting_name text,
  council_id bigint,
  schedule_id bigint,
  minute_id bigint,
  speaker text,
  speaker_name text,
  speaker_role text,
  agenda_title text,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.municipality,
    c.slug,
    c.meeting_name,
    c.council_id,
    c.schedule_id,
    c.minute_id,
    c.speaker,
    c.speaker_name,
    c.speaker_role,
    c.agenda_title,
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
