# Worker Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `wol.y-ohi.com` UI/public API to a Cloudflare Worker, keep the home gateway as a private LAN WoL relay reached through the existing Tunnel, and add GitHub Actions validation/deployment while preserving a future `Esp32Relay` extension point.

**Architecture:** The Worker owns static assets, target/relay state, and the public HTTP API. A `GatewayRelay` calls the home gateway over a Workers VPC Network binding tied to the existing Tunnel; FastAPI becomes an authenticated internal relay adapter only. The relay interface stays transport-agnostic so a future Durable Object-backed `Esp32Relay` can be added without changing browser routes.

**Tech Stack:** Python 3.14, FastAPI, unittest, Docker Compose, TypeScript, Cloudflare Workers, Workers Static Assets, Workers VPC Network binding, Wrangler 4, Node built-in node:test, GitHub Actions, `cloudflare/wrangler-action@v4`.

**Spec:** `docs/superpowers/specs/2026-09-27-worker-control-plane-design.md`

## Implementation rulings

- No subagent dispatch tool is available in this harness, so execution uses the Native fallback while preserving task order, TDD, and final whole-branch review.
- Worker tests use Node's built-in `node:test` rather than Node built-in node:test so local RED/GREEN verification does not depend on registry access.
- The fixed GatewayRelay origin is `http://localhost:8088`, matching Cloudflare Workers VPC's documented Tunnel-side localhost service model.
- Worker dependencies use `npm install` rather than `npm install` because the implementation intentionally does not commit a generated package lock at this stage.
- Production secret delivery uses an ephemeral `.secrets.production.json` with `wrangler deploy --secrets-file` rather than wrangler-action's `secrets` input; wrangler-action uploads secrets before deploy, which is unsafe for first Worker creation.
- Public Wake retains `X-WOL-Confirm: wake` as CSRF defense in depth.

## Global Constraints

- Home gateway remains the current always-on LAN relay.
- Reuse the existing Cloudflare Tunnel; no Tunnel token enters this repository.
- Workers VPC is beta; all VPC-specific behavior stays inside `GatewayRelay`.
- Existing `cloudflared` must be >= 2025.7.0 and use QUIC via `auto` or `quic`.
- Wrangler binding name: `HOME_NETWORK`; config uses `vpc_networks[].tunnel_id` and `remote: true`.
- Production hostname: `wol.y-ohi.com`; Custom Domain; `workers_dev: false`.
- Target ID: `ai-agent`; relay ID: `home-gateway`.
- Target status: `online | offline | unknown`; relay status: `online | unavailable`.
- Browser cannot supply MAC, broadcast, private host, relay URL, or shell command.
- Worker-to-gateway secret: `WOL_RELAY_SHARED_SECRET`, never exposed to browser code/logs.
- No Durable Object, ESP32 code, WebSocket protocol, relay failover, shutdown/reboot, or arbitrary destination support.
- PR CI never deploys production.
- Push to `master` deploys with `cloudflare/wrangler-action@v4`.
- GitHub Secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `WOL_RELAY_SHARED_SECRET`.
- GitHub Repository Variable: `CLOUDFLARE_TUNNEL_ID`.
- Worker compatibility date: `2026-09-27`.

## Review Focus

1. Relay unreachable must make target `unknown`, never falsely `offline`.
2. Missing/malformed/wrong gateway bearer secret must be rejected before probing or WoL.
3. Unknown target IDs and request body/query destination fields must never affect routing.
4. Already-online target must return `409` and send no Magic Packet.
5. Missing/invalid Tunnel UUID must fail config generation before deployment.

---

### Task 1: Convert FastAPI into the authenticated internal gateway relay

**Files:**
- Modify: `app/main.py`
- Modify: `.env.example`
- Create: `requirements-dev.txt`
- Create: `tests/test_internal_api.py`
- Modify: `tests/test_config.py`
- Delete: `app/static/index.html`
- Delete: `app/static/app.js`
- Delete: `app/static/style.css`

**Interfaces:**
- Consumes: existing `ai_agent_online() -> bool`, `send_magic_packet(mac, broadcast, port)`, existing Wake rate limiter.
- Produces:
  - `GET /health` without relay auth.
  - `GET /internal/status` requiring `Authorization: Bearer <WOL_RELAY_SHARED_SECRET>`.
  - `POST /internal/targets/ai-agent/wake` requiring the same bearer token.
  - startup-required `WOL_RELAY_SHARED_SECRET`.

