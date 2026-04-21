import unittest

from app import app, build_safe_form_values, default_form_values


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
        self.assertIn('"name": "north_main"', values["windows_json"])
        self.assertIn('"name": "east_side"', values["windows_json"])

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
        self.assertTrue(payload["is_multi_window"])
        self.assertTrue(payload["window_override_active"])
        self.assertEqual(len(payload["windows"]), 2)

    def test_index_invalid_windows_json_falls_back_instead_of_500(self) -> None:
        response = self.client.get("/?windows_json=not-json")

        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        self.assertIn("Multi-window JSON must be valid JSON.", page)
        self.assertIn("Keeping your current inputs below; the preview uses the nearest valid values.", page)

    def test_snapshot_api_accepts_multi_window_json(self) -> None:
        response = self.client.get(
            "/api/snapshot",
            query_string={
                "windows_json": (
                    '[{"name":"north_main","wall":"north","span_center":2.0,"sill_height":0.8,"width":1.4,"height":1.6},'
                    '{"name":"east_side","wall":"east","span_center":2.5,"sill_height":0.9,"width":1.0,"height":1.2}]'
                )
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["is_multi_window"])
        self.assertTrue(payload["window_override_active"])
        self.assertEqual(len(payload["windows"]), 2)
        self.assertEqual(payload["windows"][0]["name"], "north_main")
        self.assertEqual(payload["windows"][1]["wall"], "east")

    def test_snapshot_api_marks_single_window_json_override_active(self) -> None:
        response = self.client.get(
            "/api/snapshot",
            query_string={
                "windows_json": '[{"name":"solo","wall":"east","span_center":2.0,"sill_height":0.8,"width":1.0,"height":1.2}]'
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload["is_multi_window"])
        self.assertTrue(payload["window_override_active"])
        self.assertEqual(payload["windows"][0]["wall"], "east")

    def test_build_safe_form_values_discards_invalid_windows_json(self) -> None:
        defaults = default_form_values()

        values = build_safe_form_values(defaults | {"windows_json": "not-json"}, defaults)

        self.assertEqual(values["windows_json"], defaults["windows_json"])


if __name__ == "__main__":
    unittest.main()
