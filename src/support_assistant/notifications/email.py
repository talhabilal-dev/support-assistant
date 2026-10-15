"""Email sending via Resend.

Uses Resend's REST API through ``httpx`` (already a dependency) so no extra
package is required. Swap in the official ``resend`` SDK later if you prefer.
"""

from __future__ import annotations

import re

import httpx

from ..config import Settings
from ..log import get_logger
from ..models import Ticket

logger = get_logger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"


class EmailError(RuntimeError):
    """Raised when Resend rejects a send request."""


class ResendEmailSender:
    def __init__(
        self,
        api_key: str | None,
        sender: str,
        reply_to: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self._api_key = api_key
        self._sender = sender
        self._reply_to = reply_to
        self._timeout = timeout

    async def send(
        self,
        *,
        to: str,
        subject: str,
        html: str,
        text: str | None = None,
    ) -> str:
        """Send an email. Returns the Resend message id."""
        if not self._api_key:
            raise EmailError("RESEND_API_KEY is not configured")

        payload: dict[str, object] = {
            "from": self._sender,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        if text:
            payload["text"] = text
        if self._reply_to:
            payload["reply_to"] = self._reply_to

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
            )

        if response.status_code >= 400:
            raise EmailError(
                f"Resend API error {response.status_code}: {response.text[:300]}"
            )
        return str(response.json().get("id", ""))


def reply_to_address(settings: Settings) -> str | None:
    """Where a user's reply should land (falls back to the From address)."""
    if settings.email_reply_to:
        return settings.email_reply_to
    match = re.search(r"<([^>]+)>", settings.email_from or "")
    if match:
        return match.group(1)
    return settings.email_from or None


def _escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _paragraph(value: str) -> str:
    return _escape(value).replace("\n", "<br>")


def _wrap_html(title: str, body: str) -> str:
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;background:#0b0b12;font-family:Inter,Arial,sans-serif;color:#e9e8f2;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <h1 style="font-size:20px;margin:0 0 16px;">{_escape(title)}</h1>
      {body}
      <p style="color:#a8a4bd;line-height:1.6;margin:20px 0 0;font-size:14px;">
        You can reply directly to this email and your message will reach our support team.
      </p>
    </div>
  </body>
</html>
"""


def build_ticket_email(ticket: Ticket, settings: Settings) -> tuple[str, str, str]:
    """Return ``(subject, html, text)`` for the confirmation email."""
    reference = str(ticket.id).split("-")[0].upper()

    text = (
        f"Thanks for reaching out.\n\n"
        f"We have logged your request (reference #{reference}).\n\n"
        f"Summary: {ticket.summary}\n\n"
        f"Main issue: {ticket.pain_point}\n\n"
        f"Our support team will follow up shortly. You can reply to this email.\n"
    )

    body = f"""\
      <p style="color:#a8a4bd;line-height:1.6;margin:0 0 20px;">
        Thanks for reaching out. We have logged your request (reference
        <strong style="color:#c9b8ff;">#{reference}</strong>).
      </p>
      <div style="background:#161523;border:1px solid #2a2940;border-radius:12px;padding:18px 20px;margin-bottom:16px;">
        <p style="margin:0 0 8px;color:#8f8ba8;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Summary</p>
        <p style="margin:0 0 16px;line-height:1.6;">{_paragraph(ticket.summary)}</p>
        <p style="margin:0 0 8px;color:#8f8ba8;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Main issue</p>
        <p style="margin:0;line-height:1.6;">{_paragraph(ticket.pain_point)}</p>
      </div>
      <p style="color:#a8a4bd;line-height:1.6;margin:0;">Our support team will follow up shortly.</p>
"""
    return (
        settings.ticket_email_subject,
        _wrap_html("We received your support request", body),
        text,
    )


def build_ticket_reply_email(
    ticket: Ticket, message: str, settings: Settings
) -> tuple[str, str, str]:
    """Return ``(subject, html, text)`` for a reply from the support owner."""
    reference = str(ticket.id).split("-")[0].upper()
    subject = f"Re: your support request #{reference}"

    text = f"{message}\n\n---\nYour original question: {ticket.pain_point}\n"

    body = f"""\
      <p style="color:#e9e8f2;line-height:1.7;margin:0 0 20px;">{_paragraph(message)}</p>
      <div style="background:#161523;border:1px solid #2a2940;border-radius:12px;padding:18px 20px;">
        <p style="margin:0 0 8px;color:#8f8ba8;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Your original question</p>
        <p style="margin:0;line-height:1.6;color:#c8c5da;">{_paragraph(ticket.pain_point)}</p>
      </div>
"""
    return subject, _wrap_html(subject, body), text