- [ ] **Step 1: Write failing authentication tests**

Create TestClient cases for missing, malformed, and wrong bearer auth. Assert `401` and assert neither probe nor Magic Packet function is called.

Run: `python -m unittest tests.test_internal_api -v`

Expected: FAIL because internal endpoints/auth do not exist.

- [ ] **Step 2: Add dev-only TestClient dependency**

Create `requirements-dev.txt` with a FastAPI-compatible `httpx` range.

Run: `python -m pip install -r requirements.txt -r requirements-dev.txt`

Expected: exit 0.

- [ ] **Step 3: Implement relay auth and internal status**

In `app/main.py` require `WOL_RELAY_SHARED_SECRET`, implement `require_relay_auth(request)`, parse only Bearer auth, compare using `hmac.compare_digest`, and add `GET /internal/status` returning relay online plus fixed `ai-agent` online/offline status.

Run the targeted tests.

Expected: PASS for auth/status.

- [ ] **Step 4: Write failing Wake behavior tests**

Assert:
- online -> `409`, no Magic Packet;
- offline -> `202`, exactly one fixed Magic Packet;
- repeated accepted Wake -> `429`;
- unknown internal target path -> `404`;
- body/query `mac`, `url`, `broadcast`, `host` fields cannot alter the fixed destination.

Expected: FAIL before route implementation.

- [ ] **Step 5: Implement fixed internal Wake route**

Add only `POST /internal/targets/ai-agent/wake`. Reuse online check, rate limit, WoL send, sanitized logging.

Remove browser-facing `/api/status`, `/api/wake`, root/static routes, Cloudflare Access assertion check, and `REQUIRE_CF_ACCESS`.

Keep `/health` side-effect free.

Run: `python -m unittest discover -s tests -v`

Expected: all Python tests PASS.

- [ ] **Step 6: Remove gateway UI and update env example**

Delete `app/static/*`. Keep WoL/probe settings, add `WOL_RELAY_SHARED_SECRET=replace-with-random-secret`, remove `REQUIRE_CF_ACCESS`, keep Tunnel token absent.

- [ ] **Step 7: Commit**

`git commit -m "refactor: make gateway a private wol relay"`

---

### Task 2: Add Worker target model and GatewayRelay abstraction

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/src/domain/target.ts`
- Create: `worker/src/domain/relay.ts`
- Create: `worker/src/relays/gateway.ts`
- Create: `worker/test/target-registry.test.ts`
- Create: `worker/test/gateway-relay.test.ts`

**Interfaces:**
- Produces `TargetStatus = "online" | "offline" | "unknown"`.
- Produces `RelayStatus = "online" | "unavailable"`.
- Produces fixed `TARGETS` containing only `ai-agent`.
- Produces `WolRelay` with `status()`, `getTargetStatus(target)`, and `wake(target)`.
- Produces `GatewayRelay implements WolRelay`.

- [ ] **Step 1: Scaffold Worker tooling**

Add strict TypeScript, Node built-in node:test, Wrangler 4, Workers types, and scripts `test`, `typecheck`, `wrangler:dry-run`.

Run: `cd worker && npm install && npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Write failing target registry tests**

Assert exactly one target `ai-agent`, name `AIエージェントPC`, relay `home-gateway`, and unknown IDs are not synthesized.

Expected: FAIL.

- [ ] **Step 3: Implement domain contracts**

Create target/relay types and fixed registry lookup.

Run registry tests + typecheck.

Expected: PASS.

- [ ] **Step 4: Write failing GatewayRelay tests**

Using a fake `HOME_NETWORK.fetch`, assert:
- fixed URL `http://localhost:8088/internal/status`;
- bearer secret header;
- VPC fetch exception -> relay unavailable;
- malformed/unexpected gateway status -> target unknown;
- Wake path fixed to `/internal/targets/ai-agent/wake`;
- `202`, `409`, `429` map to typed Wake results;
- unexpected gateway error is sanitized;
- target data cannot change host/path.

Expected: FAIL.

- [ ] **Step 5: Implement GatewayRelay**

Keep the gateway origin module-private and fixed; do not accept a URL from public request data.

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: add worker relay domain and gateway adapter"`

