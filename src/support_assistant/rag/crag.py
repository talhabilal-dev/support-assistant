"""Corrective RAG (CRAG) seam.

CRAG evaluates retrieved context and, when it is weak, rewrites the query and
retrieves again (optionally falling back to a web search). None of that is
implemented yet — this module only defines the extension point that the graph
already routes through when ``ENABLE_CRAG=true``.

To add CRAG:

1. Implement a class with
   ``async def correct(query, chunks) -> CorrectionResult``.
2. Register it in ``get_corrector`` below.
3. Set ``ENABLE_CRAG=true``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from ..config import Settings
from ..models import RetrievedChunk


@dataclass(slots=True)
class CorrectionResult:
    """Outcome of a correction step: a (possibly rewritten) query and chunks."""

    query: str
    chunks: list[RetrievedChunk]


@runtime_checkable
class QueryCorrector(Protocol):
    """Contract for a CRAG correction step."""

    async def correct(self, query: str, chunks: list[RetrievedChunk]) -> CorrectionResult: ...


class NoOpQueryCorrector:
    """Default: returns the query and context unchanged."""

    async def correct(self, query: str, chunks: list[RetrievedChunk]) -> CorrectionResult:
        return CorrectionResult(query=query, chunks=chunks)


def get_corrector(settings: Settings) -> QueryCorrector:
    """Return the configured CRAG corrector."""
    if settings.enable_crag:
        raise NotImplementedError(
            "ENABLE_CRAG is set but no QueryCorrector is registered. "
            "Implement one in support_assistant/rag/crag.py."
        )
    return NoOpQueryCorrector()
