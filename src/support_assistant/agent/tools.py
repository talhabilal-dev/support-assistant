"""Agent tools.

The ticket tool lets the model turn a conversation into a stored support
ticket: it summarises the conversation and names the real pain point. It
refuses to log a second, similar ticket for the same chat, so asking the same
thing again never creates a duplicate (or a second email).
"""

from __future__ import annotations

import re
from typing import Annotated

from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import InjectedState

from ..log import get_logger
from ..repositories import TicketRepository

logger = get_logger(__name__)

# Below this token-overlap ratio a new question is treated as a different issue.
DUPLICATE_THRESHOLD = 0.4

_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "you", "your", "are", "was",
    "were", "have", "has", "had", "not", "but", "can", "could", "would",
    "should", "about", "into", "from", "they", "them", "their", "what", "when",
    "where", "which", "how", "why", "does", "did", "doing", "its", "of", "to",
    "in", "on", "is", "be", "or", "as", "at", "by", "we", "my", "me", "our",
    "us", "do", "if", "so", "no", "yes", "please", "need", "needs", "want",
    "wants", "get", "got", "any", "all", "there", "here", "also", "just",
}


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {word for word in words if len(word) > 2 and word not in _STOPWORDS}


def _similarity(left: str, right: str) -> float:
    """Token-overlap (Jaccard) similarity between two pieces of text."""
    left_tokens, right_tokens = _tokens(left), _tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def _describe(ticket) -> str:
    return (
        f"ticket {str(ticket.id)[:8]} "
        f"(status: {ticket.status}, email: {ticket.email_status})"
    )


def build_ticket_tool(tickets: TicketRepository) -> BaseTool:
    """Build the ``create_support_ticket`` tool bound to the ticket store."""

    @tool
    async def create_support_ticket(
        summary: str,
        pain_point: str,
        email: str | None = None,
        state: Annotated[dict, InjectedState] = None,
    ) -> str:
        """Save the user's query for the support owner.

        Call this ONLY after the user has agreed to have their question
        forwarded. Never call it before asking, or before the user replies.

        This will NOT create a duplicate: if this chat already has a similar
        request logged, nothing new is stored (and no second email is sent).

        Args:
            summary: A concise summary of the entire conversation.
            pain_point: The single most important underlying question or
                problem the user faces (the real pain point).
            email: The user's email address if they provided one. Omit it if
                they declined or skipped — the query is saved either way.
        """
        conversation_id = (state or {}).get("conversation_id")

        if conversation_id is not None:
            candidate = f"{summary} {pain_point}"
            for prior in await tickets.find_for_conversation(conversation_id):
                if _similarity(candidate, f"{prior.summary} {prior.pain_point}") >= DUPLICATE_THRESHOLD:
                    logger.info(
                        "ticket: skipping duplicate for conversation %s (existing %s)",
                        conversation_id,
                        prior.id,
                    )
                    return (
                        f"This chat already has a similar request logged — {_describe(prior)}. "
                        f"I did not store a duplicate and no new email was sent. "
                        f"Tell the user their request is already with the support owner."
                    )

        ticket = await tickets.create_ticket(
            conversation_id=conversation_id,
            email=email,
            summary=summary,
            pain_point=pain_point,
        )
        logger.info("ticket %s created for conversation %s", ticket.id, conversation_id)

        if email:
            follow_up = f"A reply will be sent to {email}."
        else:
            follow_up = "No email was provided, so the query was saved without one."
        return f"Support ticket {ticket.id} created. {follow_up}"

    return create_support_ticket


def build_find_similar_tool(tickets: TicketRepository) -> BaseTool:
    """Build the ``find_similar_questions`` tool bound to the ticket store."""

    @tool
    async def find_similar_questions(
        question: str,
        state: Annotated[dict, InjectedState] = None,
    ) -> str:
        """Read existing support tickets to find a similar question.

        Use this when the user asks something that may already have been asked,
        or wants to follow up on a previous request — including earlier in this
        same chat. If a similar request exists, tell the user about it (with its
        reference) instead of opening a duplicate.

        Args:
            question: The user's question or the pain point to look for.
        """
        matches = await tickets.find_similar(question, limit=3)
        if not matches:
            return "No similar questions found."

        lines = [f"- {_describe(ticket)}: {ticket.pain_point}" for ticket in matches]
        return "Similar existing questions:\n" + "\n".join(lines)

    return find_similar_questions
