import { Resolver } from 'node:dns/promises';
import { config } from '../src/config.js';

// A read-only comparison. This script does not change system or app DNS settings.
let hostname;
try {
  hostname = new URL(config.MONGODB_URI).hostname;
} catch {
  console.log('Atlas URI could not be read. Check MONGODB_URI in .env.');
  process.exit(1);
}
for (const [label, servers] of [
  ['System DNS', null],
  ['Cloudflare DNS diagnostic', ['1.1.1.1']],
  ['Google DNS diagnostic', ['8.8.8.8']],
]) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  if (servers) resolver.setServers(servers);
  try {
    const records = await resolver.resolveSrv(`_mongodb._tcp.${hostname}`);
    console.log(`${label}: ${records.length} Atlas connection records found.`);
  } catch (error) {
    const code = ['ENOTFOUND', 'ECONNREFUSED', 'ESERVFAIL', 'ETIMEOUT', 'ENODATA'].includes(
      error.code,
    )
      ? error.code
      : 'LOOKUP_FAILED';
    console.log(`${label}: ${code}.`);
  }
}
