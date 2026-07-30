from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.ops.healthcheck import (
    check_crawler_state,
    check_database,
    parse_compose_status,
)


class HealthcheckTest(unittest.TestCase):
    def test_requires_web_and_crawler_to_be_running(self) -> None:
        output = '\n'.join(
            [
                '{"Service":"web","State":"running"}',
                '{"Service":"crawler","State":"running"}',
            ]
        )
        self.assertEqual(parse_compose_status(output), [])

        stopped = '{"Service":"web","State":"running"}\n'
        self.assertEqual(parse_compose_status(stopped), ["crawler service is not running"])

    def test_rejects_failed_stale_and_stuck_crawler_runs(self) -> None:
        now = datetime(2026, 7, 31, 9, 0, tzinfo=timezone.utc)
        failed = {
            "runStatus": "failed",
            "startedAt": (now - timedelta(hours=1)).isoformat(),
            "finishedAt": now.isoformat(),
        }
        stale = {
            "runStatus": "success",
            "startedAt": (now - timedelta(hours=32)).isoformat(),
            "finishedAt": (now - timedelta(hours=31)).isoformat(),
        }
        stuck = {
            "runStatus": "running",
            "startedAt": (now - timedelta(hours=4)).isoformat(),
            "finishedAt": None,
        }

        self.assertEqual(check_crawler_state(failed, now=now), ["latest crawler run failed"])
        self.assertEqual(check_crawler_state(stale, now=now), ["latest crawler run is stale"])
        self.assertEqual(check_crawler_state(stuck, now=now), ["crawler run is stuck"])

    def test_accepts_recent_success_and_checks_database_integrity(self) -> None:
        now = datetime(2026, 7, 31, 9, 0, tzinfo=timezone.utc)
        state = {
            "runStatus": "success",
            "startedAt": (now - timedelta(hours=1)).isoformat(),
            "finishedAt": (now - timedelta(minutes=30)).isoformat(),
        }
        self.assertEqual(check_crawler_state(state, now=now), [])

        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "moneyforward.db"
            connection = sqlite3.connect(database_path)
            connection.execute("CREATE TABLE test_data (id INTEGER PRIMARY KEY)")
            connection.close()
            self.assertEqual(check_database(database_path), [])


if __name__ == "__main__":
    unittest.main()
