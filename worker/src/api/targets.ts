import type { WolRelay } from "../domain/relay.js";
import { getTarget, TARGETS } from "../domain/target.js";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(headers ?? {}) },
  });
}

export async function listTargets(relay: WolRelay): Promise<Response> {
  const relayStatus = await relay.status();
  const target = TARGETS["ai-agent"];
  const targetStatus = relayStatus === "online"
    ? await relay.getTargetStatus(target)
    : "unknown";

  return json({
    targets: [
      {
        id: target.id,
        name: target.name,
        status: targetStatus,
        wakeAvailable: relayStatus === "online" && targetStatus === "offline",
        relay: { id: relay.id, status: relayStatus },
      },
    ],
  });
}

export async function wakeTarget(targetId: string, relay: WolRelay): Promise<Response> {
  const target = getTarget(targetId);
  if (!target) return json({ error: "target_not_found" }, 404);

  if (await relay.status() !== "online") {
    return json({ error: "relay_unavailable" }, 503);
  }

  const targetStatus = await relay.getTargetStatus(target);
  if (targetStatus === "online") {
    return json({ error: "already_online" }, 409);
  }
  if (targetStatus !== "offline") {
    return json({ error: "target_status_unknown" }, 503);
  }

  const result = await relay.wake(target);
  switch (result.status) {
    case "accepted":
      return json({ status: "accepted" }, 202);
    case "already_online":
      return json({ error: "already_online" }, 409);
    case "rate_limited": {
      const headers = result.retryAfter === undefined
        ? undefined
        : { "retry-after": String(result.retryAfter) };
      return json({ error: "rate_limited" }, 429, headers);
    }
    case "unavailable":
      return json({ error: "relay_unavailable" }, 503);
  }
}
