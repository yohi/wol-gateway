import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from app.wol import send_magic_packet

BASE_DIR = Path(__file__).resolve().parent

WOL_MAC = os.environ["WOL_MAC"]
WOL_BROADCAST = os.getenv("WOL_BROADCAST", "255.255.255.255")
WOL_PORT = int(os.getenv("WOL_PORT", "9"))
WOL_MIN_INTERVAL_SECONDS = int(os.getenv("WOL_MIN_INTERVAL_SECONDS", "30"))
REQUIRE_CF_ACCESS = os.getenv("REQUIRE_CF_ACCESS", "true").lower() in {"1", "true", "yes", "on"}

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
    # This is only a defense-in-depth presence check. Cloudflare Access remains
    # the authentication/authorization boundary.
    if REQUIRE_CF_ACCESS and not request.headers.get("cf-access-jwt-assertion"):
        raise HTTPException(status_code=403, detail="Cloudflare Access assertion required")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers[
        "Content-Security-Policy"
    ] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    return response


@app.get("/health")
def health():
    # Intended for localhost/container health checks. No power-control action.
    return {"status": "ok"}


@app.get("/")
def index(request: Request):
    require_access(request)
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/app.js")
def javascript(request: Request):
    require_access(request)
    return FileResponse(BASE_DIR / "static" / "app.js", media_type="application/javascript")


@app.get("/style.css")
def stylesheet(request: Request):
    require_access(request)
    return FileResponse(BASE_DIR / "static" / "style.css", media_type="text/css")


@app.get("/api/status")
def status(request: Request):
    require_access(request)
    return {
        "gateway": "ready",
        "last_wake_at": _last_wake_at,
        "min_interval_seconds": WOL_MIN_INTERVAL_SECONDS,
    }


@app.post("/api/wake", status_code=202)
def wake(
    request: Request,
    x_wol_confirm: str | None = Header(default=None),
):
    global _last_wake_monotonic, _last_wake_at

    require_access(request)

    # A cross-origin HTML form cannot set this custom header. Since this app
    # intentionally sends no CORS headers, browser-based cross-site requests
    # requiring preflight are rejected by the browser.
    if x_wol_confirm != "wake":
        raise HTTPException(status_code=400, detail="Missing wake confirmation header")

    now = time.monotonic()
    with _lock:
        if _last_wake_monotonic is not None:
            elapsed = now - _last_wake_monotonic
            if elapsed < WOL_MIN_INTERVAL_SECONDS:
                retry_after = max(1, math.ceil(WOL_MIN_INTERVAL_SECONDS - elapsed))
                raise HTTPException(
                    status_code=429,
                    detail=f"Wake request rate limited. Retry after {retry_after}s",
                    headers={"Retry-After": str(retry_after)},
                )

        try:
            send_magic_packet(WOL_MAC, WOL_BROADCAST, WOL_PORT)
        except (OSError, ValueError) as exc:
            logger.exception("Failed to send Wake-on-LAN packet")
            raise HTTPException(status_code=500, detail="Failed to send Wake-on-LAN packet") from exc

        _last_wake_monotonic = now
        _last_wake_at = datetime.now(timezone.utc).isoformat()

    actor = request.headers.get("cf-access-authenticated-user-email", "unknown")
    logger.info("Wake-on-LAN magic packet sent actor=%s broadcast=%s port=%s", actor, WOL_BROADCAST, WOL_PORT)

    return JSONResponse(
        status_code=202,
        content={
            "status": "sent",
            "sent_at": _last_wake_at,
        },
    )
