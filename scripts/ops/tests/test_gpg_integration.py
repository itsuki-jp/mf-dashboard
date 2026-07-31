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
from scripts.ops.restore_check import RestoreConfig, decrypt_with_gpg, restore_and_check


TEST_PASSPHRASE = "匿名テスト用パスフレーズ"
TEST_IDENTITY = "Test Backup <backup@example.com>"


def _gpg_path(path: Path) -> str:
    """Use the POSIX drive form required by Git for Windows' MSYS GnuPG."""

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


@unittest.skipUnless(shutil.which("gpg"), "GnuPG integration requires gpg")
class GpgIntegrationTest(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "full backup integration runs on Linux")
    def test_real_public_key_encryption_and_private_key_restore_with_unicode_passphrase(
        self,
    ) -> None:
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
                    "--pinentry-mode",
                    "loopback",
                    "--passphrase-fd",
                    "0",
                    "--quick-generate-key",
                    TEST_IDENTITY,
                    "rsa2048",
                    "encr",
                    "1d",
                ],
                check=True,
                input=f"{TEST_PASSPHRASE}\n".encode(),
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
                        TEST_IDENTITY,
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
                        "--pinentry-mode",
                        "loopback",
                        "--passphrase-fd",
                        "0",
                        "--armor",
                        "--export-secret-keys",
                        TEST_IDENTITY,
                    ],
                    check=True,
                    input=f"{TEST_PASSPHRASE}\n".encode(),
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
            with patch(
                "scripts.ops.restore_check.getpass.getpass",
                return_value=TEST_PASSPHRASE,
            ):
                result = restore_and_check(
                    RestoreConfig(backup_path=backup, identity_path=private_key)
                )

            self.assertEqual(result.integrity_check, "ok")

    def test_decrypts_with_unicode_passphrase_on_the_host_gpg(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            key_home = base / "key-home"
            key_home.mkdir(mode=0o700)
            os.chmod(key_home, 0o700)
            gpg = [
                "gpg",
                "--batch",
                "--no-options",
                "--homedir",
                _gpg_path(key_home),
            ]
            passphrase = f"{TEST_PASSPHRASE}\n".encode()

            subprocess.run(
                [
                    *gpg,
                    "--pinentry-mode",
                    "loopback",
                    "--passphrase-fd",
                    "0",
                    "--quick-generate-key",
                    TEST_IDENTITY,
                    "rsa2048",
                    "encr",
                    "1d",
                ],
                check=True,
                input=passphrase,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            private_key = base / "backup-private-key.asc"
            private_key.write_bytes(
                subprocess.run(
                    [
                        *gpg,
                        "--pinentry-mode",
                        "loopback",
                        "--passphrase-fd",
                        "0",
                        "--armor",
                        "--export-secret-keys",
                        TEST_IDENTITY,
                    ],
                    check=True,
                    input=passphrase,
                    capture_output=True,
                ).stdout
            )

            plaintext = base / "anonymous-backup.tar"
            encrypted = base / "anonymous-backup.tar.gpg"
            restored = base / "restored.tar"
            plaintext.write_bytes(b"anonymous backup test data")
            subprocess.run(
                [
                    *gpg,
                    "--quiet",
                    "--trust-model",
                    "always",
                    "--recipient",
                    TEST_IDENTITY,
                    "--output",
                    _gpg_path(encrypted),
                    "--encrypt",
                    _gpg_path(plaintext),
                ],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            with patch(
                "scripts.ops.restore_check.getpass.getpass",
                return_value=TEST_PASSPHRASE,
            ):
                decrypt_with_gpg(encrypted, restored, private_key)

            self.assertEqual(restored.read_bytes(), plaintext.read_bytes())


if __name__ == "__main__":
    unittest.main()