---

### Task 3: Implement Worker public API and static UI

**Files:**
- Create: `worker/src/index.ts`
- Create: `worker/src/api/targets.ts`
- Create: `worker/src/api/relays.ts`
- Create: `worker/public/index.html`
- Create: `worker/public/app.js`
- Create: `worker/public/style.css`
- Create: `worker/test/public-api.test.ts`
- Create: `worker/test/routing.test.ts`

**Interfaces:**
- `GET /api/targets`
- `GET /api/relays`
- `POST /api/targets/ai-agent/wake`
- non-API requests -> `env.ASSETS.fetch(request)`.

- [ ] **Step 1: Write failing public API tests**

Assert:
- relay online + target online -> `online`, Wake disabled;
- relay online + target offline -> `offline`, Wake enabled;
- relay unavailable -> target `unknown`, Wake disabled;
- relay diagnostics expose `home-gateway`;
- unknown target Wake -> `404`, relay not called;
- online -> `409`;
- unavailable relay -> `503`;
- accepted Wake -> `202`;
- request body/query cannot inject destination/MAC/relay.

Expected: FAIL.

- [ ] **Step 2: Implement API handlers against `WolRelay`**

Handlers receive a relay interface; they do not construct arbitrary destinations.

Expected: API tests PASS.

- [ ] **Step 3: Write failing routing/sanitization tests**

Assert:
- exact API routing;
- invalid method/path -> `404`/`405`;
- non-API -> Assets binding;
- gateway exceptions -> sanitized API error;
- responses never include `127.0.0.1`, relay secret, MAC, or Python stack details.

Expected: FAIL.

- [ ] **Step 4: Implement Worker entrypoint**

Env contains `HOME_NETWORK`, `ASSETS`, `WOL_RELAY_SHARED_SECRET`. Instantiate `GatewayRelay`; route API; delegate assets.

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Move UI to Worker Static Assets**

UI displays:
- gateway online/unavailable;
- AI online/offline/unknown;
- Wake only when AI is offline and relay is online;
- 5-second polling;
- 90-second post-Wake starting window, then retry enabled.

Browser talks only to Worker APIs.

- [ ] **Step 6: Add asset leak checks**

Assert static files contain no relay secret name/value, private origin, MAC placeholder, or Tunnel UUID.

Run full Worker tests/typecheck.

Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -m "feat: add worker control plane and ui"`

---

### Task 4: Add Wrangler VPC, Static Assets, and Custom Domain configuration

**Files:**
- Create: `worker/wrangler.template.json`
- Create: `worker/scripts/render-wrangler.mjs`
- Create: `worker/test/render-wrangler.test.mjs`
- Create: `worker/.gitignore`
- Modify: `worker/package.json`

**Interfaces:**
- Consumes Repository Variable `CLOUDFLARE_TUNNEL_ID`.
- Produces ignored `worker/wrangler.generated.json`.

- [ ] **Step 1: Write failing config-render tests**

Assert missing/invalid Tunnel UUID fails. Valid render must include:
- `name: "wol-gateway"`;
- `main: "src/index.ts"`;
- compatibility date `2026-09-27`;
- `workers_dev:false`;
- Custom Domain `wol.y-ohi.com`;
- Assets `./public`, binding `ASSETS`, `run_worker_first:["/api/*"]`;
- VPC Network binding `HOME_NETWORK`, supplied `tunnel_id`, `remote:true`;
- no relay secret.

Expected: FAIL.

- [ ] **Step 2: Implement template/renderer**

Renderer validates canonical UUID, replaces only the VPC Tunnel ID, writes `wrangler.generated.json`, and never reads/serializes the relay secret.

Ignore generated config and `.dev.vars`.

- [ ] **Step 3: Verify Wrangler dry-run**

Run:

`CLOUDFLARE_TUNNEL_ID=550e8400-e29b-41d4-a716-446655440000 node scripts/render-wrangler.mjs`

then:

`npx wrangler deploy --dry-run --config wrangler.generated.json`

Expected: exit 0, no live deploy.

- [ ] **Step 4: Gate live deployment on Tunnel readiness**

Verify `cloudflared --version` >= 2025.7.0, QUIC not disabled, outbound UDP/7844 usable. Stop before hostname cutover if not proven.

- [ ] **Step 5: Commit**

`git commit -m "build: configure worker vpc and custom domain"`

---

### Task 5: Add GitHub Actions validation and production deployment

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-worker.yml`

