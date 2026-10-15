"""Short, human-friendly identifiers users can type to resume a conversation."""

from __future__ import annotations

import secrets

# Ambiguous characters (0/o, 1/l/i) are excluded so codes are easy to read back.
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def generate_code(length: int = 10) -> str:
    """Return a random, lowercase, unambiguous code."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))
