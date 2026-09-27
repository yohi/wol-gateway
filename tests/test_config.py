import os
import subprocess
import sys
import unittest


class CloudflareAccessConfigTests(unittest.TestCase):
    def run_app_with_access_setting(
        self,
        value: str,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["WOL_MAC"] = "AA:BB:CC:DD:EE:FF"
        env["AI_AGENT_HOST"] = "192.0.2.10"
        env["REQUIRE_CF_ACCESS"] = value

        return subprocess.run(
            [
                sys.executable,
                "-c",
                "from app.main import REQUIRE_CF_ACCESS; print(REQUIRE_CF_ACCESS)",
            ],
            capture_output=True,
            check=False,
            env=env,
            text=True,
        )

    def test_supported_true_values_enable_access_check(self):
        for value in ("1", "true", "yes", "on"):
            with self.subTest(value=value):
                result = self.run_app_with_access_setting(value)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "True")

    def test_supported_false_values_disable_access_check(self):
        for value in ("0", "false", "no", "off"):
            with self.subTest(value=value):
                result = self.run_app_with_access_setting(value)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "False")

    def test_unrecognized_value_fails_startup(self):
        result = self.run_app_with_access_setting("sometimes")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("REQUIRE_CF_ACCESS", result.stderr)


if __name__ == "__main__":
    unittest.main()
