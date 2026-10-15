"""PgQueuer worker process.

Run with ``python -m support_assistant worker`` (or the ``support-assistant
worker`` script). It processes the background jobs:

* ``ingest_document`` — chunk + embed uploaded documents
* ``send_ticket_email`` — send a ticket follow-up email via Resend
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from pgqueuer import PgQueuer
from pgqueuer.models import Job

from ..config import get_settings
from ..db import create_pool, init_schema
from ..ingestion import ingest_document
from ..log import get_logger, setup_logging
from ..notifications import send_ticket_email
from .queue import INGEST_DOCUMENT, SEND_TICKET_EMAIL, install_queue_schema

logger = get_logger(__name__)


async def run_worker() -> None:
    settings = get_settings()
    setup_logging(settings.log_level)

    pool = await create_pool(settings)
    try:
        await init_schema(pool, settings)
        await install_queue_schema(pool)

        pgqueuer = PgQueuer.from_asyncpg_pool(pool)

        @pgqueuer.entrypoint(INGEST_DOCUMENT)
        async def _ingest(job: Job) -> None:
            await ingest_document(pool, settings, UUID(job.payload.decode()))

        @pgqueuer.entrypoint(SEND_TICKET_EMAIL)
        async def _send_email(job: Job) -> None:
            await send_ticket_email(pool, settings, job.payload)

        logger.info(
            "worker started, listening for '%s' and '%s' jobs",
            INGEST_DOCUMENT,
            SEND_TICKET_EMAIL,
        )
        await pgqueuer.run()
    finally:
        await pool.close()


def main() -> None:
    asyncio.run(run_worker())
