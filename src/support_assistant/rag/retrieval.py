"""Hybrid retrieval: dense (pgvector) + sparse (PostgreSQL full-text)."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from uuid import UUID

from ..config import Settings
from ..models import RetrievedChunk
from ..repositories import DocumentRepository
from .embeddings import get_embeddings
from .reranker import Reranker


class HybridRetriever:
    """Combines vector and keyword search with Reciprocal Rank Fusion (RRF)."""

    def __init__(
        self,
        repository: DocumentRepository,
        embeddings: object,
        reranker: Reranker,
        settings: Settings,
    ) -> None:
        self._repository = repository
        self._embeddings = embeddings
        self._reranker = reranker
        self._settings = settings

    async def aretrieve(
        self,
        query: str,
        top_k: int | None = None,
        document_ids: Sequence[UUID] | None = None,
    ) -> list[RetrievedChunk]:
        """Return the most relevant chunks for ``query``."""
        top_k = top_k or self._settings.retrieval_top_k
        candidates = self._settings.retrieval_candidates

        embedding = await self._embeddings.aembed_query(query)  # type: ignore[attr-defined]
        vector_hits, keyword_hits = await asyncio.gather(
            self._repository.vector_search(embedding, candidates, document_ids),
            self._repository.keyword_search(query, candidates, document_ids),
        )

        vector_hits = [
            hit for hit in vector_hits if hit.score >= self._settings.min_vector_score
        ]
        fused = self._fuse(vector_hits, keyword_hits)
        return await self._reranker.rerank(query, fused, top_k)

    def _fuse(
        self,
        vector_hits: list[RetrievedChunk],
        keyword_hits: list[RetrievedChunk],
    ) -> list[RetrievedChunk]:
        """Reciprocal Rank Fusion of the two ranked lists."""
        k = self._settings.rrf_k
        scores: dict[UUID, float] = {}
        by_id: dict[UUID, RetrievedChunk] = {}

        for rank, hit in enumerate(vector_hits, start=1):
            scores[hit.chunk_id] = scores.get(hit.chunk_id, 0.0) + 1.0 / (k + rank)
            by_id.setdefault(hit.chunk_id, hit).vector_rank = rank

        for rank, hit in enumerate(keyword_hits, start=1):
            scores[hit.chunk_id] = scores.get(hit.chunk_id, 0.0) + 1.0 / (k + rank)
            by_id.setdefault(hit.chunk_id, hit).keyword_rank = rank

        fused: list[RetrievedChunk] = []
        for chunk_id, score in scores.items():
            chunk = by_id[chunk_id]
            chunk.score = score
            fused.append(chunk)

        fused.sort(key=lambda chunk: chunk.score, reverse=True)
        return fused
