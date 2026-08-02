import unittest
import json
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app import (
    app,
    build_config_and_moment,
    build_scene_details,
    build_safe_form_values,
    default_form_values,
    parse_bounded_float,
    parse_float,
    parse_positive_int,
    _MAX_WINDOWS,
)
from sunlight_house.ifc_import import IfcImportError, _element_box, _unique_window_name


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
        self.assertEqual(values["scene_door_enabled"], "1")
        self.assertEqual(values["scene_door_wall"], "south")
        self.assertEqual(values["scene_partition_enabled"], "1")
        self.assertEqual(values["scene_eaves_enabled"], "1")
        self.assertEqual(values["scene_furniture_preset"], "living")
        self.assertEqual(len(json.loads(values["scene_furniture_json"])["items"]), 2)
        self.assertEqual(values["scene_external_obstruction"], "none")
        self.assertEqual(values["scene_external_wall"], "north")

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
        self.assertIn("scene", payload)
        self.assertIn("headline", payload["summary"])
        self.assertIn("supporting_text", payload["summary"])
        self.assertTrue(payload["is_multi_window"])
        self.assertTrue(payload["window_override_active"])
        self.assertTrue(payload["snapshot"]["entered_direct_sun"])
        self.assertEqual(len(payload["windows"]), 2)
        first_window = payload["windows"][0]
        self.assertEqual(first_window["width"], 1.5)
        self.assertEqual(first_window["height"], 2.0)
        self.assertAlmostEqual(first_window["sill_height"], 0.1)
        self.assertEqual(first_window["center_xyz"], [3.0, 5.0, 1.1])
        self.assertEqual(len(first_window["corners_xyz"]), 4)
        self.assertEqual(first_window["outward_normal"], [0.0, 1.0, 0.0])
        self.assertFalse(payload["scene"]["visual_only"])
        self.assertTrue(payload["scene"]["door"]["enabled"])
        self.assertEqual(payload["scene"]["door"]["wall"], "south")
        self.assertTrue(payload["scene"]["internal_wall"]["enabled"])
        self.assertTrue(payload["scene"]["internal_wall"]["affects_sunlight"])
        self.assertFalse(payload["scene"]["external_obstruction"]["enabled"])
        self.assertEqual(payload["scene"]["furniture"]["preset"], "living")
        self.assertEqual(payload["scene"]["furniture"]["version"], 1)
        self.assertEqual(len(payload["scene"]["furniture"]["items"]), 2)
        self.assertFalse(payload["scene"]["furniture"]["affects_sunlight"])
        self.assertIn("source_center_xyz", payload["snapshot"]["patches"][0])

    def test_scene_details_scale_to_the_current_room(self) -> None:
        values = default_form_values()
        config, _moment = build_config_and_moment(values | {"room_width": "8", "room_depth": "6"})

        scene = build_scene_details(values, config.room)

        self.assertEqual(scene["version"], 3)
        self.assertEqual(scene["room_bounds"], {"width": 8.0, "depth": 6.0, "height": 3.0})
        self.assertAlmostEqual(scene["door"]["span_center"], 1.76)
        self.assertLessEqual(scene["door"]["width"], 0.9)
        self.assertAlmostEqual(scene["internal_wall"]["start_xy"][0], 4.48)
        self.assertAlmostEqual(scene["internal_wall"]["start_xy"][1], 3.48)
        self.assertEqual(scene["furniture"]["preset"], "living")

    def test_custom_furniture_layout_is_validated_and_clamped_to_room(self) -> None:
        layout = {
            "version": 1,
            "items": [
                {"id": "sofa-1", "type": "sofa", "x": -100, "y": 100, "rotation": -15, "scale": 3},
                {"id": "chair-1", "type": "chair", "x": 2, "y": 2, "rotation": 90, "scale": 1},
            ],
        }

        response = self.client.get(
            "/api/scene-details",
            query_string={"scene_furniture_preset": "custom", "scene_furniture_json": json.dumps(layout)},
        )

        self.assertEqual(response.status_code, 200)
        furniture = response.get_json()["scene"]["furniture"]
        self.assertEqual(furniture["preset"], "custom")
        self.assertEqual([item["id"] for item in furniture["items"]], ["sofa-1", "chair-1"])
        self.assertEqual(furniture["items"][0]["rotation"], 345.0)
        self.assertEqual(furniture["items"][0]["scale"], 1.5)
        self.assertGreaterEqual(furniture["items"][0]["x"], 0)
        self.assertLessEqual(furniture["items"][0]["y"], 5)

    def test_custom_furniture_layout_rejects_unknown_types_and_duplicate_ids(self) -> None:
        invalid_layouts = [
            {"version": 1, "items": [{"id": "lamp-1", "type": "lamp", "x": 1, "y": 1, "rotation": 0, "scale": 1}]},
            {"version": 1, "items": [
                {"id": "chair-1", "type": "chair", "x": 1, "y": 1, "rotation": 0, "scale": 1},
                {"id": "chair-1", "type": "chair", "x": 2, "y": 2, "rotation": 0, "scale": 1},
            ]},
        ]
        for layout in invalid_layouts:
            with self.subTest(layout=layout):
                response = self.client.get(
                    "/api/scene-details",
                    query_string={"scene_furniture_preset": "custom", "scene_furniture_json": json.dumps(layout)},
                )
                self.assertEqual(response.status_code, 400)

    def test_scene_obstructions_change_sunlight_without_furniture_participation(self) -> None:
        clear_scene = {
            "scene_partition_enabled": "0",
            "scene_eaves_enabled": "0",
            "scene_external_obstruction": "none",
        }
        clear_payload = self.client.get("/api/snapshot", query_string=clear_scene).get_json()
        blocked_payload = self.client.get(
            "/api/snapshot",
            query_string=clear_scene
            | {
                "scene_external_obstruction": "building",
                "scene_external_wall": "north",
                "scene_furniture_preset": "bedroom",
            },
        ).get_json()

        self.assertLess(
            blocked_payload["daily"]["exposure_grid"]["peak_hours"],
            clear_payload["daily"]["exposure_grid"]["peak_hours"],
        )
        self.assertTrue(blocked_payload["scene"]["external_obstruction"]["enabled"])
        self.assertEqual(blocked_payload["scene"]["external_obstruction"]["preset"], "building")
        self.assertEqual(blocked_payload["scene"]["furniture"]["preset"], "bedroom")

    def test_default_config_builds_partition_and_eave_blockers(self) -> None:
        config, _moment = build_config_and_moment(default_form_values())

        self.assertEqual(len(config.obstructions), 5)
        self.assertEqual(config.obstructions[0].name, "internal-divider")
        self.assertEqual({box.scope for box in config.obstructions}, {"interior", "exterior"})

    def test_scene_details_api_skips_sunlight_analysis(self) -> None:
        with (
            patch("app.analyze_snapshot", side_effect=AssertionError("snapshot analysis should not run")),
            patch("app.analyze_day", side_effect=AssertionError("daily analysis should not run")),
            patch("app.long_range_exposure_grids", side_effect=AssertionError("yearly analysis should not run")),
        ):
            response = self.client.get(
                "/api/scene-details",
                query_string={"scene_furniture_preset": "dining", "scene_door_enabled": "0"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(set(payload), {"scene"})
        self.assertEqual(payload["scene"]["furniture"]["preset"], "dining")
        self.assertFalse(payload["scene"]["door"]["enabled"])

    def test_snapshot_api_rejects_invalid_scene_details(self) -> None:
        response = self.client.get(
            "/api/snapshot",
            query_string={"scene_door_wall": "ceiling", "scene_furniture_preset": "office"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("door wall", response.get_json()["error"])

    def test_snapshot_api_rejects_invalid_external_obstruction(self) -> None:
        response = self.client.get(
            "/api/snapshot",
            query_string={"scene_external_obstruction": "tree", "scene_external_wall": "ceiling"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Outside obstruction", response.get_json()["error"])

    def test_day_animation_api_returns_cached_lightweight_frames(self) -> None:
        query = {"selected_date": "2025-02-13", "selected_time": "13:07"}

        first_response = self.client.get("/api/day-animation", query_string=query)
        second_response = self.client.get("/api/day-animation", query_string=query)

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        first = first_response.get_json()
        second = second_response.get_json()
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(first["step_minutes"], 10)
        self.assertEqual(len(first["frames"]), 144)
        self.assertLess(first["playback_start_index"], first["playback_end_index"])
        self.assertEqual(set(first["presets"]), {"morning", "noon", "evening"})
        self.assertIn("snapshot", first["frames"][0])
        self.assertIn("patches", first["frames"][0]["snapshot"])
        self.assertEqual(first["frames"], second["frames"])

    def test_day_animation_api_does_not_run_daily_exposure_analysis(self) -> None:
        with patch("app.analyze_day", side_effect=AssertionError("daily analysis should not run")):
            response = self.client.get(
                "/api/day-animation",
                query_string={"selected_date": "2025-03-11"},
            )

        self.assertEqual(response.status_code, 200)

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
        self.assertIn("Outdoor context", page)
        self.assertIn("environmentData.js", page)

    def test_index_handles_room_dimensions_that_do_not_fit_default_windows(self) -> None:
        for field in ("room_width", "room_depth", "room_height"):
            with self.subTest(field=field):
                response = self.client.get("/", query_string={field: "1"})

                self.assertEqual(response.status_code, 200)
                self.assertIn('name="' + field + '" value="1"', response.get_data(as_text=True))

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

    def test_import_ifc_rejects_missing_file(self) -> None:
        response = self.client.post("/api/import-ifc")

        self.assertEqual(response.status_code, 400)
        self.assertIn("IFC", response.get_json()["error"])

    def test_import_ifc_rejects_non_ifc_extension(self) -> None:
        response = self.client.post(
            "/api/import-ifc",
            data={"ifc_file": (BytesIO(b"not ifc"), "room.txt")},
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn(".ifc", response.get_json()["error"])

    def test_import_ifc_returns_converted_payload(self) -> None:
        imported = {
            "source": "ifc",
            "space": {"name": "Living Room", "global_id": "abc"},
            "room": {"width": 4.0, "depth": 5.0, "height": 3.0},
            "window_facing": "N",
            "windows": [
                {"name": "Window A", "wall": "north", "span_center": 2.0, "sill_height": 0.8, "width": 1.2, "height": 1.4}
            ],
            "diagnostics": [],
        }

        with patch("app.import_ifc_room", return_value=imported):
            response = self.client.post(
                "/api/import-ifc",
                data={"ifc_file": (BytesIO(b"ISO-10303-21;"), "room.ifc")},
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["source"], "ifc")
        self.assertEqual(payload["room"]["width"], 4.0)
        self.assertEqual(payload["windows"][0]["wall"], "north")

    def test_import_ifc_reports_converter_error(self) -> None:
        with patch("app.import_ifc_room", side_effect=IfcImportError("No IfcSpace geometry was found in this IFC file.")):
            response = self.client.post(
                "/api/import-ifc",
                data={"ifc_file": (BytesIO(b"ISO-10303-21;"), "empty.ifc")},
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 422)
        self.assertIn("IfcSpace", response.get_json()["error"])

    def test_import_ifc_sample_file(self) -> None:
        with Path("docs/sample-simple-room.ifc").open("rb") as handle:
            response = self.client.post(
                "/api/import-ifc",
                data={"ifc_file": (handle, "sample-simple-room.ifc")},
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["room"], {"width": 4.0, "depth": 5.0, "height": 3.0})
        self.assertEqual(len(payload["windows"]), 2)
        self.assertTrue(payload["diagnostics"])

    def test_import_ifc_rejects_oversized_upload(self) -> None:
        with patch("app._MAX_IFC_UPLOAD_BYTES", 1):
            response = self.client.post(
                "/api/import-ifc",
                data={"ifc_file": (BytesIO(b"ISO-10303-21;"), "room.ifc")},
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 413)


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

    def test_float_rejects_non_finite_values(self) -> None:
        for raw_value in ("nan", "inf", "-inf"):
            with self.subTest(raw_value=raw_value), self.assertRaises(ValueError):
                parse_float(raw_value, "Latitude")

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

    def test_snapshot_rejects_non_finite_custom_coordinates(self) -> None:
        response = self.client.get(
            "/api/snapshot",
            query_string={"location_preset": "custom", "latitude": "nan", "longitude": "0"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("finite", response.get_json()["error"])

    def test_snapshot_rejects_duplicate_window_names(self) -> None:
        windows_json = json.dumps(
            [
                {"name": "same", "wall": "north", "span_center": 1.0, "sill_height": 0.5, "width": 0.5, "height": 0.5},
                {"name": "same", "wall": "east", "span_center": 1.0, "sill_height": 0.5, "width": 0.5, "height": 0.5},
            ]
        )
        response = self.client.get("/api/snapshot", query_string={"windows_json": windows_json})

        self.assertEqual(response.status_code, 400)
        self.assertIn("unique", response.get_json()["error"])

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

    def test_snapshot_rejects_year_step_that_can_skip_daylight(self) -> None:
        response = self.client.get("/api/snapshot", query_string={"year_step_hours": "13"})
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


class IfcImportUnitTests(unittest.TestCase):
    def test_element_box_preserves_ifcopenshell_metre_output(self) -> None:
        shape = SimpleNamespace(
            geometry=SimpleNamespace(
                verts=(
                    0.0, 0.0, 0.0,
                    4.0, 0.0, 0.0,
                    4.0, 5.0, 3.0,
                )
            )
        )

        with patch("ifcopenshell.geom.create_shape", return_value=shape):
            box = _element_box(SimpleNamespace(), SimpleNamespace())

        self.assertIsNotNone(box)
        self.assertEqual(box.width, 4.0)
        self.assertEqual(box.depth, 5.0)
        self.assertEqual(box.height, 3.0)

    def test_unique_window_name_adds_global_id_suffix_for_duplicates(self) -> None:
        used_names: set[str] = set()
        first = SimpleNamespace(Name="Window", GlobalId="first-guid")
        second = SimpleNamespace(Name="Window", GlobalId="second-guid")

        first_name = _unique_window_name(first, used_names)
        second_name = _unique_window_name(second, used_names)

        self.assertEqual(first_name, "Window")
        self.assertEqual(second_name, "Window (second-guid)")
        self.assertEqual(len(used_names), 2)

    def test_unique_window_name_respects_model_name_limit(self) -> None:
        used_names: set[str] = set()
        element = SimpleNamespace(Name="W" * 200, GlobalId="long-guid")

        name = _unique_window_name(element, used_names)

        self.assertLessEqual(len(name), 120)


if __name__ == "__main__":
    unittest.main()
