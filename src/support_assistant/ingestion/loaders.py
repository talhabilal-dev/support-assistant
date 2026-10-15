"""Extract plain text from uploaded files.

Only the formats we can parse with already-installed dependencies are
supported: PDF via ``pypdf`` and plain text / Markdown directly.
"""

from __future__ import annotations

import io

from pypdf import PdfReader

SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".md", ".markdown", ".text"}

_TEXT_CONTENT_TYPES = {"text/plain", "text/markdown", "text/x-markdown"}


class UnsupportedDocumentError(ValueError):
    """Raised when an uploaded file has an unsupported type."""


def extension_of(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot != -1 else ""


def is_supported(filename: str, content_type: str | None) -> bool:
    if extension_of(filename) in SUPPORTED_EXTENSIONS:
        return True
    return bool(content_type) and content_type.split(";")[0].strip() in _TEXT_CONTENT_TYPES


def extract_text(filename: str, content_type: str | None, data: bytes) -> str:
    """Return the text content of a supported file, or raise if unsupported."""
    extension = extension_of(filename)
    normalized_type = (content_type or "").split(";")[0].strip()

    if extension == ".pdf" or normalized_type == "application/pdf":
        return _extract_pdf(data)
    if extension in SUPPORTED_EXTENSIONS or normalized_type in _TEXT_CONTENT_TYPES:
        return data.decode("utf-8", errors="replace")
    raise UnsupportedDocumentError(
        f"Unsupported file type {filename!r}. Supported: PDF, TXT, MD."
    )


def _extract_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n\n".join(pages)
