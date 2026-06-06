import { loadConfig } from './config.mjs';
import { extractRtkQuery } from './adapters/rtk-query.mjs';
import { extractNestjs } from './adapters/nestjs.mjs';
import { match } from './match.mjs';
import { reportHuman } from './reporters/human.mjs';
import { reportJson } from './reporters/json.mjs';

const CLIENT_ADAPTERS = { 'rtk-query': extractRtkQuery };
const SERVER_ADAPTERS = { nestjs: extractNestjs };

export function run(argv) {
  const args = parseArgs(argv);
  if (args.help) return printHelp();

  const cfg = loadConfig(args.config);

  const clientAdapter = CLIENT_ADAPTERS[cfg.client.adapter];
  const serverAdapter = SERVER_ADAPTERS[cfg.server.adapter];
  if (!clientAdapter) throw new Error(`Unknown client adapter: ${cfg.client.adapter}`);
  if (!serverAdapter) throw new Error(`Unknown server adapter: ${cfg.server.adapter}`);

  const endpoints = clientAdapter(cfg.client);
  const routes = serverAdapter(cfg.server);

  const result = match(endpoints, routes, {
    basePath: cfg.client.basePath,
    ignore: cfg.ignore,
  });

  if (args.json) reportJson(result);
  else reportHuman(result, { command: args.command });

  // Exit code: fail when a configured bucket is non-empty (unless --no-fail).
  if (args.command === 'check' && !args.noFail) {
    const failing = (cfg.failOn || []).some((k) => (result.totals[k] || 0) > 0);
    if (failing) process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const args = { command: 'check', json: false, noFail: false, config: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'check' || a === 'list' || a === 'orphans') args.command = a;
    else if (a === '--json') args.json = true;
    else if (a === '--no-fail') args.noFail = true;
    else if (a === '--config') args.config = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
seam — static FE↔BE contract-drift checker

USAGE
  seam [check|list|orphans] [options]

COMMANDS
  check      Report drift + unverifiable calls, exit non-zero on drift (default)
  list       Print the full resolved contract map (every endpoint + its status)
  orphans    List backend routes no resolvable frontend call reaches

OPTIONS
  --config <path>   Path to seam.config.json (default: search up from cwd)
  --json            Machine-readable output
  --no-fail         Always exit 0 (report only)
  -h, --help        Show this help
`);
}
