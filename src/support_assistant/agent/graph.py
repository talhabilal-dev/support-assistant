"""The LangGraph pipeline: retrieve -> (correct) -> agent <-> tools.

The graph retrieves context (hybrid search) and then runs a tool-calling agent
so the model can create support tickets. The ``correct`` node and its
conditional edges already exist so Corrective RAG can be switched on later
(``ENABLE_CRAG=true``) without reshaping the graph.
"""

from __future__ import annotations

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from ..config import Settings
from ..rag.crag import QueryCorrector
from ..rag.retrieval import HybridRetriever
from .prompts import build_context, build_system_prompt
from .state import RAGState


def content_to_text(content: Any) -> str:
    """Normalise a chat message's content (str or content blocks) to text."""
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content or []:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "".join(parts)


def build_rag_graph(
    *,
    settings: Settings,
    retriever: HybridRetriever,
    llm: BaseChatModel,
    corrector: QueryCorrector,
    tools: list[BaseTool] | None = None,
):
    """Compile and return the RAG + tools graph."""
    tools = tools or []
    model = llm.bind_tools(tools) if tools else llm

    async def retrieve(state: RAGState) -> dict[str, Any]:
        chunks = await retriever.aretrieve(
            state["question"],
            top_k=settings.retrieval_top_k,
            document_ids=state.get("document_ids"),
        )
        return {"documents": chunks, "context": build_context(chunks)}

    async def correct(state: RAGState) -> dict[str, Any]:
        result = await corrector.correct(state["question"], state.get("documents", []))
        return {
            "question": result.query,
            "documents": result.chunks,
            "context": build_context(result.chunks),
            "crag_iterations": state.get("crag_iterations", 0) + 1,
        }

    async def agent(state: RAGState) -> dict[str, Any]:
        system = SystemMessage(content=build_system_prompt(state.get("context", "")))
        response = await model.ainvoke([system, *state["messages"]])
        return {"messages": [response]}

    def route_after_retrieve(_: RAGState) -> str:
        return "correct" if settings.enable_crag else "agent"

    def route_after_correct(state: RAGState) -> str:
        if settings.enable_crag and state.get("crag_iterations", 0) < settings.crag_max_iterations:
            return "retrieve"
        return "agent"

    graph = StateGraph(RAGState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("correct", correct)
    graph.add_node("agent", agent)

    graph.add_edge(START, "retrieve")
    graph.add_conditional_edges(
        "retrieve",
        route_after_retrieve,
        {"correct": "correct", "agent": "agent"},
    )
    graph.add_conditional_edges(
        "correct",
        route_after_correct,
        {"retrieve": "retrieve", "agent": "agent"},
    )

    if tools:
        graph.add_node("tools", ToolNode(tools))
        graph.add_conditional_edges(
            "agent", tools_condition, {"tools": "tools", END: END}
        )
        graph.add_edge("tools", "agent")
    else:
        graph.add_edge("agent", END)

    return graph.compile()
