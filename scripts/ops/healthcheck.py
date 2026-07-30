#!/usr/bin/env python3
"""Check production containers, SQLite integrity, and the latest crawler run."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_compose_status(output: str) -> list[str]:
    services: dict[str, str] = {}
    stripped = output.strip()
    if stripped:
        try:
            decoded = json.loads(stripped)
            records = decoded if isinstance(decoded, list) else [decoded]
        except json.JSONDecodeError:
            records = [json.loads(line) for line in stripped.splitlines() if line.strip()]
        for record in records:
            if isinstance(record, dict):
                service = record.get("Service")
                state = record.get("State")
                if isinstance(service, str) and isinstance(state, str):
                    services[service] = state.lower()

    return [
        f"{service} service is not running"
        for service in ("web", "crawler")
        if services.get(service) != "running"
    ]


def check_database(database_path: Path) -> list[str]:
    if not database_path.is_file() or database_path.is_symlink():
        return ["production database is missing"]
    try:
        connection = sqlite3.connect(database_path.as_uri() + "?mode=ro", uri=True, timeout=10)
        try:
            result = connection.execute("PRAGMA quick_check").fetchall()
        finally:
            connection.close()
    except sqlite3.Error:
        return ["production database could not be checked"]
    return [] if result == [("ok",)] else ["production database integrity check failed"]


def check_crawler_state(
    state: Any,
    *,
    now: datetime | None = None,
    max_success_age: timedelta = timedelta(hours=30),
    max_running_age: timedelta = timedelta(hours=3),
) -> list[str]:
    if not isinstance(state, dict):
        return ["crawler run state is missing or invalid"]
    current_time = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    run_status = state.get("runStatus")
    if run_status == "failed":
        return ["latest crawler run failed"]
    if run_status == "running":
        started_at = _parse_datetime(state.get("startedAt"))
        if started_at is None:
            return ["crawler running timestamp is invalid"]
        return ["crawler run is stuck"] if current_time - started_at > max_running_age else []
    if run_status == "success":
        finished_at = _parse_datetime(state.get("finishedAt"))
        if finished_at is None:
            return ["crawler completion timestamp is invalid"]
        return ["latest crawler run is stale"] if current_time - finished_at > max_success_age else []
    return ["crawler run status is invalid"]


def _read_crawler_state(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def run_healthcheck(base_directory: Path) -> list[str]:
    errors: list[str] = []
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            cwd=base_directory,
            check=True,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
        )
        errors.extend(parse_compose_status(result.stdout))
    except (FileNotFoundError, subprocess.CalledProcessError, json.JSONDecodeError):
        errors.append("Docker Compose service status could not be checked")

    errors.extend(check_database(base_directory / "data/moneyforward.db"))
    errors.extend(
        check_crawler_state(_read_crawler_state(base_directory / "data/crawler-run-state.json"))
    )
    return errors


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-directory",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    errors = run_healthcheck(args.base_directory.resolve())
    if errors:
        for error in errors:
            print(f"Health check failed: {error}", file=sys.stderr)
        return 1
    print("Health check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
