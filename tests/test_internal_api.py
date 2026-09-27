import os
import unittest
from unittest.mock import patch

os.environ.setdefault("WOL_MAC", "AA:BB:CC:DD:EE:FF")
os.environ.setdefault("AI_AGENT_HOST", "192.0.2.10")
os.environ.setdefault("WOL_RELAY_SHARED_SECRET", "test-relay-secret")
os.environ.setdefault("REQUIRE_CF_ACCESS", "false")

from fastapi.testclient import TestClient
import app.main as main


class InternalApiAuthTests(unittest.TestCase):
    def setUp(self):
        main._last_wake_monotonic = None
        main._last_wake_at = None
        self.client = TestClient(main.app)

    def test_status_requires_bearer_token_before_probe(self):
        with patch("app.main.ai_agent_online") as probe:
            response = self.client.get("/internal/status")
        self.assertEqual(response.status_code, 401)
        probe.assert_not_called()

    def test_status_rejects_malformed_bearer_before_probe(self):
        with patch("app.main.ai_agent_online") as probe:
            response = self.client.get(
                "/internal/status",
                headers={"Authorization": "Basic abc"},
            )
        self.assertEqual(response.status_code, 401)
        probe.assert_not_called()

    def test_status_rejects_wrong_secret_before_probe(self):
        with patch("app.main.ai_agent_online") as probe:
            response = self.client.get(
                "/internal/status",
                headers={"Authorization": "Bearer wrong"},
            )
        self.assertEqual(response.status_code, 401)
        probe.assert_not_called()

    def test_status_returns_fixed_target_state_for_valid_secret(self):
        with patch("app.main.ai_agent_online", return_value=True):
            response = self.client.get(
                "/internal/status",
                headers={"Authorization": "Bearer test-relay-secret"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "relay": "online",
                "targets": {"ai-agent": {"status": "online"}},
            },
        )


class InternalWakeTests(unittest.TestCase):
    def setUp(self):
        main._last_wake_monotonic = None
        main._last_wake_at = None
        self.client = TestClient(main.app)
        self.headers = {"Authorization": "Bearer test-relay-secret"}

    def test_online_target_rejects_wake_without_packet(self):
        with patch("app.main.ai_agent_online", return_value=True), patch("app.main.send_magic_packet") as send:
            response = self.client.post("/internal/targets/ai-agent/wake", headers=self.headers)
        self.assertEqual(response.status_code, 409)
        send.assert_not_called()

    def test_offline_target_sends_one_fixed_packet(self):
        with patch("app.main.ai_agent_online", return_value=False), patch("app.main.send_magic_packet") as send:
            response = self.client.post(
                "/internal/targets/ai-agent/wake?host=198.51.100.10&broadcast=203.0.113.255",
                headers=self.headers,
                json={"mac": "11:22:33:44:55:66", "url": "http://evil.invalid"},
            )
        self.assertEqual(response.status_code, 202)
        send.assert_called_once_with(main.WOL_MAC, main.WOL_BROADCAST, main.WOL_PORT)

    def test_repeated_wake_is_rate_limited(self):
        with patch("app.main.ai_agent_online", return_value=False), patch("app.main.send_magic_packet"):
            first = self.client.post("/internal/targets/ai-agent/wake", headers=self.headers)
            second = self.client.post("/internal/targets/ai-agent/wake", headers=self.headers)
        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 429)

    def test_unknown_target_is_not_routable(self):
        with patch("app.main.ai_agent_online") as probe, patch("app.main.send_magic_packet") as send:
            response = self.client.post("/internal/targets/not-ai-agent/wake", headers=self.headers)
        self.assertEqual(response.status_code, 404)
        probe.assert_not_called()
        send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
