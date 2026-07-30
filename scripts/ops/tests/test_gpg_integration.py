from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.ops.backup import BackupConfig, create_backup
from scripts.ops.restore_check import RestoreConfig, restore_and_check


@unittest.skipUnless(
    os.name != "nt" and shutil.which("gpg"),
    "GnuPG integration is exercised on Linux",
)
class GpgIntegrationTest(unittest.TestCase):
    def test_real_public_key_encryption_and_private_key_restore(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            key_home = base / "key-home"
            key_home.mkdir(mode=0o700)
            os.chmod(key_home, 0o700)
            (base / "data").mkdir()
            (base / "config").mkdir()
            (base / "secrets").mkdir()

            subprocess.run(
                [
                    "gpg",
                    "--batch",
                    "--homedir",
                    str(key_home),
                    "--passphrase",
                    "",
                    "--quick-generate-key",
                    "Test Backup <backup@example.com>",
                    "rsa2048",
                    "encr",
                    "1d",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            public_key = base / "secrets/backup-public-key.asc"
            private_key = base / "secrets/backup-private-key.asc"
            public_key.write_bytes(
                subprocess.run(
                    [
                        "gpg",
                        "--batch",
                        "--homedir",
                        str(key_home),
                        "--armor",
                        "--export",
                        "Test Backup <backup@example.com>",
                    ],
                    check=True,
                    capture_output=True,
                ).stdout
            )
            private_key.write_bytes(
                subprocess.run(
                    [
                        "gpg",
                        "--batch",
                        "--homedir",
                        str(key_home),
                        "--armor",
                        "--export-secret-keys",
                        "Test Backup <backup@example.com>",
                    ],
                    check=True,
                    capture_output=True,
                ).stdout
            )

            database = sqlite3.connect(base / "data/moneyforward.db")
            database.executescript(
                """
                CREATE TABLE transactions (id TEXT PRIMARY KEY);
                CREATE TABLE daily_snapshots (id TEXT PRIMARY KEY);
                """
            )
            database.close()
            (base / "config/money-forward-profiles.json").write_text(
                json.dumps({"profiles": []}), encoding="utf-8"
            )
            (base / "data/crawler-run-state.json").write_text(
                json.dumps(
                    {
                        "runId": "run-a",
                        "runStatus": "success",
                        "finishedAt": "2026-07-31T08:00:00+00:00",
                    }
                ),
                encoding="utf-8",
            )
            (base / "compose.yml").write_text("services: {}\n", encoding="utf-8")

            backup = create_backup(
                BackupConfig(
                    base_directory=base,
                    database_path=base / "data/moneyforward.db",
                    profiles_path=base / "config/money-forward-profiles.json",
                    compose_path=base / "compose.yml",
                    crawler_state_path=base / "data/crawler-run-state.json",
                    destination=base / "backups",
                    public_key_path=public_key,
                )
            )
            with patch("scripts.ops.restore_check.getpass.getpass", return_value=""):
                result = restore_and_check(
                    RestoreConfig(backup_path=backup, identity_path=private_key)
                )

            self.assertEqual(result.integrity_check, "ok")


if __name__ == "__main__":
    unittest.main()
