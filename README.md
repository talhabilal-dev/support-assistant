# Support Assistant

A RAG-based support assistant. Users upload documents, the backend chunks and
embeds them into PostgreSQL (with the `pgvector` extension), and users chat
with an AI that answers using **hybrid search** (dense vectors + keyword) over
that content.

When a chat raises a problem, the model calls a **`create_support_ticket`
tool** that distils the conversation into a ticket (a summary + the real pain
point). The whole chat is stored, tickets are listed in the UI, and a follow-up
**email goes out via Resend** — as a background job.

Everything — documents, chunks, embeddings, conversations, tickets, and the
job queue — lives in a single PostgreSQL database. No separate vector store.

## Architecture

```
                ┌────────────────────────────────────────────┐
   Browser ───▶ │ FastAPI (static React app + /api/*)        │
                └───────────────┬────────────────────────────┘
                                │ enqueue background jobs
                                ▼
                ┌────────────────────────────────────────────┐
                │ PgQueuer (jobs table in PostgreSQL)        │
                └───────────────┬────────────────────────────┘
                                │ worker process
                                ▼
  upload ─▶ load (PDF/TXT/MD) ─▶ split ─▶ embed ─▶ store chunks + vectors
  email  ─▶ render ticket email ─▶ Resend API

  chat  ─▶ hybrid retrieve (vector + keyword, RRF) ─▶ [rerank] ─▶ [CRAG]
        ─▶ LangGraph agent ⇄ tools (create_support_ticket) ─▶ answer + sources
```

Both **document embedding** and **email sending** run as PgQueuer background
jobs, so API requests return immediately.

### Backend modules (`src/support_assistant/`)

| Module | Responsibility |
| --- | --- |
| `config.py` | Environment-driven settings (pydantic-settings) |
| `log.py` | Simple logging setup shared by server + worker |
| `db.py` | asyncpg pool and schema DDL (pgvector, tables, indexes) |
| `models.py` | Domain dataclasses (documents, tickets, conversations) |
| `schemas.py` | Pydantic request/response models |
| `repositories.py` | SQL for documents, chunks, conversations and tickets |
| `ingestion/` | Loaders, recursive splitter, ingest service |
| `rag/` | Embeddings, hybrid retrieval, reranker & CRAG seams |
| `agent/` | LangGraph pipeline, prompts, ticket tool, chat service |
| `notifications/` | Resend email sender + ticket email task |
| `api/` | FastAPI app, routers, static hosting |
| `jobs/` | PgQueuer queue helpers and the worker |

### Database tables

- `documents` — uploads + raw bytes + ingestion status
- `chunks` — text chunks with `vector` embeddings (HNSW) + `tsvector` (GIN)
- `conversations` / `chat_messages` — the stored chat history
- `tickets` — summary, pain point, email + delivery status
- PgQueuer's own job tables

## Requirements

