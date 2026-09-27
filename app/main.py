import hmac
import logging
import math
import os
import threading
import time
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.probe import tcp_reachable
from app.wol import send_magic_packet

WOL_MAC = os.environ["WOL_MAC"]
WOL_BROADCAST = os.getenv("WOL_BROADCAST", "255.255.255.255")
WOL_PORT = int(os.getenv("WOL_PORT", "9"))
WOL_MIN_INTERVAL_SECONDS = int(os.getenv("WOL_MIN_INTERVAL_SECONDS", "30"))
WOL_RELAY_SHARED_SECRET = os.environ["WOL_RELAY_SHARED_SECRET"]

AI_AGENT_HOST = os.environ["AI_AGENT_HOST"]
AI_AGENT_PORT = int(os.getenv("AI_AGENT_PORT", "22"))
AI_AGENT_PROBE_TIMEOUT_SECONDS = float(
    os.getenv("AI_AGENT_PROBE_TIMEOUT_SECONDS", "0.8")
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("wol-gateway")

app = FastAPI(
    title="WoL Gateway Relay",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_lock = threading.Lock()
_last_wake_monotonic: float | None = None
_last_wake_at: str | None = None


def require_relay_auth(request: Request) -> None:
    authorization = request.headers.get("authorization", "")
    scheme, separator, credential = authorization.partition(" ")
    if (
        not separator
        or scheme.lower() != "bearer"
        or not credential
        or not hmac.compare_digest(credential, WOL_RELAY_SHARED_SECRET)
    ):
        raise HTTPException(
            status_code=401,
            detail="Relay authorization required",
            headers={"WWW-Authenticate": "Bearer"},
        )


def ai_agent_online() -> bool:
    return tcp_reachable(
        AI_AGENT_HOST,
        AI_AGENT_PORT,
        AI_AGENT_PROBE_TIMEOUT_SECONDS,
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/internal/status")
def internal_status(request: Request):
    require_relay_auth(request)
    return {
        "relay": "online",
        "targets": {
            "ai-agent": {
                "status": "online" if ai_agent_online() else "offline",
            }
        },
    }


@app.post("/internal/targets/ai-agent/wake", status_code=202)
def wake_ai_agent(request: Request):
    global _last_wake_monotonic, _last_wake_at

    require_relay_auth(request)

    if ai_agent_online():
        raise HTTPException(
            status_code=409,
            detail="AI agent PC is already online",
        )

    now = time.monotonic()
    with _lock:
        if _last_wake_monotonic is not None:
            elapsed = now - _last_wake_monotonic
            if elapsed < WOL_MIN_INTERVAL_SECONDS:
                retry_after = max(
                    1,
                    math.ceil(WOL_MIN_INTERVAL_SECONDS - elapsed),
                )
                raise HTTPException(
                    status_code=429,
                    detail=(
                        "Wake request rate limited. "
                        f"Retry after {retry_after}s"
                    ),
                    headers={"Retry-After": str(retry_after)},
                )

        try:
            send_magic_packet(WOL_MAC, WOL_BROADCAST, WOL_PORT)
        except (OSError, ValueError) as exc:
            logger.exception("Failed to send Wake-on-LAN packet")
            raise HTTPException(
                status_code=500,
                detail="Failed to send Wake-on-LAN packet",
            ) from exc

        _last_wake_monotonic = now
        _last_wake_at = datetime.now(timezone.utc).isoformat()

    logger.info(
        "Wake-on-LAN magic packet sent broadcast=%s port=%s",
        WOL_BROADCAST,
        WOL_PORT,
    )

    return JSONResponse(
        status_code=202,
        content={"status": "sent", "sent_at": _last_wake_at},
    )
