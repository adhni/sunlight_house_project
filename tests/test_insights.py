import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from sunlight_house.insights import summarize_direct_sun


class DirectSunSummaryTests(unittest.TestCase):
    def test_no_direct_sun_returns_off_summary(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="behind_window",
            entered_direct_sun=False,
            peak_hours=0.0,
            sunlit_fraction=0.0,
            peak_time=None,
        )

        self.assertEqual(summary["headline"], "No direct sun reaches the floor")
        self.assertEqual(summary["tone"], "off")
        self.assertIn("0% of the room gets some direct sun", summary["supporting_text"])
        self.assertEqual(summary["moment_text"], "At the selected time, the sun does not enter this window.")

    def test_strong_concentrated_direct_sun_summary(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="floor_hit",
            entered_direct_sun=True,
            peak_hours=4.6,
            sunlit_fraction=0.12,
            peak_time=datetime(2026, 6, 21, 11, 0, tzinfo=ZoneInfo("Australia/Melbourne")),
        )

        self.assertEqual(summary["headline"], "Strong but concentrated direct sun")
        self.assertEqual(summary["tone"], "strong")
        self.assertIn("4.6 h", summary["supporting_text"])
        self.assertIn("11:00", summary["supporting_text"])
        self.assertEqual(summary["moment_text"], "At the selected time, the sun reaches the floor.")

    def test_broad_coverage_summary(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="through_window_no_floor_hit",
            entered_direct_sun=True,
            peak_hours=2.7,
            sunlit_fraction=0.5,
            peak_time=datetime(2026, 9, 22, 14, 0, tzinfo=ZoneInfo("Australia/Melbourne")),
        )

        self.assertEqual(summary["headline"], "Broad direct sun coverage")
        self.assertEqual(summary["tone"], "active")
        self.assertIn("50% of the room gets some direct sun", summary["supporting_text"])
        self.assertEqual(
            summary["moment_text"],
            "At the selected time, the sun enters the window but does not reach the floor.",
        )


if __name__ == "__main__":
    unittest.main()
