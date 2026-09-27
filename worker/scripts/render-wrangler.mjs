import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const tunnelId = process.env.CLOUDFLARE_TUNNEL_ID;
if (!tunnelId || !uuidPattern.test(tunnelId)) {
  console.error('CLOUDFLARE_TUNNEL_ID must be a canonical UUID');
  process.exit(2);
}

const templatePath = resolve(process.argv[2] ?? 'wrangler.template.json');
const outputPath = resolve(process.argv[3] ?? 'wrangler.generated.json');
const config = JSON.parse(await readFile(templatePath, 'utf8'));

if (!Array.isArray(config.vpc_networks) || config.vpc_networks.length !== 1) {
  throw new Error('wrangler template must contain exactly one VPC binding');
}
if (config.vpc_networks[0].binding !== 'HOME_NETWORK') {
  throw new Error('wrangler template VPC binding must be HOME_NETWORK');
}
config.vpc_networks[0].tunnel_id = tunnelId;

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
