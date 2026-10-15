"""Chat endpoints backed by the RAG graph."""

from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..schemas import ChatRequest, ChatResponse, SuggestionsOut
from .deps import ChatServiceDep, SuggestionServiceDep

router = APIRouter(prefix="/api", tags=["chat"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, service: ChatServiceDep) -> ChatResponse:
    """Answer a question using hybrid retrieval over the uploaded documents."""
    return await service.answer(
        payload.message, payload.conversation_id, payload.document_ids
    )


@router.get("/suggestions", response_model=SuggestionsOut)
async def suggestions(
    service: SuggestionServiceDep, limit: int = 3
) -> SuggestionsOut:
    """Starter questions the documents can answer (for the empty chat state)."""
    return SuggestionsOut(suggestions=await service.suggest(limit))


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, service: ChatServiceDep) -> StreamingResponse:
    """Stream the answer as Server-Sent Events (``token`` events, then ``done``)."""

    async def event_source():
        try:
            async for event in service.stream(
                payload.message, payload.conversation_id, payload.document_ids
            ):
                yield _sse(event["event"], event["data"])
        except Exception as exc:  # noqa: BLE001 - surface the error to the client
            yield _sse("error", {"message": str(exc)})

    return StreamingResponse(
        event_source(), media_type="text/event-stream", headers=_SSE_HEADERS
    )
