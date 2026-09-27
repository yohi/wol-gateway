import socket
import unittest
from unittest.mock import patch

from app.probe import tcp_reachable


class TcpReachabilityTests(unittest.TestCase):
    @patch("app.probe.socket.create_connection")
    def test_successful_connection_is_online(self, create_connection):
        connection = create_connection.return_value
        connection.__enter__.return_value = connection

        self.assertTrue(tcp_reachable("192.0.2.10", 22, 0.5))
        create_connection.assert_called_once_with(
            ("192.0.2.10", 22),
            timeout=0.5,
        )

    @patch(
        "app.probe.socket.create_connection",
        side_effect=ConnectionRefusedError,
    )
    def test_connection_refused_is_online(self, _create_connection):
        self.assertTrue(tcp_reachable("192.0.2.10", 22, 0.5))

    @patch(
        "app.probe.socket.create_connection",
        side_effect=socket.timeout,
    )
    def test_timeout_is_offline(self, _create_connection):
        self.assertFalse(tcp_reachable("192.0.2.10", 22, 0.5))


if __name__ == "__main__":
    unittest.main()
