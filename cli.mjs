import { readFile } from 'node:fs/promises';
import { analyze, parsePacket, privateSummary } from './src/receipt.js';
import { lookup } from './src/client.js';

try {
  const [arg, value] = process.argv.slice(2);
  if (!arg) throw new Error('Usage: node cli.mjs <evidence.json> | --live <transaction-id>');
  const packet = arg === '--live' ? await lookup(value) : parsePacket(await readFile(arg, 'utf8'));
  console.log(JSON.stringify(privateSummary(analyze(packet), true), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
