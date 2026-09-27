import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from app.probe import tcp_reachable
from app.wol import send_magic_packet

BASE_DIR = Path(__file__).resolve().parent

WOL_MAC = os.environ["WOL_MAC"]
WOL_BROADCAST = os.getenv("WOL_BROADCAST", "255.255.255.255")
WOL_PORT = int(os.getenv("WOL_PORT", "9"))
WOL_MIN_INTERVAL_SECONDS = int(os.getenv("WOL_MIN_INTERVAL_SECONDS", "30"))

AI_AGENT_HOST = os.environ["AI_AGENT_HOST"]
AI_AGENT_PORT = int(os.getenv("AI_AGENT_PORT", "22"))
AI_AGENT_PROBE_TIMEOUT_SECONDS = float(
    os.getenv("AI_AGENT_PROBE_TIMEOUT_SECONDS", "0.8")
)

_require_cf_access_setting = os.getenv("REQUIRE_CF_ACCESS", "true").lower()
match _require_cf_access_setting:
    case "1" | "true" | "yes" | "on":
        REQUIRE_CF_ACCESS = True
    case "0" | "false" | "no" | "off":
        REQUIRE_CF_ACCESS = False
    case _:
        raise ValueError(
            f"Invalid REQUIRE_CF_ACCESS value: {_require_cf_access_setting!r}"
        )

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("wol-gateway")

app = FastAPI(
    title="WoL Gateway",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_lock = threading.Lock()
_last_wake_monotonic: float | None = None
_last_wake_at: str | None = None


def require_access(request: Request) -> None:
    # Defense-in-depth presence check only. Cloudflare Access remains the
    # authentication and authorization boundary.
    if REQUIRE_CF_ACCESS and not request.headers.get("cf-access-jwt-assertion"):
        raise HTTPException(
            status_code=403,
            detail="Cloudflare Access assertion required",
        )


def ai_agent_online() -> bool:
    return tcp_reachable(
        AI_AGENT_HOST,
        AI_AGENT_PORT,
        AI_AGENT_PROBE_TIMEOUT_SECONDS,
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers[
        "Content-Security-Policy"
    ] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "connect-src 'self'; "
        "img-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "form-action 'self'"
    )
    return response


@app.get("/health")
def health():
    # Local/container health only. No network probe and no power-control action.
    return {"status": "ok"}


@app.get("/")
def index(request: Request):
    require_access(request)
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/app.js")
def javascript(request: Request):
    require_access(request)
    return FileResponse(
        BASE_DIR / "static" / "app.js",
        media_type="application/javascript",
    )


@app.get("/style.css")
def stylesheet(request: Request):
    require_access(request)
    return FileResponse(
        BASE_DIR / "static" / "style.css",
        media_type="text/css",
    )


@app.get("/api/status")
def status(request: Request):
    require_access(request)

    return {
        "gateway": {
            "status": "online",
            "role": "wol-relay",
        },
        "ai_agent": {
            "status": "online" if ai_agent_online() else "offline",
            "last_wake_at": _last_wake_at,
        },
        "probe": {
            "type": "tcp",
            "port": AI_AGENT_PORT,
        },
        "min_interval_seconds": WOL_MIN_INTERVAL_SECONDS,
    }


@app.post("/api/wake", status_code=202)
def wake(
    request: Request,
    x_wol_confirm: str | None = Header(default=None),
):
    global _last_wake_monotonic, _last_wake_at

    require_access(request)

    if x_wol_confirm != "wake":
        raise HTTPException(
            status_code=400,
            detail="Missing wake confirmation header",
        )

    # Avoid sending unnecessary packets while the fixed target already answers
    # the configured TCP reachability probe.
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

    actor = request.headers.get(
        "cf-access-authenticated-user-email",
        "unknown",
    )
    logger.info(
        "Wake-on-LAN magic packet sent actor=%s broadcast=%s port=%s",
        actor,
        WOL_BROADCAST,
        WOL_PORT,
    )

    return JSONResponse(
        status_code=202,
        content={
            "status": "sent",
            "sent_at": _last_wake_at,
        },
    )
