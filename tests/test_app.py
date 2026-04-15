import unittest

from app import app, default_form_values


class AppTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()

    def test_healthz(self) -> None:
        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_data(as_text=True), "ok")

    def test_default_form_values_match_current_app_defaults(self) -> None:
        values = default_form_values()

        self.assertEqual(values["location_preset"], "melbourne")
        self.assertEqual(values["timezone_name"], "Australia/Melbourne")
        self.assertEqual(values["window_facing"], "NE")
        self.assertEqual(values["room_width"], "4.0")
        self.assertEqual(values["room_depth"], "5.0")
        self.assertEqual(values["room_height"], "3.0")
        self.assertEqual(values["window_span_center"], "3.0")
        self.assertEqual(values["window_sill_height"], "0.1")
        self.assertEqual(values["window_width"], "1.5")
        self.assertEqual(values["window_height"], "2.0")

    def test_snapshot_api_returns_expected_shape(self) -> None:
        response = self.client.get("/api/snapshot")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["location"]["timezone_name"], "Australia/Melbourne")
        self.assertEqual(payload["window_facing_label"], "NE")
        self.assertIn("daily", payload)
        self.assertIn("snapshot", payload)
        self.assertIn("room", payload)
        self.assertIn("summary", payload)
        self.assertIn("windows", payload)
        self.assertIn("headline", payload["summary"])
        self.assertIn("supporting_text", payload["summary"])


if __name__ == "__main__":
    unittest.main()
