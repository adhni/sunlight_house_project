import unittest
import json
from pathlib import Path

from app import (
    app,
    build_config_and_moment,
    build_safe_form_values,
    default_form_values,
    parse_bounded_float,
    parse_positive_int,
    _MAX_WINDOWS,
)


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
        self.assertEqual(values["selected_date"], "2025-01-15")
        self.assertEqual(values["selected_time"], "10:00")
        self.assertEqual(values["window_facing"], "NE")
        self.assertEqual(values["room_width"], "4.0")
        self.assertEqual(values["room_depth"], "5.0")
        self.assertEqual(values["room_height"], "3.0")
        self.assertEqual(values["window_span_center"], "3.0")
        self.assertEqual(values["window_sill_height"], "0.1")
        self.assertEqual(values["window_width"], "1.5")
        self.assertEqual(values["window_height"], "2.0")
        self.assertEqual(len(json.loads(values["windows_json"])), 2)

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
        self.assertTrue(payload["snapshot"]["entered_direct_sun"])
        self.assertEqual(len(payload["windows"]), 2)

    def test_index_invalid_windows_json_falls_back_instead_of_500(self) -> None:
        response = self.client.get("/?windows_json=not-json")

        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        self.assertIn("Multi-window JSON must be valid JSON.", page)
        self.assertIn("Keeping your current inputs below; the preview uses the nearest valid values.", page)

    def test_index_invalid_hidden_sampling_values_are_sanitized(self) -> None:
        response = self.client.get("/?day_step_minutes=0&year_step_hours=0")

        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        self.assertIn('name="day_step_minutes" value="10"', page)
        self.assertIn('name="year_step_hours" value="1"', page)

    def test_index_includes_outdoor_conditions_poc(self) -> None:
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        self.assertIn("Outdoor conditions", page)
        self.assertIn("Outdoor Year", page)
        self.assertIn("environmentData.js", page)

    def test_static_environment_data_files_have_expected_shape(self) -> None:
        for location_key in ("melbourne", "jakarta", "boston"):
            with self.subTest(location_key=location_key):
                path = Path("static/env") / f"{location_key}-2025.json"
                payload = json.loads(path.read_text(encoding="utf-8"))

                self.assertEqual(payload["meta"]["locationKey"], location_key)
                self.assertEqual(payload["meta"]["year"], 2025)
                self.assertEqual(payload["meta"]["hours"], 8760)
                self.assertEqual(payload["columns"], ["tempC", "uvIndex", "solarRadiation"])
                self.assertEqual(len(payload["values"]), 8760)
                self.assertEqual(len(payload["values"][0]), 3)

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


class InputValidationUnitTests(unittest.TestCase):
    """Tests for the new parse_bounded_float / parse_positive_int helpers."""

    def test_bounded_float_accepts_valid(self) -> None:
        self.assertEqual(parse_bounded_float("45.0", "Lat", -90.0, 90.0), 45.0)

    def test_bounded_float_rejects_above_max(self) -> None:
        with self.assertRaises(ValueError):
            parse_bounded_float("91.0", "Latitude", -90.0, 90.0)

    def test_bounded_float_rejects_below_min(self) -> None:
        with self.assertRaises(ValueError):
            parse_bounded_float("-91.0", "Latitude", -90.0, 90.0)

    def test_bounded_float_accepts_boundary_value(self) -> None:
        self.assertEqual(parse_bounded_float("90.0", "Latitude", -90.0, 90.0), 90.0)
        self.assertEqual(parse_bounded_float("-180.0", "Longitude", -180.0, 180.0), -180.0)

    def test_bounded_float_exclusive_min_rejects_zero(self) -> None:
        with self.assertRaises(ValueError):
            parse_bounded_float("0.0", "Width", 0.0, 500.0, exclusive_min=True)

    def test_bounded_float_rejects_non_numeric(self) -> None:
        with self.assertRaises(ValueError):
            parse_bounded_float("abc", "Latitude", -90.0, 90.0)

    def test_positive_int_accepts_valid(self) -> None:
        self.assertEqual(parse_positive_int("10", "Step", max_val=60), 10)

    def test_positive_int_rejects_zero(self) -> None:
        with self.assertRaises(ValueError):
            parse_positive_int("0", "Step", max_val=60)

    def test_positive_int_rejects_above_max(self) -> None:
        with self.assertRaises(ValueError):
            parse_positive_int("61", "Daily step", max_val=60)

    def test_positive_int_rejects_fractional_float(self) -> None:
        with self.assertRaises(ValueError):
            parse_positive_int("5.9", "Step", max_val=60)

    def test_positive_int_rejects_fractional_below_one(self) -> None:
        with self.assertRaises(ValueError):
            parse_positive_int("0.5", "Step", max_val=60)