- Python 3.14+ and [uv](https://docs.astral.sh/uv/)
- Node.js + [pnpm](https://pnpm.io/) (to build the frontend)
- PostgreSQL with the **pgvector** extension available
- An OpenAI API key
- A [Resend](https://resend.com/) API key (for ticket emails)

## Setup

```bash
# 1. Install Python dependencies
uv sync

# 2. Configure the environment
cp .env.example .env   # set DATABASE_URL, OPENAI_API_KEY, RESEND_API_KEY, EMAIL_FROM

# 3. Build the frontend (served as static files by FastAPI)
cd frontend && pnpm install && pnpm build && cd ..
```

The build writes to the repo-root `static/` folder, which is the only frontend
artifact committed (the `frontend/` app source is gitignored). The database
schema is created automatically on startup.

## Running

Two processes: the API server and the background worker.

```bash
# Terminal 1 — API server (http://localhost:8000)
uv run support-assistant api

# Terminal 2 — background worker (document embedding + ticket emails)
uv run support-assistant worker
```

Or with the module form: `uv run python -m support_assistant api|worker`.

For frontend development with hot reload, run `pnpm dev` in `frontend/` (it
proxies `/api` to the backend) and keep the API server running.

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/documents` | Upload a PDF/TXT/MD file (multipart `file`) |
| `GET` | `/api/documents` | List documents with ingestion status |
| `GET` | `/api/documents/{id}` | Fetch a single document |
| `DELETE` | `/api/documents/{id}` | Delete a document and its chunks |
| `POST` | `/api/chat` | Ask a question; returns answer + sources + conversation id |
| `POST` | `/api/chat/stream` | Same, streamed as Server-Sent Events (`token` … then `done`) |
| `GET` | `/api/suggestions` | Starter questions the documents can answer (`?limit=3`) |
| `GET` | `/api/tickets` | List support tickets |
| `GET` | `/api/tickets/{id}` | Fetch a ticket |
| `POST` | `/api/tickets/{id}/email` | Queue the confirmation email for a ticket |
| `POST` | `/api/tickets/{id}/reply` | Send an owner reply email for a ticket |
| `GET` | `/api/conversations/{id}` | Fetch the stored messages for a conversation |
| `GET` | `/api/conversations/code/{code}` | Resume a conversation from its short code |
| `GET` | `/api/health` | Liveness + document/chunk counts |

Chat request body (the server owns history — pass the `conversation_id` from
the previous response to continue a thread):

```json
{
  "message": "I can't reset my password, the email never arrives",
  "conversation_id": "0f1e...",
  "document_ids": null
}
```

## Chat behaviour

- **Grounded, cited answers.** Sources shown under a reply are only the chunks
  the answer actually cited (by `[n]` reference), not every retrieved chunk.
- **Escalation flow.** When a question is *not* answered by the documents, the
  assistant asks whether to forward it to the support owner. Only after the user
  agrees does it call `create_support_ticket`; it asks for an email and states it
  is used only to send the reply. If no email is given, the query is still saved
  and the ticket simply has no **Send email** button.
- **Starter questions.** On an empty chat the UI shows a few questions generated
  from your documents (`/api/suggestions`). Nothing is hard-coded — if the
  documents yield none, no chips are shown.
- **Resumable conversations.** Every conversation gets a short code (e.g.
  `nkbu5mv5gy`). It is shown in the chat and on the ticket, and can be typed back
  in via **Resume** to continue where you left off.
- **Duplicate-aware escalation.** Before escalating, the model can call
  `find_similar_questions` to check existing tickets and will point at an
  existing one rather than opening a duplicate.

## Owner panel

The **Support tickets** panel on the Documents page is the support owner's view.
Each ticket shows the user's email, the conversation code, and the stored chat.
The owner can:

- **Send confirmation** — the standard acknowledgement email, or
- **Reply** — write a custom reply that is emailed to the user and recorded on
  the ticket (`ticket_replies`).

Emails are replyable: their `Reply-To` is the support address
(`EMAIL_REPLY_TO`, falling back to `EMAIL_FROM`), so a user's reply lands with
the owner. Emails are only offered when the ticket actually has an address —
otherwise the query is simply saved.

## UI

The React app (built to `static/`) has three tabbed views:

- **Home** — a gradient hero with quick links into the app.
- **Chat** — streamed answers (token by token over SSE) with cited sources;
  problems raised here become tickets automatically.
- **Documents** — upload the knowledge base and manage support tickets
  (send the Resend follow-up email, read the stored conversation).

## Extending

Two future features are pre-wired as no-op seams. Enabling either flag without
an implementation raises a clear error at startup.

- **Re-ranker** — implement `Reranker` in `rag/reranker.py`, register it in
  `get_reranker`, then set `ENABLE_RERANKER=true`. Hybrid search already calls
  through this interface.
- **Corrective RAG (CRAG)** — implement `QueryCorrector` in `rag/crag.py`,
  register it in `get_corrector`, then set `ENABLE_CRAG=true`. The graph already
  contains the `correct` node and its conditional edges.

## Dependency notes

Only already-installed packages are used, per project constraints:

- **pgvector without the `pgvector` package** — vector values are passed as
  text and cast in SQL (`CAST($1::text AS vector)`), so no extra dependency is
  needed and the same asyncpg pool is shared with PgQueuer.
- **Resend without the `resend` SDK** — the REST API is called with `httpx`
  (already a dependency).
- **Text splitting without `langchain-text-splitters`** — a small recursive
  character splitter is implemented in `ingestion/splitter.py`.
- **No client-side router** — the two-page UI uses simple state-based
  navigation, avoiding extra npm dependencies.
