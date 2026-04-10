import unittest

from sunlight_house.analysis import long_range_exposure_grids, representative_days_for_month
from sunlight_house.config import Location, SimulationConfig, default_melbourne_scenario, main_window
from sunlight_house.geometry import Room


class RepresentativeDayTests(unittest.TestCase):
    def test_representative_days_cover_full_month(self) -> None:
        representative_days = representative_days_for_month(2026, 2, samples_per_month=8)

        self.assertEqual(len(representative_days), 8)
        self.assertEqual(sum(weight for _, weight in representative_days), 28)
        self.assertEqual(representative_days[0][0].month, 2)
        self.assertEqual(representative_days[-1][0].month, 2)


class LongRangeExposureTests(unittest.TestCase):
    def test_southern_hemisphere_period_labels_are_explicit(self) -> None:
        periods = long_range_exposure_grids(default_melbourne_scenario())

        self.assertEqual(periods["winter"]["label"], "Winter (Jun-Aug)")
        self.assertEqual(periods["spring"]["label"], "Spring (Sep-Nov)")
        self.assertEqual(periods["summer"]["label"], "Summer (Dec-Feb)")
        self.assertEqual(periods["fall"]["label"], "Fall (Mar-May)")
        self.assertEqual(periods["year"]["exposure_grid"]["cols"], 12)
        self.assertEqual(periods["year"]["exposure_grid"]["rows"], 10)

    def test_northern_hemisphere_period_labels_are_explicit(self) -> None:
        room = Room(width=4.0, depth=5.0, height=3.0)
        window = main_window(room=room, span_center=3.0, center_height=1.1, width=1.5, height=2.0)
        config = SimulationConfig(
            location=Location(
                name="Boston, United States",
                latitude=42.3601,
                longitude=-71.0589,
                timezone_name="America/New_York",
            ),
            room=room,
            windows=(window,),
            year=2026,
            window_facing_label="NE",
        )

        periods = long_range_exposure_grids(config)

        self.assertEqual(periods["winter"]["label"], "Winter (Dec-Feb)")
        self.assertEqual(periods["spring"]["label"], "Spring (Mar-May)")
        self.assertEqual(periods["summer"]["label"], "Summer (Jun-Aug)")
        self.assertEqual(periods["fall"]["label"], "Fall (Sep-Nov)")


if __name__ == "__main__":
    unittest.main()
