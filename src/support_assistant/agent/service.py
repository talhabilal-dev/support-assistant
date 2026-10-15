"""Chat orchestration: persists conversations and invokes the RAG graph."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from uuid import UUID

import asyncpg
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage

from ..config import Settings
from ..models import Conversation, ConversationMessage
from ..repositories import (
    ConversationRepository,
    DocumentRepository,
    TicketRepository,
)
from ..schemas import ChatResponse, SourceChunk
from ..rag import (
    HybridRetriever,
    get_chat_model,
    get_corrector,
    get_embeddings,
    get_reranker,
)
from .graph import build_rag_graph, content_to_text
from .state import RAGState
from .tools import build_find_similar_tool, build_ticket_tool


class ChatService:
    """Answers questions by running the compiled RAG graph.

    The server owns conversation history: each turn is persisted and prior
    messages are reloaded, so the whole chat is stored in PostgreSQL.
    """

    def __init__(
        self,
        graph,
        conversations: ConversationRepository,
        settings: Settings,
    ) -> None:
        self._graph = graph
        self._conversations = conversations
        self._settings = settings

    async def answer(
        self,
        message: str,
        conversation_id: UUID | None = None,
        document_ids: list[UUID] | None = None,
    ) -> ChatResponse:
        conversation = await self._resolve_conversation(conversation_id)
        conversation_id = conversation.id

        history = await self._conversations.get_messages(conversation_id)
        await self._conversations.add_message(conversation_id, "user", message)

        state: RAGState = {
            "messages": [self._to_message(item) for item in history]
            + [HumanMessage(content=message)],
            "question": message,
            "conversation_id": conversation_id,
            "document_ids": document_ids,
            "crag_iterations": 0,
        }
        result = await self._graph.ainvoke(state)

        answer = self._final_answer(result.get("messages", []))
        sources = self._used_sources(answer, result.get("documents", []))

        await self._conversations.add_message(
            conversation_id,
            "assistant",
            answer,
            [source.model_dump(mode="json") for source in sources],
        )
        return ChatResponse(
            answer=answer,
            sources=sources,
            conversation_id=conversation_id,
            conversation_code=conversation.code,
        )

    async def stream(
        self,
        message: str,
        conversation_id: UUID | None = None,
        document_ids: list[UUID] | None = None,
    ) -> AsyncIterator[dict]:
        """Stream a chat turn, yielding ``token`` events then a final ``done``."""
        conversation = await self._resolve_conversation(conversation_id)
        conversation_id = conversation.id

        history = await self._conversations.get_messages(conversation_id)
        await self._conversations.add_message(conversation_id, "user", message)

        state: RAGState = {
            "messages": [self._to_message(item) for item in history]
            + [HumanMessage(content=message)],
            "question": message,
            "conversation_id": conversation_id,
            "document_ids": document_ids,
            "crag_iterations": 0,
        }

        parts: list[str] = []
        final_state: dict = {}
        async for mode, payload in self._graph.astream(
            state, stream_mode=["messages", "values"]
        ):
            if mode == "messages":
                chunk, _metadata = payload
                if isinstance(chunk, AIMessageChunk):
                    text = content_to_text(chunk.content)
                    if text:
                        parts.append(text)
                        yield {"event": "token", "data": {"text": text}}
            elif mode == "values":
                final_state = payload

        answer = "".join(parts).strip() or self._final_answer(
            final_state.get("messages", [])
        )
        sources = self._used_sources(answer, final_state.get("documents", []))
        serialized = [source.model_dump(mode="json") for source in sources]

        await self._conversations.add_message(
            conversation_id, "assistant", answer, serialized
        )
        yield {
            "event": "done",
            "data": {
                "answer": answer,
                "sources": serialized,
                "conversation_id": str(conversation_id),
                "conversation_code": conversation.code,
            },
        }

    async def _resolve_conversation(
        self, conversation_id: UUID | None
    ) -> Conversation:
        """Load an existing conversation, or start a new one."""
        if conversation_id is not None:
            existing = await self._conversations.get_conversation(conversation_id)
            if existing is not None:
                return existing
        return await self._conversations.create_conversation()

    _CITATION_RE = re.compile(r"\[([0-9][0-9,\s]*)\]")

    @classmethod
    def _cited_indices(cls, answer: str) -> set[int]:
        """Passage numbers the answer actually cited (e.g. ``[1]``, ``[2, 3]``)."""
        indices: set[int] = set()
        for group in cls._CITATION_RE.findall(answer):
            for part in group.split(","):
                part = part.strip()
                if part.isdigit():
                    indices.add(int(part))
        return indices

    @classmethod
    def _used_sources(cls, answer: str, documents: list) -> list[SourceChunk]:
        """Only the chunks the reply actually referenced (by citation number)."""
        cited = cls._cited_indices(answer)
        chosen = [
            chunk
            for position, chunk in enumerate(documents, start=1)
            if position in cited
        ]
        return cls._build_sources(chosen)

    @staticmethod
    def _build_sources(documents: list) -> list[SourceChunk]:
        return [
            SourceChunk(
                document_id=chunk.document_id,
                chunk_id=chunk.chunk_id,
                filename=chunk.filename,
                score=round(chunk.score, 6),
                content=chunk.content,
            )
            for chunk in documents
        ]

    @staticmethod
    def _final_answer(messages: list[BaseMessage]) -> str:
        """Return the text of the last assistant message (ignoring tool calls)."""
        for message in reversed(messages):
            if isinstance(message, AIMessage) and not getattr(message, "tool_calls", None):
                return content_to_text(message.content)
        return ""

    @staticmethod
    def _to_message(item: ConversationMessage) -> BaseMessage:
        if item.role == "user":
            return HumanMessage(content=item.content)
        return AIMessage(content=item.content)


def build_chat_service(pool: asyncpg.Pool, settings: Settings) -> ChatService:
    """Wire retrieval, tools and generation into a ready-to-use service."""
    documents = DocumentRepository(pool)
    tickets = TicketRepository(pool)
    conversations = ConversationRepository(pool)

    retriever = HybridRetriever(
        repository=documents,
        embeddings=get_embeddings(settings),
        reranker=get_reranker(settings),
        settings=settings,
    )

    tools = []
    if settings.enable_ticket_tool:
        tools = [build_find_similar_tool(tickets), build_ticket_tool(tickets)]

    graph = build_rag_graph(
        settings=settings,
        retriever=retriever,
        llm=get_chat_model(settings),
        corrector=get_corrector(settings),
        tools=tools,
    )
    return ChatService(graph, conversations, settings)
