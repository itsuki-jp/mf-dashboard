#!/usr/bin/env python3
"""Decrypt an mf-dashboard backup and verify that it can be restored."""

from __future__ import annotations

import argparse
import getpass
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable


class RestoreError(RuntimeError):
    """Raised when a backup cannot be restored safely."""


@dataclass(frozen=True)
class RestoreConfig:
    backup_path: Path
    identity_path: Path


@dataclass(frozen=True)
class RestoreResult:
    integrity_check: str
    transaction_count: int
    daily_snapshot_count: int


DecryptFunction = Callable[[Path, Path, Path], None]

MAX_DECRYPTED_BACKUP_BYTES = 16 * 1024 * 1024 * 1024
MAX_MEMBER_SIZES = {
    "data/moneyforward.db": 15 * 1024 * 1024 * 1024,
    "config/money-forward-profiles.json": 1024 * 1024,
    "compose.yml": 2 * 1024 * 1024,
    "metadata.json": 64 * 1024,
}


def _gpg_path(path: Path) -> str:
    """Format paths for the selected Windows GnuPG implementation."""

    executable = shutil.which("gpg")
    resolved = path.resolve()
    if (
        os.name == "nt"
        and executable is not None
        and "/git/usr/bin/" in Path(executable).resolve().as_posix().lower()
    ):
        posix_path = resolved.as_posix()
        return f"/{posix_path[0].lower()}{posix_path[2:]}"
    return str(resolved)


def decrypt_with_gpg(source: Path, destination: Path, identity_path: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="mf-dashboard-gpg-") as temporary_home:
        home = Path(temporary_home)
        os.chmod(home, 0o700)
        base_command = ["gpg", "--batch", "--no-options", "--homedir", _gpg_path(home)]
        try:
            subprocess.run(
                [*base_command, "--quiet", "--import", _gpg_path(identity_path)],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            passphrase = getpass.getpass("Backup key passphrase: ")
            subprocess.run(
                [
                    *base_command,
                    "--quiet",
                    "--pinentry-mode",
                    "loopback",
                    "--passphrase-fd",
                    "0",
                    "--max-output",
                    str(MAX_DECRYPTED_BACKUP_BYTES),
                    "--output",
                    _gpg_path(destination),
                    "--decrypt",
                    _gpg_path(source),
                ],
                check=True,
                input=f"{passphrase}\n".encode("utf-8"),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (FileNotFoundError, subprocess.CalledProcessError) as error:
            raise RestoreError("GnuPG backup decryption failed") from error


def _validate_archive_members(archive: tarfile.TarFile) -> None:
    required = set(MAX_MEMBER_SIZES)
    names: set[str] = set()
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if (
            path.is_absolute()
            or ".." in path.parts
            or member.name in names
            or not member.isfile()
            or member.size < 0
            or member.size > MAX_MEMBER_SIZES.get(member.name, -1)
        ):
            raise RestoreError("backup archive contains an unsafe member")
        names.add(member.name)
    if names != required:
        raise RestoreError("backup archive has unexpected or missing files")


def _extract_validated_archive(archive: tarfile.TarFile, destination: Path) -> None:
    for name in (
        "data/moneyforward.db",
        "config/money-forward-profiles.json",
        "compose.yml",
        "metadata.json",
    ):
        member = archive.getmember(name)
        source = archive.extractfile(member)
        if source is None:
            raise RestoreError("backup archive member could not be read")
        target = destination.joinpath(*PurePosixPath(name).parts)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with source, target.open("xb") as output:
            shutil.copyfileobj(source, output)
        os.chmod(target, 0o600)


def restore_and_check(
    config: RestoreConfig,
    *,
    decrypt: DecryptFunction = decrypt_with_gpg,
) -> RestoreResult:
    if not config.backup_path.is_file() or config.backup_path.is_symlink():
        raise RestoreError("backup file is missing or is not a regular file")
    if config.backup_path.stat().st_size > MAX_DECRYPTED_BACKUP_BYTES:
        raise RestoreError("backup file exceeds the restore size limit")
    if not config.identity_path.is_file() or config.identity_path.is_symlink():
        raise RestoreError("private-key file is missing or is not a regular file")

    with tempfile.TemporaryDirectory(prefix="mf-dashboard-restore-") as temporary_directory:
        workspace = Path(temporary_directory)
        os.chmod(workspace, 0o700)
        archive_path = workspace / "mf-dashboard.tar"
        extracted = workspace / "restored"
        extracted.mkdir(mode=0o700)
        decrypt(config.backup_path, archive_path, config.identity_path)

        with tarfile.open(archive_path, "r") as archive:
            _validate_archive_members(archive)
            _extract_validated_archive(archive, extracted)

        database_path = extracted / "data/moneyforward.db"
        connection = sqlite3.connect(database_path.as_uri() + "?mode=ro", uri=True)
        try:
            integrity_rows = connection.execute("PRAGMA integrity_check").fetchall()
            if integrity_rows != [("ok",)]:
                raise RestoreError("restored SQLite integrity check failed")
            transaction_count = connection.execute(
                "SELECT COUNT(*) FROM transactions"
            ).fetchone()[0]
            snapshot_count = connection.execute(
                "SELECT COUNT(*) FROM daily_snapshots"
            ).fetchone()[0]
        except sqlite3.Error as error:
            raise RestoreError("restored database schema validation failed") from error
        finally:
            connection.close()

    return RestoreResult("ok", int(transaction_count), int(snapshot_count))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--identity", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = restore_and_check(
            RestoreConfig(
                backup_path=args.backup.resolve(),
                identity_path=args.identity.resolve(),
            )
        )
    except (RestoreError, OSError, sqlite3.Error, tarfile.TarError) as error:
        print(f"Restore check failed: {error}", file=sys.stderr)
        return 1
    print("Restore check passed")
    print(f"transactions: {result.transaction_count}")
    print(f"daily_snapshots: {result.daily_snapshot_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
