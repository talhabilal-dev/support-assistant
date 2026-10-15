"""Support Assistant — a RAG-based assistant over your uploaded documents."""

from __future__ import annotations

import argparse


def main(argv: list[str] | None = None) -> None:
    """CLI entry point. Dispatches to the API server or the job worker."""
    parser = argparse.ArgumentParser(
        prog="support-assistant",
        description="Support Assistant (RAG): API server and background worker.",
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="api",
        choices=["api", "worker"],
        help="'api' runs the FastAPI server (default); 'worker' runs the PgQueuer worker.",
    )
    args = parser.parse_args(argv)

    if args.command == "worker":
        from .jobs.worker import main as worker_main

        worker_main()
    else:
        from .api.app import run as run_api

        run_api()
