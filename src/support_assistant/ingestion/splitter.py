"""A small recursive character text splitter.

``langchain-text-splitters`` is not installed, and no extra package is allowed,
so this reimplements the same recursive character algorithm: try to split on
the largest separator that occurs in the text, recurse into pieces that are
still too big, then merge neighbouring pieces up to ``chunk_size`` while
carrying ``chunk_overlap`` characters of context into the next chunk.
"""

from __future__ import annotations

import re

DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


class RecursiveCharacterTextSplitter:
    """Split text into overlapping chunks, preferring natural boundaries."""

    def __init__(
        self,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
        separators: list[str] | None = None,
    ) -> None:
        if chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or DEFAULT_SEPARATORS

    def split_text(self, text: str) -> list[str]:
        text = text.strip()
        if not text:
            return []
        return [chunk for chunk in self._split(text, self.separators) if chunk.strip()]

    # -- internals ------------------------------------------------------
    def _split(self, text: str, separators: list[str]) -> list[str]:
        final_chunks: list[str] = []

        separator = separators[-1]
        remaining: list[str] = []
        for index, candidate in enumerate(separators):
            if candidate == "":
                separator = candidate
                break
            if candidate in text:
                separator = candidate
                remaining = separators[index + 1 :]
                break

        splits = self._split_with_separator(text, separator)
        good: list[str] = []
        for piece in splits:
            if len(piece) <= self.chunk_size:
                good.append(piece)
            else:
                if good:
                    final_chunks.extend(self._merge(good, separator))
                    good = []
                if remaining:
                    final_chunks.extend(self._split(piece, remaining))
                else:
                    final_chunks.extend(self._hard_split(piece))

        if good:
            final_chunks.extend(self._merge(good, separator))
        return final_chunks

    @staticmethod
    def _split_with_separator(text: str, separator: str) -> list[str]:
        if separator == "":
            return list(text)
        return [piece for piece in re.split(re.escape(separator), text) if piece != ""]

    def _hard_split(self, text: str) -> list[str]:
        size = self.chunk_size
        return [text[i : i + size] for i in range(0, len(text), size)]

    def _merge(self, splits: list[str], separator: str) -> list[str]:
        sep_len = len(separator)
        chunks: list[str] = []
        current: list[str] = []
        total = 0

        for piece in splits:
            piece_len = len(piece)
            extra = sep_len if current else 0
            if total + piece_len + extra > self.chunk_size:
                if current:
                    doc = separator.join(current)
                    if doc.strip():
                        chunks.append(doc)
                    while total > self.chunk_overlap or (
                        total + piece_len + (sep_len if current else 0) > self.chunk_size
                        and total > 0
                    ):
                        total -= len(current[0]) + (sep_len if len(current) > 1 else 0)
                        current.pop(0)
            current.append(piece)
            total += piece_len + (sep_len if len(current) > 1 else 0)

        if current:
            doc = separator.join(current)
            if doc.strip():
                chunks.append(doc)
        return chunks
