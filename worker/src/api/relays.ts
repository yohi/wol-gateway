import type { WolRelay } from "../domain/relay.js";

export async function listRelays(relay: WolRelay): Promise<Response> {
  const status = await relay.status();
  return new Response(
    JSON.stringify({ relays: [{ id: relay.id, type: relay.type, status }] }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
