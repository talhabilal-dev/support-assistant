"""Application configuration loaded from environment variables / .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """All tunables for the support assistant.

    Values are read from environment variables first, then from a ``.env`` file
    at the project root. Every field has a sane default so the app can boot
    without a fully populated environment.
    """

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Server ---------------------------------------------------------
    app_name: str = "Support Assistant"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"

    # --- Database -------------------------------------------------------
    database_url: str = "postgresql://dev:dev@localhost:5432/support_assistant"
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10

    # --- Models ---------------------------------------------------------
    openai_api_key: str | None = None
    openai_base_url: str | None = None

    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    embedding_batch_size: int = 64

    chat_model: str = "gpt-4o-mini"
    chat_temperature: float = 0.0

    # --- Ingestion ------------------------------------------------------
    chunk_size: int = 1000
    chunk_overlap: int = 200
    max_upload_bytes: int = 20 * 1024 * 1024

    # --- Retrieval (hybrid search) --------------------------------------
    retrieval_candidates: int = 20  # per-arm candidates before fusion
    retrieval_top_k: int = 8  # chunk count returned to the LLM
    rrf_k: int = 60  # Reciprocal Rank Fusion constant
    min_vector_score: float = 0.0  # cosine similarity floor

    # --- Future-proofing (disabled by default) --------------------------
    # Reranker: set enable_reranker=True once a Reranker implementation is
    # registered in support_assistant.rag.reranker.
    enable_reranker: bool = False
    reranker_model: str | None = None
    # Corrective RAG: enables the query-correction node in the graph once a
    # QueryCorrector is registered in support_assistant.rag.crag.
    enable_crag: bool = False
    crag_max_iterations: int = 1

    # --- Support tickets ------------------------------------------------
    enable_ticket_tool: bool = True
    ticket_email_subject: str = "We received your support request"

    # --- Email (Resend) -------------------------------------------------
    resend_api_key: str | None = None
    email_from: str = "Support Assistant <onboarding@resend.dev>"
    email_reply_to: str | None = None

    # --- Frontend -------------------------------------------------------
    frontend_dist: str = "static"

    @property
    def frontend_dist_path(self) -> Path:
        """Absolute path to the built frontend directory."""
        path = Path(self.frontend_dist)
        return path if path.is_absolute() else PROJECT_ROOT / path


@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings."""
    return Settings()
