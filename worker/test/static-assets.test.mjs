import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const file of ['index.html', 'app.js', 'style.css']) {
  test(`${file} does not leak private relay configuration`, async () => {
    const text = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    for (const forbidden of ['WOL_RELAY_SHARED_SECRET', '127.0.0.1:8088', 'localhost:8088', 'AA:BB:CC:DD:EE:FF', 'CLOUDFLARE_TUNNEL_ID']) {
      assert.ok(!text.includes(forbidden), `${file} leaked ${forbidden}`);
    }
  });
}
