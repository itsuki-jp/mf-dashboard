from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
import unittest
from io import BytesIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

from scripts.ops.backup import BackupConfig, create_backup
from scripts.ops.restore_check import (
    MAX_MEMBER_SIZES,
    RestoreConfig,
    RestoreError,
    _validate_archive_members,
    restore_and_check,
)


class BackupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.base = Path(self.temp_directory.name)
        (self.base / "data").mkdir()
        (self.base / "config").mkdir()
        (self.base / "secrets").mkdir()

        database = sqlite3.connect(self.base / "data/moneyforward.db")
        database.executescript(
            """
            CREATE TABLE transactions (id TEXT PRIMARY KEY);
            CREATE TABLE daily_snapshots (id TEXT PRIMARY KEY);
            INSERT INTO transactions VALUES ('transaction-a');
            INSERT INTO daily_snapshots VALUES ('snapshot-a');
            """
        )
        database.close()

        (self.base / "config/money-forward-profiles.json").write_text(
            json.dumps(
                {
                    "profiles": [
                        {
                            "id": "primary",
                            "displayName": "User A",
                            "enabled": True,
                            "secrets": {
                                "username": "secret-id-a",
                                "password": "secret-id-b",
                                "totp": "secret-id-c",
                            },
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        (self.base / "data/crawler-run-state.json").write_text(
            json.dumps(
                {
                    "runId": "run-a",
                    "runStatus": "success",
                    "finishedAt": "2026-07-31T08:00:00+00:00",
                }
            ),
            encoding="utf-8",
        )
        (self.base / "compose.yml").write_text("services: {}\n", encoding="utf-8")
        (self.base / "secrets/backup-public-key.asc").write_text(
            "anonymous test public key\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def config(self, retention_days: int = 14) -> BackupConfig:
        return BackupConfig(
            base_directory=self.base,
            database_path=self.base / "data/moneyforward.db",
            profiles_path=self.base / "config/money-forward-profiles.json",
            compose_path=self.base / "compose.yml",
            crawler_state_path=self.base / "data/crawler-run-state.json",
            destination=self.base / "backups",
            public_key_path=self.base / "secrets/backup-public-key.asc",
            retention_days=retention_days,
        )

    @staticmethod
    def copy_encrypt(source: Path, destination: Path, _public_key: Path) -> None:
        shutil.copyfile(source, destination)

    @staticmethod
    def copy_decrypt(source: Path, destination: Path, _identity: Path) -> None:
        shutil.copyfile(source, destination)

    def test_creates_atomic_bundle_from_live_database_and_prunes_expired_backup(self) -> None:
        destination = self.base / "backups"
        destination.mkdir()
        expired = destination / "mf-dashboard-20260101-000000.tar.gpg"
        expired.write_bytes(b"expired")
        old = datetime.now(timezone.utc) - timedelta(days=15)
        os.utime(expired, (old.timestamp(), old.timestamp()))

        now = datetime(2026, 7, 31, 8, 30, tzinfo=timezone.utc)
        encrypted = create_backup(self.config(), now=now, encrypt=self.copy_encrypt)

        self.assertEqual(encrypted.name, "mf-dashboard-20260731-083000.tar.gpg")
        self.assertFalse(expired.exists())
        self.assertEqual(list(destination.glob("*.tmp")), [])

        with tarfile.open(encrypted, "r") as archive:
            self.assertEqual(
                sorted(archive.getnames()),
                [
                    "compose.yml",
                    "config/money-forward-profiles.json",
                    "data/moneyforward.db",
                    "metadata.json",
                ],
            )
            extracted_database = self.base / "extracted.db"
            member = archive.extractfile("data/moneyforward.db")
            assert member is not None
            extracted_database.write_bytes(member.read())

        connection = sqlite3.connect(extracted_database)
        self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        connection.close()

    def test_encryption_failure_leaves_no_plaintext_or_partial_backup(self) -> None:
        def fail_encrypt(_source: Path, _destination: Path, _public_key: Path) -> None:
            raise RuntimeError("encryption failed")

        with self.assertRaisesRegex(RuntimeError, "encryption failed"):
            create_backup(self.config(), encrypt=fail_encrypt)

        destination = self.base / "backups"
        self.assertEqual(list(destination.iterdir()), [])

    def test_refuses_backup_during_failed_or_running_crawler_run(self) -> None:
        state_path = self.base / "data/crawler-run-state.json"
        for status in ("failed", "running"):
            state_path.write_text(
                json.dumps(
                    {
                        "runId": "run-a",
                        "runStatus": status,
                        "finishedAt": None,
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                RuntimeError, "has not completed successfully"
            ):
                create_backup(self.config(), encrypt=self.copy_encrypt)

    def test_restore_check_validates_integrity_and_required_tables(self) -> None:
        encrypted = create_backup(self.config(), encrypt=self.copy_encrypt)
        identity = self.base / "secrets/backup-private-key.asc"
        identity.write_text("anonymous test private key\n", encoding="utf-8")

        result = restore_and_check(
            RestoreConfig(backup_path=encrypted, identity_path=identity),
            decrypt=self.copy_decrypt,
        )

        self.assertEqual(result.integrity_check, "ok")
        self.assertEqual(result.transaction_count, 1)
        self.assertEqual(result.daily_snapshot_count, 1)

    def test_restore_rejects_path_traversal_member(self) -> None:
        archive_path = self.base / "unsafe.tar"
        with tarfile.open(archive_path, "w") as archive:
            member = tarfile.TarInfo("../outside")
            member.size = 1
            archive.addfile(member, BytesIO(b"x"))

        with tarfile.open(archive_path, "r") as archive:
            with self.assertRaisesRegex(RestoreError, "unsafe member"):
                _validate_archive_members(archive)

    def test_restore_rejects_windows_paths_and_oversized_members(self) -> None:
        for member_name in (r"..\outside", "C:/outside"):
            archive_path = self.base / "unsafe.tar"
            with tarfile.open(archive_path, "w") as archive:
                member = tarfile.TarInfo(member_name)
                member.size = 1
                archive.addfile(member, BytesIO(b"x"))
            with tarfile.open(archive_path, "r") as archive:
                with self.assertRaises(RestoreError):
                    _validate_archive_members(archive)

        oversized = tarfile.TarInfo("data/moneyforward.db")
        oversized.size = MAX_MEMBER_SIZES["data/moneyforward.db"] + 1
        archive = Mock()
        archive.getmembers.return_value = [oversized]
        with self.assertRaises(RestoreError):
            _validate_archive_members(archive)


if __name__ == "__main__":
    unittest.main()