**Interfaces:**
- Secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `WOL_RELAY_SHARED_SECRET`.
- Variable: `CLOUDFLARE_TUNNEL_ID`.

- [ ] **Step 1: Add no-deploy CI workflow**

PR/push CI:
- checkout;
- setup Python;
- install runtime + dev requirements;
- copy `.env.example` to `.env`;
- Python tests;
- `docker compose config`;
- setup Node with npm cache;
- `npm install`;
- Worker tests;
- typecheck;
- render Wrangler config with documentation UUID;
- Wrangler `deploy --dry-run`.

Run the same commands locally.

Expected: all exit 0.

- [ ] **Step 2: Add production deploy workflow**

Trigger on push to `master` plus `workflow_dispatch`.

Use:
- `permissions: contents: read`;
- production concurrency with no cancellation of an in-flight deploy;
- checkout + Node setup + `npm install`;
- config render using GitHub Repository Variable `CLOUDFLARE_TUNNEL_ID`;
- `cloudflare/wrangler-action@v4`;
- `wranglerVersion: "4"`;
- `workingDirectory: "worker"`;
- `apiToken` and `accountId` from GitHub Secrets;
- write an ephemeral git-ignored `.secrets.production.json` from `WOL_RELAY_SHARED_SECRET`;
- command `deploy --config wrangler.generated.json --secrets-file .secrets.production.json`;
- remove the secret file in an `if: always()` cleanup step.

Never echo secrets.

- [ ] **Step 3: Add workflow static checks**

Assert:
- deploy workflow uses `wrangler-action@v4`;
- all three secret names and Tunnel variable are referenced;
- PR CI has no live Wrangler deploy;
- no literal token/shared-secret values appear.

Run full repository tests.

Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "ci: validate and deploy cloudflare worker"`

---

### Task 6: Update docs and production cutover/rollback runbook

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify spec only if implementation discoveries require synchronization.

- [ ] **Step 1: Update architecture/setup docs**

Document Worker ownership of UI/API, gateway-only internal relay, GitHub secrets/variable, Workers VPC beta, cloudflared >=2025.7.0, QUIC requirement, public API semantics, and future `Esp32Relay` boundary.

- [ ] **Step 2: Update security model**

Document Access at `wol.y-ohi.com`, VPC Network boundary, bearer defense-in-depth, fixed destination/no generic proxy, and the broader private-network reach granted by VPC Network binding.

Document that direct Tunnel binding requires Connectivity Directory Admin and CI API token scopes must be minimal.

- [ ] **Step 3: Document exact cutover order**

1. Set GitHub Secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `WOL_RELAY_SHARED_SECRET`.
2. Set Repository Variable `CLOUDFLARE_TUNNEL_ID`.
3. Put the same relay secret in gateway `.env`.
4. Restart gateway relay; verify local `/health`.
5. Verify cloudflared version/QUIC readiness.
6. Confirm hostname-based Access policy remains configured.
7. Remove only the old Tunnel published hostname/DNS ownership for `wol.y-ohi.com`; keep the Tunnel connector.
8. Trigger/allow Worker production deployment so the Custom Domain can claim `wol.y-ohi.com`.
9. Verify Access login, UI, relay state, target state, and one real Wake.
10. Rollback on Custom Domain failure by restoring the old Tunnel published hostname.

- [ ] **Step 4: Run final verification**

Run:

`python -m unittest discover -s tests -v`

`docker compose config`

`cd worker && npm install && npm test && npm run typecheck`

`CLOUDFLARE_TUNNEL_ID=550e8400-e29b-41d4-a716-446655440000 node scripts/render-wrangler.mjs`

`npx wrangler deploy --dry-run --config wrangler.generated.json`

Expected: all pass/exit 0.

- [ ] **Step 5: Final spec/diff review**

Confirm:
- browser never reaches gateway directly;
- relay outage -> target unknown;
- only `ai-agent` can Wake;
- no secret/private destination in static assets;
- no Tunnel token;
- no Durable Object/ESP32 implementation;
- future `Esp32Relay` can implement `WolRelay` without public API change.

- [ ] **Step 6: Commit**

`git commit -m "docs: document worker deployment and cutover"`
