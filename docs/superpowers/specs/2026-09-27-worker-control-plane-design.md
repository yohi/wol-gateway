# Worker Control Plane and Relay Architecture Design

**Date:** 2026-09-27  
**Status:** Proposed for implementation  
**Repository:** yohi/wol-gateway  
**Branch:** feat/existing-tunnel-status-ui

## 1. Goal

Move the public UI and control plane for wol.y-ohi.com from the home gateway
PC to Cloudflare Workers while keeping Wake-on-LAN packet delivery inside the
home LAN.

The design must:

- keep the home gateway PC as the current always-on LAN relay;
- reuse the existing Cloudflare Tunnel;
- deploy the Worker from GitHub Actions;
- avoid exposing arbitrary network destinations or shell execution;
- keep the public API stable when additional relay types are added later;
- allow a future ESP32 relay without redesigning the UI or public API;
- keep ESP32, Durable Objects, and WebSocket device sessions out of the current implementation.

## 2. Current state

PR #2 currently implements this topology:

~~~text
Browser
  |
Cloudflare Access
  |
Existing Cloudflare Tunnel
  |
Home Gateway / FastAPI
  |- UI
  |- status API
  `- Wake API
       |
       `- UDP Magic Packet -> AI Agent PC
~~~

This has one operational weakness: if the home gateway is unavailable, the
public UI is unavailable as well. The user cannot distinguish "the relay is
down" from "the site itself is down."

The current FastAPI implementation also owns both presentation and LAN-side
device control, which makes adding a second relay type unnecessarily invasive.

## 3. Target architecture

~~~text
                         wol.y-ohi.com
                               |
                       Cloudflare Access
                               |
                       Cloudflare Worker
                      UI / Control Plane
                               |
                  +------------+-------------+
                  |                          |
             Target Registry             Relay Layer
                                             |
                                  +----------+----------+
                                  |                     |
                              current                future
                                  |                     |
                           GatewayRelay            Esp32Relay
                                  |                     |
                         Workers VPC binding       Durable Object
                                  |                  WebSocket
                         existing CF Tunnel             |
                                  |                   ESP32
                           Home Gateway                 |
                              FastAPI                   |
                                  |                     |
                                  +----------+----------+
                                             |
                                          UDP WoL
                                             |
                                      AI Agent PC
~~~

### Responsibility split

**Cloudflare Worker**

- serves the public UI;
- owns the public HTTP API;
- owns target metadata visible to the UI;
- selects a relay;
- converts relay failures into stable public error responses;
- never accepts an arbitrary IP, MAC, broadcast address, or URL from the browser.

**Home gateway FastAPI service**

- is not a public UI server after migration;
- remains the trusted LAN-side adapter;
- probes the fixed AI Agent PC;
- emits the UDP Magic Packet;
- exposes only the minimal internal relay API required by the Worker.

**Cloudflare Tunnel**

- remains the network path from Cloudflare to the home network;
- is not created or credentialed by this repository;
- is reused by the Worker through a Workers VPC binding.

## 4. Public API contract

The browser communicates only with the Worker.

### GET /api/targets

Returns the targets known to the control plane.

Initial response shape:

~~~json
{
  "targets": [
    {
      "id": "ai-agent",
      "name": "AIエージェントPC",
      "status": "online",
      "wakeAvailable": false,
      "relay": {
        "id": "home-gateway",
        "status": "online"
      }
    }
  ]
}
~~~

The status vocabulary is:

- online
- offline
- unknown

The Worker must return unknown, not offline, when it cannot reach any relay.
Relay failure is not proof that the PC is powered off.

### GET /api/relays

Returns relay availability for diagnostics.

Initial response shape:

~~~json
{
  "relays": [
    {
      "id": "home-gateway",
      "type": "gateway",
      "status": "online"
    }
  ]
}
~~~

This endpoint gives the UI enough information to render "Gateway unavailable"
without making the UI itself unavailable.

### POST /api/targets/:targetId/wake

Requests a wake for a known target.

Initial valid target:

~~~text
ai-agent
~~~

The Worker rejects unknown target IDs. The browser cannot provide MAC address,
broadcast address, relay destination, or other network parameters. Wake requests
also require `X-WOL-Confirm: wake` as CSRF defense in depth.

The Worker returns:

- 202 when a relay accepted the wake;
- 409 when the target is already online;
- 429 when rate limited;
- 503 when no suitable relay is available;
- 404 for unknown target IDs.

## 5. Internal relay contract

Worker code uses a relay abstraction rather than directly calling the gateway
throughout route handlers.

Conceptual TypeScript interface:

~~~ts
interface WolRelay {
  readonly id: string;
  readonly type: "gateway" | "esp32";

