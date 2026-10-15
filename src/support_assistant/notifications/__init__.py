"""Notifications (email via Resend)."""

from .email import (
    EmailError,
    ResendEmailSender,
    build_ticket_email,
    build_ticket_reply_email,
    reply_to_address,
)
from .service import send_ticket_email

__all__ = [
    "EmailError",
    "ResendEmailSender",
    "build_ticket_email",
    "build_ticket_reply_email",
    "reply_to_address",
    "send_ticket_email",
]
