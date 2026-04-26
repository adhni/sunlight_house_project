import unittest
from datetime import datetime

import numpy as np

from sunlight_house.analysis import room_sun_vector
from sunlight_house.config import Location, Room, SimulationConfig, main_window, window_on_wall
from sunlight_house.geometry import project_to_floor
from sunlight_house.solar import get_sun_position


class FloorProjectionTests(unittest.TestCase):
    def test_corner_clipped_patch_does_not_repeat_vertices(self) -> None:
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
        position = get_sun_position(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            datetime(2026, 1, 11, 7, 30),
        )

        patch = project_to_floor(room, window, room_sun_vector(config, position))

        self.assertIsNotNone(patch)
        self.assertEqual(len(patch.polygon_xy), 3)
        self.assertFalse(np.allclose(patch.polygon_xy[-1], patch.polygon_xy[0]))
        self.assertTrue(np.all(patch.polygon_xy[:, 0] >= -1e-9))
        self.assertTrue(np.all(patch.polygon_xy[:, 0] <= room.width + 1e-9))
        self.assertTrue(np.all(patch.polygon_xy[:, 1] >= -1e-9))
        self.assertTrue(np.all(patch.polygon_xy[:, 1] <= room.depth + 1e-9))

    def test_side_window_clip_keeps_polygon_inside_room(self) -> None:
        room = Room(width=4.0, depth=5.0, height=3.0)
        window = window_on_wall(
            name="east_window",
            room=room,
            wall="east",
            span_center=2.5,
            center_height=1.1,
            width=1.5,
            height=2.0,
        )
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
        position = get_sun_position(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            datetime(2026, 1, 6, 7, 30),
        )

        patch = project_to_floor(room, window, room_sun_vector(config, position))

        self.assertIsNotNone(patch)
        self.assertGreaterEqual(len(patch.polygon_xy), 3)
        self.assertTrue(np.all(patch.polygon_xy[:, 0] >= -1e-9))
        self.assertTrue(np.all(patch.polygon_xy[:, 0] <= room.width + 1e-9))
        self.assertTrue(np.all(patch.polygon_xy[:, 1] >= -1e-9))
        self.assertTrue(np.all(patch.polygon_xy[:, 1] <= room.depth + 1e-9))


class RoomContainsXYTests(unittest.TestCase):
    def setUp(self) -> None:
        self.room = Room(width=4.0, depth=5.0, height=3.0)

    def test_centre_is_inside(self) -> None:
        self.assertTrue(self.room.contains_xy(np.array([2.0, 2.5])))

    def test_corner_is_inside(self) -> None:
        self.assertTrue(self.room.contains_xy(np.array([0.0, 0.0])))

    def test_opposite_corner_is_inside(self) -> None:
        self.assertTrue(self.room.contains_xy(np.array([4.0, 5.0])))

    def test_outside_x_is_false(self) -> None:
        self.assertFalse(self.room.contains_xy(np.array([4.1, 2.5])))

    def test_outside_y_is_false(self) -> None:
        self.assertFalse(self.room.contains_xy(np.array([2.0, 5.1])))

    def test_negative_coordinate_is_false(self) -> None:
        self.assertFalse(self.room.contains_xy(np.array([-0.01, 2.5])))


class RoomValidateWindowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.room = Room(width=4.0, depth=5.0, height=3.0)

    def test_valid_north_wall_window(self) -> None:
        w = main_window(room=self.room, span_center=2.0, center_height=1.5, width=1.0, height=1.0)
        self.room.validate_window(w)  # should not raise

    def test_valid_east_wall_window(self) -> None:
        w = window_on_wall(
            name="east",
            room=self.room,
            wall="east",
            span_center=2.5,
            center_height=1.5,
            width=1.0,
            height=1.0,
        )
        self.room.validate_window(w)

    def test_zero_width_raises(self) -> None:
        from sunlight_house.geometry import Window

        w = Window(
            name="bad",
            center=np.array([2.0, 5.0, 1.5]),
            width=0.0,
            height=1.0,
            outward_normal=np.array([0.0, 1.0, 0.0]),
        )
        with self.assertRaises(ValueError):
            self.room.validate_window(w)

    def test_window_too_tall_raises(self) -> None:
        from sunlight_house.geometry import Window

        w = Window(
            name="bad",
            center=np.array([2.0, 5.0, 1.5]),
            width=1.0,
            height=4.0,
            outward_normal=np.array([0.0, 1.0, 0.0]),
        )
        with self.assertRaises(ValueError):
            self.room.validate_window(w)

    def test_north_window_on_wrong_wall_raises(self) -> None:
        from sunlight_house.geometry import Window

        w = Window(
            name="bad",
            center=np.array([2.0, 3.0, 1.5]),  # y != depth
            width=1.0,
            height=1.0,
            outward_normal=np.array([0.0, 1.0, 0.0]),
        )
        with self.assertRaises(ValueError):
            self.room.validate_window(w)