  status(): Promise<RelayStatus>;
  getTargetStatus(target: Target): Promise<TargetStatus>;
  wake(target: Target): Promise<WakeResult>;
}
~~~

The initial implementation contains one provider:

~~~text
GatewayRelay
~~~

A future implementation can add:

~~~text
Esp32Relay
~~~

without changing browser routes or the target model.

The target registry remains explicit and server-side:

~~~text
ai-agent
  preferred relay: home-gateway
~~~

There is no generic arbitrary destination relay API.

## 6. GatewayRelay transport

The preferred transport is a Workers VPC Network binding tied to the existing
Cloudflare Tunnel.

The Worker calls a fixed internal origin through the binding. The destination is
hard-coded in Worker configuration/code and is never derived from a browser request.

Conceptually:

~~~ts
env.HOME_NETWORK.fetch("http://localhost:8088/internal/status")
env.HOME_NETWORK.fetch("http://localhost:8088/internal/wake", ...)
~~~

The exact private destination used during deployment must be verified against
the existing Tunnel connector. If Tunnel-to-loopback routing is not supported by
the deployed environment, the private service will bind to a gateway-local
address reachable only from the connector rather than exposing a public hostname.

### Workers VPC beta risk

Workers VPC remains beta as of 2026-09-27. The implementation therefore keeps
all VPC-specific code inside GatewayRelay.

If Workers VPC proves unsuitable operationally, a future transport can replace
only GatewayRelay with an Access-protected Tunnel origin transport. The public
API, UI, and future Esp32Relay contract must not change.

The fallback is deliberately not implemented in this PR.

## 7. Home gateway internal API

FastAPI becomes a LAN relay adapter.

Proposed endpoints:

### GET /internal/status

Response:

~~~json
{
  "relay": "online",
  "targets": {
    "ai-agent": {
      "status": "online"
    }
  }
}
~~~

The AI target status continues to use the existing fixed TCP reachability probe.

### POST /internal/targets/ai-agent/wake

Behavior:

1. verify the target is fixed and known;
2. reject the request if the target is already reachable;
3. enforce the existing wake interval;
4. emit the fixed Magic Packet;
5. return 202.

The endpoint never accepts target MAC, broadcast address, probe host, shell
command, or arbitrary target ID from the body.

## 8. Authentication and trust boundaries

### Browser -> Worker

Cloudflare Access protects wol.y-ohi.com.

The Worker assumes Access is the user authentication and authorization boundary.

### Worker -> GatewayRelay

Workers VPC is the network boundary. The gateway relay is not published as a
normal Internet-facing application hostname.

The FastAPI service continues to have no CORS support and no generic proxy behavior.

### Defense in depth

The gateway internal API should require a fixed relay authorization secret in
addition to private network reachability unless a stronger origin identity
mechanism is available during implementation.

The secret:

- is generated independently from Cloudflare Tunnel credentials;
- is stored as a Worker secret;
- is stored in the home gateway .env;
- is sent only Worker -> gateway;
- is never exposed to browser JavaScript;
- is never logged.

This prevents another Worker with private-network reachability from trivially
issuing Wake requests.

## 9. UI behavior

The Worker owns all static UI assets.

The initial UI still shows two logical devices:

~~~text
Home Gateway
  Online / Unavailable
  role: WoL relay

AI Agent PC
  Online / Offline / Unknown
  [Wake]
~~~

Rules:

- Gateway reachable + AI online -> Wake disabled.
- Gateway reachable + AI offline -> Wake enabled.
- Gateway unavailable -> AI status is unknown, Wake disabled.
- A sent wake enters a temporary "starting" state while status polling continues.
- If startup is not observed within the configured window, Wake becomes available again.

The browser polls only the Worker. It never calls the home gateway directly.

## 10. Future ESP32 extension

ESP32 is explicitly out of scope for the current implementation, but the relay
boundary is designed for it.

Future topology:

~~~text
ESP32
  |
  | outbound WSS
  v
Durable Object
  |
Esp32Relay
  |
Worker public API
~~~

The ESP32 initiates the outbound connection, so no router port forwarding is required.

The Durable Object will act as the WebSocket server. Cloudflare's Hibernation
WebSocket API is the preferred future mechanism so the device connection can
remain attached while the Durable Object is not continuously billed for active duration.

Future relay selection policy may become:

~~~text
1. home-gateway
2. esp32 fallback
~~~

or the reverse. That policy belongs to the Worker control plane, not to the UI.

No Durable Object binding, WebSocket code, ESP32 protocol, or device
authentication is implemented now.

## 11. Worker project layout

Proposed structure:

~~~text
worker/
  package.json
  tsconfig.json
  wrangler.template.json
  scripts/
    render-wrangler.mjs
  src/
    index.ts
    api/
      targets.ts
      relays.ts
    domain/
      target.ts
      relay.ts
    relays/
      gateway.ts
  public/
    index.html
    app.js
    style.css
  test/
    *.test.mjs
