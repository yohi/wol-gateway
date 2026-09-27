import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = dirname(here);
const script = join(workerDir, 'scripts', 'render-wrangler.mjs');
const template = join(workerDir, 'wrangler.template.json');
const goodUuid = '550e8400-e29b-41d4-a716-446655440000';

async function run(id) {
  const dir = await mkdtemp(join(tmpdir(), 'wol-wrangler-'));
  const localTemplate = join(dir, 'wrangler.template.json');
  await copyFile(template, localTemplate);
  const out = join(dir, 'wrangler.generated.json');
  const env = { ...process.env };
  if (id !== undefined) env.CLOUDFLARE_TUNNEL_ID = id;
  else delete env.CLOUDFLARE_TUNNEL_ID;
  return {
    result: spawnSync(process.execPath, [script, localTemplate, out], { env, encoding:'utf8' }),
    out,
  };
}

test('missing tunnel id fails', async () => {
  const { result } = await run(undefined);
  assert.notEqual(result.status, 0);
});

test('invalid tunnel id fails', async () => {
  const { result } = await run('not-a-uuid');
  assert.notEqual(result.status, 0);
});

test('valid tunnel id renders production worker config', async () => {
  const { result, out } = await run(goodUuid);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(config.name, 'wol-gateway');
  assert.equal(config.main, 'src/index.ts');
  assert.equal(config.compatibility_date, '2026-09-27');
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [{ pattern:'wol.y-ohi.com', custom_domain:true }]);
  assert.deepEqual(config.assets, {
    directory:'./public', binding:'ASSETS', run_worker_first:['/api/*']
  });
  assert.deepEqual(config.vpc_networks, [{ binding:'HOME_NETWORK', tunnel_id:goodUuid, remote:true }]);
  assert.deepEqual(config.secrets, { required:['WOL_RELAY_SHARED_SECRET'] });
  const raw = await readFile(out, 'utf8');
  assert.ok(!raw.includes('replace-with-random-secret'));
});
