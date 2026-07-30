#!/usr/bin/env python3
"""Send a generic operational failure alert without exposing local details."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NotificationError(RuntimeError):
    """Raised when an alert cannot be sent safely."""


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def build_payload(webhook_url: str, event: str) -> bytes:
    parsed = urlparse(webhook_url)
    safe_event = event if re.fullmatch(r"[A-Za-z0-9_.@:-]{1,128}", event) else "operation"
    message = f"mf-dashboard operation failed: {safe_event}"

    if parsed.scheme != "https":
        raise NotificationError("webhook must use HTTPS")
    if parsed.hostname in {"discord.com", "www.discord.com"} and parsed.path.startswith(
        "/api/webhooks/"
    ):
        payload = {"content": message, "allowed_mentions": {"parse": []}}
    elif parsed.hostname == "hooks.slack.com" and parsed.path.startswith("/services/"):
        payload = {"text": message}
    else:
        raise NotificationError("only Discord or Slack incoming webhooks are supported")
    return json.dumps(payload).encode("utf-8")


def _read_webhook_url(webhook_file: Path) -> str:
    if not webhook_file.is_file() or webhook_file.is_symlink():
        raise NotificationError("webhook file is missing or is not a regular file")
    file_stat = webhook_file.stat()
    if os.name == "posix" and (
        file_stat.st_uid != os.getuid() or stat.S_IMODE(file_stat.st_mode) & 0o077
    ):
        raise NotificationError("webhook file must be owner-only")
    if file_stat.st_size > 4096:
        raise NotificationError("webhook file is unexpectedly large")
    return webhook_file.read_text(encoding="utf-8").strip()


def send_notification(webhook_file: Path, event: str) -> None:
    webhook_url = _read_webhook_url(webhook_file)
    payload = build_payload(webhook_url, event)
    request = Request(
        webhook_url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "mf-dashboard-ops/1"},
        method="POST",
    )
    try:
        with build_opener(_RejectRedirects).open(request, timeout=10) as response:
            if not 200 <= response.status < 300:
                raise NotificationError("webhook returned a non-success status")
    except (OSError, URLError) as error:
        raise NotificationError("webhook request failed") from error


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--webhook-file", type=Path, required=True)
    parser.add_argument("--event", default="operation")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        send_notification(args.webhook_file.resolve(), args.event)
    except (NotificationError, OSError) as error:
        print(f"Failure notification was not sent: {error}", file=sys.stderr)
        return 1
    print("Failure notification sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
