"""Factories for the embedding and chat models (LangChain OpenAI)."""

from __future__ import annotations

from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from ..config import Settings


def _openai_kwargs(settings: Settings) -> dict[str, object]:
    kwargs: dict[str, object] = {}
    if settings.openai_api_key:
        kwargs["api_key"] = settings.openai_api_key
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    return kwargs


def get_embeddings(settings: Settings) -> OpenAIEmbeddings:
    """Build the embedding model. ``dimensions`` only applies to v3 models."""
    kwargs = _openai_kwargs(settings)
    kwargs["model"] = settings.embedding_model
    if settings.embedding_model.startswith("text-embedding-3"):
        kwargs["dimensions"] = settings.embedding_dimensions
    return OpenAIEmbeddings(**kwargs)


def get_chat_model(settings: Settings) -> ChatOpenAI:
    """Build the chat model used for answer generation."""
    kwargs = _openai_kwargs(settings)
    kwargs["model"] = settings.chat_model
    kwargs["temperature"] = settings.chat_temperature
    return ChatOpenAI(**kwargs)
