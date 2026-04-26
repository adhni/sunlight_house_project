import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np

from sunlight_house.solar import (
    SunPosition,
    _julian_day,
    generate_day_positions,
    get_sun_position,
    sun_vector,
)


class JulianDayTests(unittest.TestCase):
    def test_j2000_epoch(self) -> None:
        # J2000.0 is defined as 2000-01-01 12:00:00 UTC = JD 2451545.0
        dt = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        self.assertAlmostEqual(_julian_day(dt), 2451545.0, places=5)

    def test_january_date_wraps_year_correctly(self) -> None:
        # January/February use year-1, month+12 in the algorithm — sanity check
        dt_jan = datetime(2026, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        dt_feb = datetime(2026, 2, 15, 0, 0, 0, tzinfo=timezone.utc)
        # February should be 31 days after January 15
        self.assertAlmostEqual(_julian_day(dt_feb) - _julian_day(dt_jan), 31.0, places=5)


class SunPositionTests(unittest.TestCase):
    def test_midday_summer_melbourne_sun_is_high(self) -> None:
        # Melbourne, January 15 ~solar noon — sun should be high in the sky
        dt = datetime(2026, 1, 15, 13, 0, 0)
        pos = get_sun_position(-37.8136, 144.9631, "Australia/Melbourne", dt)
        self.assertGreater(pos.elevation_deg, 50.0)
        # Southern hemisphere summer noon — sun is in the north, so azimuth near 0/360
        self.assertTrue(pos.azimuth_deg < 45.0 or pos.azimuth_deg > 315.0)

    def test_midnight_sun_is_below_horizon(self) -> None:
        dt = datetime(2026, 1, 15, 0, 0, 0)
        pos = get_sun_position(-37.8136, 144.9631, "Australia/Melbourne", dt)
        self.assertLess(pos.elevation_deg, 0.0)

    def test_midday_summer_boston_sun_is_high(self) -> None:
        # Boston, June 21 ~solar noon
        dt = datetime(2026, 6, 21, 12, 30, 0)
        pos = get_sun_position(42.3601, -71.0589, "America/New_York", dt)
        self.assertGreater(pos.elevation_deg, 60.0)
        # Northern hemisphere summer — sun in the south, azimuth near 180
        self.assertGreater(pos.azimuth_deg, 150.0)
        self.assertLess(pos.azimuth_deg, 210.0)

    def test_midday_winter_boston_sun_is_low(self) -> None:
        # Boston, December 21 — low winter sun
        dt = datetime(2026, 12, 21, 12, 30, 0)
        pos = get_sun_position(42.3601, -71.0589, "America/New_York", dt)
        self.assertGreater(pos.elevation_deg, 0.0)
        self.assertLess(pos.elevation_deg, 30.0)

    def test_elevation_range(self) -> None:
        dt = datetime(2026, 6, 21, 12, 0, 0)
        pos = get_sun_position(0.0, 0.0, "UTC", dt)
        self.assertGreaterEqual(pos.elevation_deg, -90.0)
        self.assertLessEqual(pos.elevation_deg, 90.0)

    def test_azimuth_range(self) -> None:
        dt = datetime(2026, 6, 21, 12, 0, 0)
        pos = get_sun_position(0.0, 0.0, "UTC", dt)
        self.assertGreaterEqual(pos.azimuth_deg, 0.0)
        self.assertLess(pos.azimuth_deg, 360.0)

    def test_naive_datetime_is_interpreted_in_given_timezone(self) -> None:
        naive_dt = datetime(2026, 1, 15, 12, 0, 0)
        tz = ZoneInfo("Australia/Melbourne")
        aware_dt = datetime(2026, 1, 15, 12, 0, 0, tzinfo=tz)
        pos_naive = get_sun_position(-37.8136, 144.9631, "Australia/Melbourne", naive_dt)
        pos_aware = get_sun_position(-37.8136, 144.9631, "Australia/Melbourne", aware_dt)
        self.assertAlmostEqual(pos_naive.elevation_deg, pos_aware.elevation_deg, places=6)
        self.assertAlmostEqual(pos_naive.azimuth_deg, pos_aware.azimuth_deg, places=6)


class SunVectorTests(unittest.TestCase):
    def test_unit_length(self) -> None:
        v = sun_vector(45.0, 90.0)
        self.assertAlmostEqual(float(np.linalg.norm(v)), 1.0, places=10)

    def test_overhead_points_up(self) -> None:
        v = sun_vector(90.0, 0.0)
        np.testing.assert_allclose(v, [0.0, 0.0, 1.0], atol=1e-9)

    def test_horizon_east_points_east(self) -> None:
        # elevation=0, azimuth=90 (east) => x=1, y=0, z=0
        v = sun_vector(0.0, 90.0)
        np.testing.assert_allclose(v, [1.0, 0.0, 0.0], atol=1e-9)

    def test_horizon_north_points_north(self) -> None:
        # elevation=0, azimuth=0 (north) => x=0, y=1, z=0
        v = sun_vector(0.0, 0.0)
        np.testing.assert_allclose(v, [0.0, 1.0, 0.0], atol=1e-9)

    def test_z_positive_when_sun_above_horizon(self) -> None:
        v = sun_vector(30.0, 135.0)
        self.assertGreater(v[2], 0.0)

    def test_z_negative_when_sun_below_horizon(self) -> None:
        v = sun_vector(-10.0, 90.0)
        self.assertLess(v[2], 0.0)


class GenerateDayPositionsTests(unittest.TestCase):
    def test_returns_correct_count_for_10_min_step(self) -> None:
        dt = datetime(2026, 1, 15, 0, 0, 0)
        positions = generate_day_positions(-37.8136, 144.9631, "Australia/Melbourne", dt, step_minutes=10)
        self.assertEqual(len(positions), 144)  # 24*60/10

    def test_returns_correct_count_for_60_min_step(self) -> None:
        dt = datetime(2026, 6, 21, 0, 0, 0)
        positions = generate_day_positions(42.3601, -71.0589, "America/New_York", dt, step_minutes=60)
        self.assertEqual(len(positions), 24)

    def test_raises_for_non_positive_step(self) -> None:
        dt = datetime(2026, 1, 15, 0, 0, 0)
        with self.assertRaises(ValueError):
            generate_day_positions(-37.8136, 144.9631, "Australia/Melbourne", dt, step_minutes=0)

    def test_each_entry_is_datetime_and_sunposition(self) -> None:
        dt = datetime(2026, 1, 15, 0, 0, 0)
        positions = generate_day_positions(-37.8136, 144.9631, "Australia/Melbourne", dt, step_minutes=60)
        for entry_dt, entry_pos in positions:
            self.assertIsInstance(entry_dt, datetime)
            self.assertIsInstance(entry_pos, SunPosition)

    def test_timestamps_are_sequential(self) -> None:
        dt = datetime(2026, 1, 15, 0, 0, 0)
        positions = generate_day_positions(-37.8136, 144.9631, "Australia/Melbourne", dt, step_minutes=30)
        datetimes = [t for t, _ in positions]
        for i in range(1, len(datetimes)):
            self.assertGreater(datetimes[i], datetimes[i - 1])


if __name__ == "__main__":
    unittest.main()
