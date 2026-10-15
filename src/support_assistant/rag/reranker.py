"""Re-ranker seam.

A re-ranker reorders the fused hybrid-search candidates before they reach the
LLM. It is intentionally *not* implemented yet. To add one:

1. Implement a class with ``async def rerank(query, chunks, top_k) -> list[RetrievedChunk]``.
2. Register it in ``get_reranker`` below.
3. Set ``ENABLE_RERANKER=true`` (and, if needed, ``RERANKER_MODEL``).

The rest of the pipeline already calls through this interface, so no other
code needs to change.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..config import Settings
from ..models import RetrievedChunk


@runtime_checkable
class Reranker(Protocol):
    """Contract for a candidate re-ranker."""

    async def rerank(
        self,
        query: str,
        chunks: list[RetrievedChunk],
        top_k: int,
    ) -> list[RetrievedChunk]: ...


class NoOpReranker:
    """Default: preserves hybrid-search order and simply truncates to ``top_k``."""

    async def rerank(
        self,
        query: str,
        chunks: list[RetrievedChunk],
        top_k: int,
    ) -> list[RetrievedChunk]:
        return chunks[:top_k]


def get_reranker(settings: Settings) -> Reranker:
    """Return the configured re-ranker."""
    if settings.enable_reranker:
        raise NotImplementedError(
            "ENABLE_RERANKER is set but no Reranker is registered. "
            "Implement one in support_assistant/rag/reranker.py."
        )
    return NoOpReranker()
