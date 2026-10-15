"""Suggested starter questions derived from the documents.

On a new chat the UI offers a few questions the knowledge base can actually
answer. We sample a couple of chunks and ask the model to phrase questions
from them.
"""

from __future__ import annotations

import re

import asyncpg

from ..config import Settings
from ..log import get_logger
from ..rag.embeddings import get_chat_model
from ..repositories import DocumentRepository
from .graph import content_to_text

logger = get_logger(__name__)

PROMPT = """You write starter questions for a support knowledge base.

Excerpts from the documentation:

{excerpts}

Write {count} short, distinct questions that a user could ask and that these \
excerpts would answer.

Rules:
- One question per line.
- No numbering, bullets, quotes, or extra commentary.
- Keep each under 12 words."""

_LIST_PREFIX_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")


class SuggestionService:
    """Generates a handful of answerable questions from the documents."""

    def __init__(
        self,
        repository: DocumentRepository,
        llm: object,
        settings: Settings,
    ) -> None:
        self._repository = repository
        self._llm = llm
        self._settings = settings

    async def suggest(self, count: int = 3) -> list[str]:
        chunks = await self._repository.sample_chunks(count)
        if not chunks:
            return []

        excerpts = "\n\n".join(
            f"- ({filename}) {content[:600]}" for content, filename in chunks
        )
        try:
            response = await self._llm.ainvoke(  # type: ignore[attr-defined]
                PROMPT.format(excerpts=excerpts, count=count)
            )
        except Exception as exc:  # noqa: BLE001 - suggestions are best-effort
            logger.warning("suggestions: generation failed: %s", exc)
            return []
        return _parse_questions(content_to_text(response.content), count)


def _parse_questions(text: str, count: int) -> list[str]:
    questions: list[str] = []
    seen: set[str] = set()
    for line in text.splitlines():
        cleaned = _LIST_PREFIX_RE.sub("", line).strip().strip('"').strip()
        if len(cleaned) < 4:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        questions.append(cleaned)
        if len(questions) >= count:
            break
    return questions


def build_suggestion_service(pool: asyncpg.Pool, settings: Settings) -> SuggestionService:
    return SuggestionService(
        repository=DocumentRepository(pool),
        llm=get_chat_model(settings),
        settings=settings,
    )
