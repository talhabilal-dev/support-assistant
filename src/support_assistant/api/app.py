"""FastAPI application: API routers + static frontend hosting."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from ..agent.service import build_chat_service
from ..agent.suggestions import build_suggestion_service
from ..config import Settings, get_settings
from ..db import create_pool, init_schema
from ..jobs import JobQueue, install_queue_schema
from ..log import get_logger, setup_logging
from ..repositories import DocumentRepository
from ..schemas import HealthOut
from . import chat, documents, tickets

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    setup_logging(settings.log_level)

    pool = await create_pool(settings)
    await init_schema(pool, settings)
    await install_queue_schema(pool)

    app.state.pool = pool
    app.state.queue = JobQueue(pool)
    app.state.chat_service = build_chat_service(pool, settings)
    app.state.suggestions = build_suggestion_service(pool, settings)
    logger.info("%s ready", settings.app_name)

    try:
        yield
    finally:
        await pool.close()
        logger.info("database pool closed")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.state.settings = settings

    app.include_router(documents.router)
    app.include_router(chat.router)
    app.include_router(tickets.router)

    @app.get("/api/health", response_model=HealthOut, tags=["health"])
    async def health(request: Request) -> HealthOut:
        repository = DocumentRepository(request.app.state.pool)
        document_count, chunk_count = await repository.counts()
        return HealthOut(
            status="ok",
            database="up",
            documents=document_count,
            chunks=chunk_count,
        )

    dist = settings.frontend_dist_path
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
        logger.info("serving frontend from %s", dist)
    else:

        @app.get("/", include_in_schema=False)
        async def missing_frontend() -> dict[str, str]:
            return {
                "message": (
                    "Frontend build not found. Run `pnpm build` in ./frontend "
                    "to generate static assets."
                )
            }

    return app


app = create_app()


def run() -> None:
    """Entry point that starts the API server with uvicorn."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )
