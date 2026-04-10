import unittest

from sunlight_house.config import default_melbourne_scenario


class DefaultScenarioTests(unittest.TestCase):
    def test_default_melbourne_scenario_matches_ui_defaults(self) -> None:
        scenario = default_melbourne_scenario()
        window = scenario.windows[0]

        self.assertEqual(scenario.location.name, "Melbourne, Australia")
        self.assertEqual(scenario.location.timezone_name, "Australia/Melbourne")
        self.assertEqual(scenario.window_facing_label, "NE")

        self.assertEqual(scenario.room.width, 4.0)
        self.assertEqual(scenario.room.depth, 5.0)
        self.assertEqual(scenario.room.height, 3.0)

        self.assertEqual(window.center[0], 3.0)
        self.assertEqual(window.center[2], 1.1)
        self.assertEqual(window.width, 1.5)
        self.assertEqual(window.height, 2.0)


if __name__ == "__main__":
    unittest.main()
