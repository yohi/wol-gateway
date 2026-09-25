import re
import socket

_MAC_RE = re.compile(r"^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")


def normalize_mac(mac: str) -> bytes:
    if not _MAC_RE.fullmatch(mac):
        raise ValueError("WOL_MAC must be a 6-byte MAC address such as AA:BB:CC:DD:EE:FF")
    return bytes.fromhex(mac.replace(":", "").replace("-", ""))


def build_magic_packet(mac: str) -> bytes:
    mac_bytes = normalize_mac(mac)
    return b"\xff" * 6 + mac_bytes * 16


def send_magic_packet(mac: str, broadcast: str, port: int = 9) -> None:
    packet = build_magic_packet(mac)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, (broadcast, port))
