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

    def test_strong_broad_headline(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="floor_hit",
            entered_direct_sun=True,
            peak_hours=5.0,
            sunlit_fraction=0.35,
            peak_time=None,
        )
        self.assertEqual(summary["headline"], "Strong direct sun across the room")
        self.assertEqual(summary["tone"], "strong")

    def test_limited_sun_headline(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="floor_hit",
            entered_direct_sun=True,
            peak_hours=1.0,
            sunlit_fraction=0.1,
            peak_time=None,
        )
        self.assertEqual(summary["headline"], "Limited direct sun today")
        self.assertEqual(summary["tone"], "muted")

    def test_moderate_sun_headline(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="floor_hit",
            entered_direct_sun=True,
            peak_hours=2.5,
            sunlit_fraction=0.3,
            peak_time=None,
        )
        self.assertEqual(summary["headline"], "Moderate direct sun today")
        self.assertEqual(summary["tone"], "neutral")

    def test_zero_peak_hours_treated_as_no_sun(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="floor_hit",
            entered_direct_sun=True,
            peak_hours=0.0,
            sunlit_fraction=0.0,
            peak_time=None,
        )
        self.assertEqual(summary["headline"], "No direct sun reaches the floor")
        self.assertEqual(summary["tone"], "off")

    def test_peak_time_omitted_when_no_sun(self) -> None:
        # peak_time provided but entered_direct_sun=False → should not appear in supporting text
        summary = summarize_direct_sun(
            snapshot_state="behind_window",
            entered_direct_sun=False,
            peak_hours=0.0,
            sunlit_fraction=0.0,
            peak_time=datetime(2026, 1, 15, 12, 0, tzinfo=ZoneInfo("UTC")),
        )
        self.assertNotIn("appears around", summary["supporting_text"])

    def test_coverage_percentage_is_rounded(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="floor_hit",
            entered_direct_sun=True,
            peak_hours=2.0,
            sunlit_fraction=0.333,
            peak_time=None,
        )
        self.assertIn("33%", summary["supporting_text"])

    def test_all_return_values_are_strings(self) -> None:
        summary = summarize_direct_sun(
            snapshot_state="floor_hit",
            entered_direct_sun=True,
            peak_hours=2.0,
            sunlit_fraction=0.3,
            peak_time=None,
        )
        for key, value in summary.items():
            self.assertIsInstance(value, str, f"Key '{key}' is not a string")


if __name__ == "__main__":
    unittest.main()