class WindowPrimitivesTests(unittest.TestCase):
    def _north_window(self) -> "Window":
        from sunlight_house.geometry import Window

        return Window(
            name="W",
            center=np.array([2.0, 5.0, 1.5]),
            width=1.0,
            height=1.0,
            outward_normal=np.array([0.0, 1.0, 0.0]),
        )

    def test_normal_is_normalised(self) -> None:
        from sunlight_house.geometry import Window

        w = Window(
            name="W",
            center=np.array([2.0, 5.0, 1.5]),
            width=1.0,
            height=1.0,
            outward_normal=np.array([0.0, 2.0, 0.0]),
        )
        self.assertAlmostEqual(float(np.linalg.norm(w.outward_normal)), 1.0, places=10)

    def test_zero_normal_raises(self) -> None:
        from sunlight_house.geometry import Window

        with self.assertRaises(ValueError):
            Window(
                name="W",
                center=np.array([2.0, 5.0, 1.5]),
                width=1.0,
                height=1.0,
                outward_normal=np.array([0.0, 0.0, 0.0]),
            )

    def test_inward_normal_is_negated(self) -> None:
        w = self._north_window()
        np.testing.assert_allclose(w.inward_normal, [0.0, -1.0, 0.0], atol=1e-9)

    def test_corners_returns_four_points(self) -> None:
        corners = self._north_window().corners()
        self.assertEqual(len(corners), 4)

    def test_corners_span_correct_width_and_height(self) -> None:
        from sunlight_house.geometry import Window

        w = Window(
            name="W",
            center=np.array([2.0, 5.0, 1.5]),
            width=2.0,
            height=1.0,
            outward_normal=np.array([0.0, 1.0, 0.0]),
        )
        corners = w.corners()
        xs = [c[0] for c in corners]
        zs = [c[2] for c in corners]
        self.assertAlmostEqual(max(xs) - min(xs), 2.0, places=9)
        self.assertAlmostEqual(max(zs) - min(zs), 1.0, places=9)

    def test_wall_segment_length_matches_width(self) -> None:
        from sunlight_house.geometry import Window

        w = Window(
            name="W",
            center=np.array([2.0, 5.0, 1.5]),
            width=1.5,
            height=1.0,
            outward_normal=np.array([0.0, 1.0, 0.0]),
        )
        seg = w.wall_segment_xy()
        length = float(np.linalg.norm(seg[1] - seg[0]))
        self.assertAlmostEqual(length, 1.5, places=9)


class IntersectsWindowTests(unittest.TestCase):
    def test_sun_facing_window_returns_positive(self) -> None:
        from sunlight_house.geometry import intersects_window

        sun_dir = np.array([0.0, 1.0, 1.0]) / np.sqrt(2)
        factor = intersects_window(sun_dir, np.array([0.0, 1.0, 0.0]))
        self.assertGreater(factor, 0.0)

    def test_sun_on_horizon_returns_zero(self) -> None:
        from sunlight_house.geometry import intersects_window

        # z == 0 → on horizon, should return 0
        sun_dir = np.array([0.0, 1.0, 0.0])
        factor = intersects_window(sun_dir, np.array([0.0, 1.0, 0.0]))
        self.assertEqual(factor, 0.0)

    def test_sun_behind_window_returns_zero(self) -> None:
        from sunlight_house.geometry import intersects_window

        # Sun coming from south into a north-facing window → dot < 0
        sun_dir = np.array([0.0, -1.0, 1.0]) / np.sqrt(2)
        factor = intersects_window(sun_dir, np.array([0.0, 1.0, 0.0]))
        self.assertEqual(factor, 0.0)

    def test_perpendicular_incidence_value(self) -> None:
        from sunlight_house.geometry import intersects_window

        sun_dir = np.array([0.0, 1.0, 1.0]) / np.sqrt(2.0)
        factor = intersects_window(sun_dir, np.array([0.0, 1.0, 0.0]))
        self.assertAlmostEqual(factor, 1.0 / np.sqrt(2.0), places=9)


class PolygonAreaTests(unittest.TestCase):
    def test_unit_square(self) -> None:
        from sunlight_house.geometry import _polygon_area

        pts = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
        self.assertAlmostEqual(_polygon_area(pts), 1.0, places=9)

    def test_rectangle(self) -> None:
        from sunlight_house.geometry import _polygon_area

        pts = np.array([[0.0, 0.0], [3.0, 0.0], [3.0, 2.0], [0.0, 2.0]])
        self.assertAlmostEqual(_polygon_area(pts), 6.0, places=9)

    def test_right_triangle(self) -> None:
        from sunlight_house.geometry import _polygon_area

        pts = np.array([[0.0, 0.0], [2.0, 0.0], [0.0, 2.0]])
        self.assertAlmostEqual(_polygon_area(pts), 2.0, places=9)

    def test_area_is_positive_regardless_of_winding(self) -> None:
        from sunlight_house.geometry import _polygon_area

        cw = np.array([[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0]])
        ccw = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
        self.assertGreater(_polygon_area(cw), 0.0)
        self.assertAlmostEqual(_polygon_area(cw), _polygon_area(ccw), places=9)


if __name__ == "__main__":
    unittest.main()
