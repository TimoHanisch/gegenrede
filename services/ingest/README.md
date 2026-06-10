<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 gegenrede contributors -->

# @gegenrede/ingest

Source connectors, the shared normalizer, and (later) the snapshot-builder
CLI (spec §9.3). Connectors implement `fetchSince(date): RawFactCheck[]`;
the shared normalizer maps records onto the canonical §9.2 schema, applies
the verdict map (unknown ratings → `unproven` + warning), dedups on
`dedup_hash`, embeds claims via `shared/embedText("passage", …)`, and
upserts into Postgres.

Only claim + verdict + link metadata are stored — never article bodies —
which keeps the dataset redistributable (architecture doc §3.3).

## Dev database

Development uses a plain local **Postgres 17 + pgvector** container. (The
production docker-compose stack is a separate task, #52.)

```sh
docker run -d --name gegenrede-db \
  -e POSTGRES_USER=gegenrede \
  -e POSTGRES_PASSWORD=gegenrede \
  -e POSTGRES_DB=gegenrede \
  -p 5432:5432 \
  pgvector/pgvector:pg17
```

Apply migrations (creates the `vector` extension and the `factchecks` table):

```sh
cd services/ingest
pnpm db:migrate
```

`DATABASE_URL` defaults to
`postgres://gegenrede:gegenrede@localhost:5432/gegenrede`
(see `drizzle.config.ts`); set it to point anywhere else.

Schema changes: edit `src/db/schema.ts`, then `pnpm db:generate` to emit a
new migration into `drizzle/`. Post-M1 schema changes require human
approval (CLAUDE.md).

## Tests

`pnpm test` is hermetic (in-memory store, fake embedding provider). The
Drizzle store integration test runs only when `DATABASE_URL` is set and
migrations have been applied:

```sh
DATABASE_URL=postgres://gegenrede:gegenrede@localhost:5432/gegenrede pnpm test
```
