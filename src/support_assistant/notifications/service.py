"""Background email tasks."""

from __future__ import annotations

import json
from uuid import UUID

import asyncpg

from ..config import Settings
from ..log import get_logger
from ..models import EmailStatus
from ..repositories import TicketRepository
from .email import (
    EmailError,
    ResendEmailSender,
    build_ticket_email,
    build_ticket_reply_email,
    reply_to_address,
)

logger = get_logger(__name__)


def _parse_payload(payload: bytes) -> tuple[UUID, str, str | None]:
    """Decode a job payload: JSON ``{ticket_id, kind, message}`` or a bare id."""
    text = payload.decode().strip()
    if text.startswith("{"):
        data = json.loads(text)
        return UUID(data["ticket_id"]), data.get("kind", "confirmation"), data.get("message")
    return UUID(text), "confirmation", None


async def send_ticket_email(
    pool: asyncpg.Pool,
    settings: Settings,
    payload: bytes,
) -> None:
    """Send a ticket email — a confirmation or an owner reply — as a queued job."""
    ticket_id, kind, message = _parse_payload(payload)
    tickets = TicketRepository(pool)
    ticket = await tickets.get_ticket(ticket_id)
    if ticket is None:
        logger.warning("email: ticket %s no longer exists, skipping", ticket_id)
        return

    if not ticket.email:
        await tickets.set_email_status(
            ticket_id, EmailStatus.FAILED, "ticket has no email address"
        )
        logger.warning("email: ticket %s has no email address", ticket_id)
        return

    if kind == "reply":
        subject, html, text = build_ticket_reply_email(ticket, message or "", settings)
    else:
        subject, html, text = build_ticket_email(ticket, settings)

    sender = ResendEmailSender(
        api_key=settings.resend_api_key,
        sender=settings.email_from,
        reply_to=reply_to_address(settings),
    )

    try:
        message_id = await sender.send(
            to=ticket.email, subject=subject, html=html, text=text
        )
    except EmailError as exc:
        # Do not re-raise: retrying could send duplicates. Record the failure.
        await tickets.set_email_status(ticket_id, EmailStatus.FAILED, str(exc)[:500])
        logger.error("email: ticket %s failed: %s", ticket_id, exc)
        return

    await tickets.set_email_status(ticket_id, EmailStatus.SENT, None)
    logger.info(
        "email: ticket %s %s sent to %s (%s)",
        ticket_id,
        kind,
        ticket.email,
        message_id,
    )
