#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { check, sync } from '../lib/consumer.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const help = `Usage: laserjm-skills <sync|check|list> [--project <directory>]

sync   Replace selected managed skills and remove deselected managed skills.
check  Verify the Git pin, npm lockfile, receipt, and all managed files; read-only.
list   List the skills available in this installed package.

Run sync/check from the npm project containing skills.config.json, or select it
with --project. Commit the synchronized directories and skills-installed.json.`;

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
    console.log(help);
  } else {
    const command = args.shift();
    let project = process.cwd();
    if (args.length === 2 && args[0] === '--project') project = path.resolve(args[1]);
    else if (args.length) throw new Error(help);
    if (command === 'list') {
      const catalog = await loadCatalog(packageRoot);
      for (const [name, skill] of Object.entries(catalog.skills)) console.log(`${name}: ${skill.description}`);
    } else if (command === 'sync' || command === 'check') {
      const receipt = await (command === 'sync' ? sync : check)(project, packageRoot);
      console.log(`${command === 'sync' ? 'Synchronized' : 'Verified'} ${receipt.installations.length} skill installations at ${receipt.source.commit}.`);
    } else {
      throw new Error(help);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
