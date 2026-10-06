# Support Assistant

A multi-tenant **RAG support assistant**. An owner uploads their own documents; anonymous visitors chat with an AI that answers *only* from those documents and cites its sources. When the assistant can't answer, it escalates to a human ticket — notifying the owner by email — and the owner's reply is emailed back to the visitor.

One person = one store. There is no separate "store" table: an authenticated `user` *is* the store, with a public `storeSlug` that the chat widget uses to identify which knowledge base to search.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
  - [System overview](#system-overview)
  - [Chat request lifecycle](#chat-request-lifecycle)
  - [Retrieval pipeline (CRAG-lite)](#retrieval-pipeline-crag-lite)
  - [Ticket escalation and reply](#ticket-escalation-and-reply)
  - [Background jobs](#background-jobs)
  - [Data model](#data-model)
- [Project structure](#project-structure)
- [Installation](#installation)
- [Serving the frontend](#serving-the-frontend)
- [API reference](#api-reference)
- [Configuration reference](#configuration-reference)
- [Security model](#security-model)
- [Operations](#operations)
- [Deployment checklist](#deployment-checklist)
- [Troubleshooting](#troubleshooting)
- [Scripts](#scripts)

---

## Features

**Visitor side (anonymous, no account)**

- Floating chat widget, streamed token-by-token over SSE
- Answers grounded strictly in the owner's uploaded documents
- Inline `[n]` citations that map to the exact source document
- Graceful escalation: when retrieval isn't good enough, it collects an email address and opens a ticket instead of guessing
- Conversations are resumable — the transcript is restored from a signed visitor token

**Owner side (authenticated)**

- Email/password auth with **mandatory email verification** (OTP) and username sign-in
- Profile management: name, username (with live availability check), password change, session list, sign out everywhere
- Document uploader (PDF / TXT / Markdown) with background embedding and live status
- Vector search across your own documents
- Ticket inbox: read escalated questions and reply — the reply is emailed to the visitor and mirrored into the conversation
- Landing page + dashboard, dark gradient theme, served by the backend itself

**Engineering**

- Hybrid retrieval (pgvector cosine + Postgres full-text, fused with Reciprocal Rank Fusion)
- CRAG-lite gate: batched LLM rerank **and** a groundedness verdict in a single call
- Bounded corrective rewrite (off by default)
- pg-boss background queues with retries, dead-letter queues, and a maintenance cron
- Zod-validated config and request payloads; a single error envelope
- Rate limiting per endpoint class, request-id correlation across API → worker, helmet security headers

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js (ESM, `"type": "module"`) |
| Language | TypeScript 7, strict (`noUnusedLocals`, `noUnusedParameters`) |
| HTTP | Express 5 |
| Database | PostgreSQL + `pgvector` |
| ORM / migrations | Drizzle ORM `1.0.0-rc.4` with `postgres-js` |
| Auth | better-auth 1.7 (email/password, username, email OTP) |
| Orchestration | LangGraph + LangChain (`@langchain/openai`) |
| Models | OpenAI — `gpt-4o-mini` for generation and the gate, `text-embedding-3-small` (1536-d) for embeddings |
| Jobs | pg-boss 12 (Postgres-backed queue) |
| Email | Resend + HTML templates in `emails/` |
| Logging | pino + pino-http |
| Validation | Zod 4 |
| Security | helmet 8, express-rate-limit 8 |
| Uploads | multer 2 (memory storage, 10 MB cap), pdf-parse 2 |
| Lint/format | Biome |
| Frontend | React 19, Vite 8, Tailwind CSS v4, shadcn/base-ui, lucide |

---

## Architecture

### System overview

The backend serves the built SPA from `public/`, so the browser talks to a **single origin** — no CORS in production, and one process runs the API, the queue producers, and the workers.

```mermaid
flowchart LR
  B["Browser<br/>React SPA"] -->|"same origin"| E["Express 5 API<br/>src/app.ts"]
  E --> DB[("PostgreSQL<br/>+ pgvector")]
  E --> AI["OpenAI<br/>chat · gate · embeddings"]
  E -->|"enqueue"| Q[("pg-boss<br/>same database")]
  Q --> W["Workers"]
  W --> AI
  W --> RS["Resend<br/>transactional email"]
  E -.->|"optional traces"| LS["LangSmith"]
  W -.->|"optional traces"| LS
```

### Chat request lifecycle

`POST /api/v1/assistant/chat` responds with `text/event-stream` and emits named SSE events: `token`, `done`, `error`.

```mermaid
sequenceDiagram
  autonumber
  participant V as Visitor (browser)
  participant A as Assistant service
  participant P as Postgres
  participant R as Retrieval
  participant M as LLM (CRAG + generation)

  V->>A: POST /chat {storeSlug, message, conversationId?}
  A->>P: resolve storeSlug -> owner id
  A->>P: create or verify conversation (HMAC visitor token)
  A->>P: persist the user message

  alt Small talk / meta question
    A-->>V: event: token (canned reply)
    A-->>V: event: done (citations: [], escalated: false)
  else Real question
    A->>R: hybrid retrieve (dense + FTS, RRF-fused)
    R->>P: pgvector cosine + full-text queries
    R-->>A: candidate passages
    A->>M: assess — rank + sufficiency verdict (one call)
    M-->>A: relevant passages, sufficient?

    alt Sufficient
      A->>M: stream a grounded answer from those passages
      M-->>V: event: token (repeated)
      A-->>V: event: done (citations, visitorToken)
    else Insufficient
      A-->>V: event: token (escalation prompt)
      A-->>V: event: done (escalated: true)
    end
  end
```

Notes on the flow:

- Retrieval and history loading run **in parallel** before the first byte is sent.
- The **visitor token** is an HMAC over the conversation id. It is returned in every `done` event and is required to continue a conversation, fetch its messages, or open a ticket. It is deliberately *not* individually revocable — rotating `CHAT_TOKEN_SECRET` invalidates all of them at once.
- If generation fails, the just-persisted user message is rolled back so no unanswered turn is left in the history.
- The client disconnecting aborts generation via an `AbortController`.

### Retrieval pipeline (CRAG-lite)

Implemented as a compiled LangGraph state machine in `src/modules/assistant/assistant.graph.ts`.

```mermaid
flowchart TD
  START([question]) --> retrieve["retrieve<br/>hybrid: dense + FTS<br/>RRF k=60 → RETRIEVAL_CANDIDATES"]
  retrieve --> assess["assess (one LLM call)<br/>rerank candidates +<br/>decide if the top K is enough"]
  assess --> route{sufficient?}
  route -->|yes| END([answer])
  route -->|"no, rewrites remain"| rewrite["rewrite<br/>better search query"]
  route -->|"no, rewrites exhausted"| END2([escalate])
  rewrite --> retrieve
```

- **retrieve** runs two queries in parallel — pgvector cosine distance over `document_chunk.embedding`, and Postgres full-text over a generated `tsvector` column — then merges them with Reciprocal Rank Fusion.
- **assess** is a single structured-output call that both reranks the candidates and decides whether the best ones actually contain the answer. Asking for only the needed indices (not a full permutation of every candidate) keeps the completion small, which is the dominant latency factor.
- The **rewrite** loop is bounded by `CRAG_MAX_REWRITES` and **defaults to `0`** — on a curated per-owner knowledge base it rarely earned its latency.
- A greeting or meta question (`hi`, `thanks`, `what can you do`) short-circuits before the graph entirely: no retrieval, no model calls, no ticket.

### Ticket escalation and reply

```mermaid
sequenceDiagram
  autonumber
  participant V as Visitor
  participant A as Assistant service
  participant P as Postgres
  participant E as email queue
  participant W as email worker
  participant O as Owner

  V->>A: POST /tickets {conversationId, visitorToken, email}
  A->>P: existing open ticket for this conversation?
  alt Already exists
    A->>E: re-enqueue the notification (a retry must not lose it)
  else New
    A->>P: insert ticket (question = last visitor message)
    A->>E: enqueue owner notification
  end
  W->>O: "New support request" email
  Note over W,O: Notification email delivery is retried up to 5 times, then dead-lettered.

  O->>A: POST /tickets/:id/replies {body}
  A->>P: transaction — insert reply + set status replied
  A->>P: + mirror reply into the conversation
  A->>E: enqueue visitor notification
  W->>V: reply emailed to the visitor
```

### Background jobs

Everything asynchronous is a pg-boss queue stored in the same Postgres database.

```mermaid
flowchart TD
  subgraph proc["Node process — src/server.ts"]
    App["Express app"]
    Ensure["ensureQueues()<br/>create queues + register cron"]
    Workers["registerWorkers()"]
  end

  App -->|"sendJob"| EQ[("email")]
  App -->|"sendJob"| DQ[("document")]
  Ensure -->|"cron */5 * * * *"| MQ[("maintenance")]

  EQ --> EW["email worker<br/>OTP · ticket-created · ticket-reply"]
  EW --> RS["Resend API"]

  DQ --> DW["document worker<br/>extract → chunk → embed → store"]
  DW --> EMB["OpenAI embeddings"]

  MQ --> MW["maintenance worker"]
  MW --> SW["reconcileStaleDocuments()<br/>stuck pending/processing → failed"]
  MW --> DL["reportDeadLetterBacklog()"]

  EW -.->|"retries exhausted"| EDL[("email-dead-letter")]
  DW -.->|"retries exhausted"| DDL[("document-dead-letter")]
  DL -.->|"reads queuedCount"| EDL
  DL -.->|"reads queuedCount"| DDL
```

| Queue | Retries | Expiry | Worker |
| --- | --- | --- | --- |
| `email` | 5, exponential backoff from 30s | 300s | `email.worker.ts` |
| `document` | 3, exponential backoff from 30s | 600s | `document.worker.ts` |
| `maintenance` | 1 | 60s | `maintenance.worker.ts` (cron) |
| `email-dead-letter` / `document-dead-letter` | — | 14-day retention | none — reported, not drained |

### Data model

```mermaid
erDiagram
  user ||--o{ session : "has"
  user ||--o{ account : "has"
  user ||--o{ conversation : "owns"
  user ||--o{ ticket : "receives"
  user ||--o{ document : "uploads"
  conversation ||--o{ message : "contains"
  conversation ||--o{ ticket : "escalates to"
  ticket ||--o{ ticket_reply : "has"
  document ||--o{ document_chunk : "is split into"

  user {
    text id PK
    text email
    text username
    text store_slug UK "public identifier"
    boolean email_verified
  }
  conversation {
    uuid id PK
    text user_id FK
    timestamp updated_at
  }
  message {
    uuid id PK
    uuid conversation_id FK
    message_role role "user | assistant"
    text content
    jsonb citations "index -> chunk/document"
  }
  ticket {
    uuid id PK
    text user_id FK
    uuid conversation_id FK
    text question
    text visitor_email
    ticket_status status "open | replied | closed"
  }
  ticket_reply {
    uuid id PK
    uuid ticket_id FK
    ticket_reply_role author_role "owner | visitor"
    text body
  }
  document {
    uuid id PK
    text user_id FK
    text name
    text mime_type
    document_status status "pending | processing | ready | failed"
    bytea content "cleared once embedded"
    integer chunk_count
  }
  document_chunk {
    uuid id PK
    uuid document_id FK
    integer chunk_index
    text content
    tsvector content_tsv "generated, GIN indexed"
    vector embedding "1536-d, HNSW cosine"
  }
```

Tables marked `pending`/`processing` are reconciled by the maintenance cron, so a lost ingest job can never leave a document stuck forever. `document_chunk` has a unique `(document_id, chunk_index)`, so an overlapping retry cannot duplicate chunks.

---

## Project structure

```
backend/
├── src/
│   ├── app.ts                     # Express app: middleware, routes, static SPA, 404
│   ├── server.ts                  # Entrypoint: start queue → ensure queues → workers → listen
│   ├── config/
│   │   ├── env.ts                 # Zod-validated environment (fails fast on bad config)
│   │   └── embedding.ts           # EMBEDDING_DIMENSIONS
│   ├── jobs/
│   │   ├── index.ts               # registerWorkers()
│   │   ├── queues.ts              # Queue definitions, ensureQueues(), DLQ reporting
│   │   ├── types.ts               # Job payload types
│   │   └── workers/
│   │       ├── email.worker.ts    # otp | ticket-created | ticket-reply
│   │       ├── document.worker.ts # ingest pipeline
│   │       └── maintenance.worker.ts
│   ├── lib/
│   │   ├── auth.ts                # better-auth instance
│   │   ├── chat.ts                # createChatModel() — the only model factory
│   │   ├── conversation-token.ts  # HMAC visitor capability tokens
│   │   ├── db.ts                  # Drizzle client (+ vector-db.ts re-export)
│   │   ├── logger.ts              # pino
│   │   ├── mailer.ts              # Resend + template rendering
│   │   ├── queue.ts               # pg-boss instance, sendJob()
│   │   ├── request-context.ts     # AsyncLocalStorage request id
│   │   ├── vector-db.ts
│   │   └── vector-search.ts       # searchChunksByVector()
│   ├── middlewares/
│   │   ├── auth.ts                # requireAuth
│   │   ├── rate-limit.ts          # one limiter per endpoint class
│   │   ├── request-logger.ts      # request id + pino-http
│   │   └── security-headers.ts    # helmet configuration
│   ├── modules/
│   │   ├── index.ts               # Drizzle relations + model barrel
│   │   ├── assistant/             # chat, retrieval, graph, tickets
│   │   │   ├── assistant.graph.ts      # LangGraph CRAG-lite
│   │   │   ├── assistant.retrieval.ts  # hybrid search + RRF
│   │   │   ├── assistant.service.ts    # streamChat, tickets, conversations
│   │   │   ├── assistant.controller.ts
│   │   │   ├── assistant.routes.ts
│   │   │   ├── assistant.schema.ts
│   │   │   └── assistant.model.ts
│   │   ├── auth/                  # better-auth wrapper + profile/session endpoints
│   │   └── document/              # upload, ingest, search, delete
│   ├── scripts/clear-vectors.ts   # destructive: wipe documents + vectors
│   └── utils/                     # api-response, error-handler, pagination,
│                                  # require-user, sse, validation
├── drizzle/                       # generated SQL migrations (+ meta snapshots)
├── emails/                        # HTML templates: 4 OTP flows + ticket created/reply
├── public/                        # built SPA — this is what ships and is served
├── frontend/                      # React source (git-ignored; see below)
├── drizzle.config.ts
├── biome.json
├── tsconfig.json
└── package.json
```

Each backend module follows the same layering: **routes → controller → service → schema → model**. Controllers do validation and response shaping only; all business logic lives in services.

> **Note on `frontend/`** — the React source is intentionally **not committed** (only the built output in `public/` is). You need the frontend source present locally (or in CI) to rebuild the SPA.

---

## Installation

### Prerequisites

- **Node.js 22+** (the config loader uses `process.loadEnvFile`, which needs ≥ 20.6)
- **pnpm 12** (`corepack enable` or `npm i -g pnpm`)
- **PostgreSQL with the `pgvector` extension** — either locally via Docker or a managed provider such as Neon
- **OpenAI API key** (chat, gate, and embeddings)
- **Resend API key** (transactional email)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start PostgreSQL with pgvector

**Option A — Docker (recommended for local development)**

```bash
docker run -d --name support-assistant-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=support_assistant \
  -p 5432:5432 \
  pgvector/pgvector:pg17
```

Connection string:

```
postgresql://postgres:postgres@localhost:5432/support_assistant
```

Set `DATABASE_SSL=false` for this one — the container doesn't speak TLS.

**Option B — Neon**

Create a project in the Neon console and copy the connection string. Two things to get right:

1. Use `sslmode=verify-full` rather than the default `sslmode=require`. Both verify the certificate today, but `require` will stop verifying in `pg` v9 — and it emits a security warning in the meantime.
2. Enable the **`vector`** extension on the database (Neon: *Extensions* in the dashboard) before running migrations.

```
postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=verify-full
```

If you use Neon's **pooled** endpoint (the host containing `-pooler`), postgres-js's prepared statements can conflict with PgBouncer's transaction pooling.

### 3. Create your `.env`

Copy the example and fill it in:

```bash
cp .env.example .env
```

**Required** (the app refuses to boot without these):

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_URL` | Public origin of the app, e.g. `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Long random string. `openssl rand -base64 32` |
| `CHAT_TOKEN_SECRET` | HMAC key for visitor tokens. `openssl rand -base64 32` |
| `OPENAI_API_KEY` | Used for chat, the gate models, and embeddings |
| `RESEND_API_KEY` | Transactional email |

**Commonly changed:**

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `NODE_ENV` | `development` | `production` enables HSTS and JSON logs |
| `DATABASE_SSL` | `true` | Set `false` for a local Docker Postgres |
| `EMAIL_FROM` | `Support Assistant <onboarding@resend.dev>` | Must be on a **verified Resend domain** in production |
| `CORS_ORIGIN` | *(empty)* | Leave empty when the backend serves the SPA (same origin) |
| `TRUST_PROXY` | `0` | **Set to `1` behind a proxy/LB**, or all visitors share one rate-limit bucket |
| `CHAT_MODEL` | `gpt-4o-mini` | Writes the answer |
| `PIPELINE_MODEL` | `gpt-4o-mini` | Gate steps only (rerank + verdict); never writes the answer |
| `RETRIEVAL_TOP_K` | `5` | Passages handed to generation |
| `RETRIEVAL_CANDIDATES` | `12` | Candidates retrieved before assessment |
| `CRAG_MAX_REWRITES` | `0` | `1` re-enables the corrective rewrite loop |
| `CHAT_HISTORY_LIMIT` | `10` | Prior turns sent to the model |
| `ASSISTANT_MAX_OUTPUT_TOKENS` | `2000` | Output cap for every model call |
| `LANGSMITH_TRACING` | `false` | `true` + `LANGSMITH_API_KEY` sends traces to LangSmith |

Rate limits are all configurable too (`*_RATE_LIMIT_WINDOW_MS` / `*_RATE_LIMIT_MAX`) for auth, OTP, username checks, documents, chat, tickets, and ticket replies. See `.env.example` for the full annotated list.

### 4. Run migrations

Migrations are **never applied automatically** — run them explicitly:

```bash
pnpm exec drizzle-kit migrate     # apply pending migrations
pnpm exec drizzle-kit generate    # after changing a schema, create a new one
```

The first migration includes `CREATE EXTENSION IF NOT EXISTS vector;`, so the extension must be installable by your database user.

### 5. Start the app

```bash
pnpm dev
```

`src/server.ts` starts pg-boss, creates the queues, registers the cron schedule, registers the workers, and then listens. **API and workers run in the same process** — there is no separate worker command.

Verify it's up:

```bash
curl http://localhost:3000/health         # liveness
curl http://localhost:3000/health/ready   # readiness (touches the database)
```

### 6. Create your first store

1. Open `http://localhost:3000/signup` and create an account.
2. Enter the OTP sent to your email to verify.
3. Sign in — you'll land on the dashboard.
4. Go to **Documents**, upload a PDF/MD/TXT, and wait for the status to become **ready**.
5. Return to the site and open the chat bubble; ask something answered by that document.

---

## Serving the frontend

The React app lives in `frontend/` and builds **into `public/`**, which Express serves as static files with an SPA fallback.

```bash
cd frontend
pnpm install
pnpm build     # vite build -> ../public
```

Then the whole app is available from the backend on one origin:

| Path | Served by |
| --- | --- |
| `/assets/*` | hashed bundle, `Cache-Control: max-age=1y, immutable` |
| `/favicon.svg`, etc. | `Cache-Control: no-cache` |
| any other extension-less path | `public/index.html` (client-side routing) |
| a missing file (e.g. `/assets/nope.js`) | JSON 404, not the SPA shell |
| `/api/*` | API routers, JSON error envelope |

For frontend development with hot reload, run `pnpm dev` in `frontend/` — Vite proxies `/api` to `http://localhost:3000`.

---

## API reference

All JSON responses use a single envelope:

```jsonc
// success
{ "success": true, "message": "OK", "data": { } }
// failure
{ "success": false, "error": { "message": "…", "code": "SOME_CODE", "details": {} } }
```

### Assistant — `/api/v1/assistant`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/demo-store` | public | Store slug of the earliest-created store, for the marketing widget |
| `GET` | `/store` | session | Your own store slug |
| `POST` | `/chat` | visitor token\* | **SSE** chat stream (`token`, `done`, `error` events) |
| `POST` | `/tickets` | visitor token | Escalate a conversation to a human ticket |
| `GET` | `/conversations/:conversationId/messages` | visitor token | Conversation transcript (paginated, newest-first) |
| `GET` | `/tickets` | session | List your tickets (paginated) |
| `GET` | `/tickets/:ticketId` | session | Ticket detail with replies |
| `POST` | `/tickets/:ticketId/replies` | session | Reply — emails the visitor and mirrors into the conversation |

\* The visitor token is optional for the first message and required to continue an existing conversation. It is issued in every `done` event.

### Documents — `/api/v1/documents`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/` | session | Upload a file (`multipart/form-data`, field `file`); enqueues embedding, returns `202` |
| `GET` | `/` | session | List your documents (paginated) |
| `POST` | `/search` | session | Vector search across your documents |
| `DELETE` | `/:documentId` | session | Delete a document and its vectors |

Accepted MIME types: `application/pdf`, `text/plain`, `text/markdown`. Max 10 MB. PDFs are checked for a `%PDF-` magic number.

### Auth — `/api/v1/auth`

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/sign-up` | Create an account (username + email + password) |
| `POST` | `/sign-in` | Email + password |
| `POST` | `/sign-in/username` | Username + password |
| `POST` | `/sign-in/email-otp` | Passwordless email OTP |
| `GET` | `/session` | Current session + user, or `null` |
| `GET` | `/sessions` | All active sessions for the user |
| `POST` | `/otp/send` | Send an OTP (`email-verification`, `sign-in`, `forget-password`, `change-email`) |
| `POST` | `/otp/verify` | Verify an email-verification or sign-in OTP |
| `POST` | `/otp/reset-password` | Reset a password using an OTP |
| `POST` | `/is-username-available` | Username availability (used by the debounced inputs) |
| `POST` | `/update-user` | Change name and/or username |
| `POST` | `/change-password` | Change password (requires the current one) |
| `POST` | `/revoke-other-sessions` | Sign out every other device |
| `POST` | `/sign-out` | Sign out |
| `POST` | `/request-password-reset` | Token-link reset (**superseded** by the OTP flow) |
| `POST` | `/reset-password` | Token-link reset (**superseded** by the OTP flow) |

better-auth also mounts its own handlers at `/api/auth/*`.

### Health

| Path | Purpose |
| --- | --- |
| `GET /health` | Liveness — process is up |
| `GET /health/ready` | Readiness — runs `SELECT 1`; `503 NOT_READY` if the database is unreachable |

### Frontend routes

`/` · `/signup` · `/signin` · `/verify-otp` · `/reset-password` · `/chat/:storeSlug` · `/dashboard` · `/dashboard/documents` · `/dashboard/tickets` · `/dashboard/tickets/:id` · `/dashboard/profile` · `/dashboard/chat` · anything else → a real 404 page.

---

## Configuration reference

**Retrieval**

| Variable | Default | Meaning |
| --- | --- | --- |
| `RETRIEVAL_CANDIDATES` | 12 | Fusion output size fed to the assess call. Lower = faster, less recall. |
| `RETRIEVAL_TOP_K` | 5 | Passages actually used for the answer and the citation map. |
| `CRAG_MAX_REWRITES` | 0 | Max corrective rewrites. `0` disables the loop entirely. |
| `CHAT_HISTORY_LIMIT` | 10 | Prior turns given to the model as context. |

**Models**

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHAT_MODEL` | `gpt-4o-mini` | Writes the answer. |
| `PIPELINE_MODEL` | `gpt-4o-mini` | Rerank + sufficiency verdict. A smaller model here is the cheapest latency win. |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Changing this **requires re-ingesting every document**. |
| `OPENAI_EMBEDDING_DIMENSIONS` | 1536 | Must match the `vector(N)` column. Changing it requires a migration + re-ingest. |
| `ASSISTANT_MAX_OUTPUT_TOKENS` | 2000 | Output cap for every model call. |

**Rate limits** — every limiter takes a `WINDOW_MS` and a `MAX`:

| Group | Default | Key |
| --- | --- | --- |
| Auth (`RATE_LIMIT_*`) | 10 / 15 min | IP |
| OTP (`OTP_RATE_LIMIT_*`) | 5 / 15 min | IP |
| Username checks | 30 / min | IP |
| Documents (`DOCUMENT_RATE_LIMIT_*`) | 100 / 15 min | user, else IP |
| Chat (`CHAT_RATE_LIMIT_*`) | 30 / min | IP |
| Ticket creation (`TICKET_RATE_LIMIT_*`) | 5 / 15 min | IP |
| Ticket replies (`TICKET_REPLY_RATE_LIMIT_*`) | 50 / 15 min | user, else IP |
| Public reads (`/demo-store`) | 60 / min | IP (fixed, not configurable) |

---

## Security model

- **Config is validated at boot.** A missing or malformed variable crashes the process immediately rather than failing later at request time.
- **Passwords** are hashed by better-auth; sessions are httpOnly cookies.
- **Email verification is mandatory** (`requireEmailVerification: true`) — sign-up does not create a session, and sign-in returns `403 EMAIL_NOT_VERIFIED` until the address is verified.
- **Visitor tokens** are HMAC-SHA256 capability tokens, domain-separated and compared in constant time. They authorize exactly one conversation — continuing it, reading its messages, and opening its ticket. They are not individually revocable; rotating `CHAT_TOKEN_SECRET` invalidates all of them.
- **Ownership is enforced in the query, not the handler** — every authenticated read/write filters by the session user id, so a guessed id returns 404 rather than someone else's data.
- **Rate limiting** is applied per endpoint class, keyed by IP or user. Behind a proxy you must set `TRUST_PROXY`, or every visitor shares one bucket.
- **Security headers** via helmet: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, and HSTS in production.
- **CSP ships report-only** on purpose. Violations are reported but nothing is blocked, because a slightly-too-strict policy white-screens the SPA. Load the site in a browser, confirm the console is clean, then set `reportOnly: false` in `src/middlewares/security-headers.ts`.
- **Uploads** are size-capped (10 MB) and type-checked, including a PDF magic-number check.
- **Prompt injection via documents is mitigated, not solved** — retrieved passages are wrapped in an explicit `[n]` numbering and the model is instructed to answer only from that context; citations are validated server-side and any out-of-range index is dropped. Treat uploaded documents as untrusted input.
- **Logs** exclude credentials; job payloads carry a request id, not user content beyond what is necessary.

---

## Operations

**Health** — point liveness at `/health`, readiness at `/health/ready`.

**Request correlation** — every response carries an `X-Request-Id` header. An inbound `X-Request-Id` is honoured, so you can correlate through a proxy. The id is attached to every queued job and logged by the workers, so one id follows a request from HTTP into the background.

**Queues** — failed jobs retry with exponential backoff, then land in a dead-letter queue. The maintenance cron logs an error whenever a dead-letter queue is non-empty, so failures surface in your logs instead of sitting silently for two weeks.

**Maintenance cron** — every 5 minutes: documents still `pending`/`processing` after 15 minutes are marked `failed` with a clear message (so nothing is stuck forever), and dead-letter backlogs are reported.

**Graceful shutdown** — `SIGTERM`/`SIGINT` stop accepting connections, drop idle connections, force-close lingering SSE streams after 5s, and stop pg-boss.

**Logging** — pino. JSON in production, pretty-printed in development. Set `LOG_LEVEL` to tune.

---

## Deployment checklist

1. **Apply migrations before the new build boots.** The app never migrates itself.
2. **Ensure `pgvector` is enabled** on the production database.
3. **Set production env:** `NODE_ENV=production`, a real `BETTER_AUTH_URL`, freshly generated `BETTER_AUTH_SECRET` and `CHAT_TOKEN_SECRET`, `DATABASE_SSL=true`, and `sslmode=verify-full` in `DATABASE_URL`.
4. **Set `TRUST_PROXY`** to your hop count (usually `1`) if you're behind a proxy or load balancer.
5. **Verify your sending domain in Resend** and set `EMAIL_FROM` to it. `onboarding@resend.dev` only delivers to your own account address.
6. **Build the SPA into `public/`** before deploying — and remember `frontend/` is git-ignored, so the build must run somewhere that has the source.
7. **Build the backend** (`pnpm build` → `dist/`) and run `node dist/server.js`.
8. **Configure the proxy:** raise the read timeout and disable response buffering for SSE (`/api/v1/assistant/chat`), and raise the upload body limit above 10 MB.
9. **Keep it a long-lived process** — the maintenance cron needs a continuously running process.
10. **Flip the CSP to enforcing** after a browser check.
11. **Smoke test:** sign up → OTP arrives → verify → sign in → upload a document → status *ready* → ask an answerable question → citation renders → ask an unanswerable one → escalation → owner email → reply → visitor email.

---

## Troubleshooting

**`SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'`**
Your `DATABASE_URL` uses `sslmode=require`. It's emitted by `pg-connection-string` (used by `pg`, which pg-boss depends on). Change the URL to `sslmode=verify-full` — same strong behaviour today, no warning, and correct after the pg v9 upgrade.

**The app exits immediately on boot**
That's the env schema failing fast — the log names the offending variable. Check the required list above.

**`ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: esbuild@…` during `pnpm install`**
pnpm doesn't run dependency install scripts unless they're allowlisted, and on a **fresh** install (a deploy host or CI) it exits non-zero when any were skipped. This repo ships the allowlist in `pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - esbuild
```

`esbuild` — pulled in by `tsx` and `drizzle-kit` — is the only dependency here that needs one. pnpm no longer reads the `pnpm` field in `package.json`, so putting the setting there is silently ignored (it warns). If you later add a dependency with an install script, add its name to this list.

**`type "vector" does not exist`**
The `pgvector` extension isn't installed/enabled on the database. Run `CREATE EXTENSION IF NOT EXISTS vector;` as a superuser, or enable it in your provider's dashboard.

**Documents stay on `pending` or `processing`**
Check that the process is running (workers live in it, there is no separate worker command) and look for worker errors in the logs. The maintenance cron will mark anything stuck for more than 15 minutes as `failed`.

**Chat never streams; the answer arrives all at once**
Something is buffering the SSE response — disable proxy buffering for `/api/v1/assistant/chat` and raise the read timeout.

**Rate limits trip for everyone at once**
`TRUST_PROXY` is `0` behind a proxy, so all requests share the proxy's IP. Set it to the hop count.

**`bind message supplies … parameters` / prepared statement errors on Neon**
You're on the pooled (`-pooler`) endpoint, which PgBouncer can't combine with prepared statements.

**Chat escalates on every question**
Either the knowledge base is empty (upload a document and wait for *ready*), or the passages genuinely don't contain the answer. If it's over-eager, raise `RETRIEVAL_TOP_K`/`RETRIEVAL_CANDIDATES` or check the gate's traces in LangSmith.

**Answers are slow**
Enable `LANGSMITH_TRACING` and look at the `crag-retrieval` trace: the `assess` span dominates. Lower `RETRIEVAL_CANDIDATES`, keep `PIPELINE_MODEL` on a small model, and keep `CRAG_MAX_REWRITES=0`.

**`Database not found` after switching `OPENAI_EMBEDDING_MODEL` or dimensions**
Embeddings from a different model aren't comparable. Re-ingest everything: `pnpm clear:vectors --yes`, then upload again.

---

## Scripts

```bash
pnpm dev              # development server (API + workers, tsx watch)
pnpm build            # tsc -> dist/
pnpm start            # run the built server
pnpm clear:vectors    # DESTRUCTIVE: delete all documents and vectors (requires --yes)

pnpm lint             # Biome lint, with fixes
pnpm format           # Biome format
pnpm check            # Biome check, with fixes

cd frontend
pnpm dev              # Vite dev server (proxies /api to :3000)
pnpm build            # build into ../public
pnpm lint             # ESLint
```

### Regenerating a migration

```bash
# edit a model in src/modules/**, then:
pnpm exec drizzle-kit generate --name describe_your_change
pnpm exec drizzle-kit migrate
```

If Drizzle asks whether a changed index is a rename or a create, prefer `create` when the columns or uniqueness changed — a rename only renames an index and leaves the old definition in place.
