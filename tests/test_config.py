import os
import subprocess
import sys
import unittest


class RelayConfigTests(unittest.TestCase):
    def base_env(self):
        env = os.environ.copy()
        env["WOL_MAC"] = "AA:BB:CC:DD:EE:FF"
        env["AI_AGENT_HOST"] = "192.0.2.10"
        env["WOL_RELAY_SHARED_SECRET"] = "test-secret"
        env.pop("REQUIRE_CF_ACCESS", None)
        return env

    def test_valid_required_configuration_imports(self):
        result = subprocess.run(
            [sys.executable, "-c", "from app.main import WOL_RELAY_SHARED_SECRET; print(WOL_RELAY_SHARED_SECRET)"],
            capture_output=True,
            check=False,
            env=self.base_env(),
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "test-secret")

    def test_missing_relay_secret_fails_startup(self):
        env = self.base_env()
        env.pop("WOL_RELAY_SHARED_SECRET")
        result = subprocess.run(
            [sys.executable, "-c", "import app.main"],
            capture_output=True,
            check=False,
            env=env,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WOL_RELAY_SHARED_SECRET", result.stderr)


if __name__ == "__main__":
    unittest.main()
