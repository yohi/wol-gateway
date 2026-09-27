import { listRelays } from "./api/relays.js";
import { listTargets, wakeTarget } from "./api/targets.js";
import { GatewayRelay, type NetworkBinding } from "./relays/gateway.js";

export interface AssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  HOME_NETWORK: NetworkBinding;
  ASSETS: AssetsBinding;
  WOL_RELAY_SHARED_SECRET: string;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const relay = new GatewayRelay(env.HOME_NETWORK, env.WOL_RELAY_SHARED_SECRET);

  if (url.pathname === "/api/targets") {
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "content-type": "application/json", allow: "GET" },
      });
    }
    return listTargets(relay);
  }

  if (url.pathname === "/api/relays") {
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "content-type": "application/json", allow: "GET" },
      });
    }
    return listRelays(relay);
  }

  const wakeMatch = /^\/api\/targets\/([^/]+)\/wake$/.exec(url.pathname);
  if (wakeMatch) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { "content-type": "application/json", allow: "POST" },
      });
    }
    if (request.headers.get("x-wol-confirm") !== "wake") {
      return new Response(JSON.stringify({ error: "wake_confirmation_required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return wakeTarget(decodeURIComponent(wakeMatch[1]), relay);
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
