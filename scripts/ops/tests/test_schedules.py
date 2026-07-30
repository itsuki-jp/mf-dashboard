from __future__ import annotations

import unittest
from pathlib import Path


class ScheduleTest(unittest.TestCase):
    def test_monitoring_covers_stuck_threshold_and_backup_runs_afterward(self) -> None:
        root = Path(__file__).resolve().parents[3]
        crawler_cron = (root / "docker/crawler/crontab").read_text(encoding="utf-8")
        health_timer = (
            root / "ops/systemd/mf-dashboard-healthcheck.timer"
        ).read_text(encoding="utf-8")
        backup_timer = (root / "ops/systemd/mf-dashboard-backup.timer").read_text(
            encoding="utf-8"
        )

        self.assertEqual(
            [line for line in crawler_cron.splitlines() if line.strip()],
            [
                "30 6 * * * cd /app/apps/crawler && CRAWLER_RUN_SOURCE=scheduled "
                "node --import tsx src/index.ts"
            ],
        )
        self.assertIn("OnCalendar=hourly", health_timer)
        self.assertIn("OnCalendar=*-*-* 10:30:00 Asia/Tokyo", backup_timer)


if __name__ == "__main__":
    unittest.main()
