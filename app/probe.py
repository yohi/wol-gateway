import socket


def tcp_reachable(host: str, port: int, timeout: float) -> bool:
    """Return whether the configured host answered a TCP connection attempt.

    A connection-refused response still proves the host's TCP stack answered,
    so it is considered reachable. Timeouts and other network errors are not.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except ConnectionRefusedError:
        return True
    except (socket.timeout, TimeoutError, OSError):
        return False