~~~

Implementation may simplify this structure when files are too small to justify
separation, but the domain/relay boundary must remain explicit.

## 12. GitHub Actions

Two concerns are separated.

### Pull request validation

PRs run:

~~~text
npm install
npm test
npm run typecheck
~~~

for the Worker, plus the existing Python tests for the gateway relay.

PR validation does not deploy production.

### Production deployment

Pushes to master deploy the Worker with Cloudflare's official
cloudflare/wrangler-action@v4. The workflow writes an ephemeral git-ignored
secrets JSON file and passes it with `wrangler deploy --secrets-file` so the
first deployment can create the Worker and required secret atomically.

GitHub Secrets:

~~~text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
WOL_RELAY_SHARED_SECRET
~~~

Account ID and API token are required by Wrangler in CI. The API token must be
scoped to the minimum account/zone permissions necessary to deploy this Worker
and bind the required Workers VPC resource. Direct VPC Network binding to the
existing Tunnel requires Connectivity Directory Admin access.

Account-specific resource identifiers that are not secrets should use GitHub
Repository Variables rather than source literals where practical.

Candidate variable:

~~~text
CLOUDFLARE_TUNNEL_ID
~~~

If Wrangler requires the VPC binding identifier to be materialized in
wrangler.jsonc, CI generates the effective config from the repository template
before deploy. Secrets must never be written to the generated config.

## 13. Worker deployment routing

wol.y-ohi.com becomes the Worker custom domain/route.

The old public Tunnel mapping:

~~~text
wol.y-ohi.com -> http://localhost:8088
~~~

must no longer own that hostname once the Worker is deployed.

The existing Cloudflare Tunnel remains connected and is used only as the
private gateway path for GatewayRelay.

This prevents hostname ownership ambiguity between Tunnel and Worker.

## 14. Error handling

Worker response rules:

- Gateway VPC fetch timeout/failure -> relay unavailable, target unknown.
- Gateway 409 -> propagate semantic already_online as HTTP 409.
- Gateway 429 -> propagate HTTP 429 and retry metadata when available.
- Gateway unexpected 5xx -> return sanitized 502/503; never expose private addresses or stack traces.
- Unknown Worker target -> 404 without contacting a relay.

Gateway logs may record Access actor forwarded by the Worker only if that value
is explicitly trusted and sanitized. It must not log relay secrets, Tunnel
credentials, MAC addresses, or Access JWTs.

## 15. Test strategy

### Worker unit tests

Tests must cover:

- known target enumeration;
- unknown target rejection;
- target online -> Wake disabled / 409;
- target offline -> Wake routes to GatewayRelay;
- relay unavailable -> target becomes unknown and wake returns 503;
- no arbitrary destination can be injected through the public API;
- gateway failures are sanitized;
- public Wake without `X-WOL-Confirm: wake` is rejected before relay access.

### Gateway tests

Existing WoL and TCP probe tests remain.

Add tests for:

- relay authorization required;
- internal fixed target only;
- online target rejects Wake;
- offline target sends exactly one Magic Packet;
- rate limiting remains enforced.

### CI configuration validation

Validation should cover:

- Worker typecheck;
- Worker tests;
- Python tests;
- docker compose config;
- Wrangler configuration validation/dry-run where supported.

## 16. Non-goals

Not part of this implementation:

- ESP32 firmware;
- Durable Object runtime;
- WebSocket relay protocol;
- automatic relay failover;
- Wake of the home gateway itself;
- remote shutdown or reboot;
- arbitrary MAC/IP support;
- arbitrary HTTP/TCP proxying;
- router port forwarding;
- provisioning or rotating the existing Cloudflare Tunnel credential.

## 17. Acceptance criteria

The implementation is complete when:

1. wol.y-ohi.com is served by the Worker rather than FastAPI.
2. Cloudflare Access remains required before the UI is usable.
3. The UI remains available when the home gateway relay is unavailable.
4. Relay failure is represented as unknown, not falsely as target offline.
5. The Worker reaches the home gateway through the existing Tunnel using the selected Workers VPC binding.
6. The browser has no direct route or credentials to the gateway.
7. The AI Agent PC can be woken through the Worker -> GatewayRelay path.
8. Worker code has an explicit relay interface suitable for a future Esp32Relay.
9. No Durable Object or ESP32 implementation is added yet.
10. PR CI runs Worker tests/typecheck and Python tests.
11. Push to master deploys the Worker via GitHub Actions.
12. Deployment credentials exist only in GitHub/Cloudflare secret stores.
13. Tunnel token remains outside this repository.
14. No arbitrary destination or arbitrary command execution is introduced.
