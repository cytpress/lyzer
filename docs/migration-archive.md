# lyzer migration archive

This file consolidates the old migration plans, comparison notes, and planning discussions into one readable record. The original scattered files were removed after this archive was created.

## Final Direction

The project name is now `lyzer`.

The migration target is:

- Public frontend: Astro SSG deployed to Cloudflare Pages.
- Private backend: Hono running on GL552VW.
- Database: local Postgres, managed by Docker Compose.
- Build and deploy: GL552VW runs fetch, analysis, static build, and Cloudflare Pages direct upload.
- Search: MiniSearch with a CJK bigram tokenizer for the first static-search version.
- AI analysis: keep one latest analysis result per agenda. If the prompt changes significantly, clear `analysis_results` and rerun.

The first v2 migration intentionally does not include:

- RAG.
- pgvector.
- legislator speech database.
- bill or law mapping UI.
- document block tables.
- prompt versioning, model name tracking, or input hash tracking.
- Supabase completed-data migration.

## Architecture

```text
packages/api
  Hono private API
  Postgres schema migration
  LYAPI adapter
  fetch/analyze/build/deploy/daily jobs

packages/web
  Astro static site
  React islands for search and bookmarks
  MiniSearch serialized index
```

The public website should keep working even if GL552VW is offline, because the deployed Cloudflare Pages site is static.

## Data Model

The minimal v2 schema is:

```text
gazettes
  gazette_id text primary key
  volume integer
  issue integer
  booklet integer
  publish_date date
  raw jsonb
  fetched_at timestamptz

agendas
  agenda_id text primary key
  gazette_id text references gazettes(gazette_id)
  meeting_dates date[]
  subject text
  category_code integer
  parsed_url text
  txt_url text
  official_page_url text
  official_pdf_url text
  raw jsonb
  fetched_at timestamptz

analysis_results
  agenda_id text primary key references agendas(agenda_id)
  status text
  analysis_json jsonb
  analyzed_at timestamptz
  error_message text
  updated_at timestamptz
```

`agendas.raw` is kept because LYAPI may expose useful future metadata, such as processed document URL lists or bill relation data. The project does not store parsed JSON or raw text snapshots in v1; it stores only URLs and can refetch source documents later.

## Route Decisions

The canonical detail route is:

```text
/gazettes/{agenda_id}
```

`gazette` remains part of the route and database vocabulary because the domain is still legislative gazettes. The brand name is `lyzer`.

## LYAPI Decisions

The migration settled on these LYAPI sources:

```text
GET /gazettes?page=1&limit=N
GET /gazettes/{gazette_id}/agendas?limit=N
```

For each agenda:

- Use `公報議程編號` as `agenda_id`.
- Use `類別代碼` as `category_code`.
- Analyze only `category_code = 3`.
- Use `處理後公報網址` entries with `type = parsed` first.
- Fall back to `type = txt` when parsed fetch fails.
- Store the first parsed/txt URL in columns for convenience, but keep all processed URLs in `agendas.raw`.

For future bill/law mapping, prefer `/meets` data where `議事網資料.關係文書.議案` is present. `/bills/{billNo}/meets` may also help, but `/meets/{id}/bills` was observed to be less reliable for this use case.

## Search Decision

The chosen first version is MiniSearch rather than Pagefind.

Reasons:

- Static-site friendly.
- No runtime backend.
- Serialized index can be built at Astro build time.
- CJK bigram tokenization improves recall for Traditional Chinese.
- Alias expansion can make terms like `勞基法` match `勞動基準法`.

Initial aliases:

```text
勞基法 -> 勞動基準法
長照 -> 長期照顧
健保 -> 全民健康保險
兒少 -> 兒童及少年
```

Pagefind was considered, but its Chinese word-boundary behavior and fuzzy limitations made it less attractive for this project.

## Deployment Decision

The deployment pipeline is:

```text
pnpm job:fetch
pnpm job:analyze
pnpm job:build
pnpm job:deploy
```

`job:daily` currently runs fetch, analyze, and build. Deploy can be run separately.

The preferred scheduler on GL552VW is a host-level trigger, such as systemd timer or cron, that calls the CLI or private Hono endpoint. The job logic belongs in the application code, not inside a fragile shell script.

## Rejected or Deferred Ideas

### Supabase Data Migration

The old completed analysis data is not migrated in v1. Starting fresh avoids schema mismatch, old prompt output, and historical inconsistencies. If old data is needed later, keep it as an archive or run a one-off import.

### RAG and Embeddings

RAG is deferred. The project can later backfill embeddings from:

- `analysis_results.analysis_json` for a simple first pass.
- refetched parsed/txt documents through `agendas.raw` and `parsed_url`.

No `embeddings`, `document_blocks`, or `source_documents` tables are needed in v1.

### Document Blocks

Storing every parsed block as a row was rejected for v1. A single meeting can have more than 1,500 blocks, which is unnecessary for the current feature set. If future RAG needs chunking, chunks can be generated in a backfill process.

### Prompt Versioning

Multiple prompt versions are not stored. The product should not show old prompt output and new prompt output mixed together. When the prompt changes substantially, clear and rerun `analysis_results`.

### Drizzle

Drizzle was discussed, but the implemented v1 keeps direct SQL with `pg` to reduce migration complexity. A future move to Drizzle is possible if schema growth justifies it.

## Future Expansion Notes

### Legislator Database

Do not build this in v1. When ready, use agenda source documents and analysis JSON to backfill legislator participation, speaker names, and speech segments.

### Basic RAG

The simplest useful first RAG version can embed a normalized text derived from `analysis_json`, not the full raw transcript. This can answer high-level questions like "近三年勞基法相關討論有哪些" with far lower storage and processing cost.

### Bill/Law Mapping

The website may later show which bills were discussed in a meeting. The likely data path is:

1. Use `agenda_id` and meeting metadata to map to LYAPI meet records.
2. Read embedded bill relations from `/meets`.
3. Store normalized mapping in future tables only when the UI needs it.

## Current v2 Runtime Files

The files that matter now are:

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
docker-compose.yml
.env.example

packages/api/**
packages/web/**
docs/migration-archive.md
lyapi-swagger.yaml
```

The old `backend/`, `frontend/`, scattered migration reports, zip/rar archives, and local parsed text fixtures are no longer part of the maintained project.
