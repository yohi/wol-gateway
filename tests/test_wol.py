import unittest

from app.wol import build_magic_packet, normalize_mac


class WolPacketTests(unittest.TestCase):
    def test_magic_packet_shape(self):
        packet = build_magic_packet("AA:BB:CC:DD:EE:FF")
        mac = bytes.fromhex("AABBCCDDEEFF")
        self.assertEqual(packet[:6], b"\xff" * 6)
        self.assertEqual(packet[6:], mac * 16)
        self.assertEqual(len(packet), 102)

    def test_hyphenated_mac_is_supported(self):
        self.assertEqual(
            normalize_mac("AA-BB-CC-DD-EE-FF"),
            bytes.fromhex("AABBCCDDEEFF"),
        )

    def test_invalid_mac_is_rejected(self):
        with self.assertRaises(ValueError):
            build_magic_packet("not-a-mac")


if __name__ == "__main__":
    unittest.main()