class InputValidationAPITests(unittest.TestCase):
    """Tests that the API endpoints reject invalid inputs with 400."""

    def setUp(self) -> None:
        self.client = app.test_client()

    def test_snapshot_rejects_latitude_out_of_range(self) -> None:
        response = self.client.get(
            "/api/snapshot",
            query_string={"location_preset": "custom", "latitude": "999", "longitude": "0"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Latitude", response.get_json()["error"])

    def test_snapshot_rejects_longitude_out_of_range(self) -> None:
        response = self.client.get(
            "/api/snapshot",
            query_string={"location_preset": "custom", "latitude": "0", "longitude": "-999"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Longitude", response.get_json()["error"])

    def test_snapshot_rejects_too_many_windows(self) -> None:
        too_many = json.dumps(
            [
                {"name": f"w{i}", "wall": "north", "span_center": 2.0, "sill_height": 0.5, "width": 0.3, "height": 0.5}
                for i in range(_MAX_WINDOWS + 1)
            ]
        )
        response = self.client.get("/api/snapshot", query_string={"windows_json": too_many})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Too many windows", response.get_json()["error"])

    def test_snapshot_rejects_invalid_facing(self) -> None:
        response = self.client.get("/api/snapshot", query_string={"window_facing": "XX"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("facing", response.get_json()["error"])

    def test_snapshot_rejects_day_step_too_large(self) -> None:
        response = self.client.get("/api/snapshot", query_string={"day_step_minutes": "9999"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Daily step", response.get_json()["error"])

    def test_snapshot_rejects_year_step_too_large(self) -> None:
        response = self.client.get("/api/snapshot", query_string={"year_step_hours": "9999"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Yearly step", response.get_json()["error"])

    def test_index_falls_back_on_out_of_range_latitude(self) -> None:
        response = self.client.get(
            "/",
            query_string={"location_preset": "custom", "latitude": "999", "longitude": "0"},
        )
        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        self.assertIn("Keeping your current inputs below", page)

    def test_safe_form_values_clamps_latitude_to_default(self) -> None:
        defaults = default_form_values()
        values = build_safe_form_values(defaults | {"location_preset": "custom", "latitude": "999"}, defaults)
        lat = float(values["latitude"])
        self.assertGreaterEqual(lat, -90.0)
        self.assertLessEqual(lat, 90.0)

    def test_safe_form_values_clamps_longitude_to_default(self) -> None:
        defaults = default_form_values()
        values = build_safe_form_values(defaults | {"location_preset": "custom", "longitude": "-999"}, defaults)
        lon = float(values["longitude"])
        self.assertGreaterEqual(lon, -180.0)
        self.assertLessEqual(lon, 180.0)

    def test_safe_form_values_clamps_day_step_to_default(self) -> None:
        defaults = default_form_values()
        values = build_safe_form_values(defaults | {"day_step_minutes": "9999"}, defaults)
        self.assertEqual(values["day_step_minutes"], defaults["day_step_minutes"])

    def test_safe_form_values_clamps_year_step_to_default(self) -> None:
        defaults = default_form_values()
        values = build_safe_form_values(defaults | {"year_step_hours": "9999"}, defaults)
        self.assertEqual(values["year_step_hours"], defaults["year_step_hours"])

    def test_snapshot_rejects_window_width_above_max(self) -> None:
        """Single-window fallback path rejects window_width > _MAX_ROOM_DIM."""
        values = default_form_values() | {"windows_json": ""}
        values["window_width"] = "501"
        with self.assertRaises(ValueError) as ctx:
            build_config_and_moment(values)
        self.assertIn("Window width", str(ctx.exception))

    def test_snapshot_rejects_window_height_above_max(self) -> None:
        """Single-window fallback path rejects window_height > _MAX_ROOM_DIM."""
        values = default_form_values() | {"windows_json": ""}
        values["window_height"] = "501"
        with self.assertRaises(ValueError) as ctx:
            build_config_and_moment(values)
        self.assertIn("Window height", str(ctx.exception))

    def test_snapshot_rejects_multi_window_width_above_max(self) -> None:
        windows_json = json.dumps(
            [{"name": "w1", "wall": "north", "span_center": 2.0, "sill_height": 0.5, "width": 501, "height": 1.0}]
        )
        response = self.client.get("/api/snapshot", query_string={"windows_json": windows_json})
        self.assertEqual(response.status_code, 400)
        self.assertIn("width", response.get_json()["error"])

    def test_snapshot_rejects_multi_window_height_above_max(self) -> None:
        windows_json = json.dumps(
            [{"name": "w1", "wall": "north", "span_center": 2.0, "sill_height": 0.5, "width": 1.0, "height": 501}]
        )
        response = self.client.get("/api/snapshot", query_string={"windows_json": windows_json})
        self.assertEqual(response.status_code, 400)
        self.assertIn("height", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
