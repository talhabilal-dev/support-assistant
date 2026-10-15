"""Document ingestion: load -> split -> embed -> store.

Runs as a PgQueuer ``ingest_document`` job, so it is fully decoupled from the
API request that triggered it.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg

from ..config import Settings
from ..log import get_logger
from ..models import DocumentStatus
from ..rag.embeddings import get_embeddings
from ..repositories import DocumentRepository
from .loaders import extract_text
from .splitter import RecursiveCharacterTextSplitter

logger = get_logger(__name__)


async def ingest_document(
    pool: asyncpg.Pool,
    settings: Settings,
    document_id: UUID,
) -> None:
    """Process one uploaded document end to end."""
    repository = DocumentRepository(pool)
    document = await repository.get_document(document_id)
    if document is None:
        logger.warning("ingest: document %s no longer exists, skipping", document_id)
        return

    logger.info("ingest: processing %s (%s)", document_id, document.filename)
    await repository.set_status(document_id, DocumentStatus.PROCESSING, error=None)

    try:
        payload = await repository.get_document_content(document_id)
        if payload is None:
            raise RuntimeError("document content is missing")
        filename, content_type, data = payload

        text = extract_text(filename, content_type, data)
        splitter = RecursiveCharacterTextSplitter(settings.chunk_size, settings.chunk_overlap)
        pieces = splitter.split_text(text)

        if not pieces:
            await repository.replace_chunks(document_id, [])
            await repository.set_status(document_id, DocumentStatus.READY, chunk_count=0)
            logger.warning("ingest: no text extracted from %s", filename)
            return

        embeddings = get_embeddings(settings)
        vectors: list[list[float]] = []
        for start in range(0, len(pieces), settings.embedding_batch_size):
            batch = pieces[start : start + settings.embedding_batch_size]
            vectors.extend(await embeddings.aembed_documents(batch))

        chunks = [
            (uuid4(), index, piece, vectors[index] if index < len(vectors) else None)
            for index, piece in enumerate(pieces)
        ]
        count = await repository.replace_chunks(document_id, chunks)
        await repository.set_status(document_id, DocumentStatus.READY, error=None, chunk_count=count)
        logger.info("ingest: %s ready with %d chunks", document_id, count)
    except Exception as exc:  # noqa: BLE001 - record failure then re-raise for the queue
        logger.exception("ingest: failed for %s", document_id)
        await repository.set_status(document_id, DocumentStatus.FAILED, error=str(exc)[:1000])
        raise
