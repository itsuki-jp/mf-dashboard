from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from scripts.ops.notify_failure import NotificationError, _read_webhook_url, build_payload


class NotifyFailureTest(unittest.TestCase):
    def test_builds_provider_specific_payload_without_mentions(self) -> None:
        discord = json.loads(
            build_payload(
                "https://discord.com/api/webhooks/placeholder/token", "backup.service"
            )
        )
        slack = json.loads(
            build_payload(
                "https://hooks.slack.com/services/placeholder/token/value",
                "healthcheck.service",
            )
        )

        self.assertEqual(discord["allowed_mentions"], {"parse": []})
        self.assertEqual(discord["content"], "mf-dashboard operation failed: backup.service")
        self.assertEqual(slack["text"], "mf-dashboard operation failed: healthcheck.service")

    def test_rejects_unapproved_or_unencrypted_webhook_hosts(self) -> None:
        with self.assertRaises(NotificationError):
            build_payload("http://discord.com/api/webhooks/placeholder/token", "backup")
        with self.assertRaises(NotificationError):
            build_payload("https://example.com/webhook", "backup")

    @unittest.skipUnless(os.name == "posix", "POSIX permissions are checked on Linux")
    def test_rejects_webhook_file_readable_by_group_or_others(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            webhook_file = Path(directory) / "alert-webhook"
            webhook_file.write_text(
                "https://discord.com/api/webhooks/placeholder/token\n", encoding="utf-8"
            )
            os.chmod(webhook_file, 0o644)
            with self.assertRaisesRegex(NotificationError, "owner-only"):
                _read_webhook_url(webhook_file)


if __name__ == "__main__":
    unittest.main()
