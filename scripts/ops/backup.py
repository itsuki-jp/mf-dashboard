#!/usr/bin/env python3
"""Create an encrypted, integrity-checked mf-dashboard backup bundle."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable


class BackupError(RuntimeError):
    """Raised when a safe backup cannot be completed."""


@dataclass(frozen=True)
class BackupConfig:
    base_directory: Path
    database_path: Path
    profiles_path: Path
    compose_path: Path
    crawler_state_path: Path
    destination: Path
    public_key_path: Path
    retention_days: int = 14


EncryptFunction = Callable[[Path, Path, Path], None]


def _require_regular_file(path: Path, label: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise BackupError(f"{label} is missing or is not a regular file")


def _require_completed_crawler_run(path: Path) -> tuple[str, str]:
    _require_regular_file(path, "crawler run state")
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BackupError("crawler run state is invalid") from error
    if not isinstance(state, dict) or state.get("runStatus") != "success":
        raise BackupError("latest crawler run has not completed successfully")
    run_id = state.get("runId")
    finished_at = state.get("finishedAt")
    if not isinstance(run_id, str) or not run_id or not isinstance(finished_at, str):
        raise BackupError("crawler run state is invalid")
    return run_id, finished_at


def _create_consistent_database_backup(source: Path, destination: Path) -> None:
    source_uri = source.resolve().as_uri() + "?mode=ro"
    source_connection = sqlite3.connect(source_uri, uri=True, timeout=10)
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.backup(destination_connection)
        result = destination_connection.execute("PRAGMA integrity_check").fetchall()
        if result != [("ok",)]:
            raise BackupError("SQLite integrity check failed")
    finally:
        destination_connection.close()
        source_connection.close()


def _create_archive(
    archive_path: Path,
    database_path: Path,
    profiles_path: Path,
    compose_path: Path,
    created_at: datetime,
) -> None:
    metadata_path = archive_path.parent / "metadata.json"
    metadata_path.write_text(
        json.dumps(
            {
                "formatVersion": 1,
                "createdAt": created_at.isoformat(),
                "database": "data/moneyforward.db",
                "profiles": "config/money-forward-profiles.json",
                "compose": "compose.yml",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    os.chmod(metadata_path, 0o600)

    with tarfile.open(archive_path, "w") as archive:
        archive.add(database_path, arcname="data/moneyforward.db", recursive=False)
        archive.add(
            profiles_path,
            arcname="config/money-forward-profiles.json",
            recursive=False,
        )
        archive.add(compose_path, arcname="compose.yml", recursive=False)
        archive.add(metadata_path, arcname="metadata.json", recursive=False)


def encrypt_with_gpg(source: Path, destination: Path, public_key_path: Path) -> None:
    """Encrypt with one public key in an isolated temporary GnuPG home."""

    with tempfile.TemporaryDirectory(prefix="mf-dashboard-gpg-") as temporary_home:
        home = Path(temporary_home)
        os.chmod(home, 0o700)
        base_command = ["gpg", "--batch", "--no-options", "--homedir", str(home)]
        try:
            subprocess.run(
                [*base_command, "--quiet", "--import", str(public_key_path)],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            key_listing = subprocess.run(
                [*base_command, "--with-colons", "--list-keys"],
                check=True,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
            ).stdout
        except (FileNotFoundError, subprocess.CalledProcessError) as error:
            raise BackupError("GnuPG public-key validation failed") from error

        fingerprints: list[str] = []
        awaiting_primary_fingerprint = False
        for line in key_listing.splitlines():
            fields = line.split(":")
            if line.startswith("pub:"):
                awaiting_primary_fingerprint = True
            elif awaiting_primary_fingerprint and line.startswith("fpr:") and len(fields) > 9:
                fingerprints.append(fields[9])
                awaiting_primary_fingerprint = False
        if len(fingerprints) != 1:
            raise BackupError("backup public-key file must contain exactly one key")

        try:
            subprocess.run(
                [
                    *base_command,
                    "--quiet",
                    "--trust-model",
                    "always",
                    "--compress-algo",
                    "none",
                    "--recipient",
                    fingerprints[0],
                    "--output",
                    str(destination),
                    "--encrypt",
                    str(source),
                ],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (FileNotFoundError, subprocess.CalledProcessError) as error:
            raise BackupError("GnuPG backup encryption failed") from error


def _prune_expired_backups(
    destination: Path, current_backup: Path, now: datetime, retention_days: int
) -> None:
    cutoff = now - timedelta(days=retention_days)
    for candidate in destination.glob("mf-dashboard-*.tar.gpg"):
        if candidate == current_backup or candidate.is_symlink() or not candidate.is_file():
            continue
        modified = datetime.fromtimestamp(candidate.stat().st_mtime, tz=now.tzinfo)
        if modified < cutoff:
            candidate.unlink()


def create_backup(
    config: BackupConfig,
    *,
    now: datetime | None = None,
    encrypt: EncryptFunction = encrypt_with_gpg,
) -> Path:
    """Create an encrypted backup atomically and return its final path."""

    if config.retention_days < 1:
        raise BackupError("retention_days must be at least 1")
    _require_regular_file(config.database_path, "database")
    _require_regular_file(config.profiles_path, "profile configuration")
    _require_regular_file(config.compose_path, "Compose configuration")
    _require_regular_file(config.public_key_path, "backup public key")
    crawler_run = _require_completed_crawler_run(config.crawler_state_path)

    created_at = now or datetime.now().astimezone()
    config.destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(config.destination, 0o700)
    final_path = config.destination / f"mf-dashboard-{created_at:%Y%m%d-%H%M%S}.tar.gpg"
    partial_path = final_path.with_name(f".{final_path.name}.{os.getpid()}.tmp")

    if final_path.exists():
        raise BackupError("a backup with the same timestamp already exists")

    try:
        runtime_directory = os.environ.get("XDG_RUNTIME_DIR")
        temporary_root = Path(runtime_directory) if runtime_directory else None
        if temporary_root is not None:
            runtime_stat = temporary_root.stat()
            if (
                not temporary_root.is_dir()
                or temporary_root.is_symlink()
                or (os.name == "posix" and runtime_stat.st_uid != os.getuid())
                or stat.S_IMODE(runtime_stat.st_mode) & 0o077
            ):
                raise BackupError("XDG_RUNTIME_DIR is not owner-only")
        with tempfile.TemporaryDirectory(
            prefix="mf-dashboard-backup-", dir=temporary_root
        ) as workspace:
            workspace_path = Path(workspace)
            os.chmod(workspace_path, 0o700)
            database_backup = workspace_path / "moneyforward.db"
            archive_path = workspace_path / "mf-dashboard.tar"
            _create_consistent_database_backup(config.database_path, database_backup)
            os.chmod(database_backup, 0o600)
            _create_archive(
                archive_path,
                database_backup,
                config.profiles_path,
                config.compose_path,
                created_at,
            )
            os.chmod(archive_path, 0o600)
            encrypt(archive_path, partial_path, config.public_key_path)

        if _require_completed_crawler_run(config.crawler_state_path) != crawler_run:
            raise BackupError("crawler state changed while the backup was running")
        os.chmod(partial_path, 0o600)
        os.replace(partial_path, final_path)
        _prune_expired_backups(
            config.destination, final_path, created_at, config.retention_days
        )
        return final_path
    finally:
        partial_path.unlink(missing_ok=True)


def _default_base_directory() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    base = _default_base_directory()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-directory", type=Path, default=base)
    parser.add_argument("--database", type=Path)
    parser.add_argument("--profiles", type=Path)
    parser.add_argument("--compose", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--public-key", type=Path)
    parser.add_argument("--retention-days", type=int, default=14)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    base = args.base_directory.resolve()
    config = BackupConfig(
        base_directory=base,
        database_path=(args.database or base / "data/moneyforward.db").resolve(),
        profiles_path=(
            args.profiles or base / "config/money-forward-profiles.json"
        ).resolve(),
        compose_path=(args.compose or base / "compose.yml").resolve(),
        crawler_state_path=(base / "data/crawler-run-state.json").resolve(),
        destination=(args.destination or base / "backups").resolve(),
        public_key_path=(
            args.public_key or base / "secrets/backup-public-key.asc"
        ).resolve(),
        retention_days=args.retention_days,
    )
    try:
        backup_path = create_backup(config)
    except (BackupError, OSError, sqlite3.Error) as error:
        print(f"Backup failed: {error}", file=sys.stderr)
        return 1
    print(f"Backup completed: {backup_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
