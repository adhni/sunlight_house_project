from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import date

from sunlight_house.config import Location, default_melbourne_scenario
from sunlight_house.goals import GOAL_DEFINITIONS, _movement_direction_label, evaluate_probe, goal_studio_payload


class GoalStudioTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = default_melbourne_scenario()

    def test_probe_evaluation_clips_edge_zone_and_returns_bounded_score(self) -> None:
        result = evaluate_probe(
            self.config,
            date(2025, 6, 21),
            GOAL_DEFINITIONS["winter_warmth"],
            x=0.0,
            y=0.0,
            size=0.8,
        )

        self.assertEqual(result["zone"]["min_x"], 0.0)
        self.assertEqual(result["zone"]["min_y"], 0.0)
        self.assertEqual(result["zone"]["sample_count"], 9)
        self.assertGreaterEqual(result["score"], 0.0)
        self.assertLessEqual(result["score"], 100.0)
        self.assertTrue(all(0.0 <= sample["coverage"] <= 1.0 for sample in result["timeline"]))

    def test_seasonal_reference_date_follows_hemisphere(self) -> None:
        northern = replace(
            self.config,
            location=Location("Northern test", 42.0, -71.0, "America/New_York"),
        )

        winter = goal_studio_payload(
            northern,
            date(2025, 4, 1),
            goal_key="winter_warmth",
            x=2.0,
            y=2.5,
            size=0.8,
        )
        summer = goal_studio_payload(
            northern,
            date(2025, 4, 1),
            goal_key="summer_protection",
            x=2.0,
            y=2.5,
            size=0.8,
        )

        self.assertEqual(winter["probe"]["date"], "2025-12-21")
        self.assertEqual(summer["probe"]["date"], "2025-06-21")

    def test_window_movement_direction_uses_selected_room_bearing(self) -> None:
        north_facing = replace(self.config, window_facing_label="N")
        northeast_facing = replace(self.config, window_facing_label="NE")

        self.assertEqual(_movement_direction_label(north_facing, "north", 0.35), "E")
        self.assertEqual(_movement_direction_label(north_facing, "north", -0.35), "W")
        self.assertEqual(_movement_direction_label(northeast_facing, "north", 0.35), "SE")
        self.assertEqual(_movement_direction_label(northeast_facing, "north", -0.35), "NW")
        self.assertEqual(_movement_direction_label(northeast_facing, "east", 0.35), "NE")
        self.assertEqual(_movement_direction_label(northeast_facing, "east", -0.35), "SW")


if __name__ == "__main__":
    unittest.main()
