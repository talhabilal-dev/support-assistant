"""Support ticket and conversation endpoints."""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from ..models import EmailStatus
from ..schemas import (
    ConversationMessageOut,
    ConversationOut,
    TicketEmailRequest,
    TicketListOut,
    TicketOut,
    TicketReplyRequest,
)
from .deps import ConversationRepositoryDep, QueueDep, TicketRepositoryDep

router = APIRouter(prefix="/api", tags=["tickets"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.get("/tickets", response_model=TicketListOut)
async def list_tickets(tickets: TicketRepositoryDep) -> TicketListOut:
    found = await tickets.list_tickets()
    return TicketListOut(tickets=[TicketOut.model_validate(ticket) for ticket in found])


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
async def get_ticket(ticket_id: UUID, tickets: TicketRepositoryDep) -> TicketOut:
    ticket = await tickets.get_ticket(ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    return TicketOut.model_validate(ticket)


@router.post(
    "/tickets/{ticket_id}/email",
    response_model=TicketOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def email_ticket(
    ticket_id: UUID,
    payload: TicketEmailRequest,
    tickets: TicketRepositoryDep,
    queue: QueueDep,
) -> TicketOut:
    """Queue a follow-up email for a ticket (sent by the background worker)."""
    ticket = await tickets.get_ticket(ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")

    email = (payload.email or ticket.email or "").strip()
    if not _EMAIL_RE.match(email):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A valid recipient email address is required.",
        )

    await tickets.set_email(ticket_id, email, EmailStatus.QUEUED)
    await queue.enqueue_ticket_email(ticket_id)
    updated = await tickets.get_ticket(ticket_id)
    return TicketOut.model_validate(updated)


@router.post(
    "/tickets/{ticket_id}/reply",
    response_model=TicketOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def reply_ticket(
    ticket_id: UUID,
    payload: TicketReplyRequest,
    tickets: TicketRepositoryDep,
    queue: QueueDep,
) -> TicketOut:
    """Record an owner reply and queue it as an email to the user."""
    ticket = await tickets.get_ticket(ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")
    if not ticket.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This ticket has no email address to reply to.",
        )

    body = payload.message.strip()
    await tickets.add_reply(ticket_id, body)
    await tickets.set_email_status(ticket_id, EmailStatus.QUEUED)
    await queue.enqueue_ticket_reply(ticket_id, body)

    updated = await tickets.get_ticket(ticket_id)
    return TicketOut.model_validate(updated)


def _conversation_out(conversation, messages) -> ConversationOut:
    return ConversationOut(
        conversation_id=conversation.id,
        code=conversation.code,
        messages=[
            ConversationMessageOut.model_validate(message) for message in messages
        ],
    )


@router.get("/conversations/code/{code}", response_model=ConversationOut)
async def get_conversation_by_code(
    code: str,
    conversations: ConversationRepositoryDep,
) -> ConversationOut:
    """Resume a conversation from the code handed to the user at the start."""
    conversation = await conversations.get_conversation_by_code(code)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    messages = await conversations.get_messages(conversation.id)
    return _conversation_out(conversation, messages)


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: UUID,
    conversations: ConversationRepositoryDep,
) -> ConversationOut:
    conversation = await conversations.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    messages = await conversations.get_messages(conversation_id)
    return _conversation_out(conversation, messages)
