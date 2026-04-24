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


if __name__ == "__main__":
    unittest.main()
