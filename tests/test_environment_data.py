import unittest
from urllib.parse import parse_qs, urlparse

from scripts.build_environment_data import compact_payload, power_url


class EnvironmentDataBuildTests(unittest.TestCase):
    def test_power_url_requests_utc_time_standard(self) -> None:
        query = parse_qs(urlparse(power_url(-37.8136, 144.9631)).query)

        self.assertEqual(query["time-standard"], ["UTC"])

    def test_compact_payload_declares_utc_time_standard(self) -> None:
        payload = {
            "properties": {
                "parameter": {
                    "T2M": {"2025010100": 21.123},
                    "ALLSKY_SFC_UV_INDEX": {"2025010100": 4.567},
                    "ALLSKY_SFC_SW_DWN": {"2025010100": 789.123},
                }
            }
        }
        location = {
            "label": "Melbourne",
            "latitude": -37.8136,
            "longitude": 144.9631,
            "timezone": "Australia/Melbourne",
        }

        compact = compact_payload("melbourne", location, payload)

        self.assertEqual(compact["meta"]["timeStandard"], "UTC")
        self.assertEqual(compact["values"], [[21.12, 4.57, 789.12]])


if __name__ == "__main__":
    unittest.main()
