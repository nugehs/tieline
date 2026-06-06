import { loadConfig } from './config.mjs';
import { extractRtkQuery } from './adapters/rtk-query.mjs';
import { extractNestjs } from './adapters/nestjs.mjs';
import { extractOpenapi } from './adapters/openapi.mjs';
import { extractExpress } from './adapters/express.mjs';
import { extractFastify } from './adapters/fastify.mjs';
import { extractNext } from './adapters/next.mjs';
import { extractFastapi } from './adapters/fastapi.mjs';
import { extractFlask } from './adapters/flask.mjs';
import { extractSpring } from './adapters/spring.mjs';
import { extractAxiosFetch } from './adapters/axios-fetch.mjs';
import { extractAngularHttp } from './adapters/angular-http.mjs';
import { match } from './match.mjs';
import { doctor } from './doctor.mjs';
import { reportHuman, reportDoctor } from './reporters/human.mjs';
import { reportJson, reportDoctorJson } from './reporters/json.mjs';
import { reportHtml } from './reporters/html.mjs';
import { writeFileSync } from 'node:fs';

const CLIENT_ADAPTERS = {
  'rtk-query': extractRtkQuery,
  'axios-fetch': extractAxiosFetch,
  'angular-http': extractAngularHttp,
};
const SERVER_ADAPTERS = {
  nestjs: extractNestjs,
  openapi: extractOpenapi,
  express: extractExpress,
  fastify: extractFastify,
  next: extractNext,
  fastapi: extractFastapi,
  flask: extractFlask,
  spring: extractSpring,
};

export async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) return printHelp();

  const cfg = loadConfig(args.config);

  if (args.command === 'doctor') return runDoctor(cfg, args);

  const clientAdapter = CLIENT_ADAPTERS[cfg.client.adapter];
  const serverAdapter = SERVER_ADAPTERS[cfg.server.adapter];
  if (!clientAdapter) throw new Error(`Unknown client adapter: ${cfg.client.adapter}`);
  if (!serverAdapter) throw new Error(`Unknown server adapter: ${cfg.server.adapter}`);

  const endpoints = await clientAdapter(cfg.client);
  const routes = await serverAdapter(cfg.server);

  const result = match(endpoints, routes, {
    basePath: cfg.client.basePath,
    ignore: cfg.ignore,
  });

  if (args.html) {
    writeFileSync(args.html, reportHtml(result, {
      clientAdapter: cfg.client.adapter,
      serverAdapter: cfg.server.adapter,
      generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    }));
    console.log(`\n  📄 HTML report written to ${args.html}\n`);
  }

  if (args.json) reportJson(result);
  else if (!args.html) reportHuman(result, { command: args.command });

  // Exit code: fail when a configured bucket is non-empty (unless --no-fail).
  if (args.command === 'check' && !args.noFail) {
    const failing = (cfg.failOn || []).some((k) => (result.totals[k] || 0) > 0);
    if (failing) process.exitCode = 1;
  }
}

// `seam doctor`: diff native-parsed code routes against the OpenAPI spec.
async function runDoctor(cfg, args) {
  const codeAdapter = SERVER_ADAPTERS[cfg.server.adapter];
  if (!codeAdapter) throw new Error(`Unknown server adapter: ${cfg.server.adapter}`);
  if (cfg.server.adapter === 'openapi') {
    throw new Error("`doctor` needs a native server adapter (e.g. nestjs) as the code source, plus server.spec for the doc.");
  }
  if (!cfg.server.spec) {
    throw new Error('`doctor` needs `server.spec` (file path or url to the OpenAPI doc) in your config.');
  }

  const codeRoutes = await codeAdapter(cfg.server);
  const specRoutes = await extractOpenapi({
    spec: cfg.server.spec,
    stripPrefix: cfg.server.globalPrefix,
    repoRoot: cfg.server.repoRoot,
  });

  const result = doctor(codeRoutes, specRoutes, {
    basePath: cfg.server.globalPrefix,
    ignore: cfg.ignore,
  });

  if (args.json) reportDoctorJson(result);
  else reportDoctor(result, { codeAdapter: cfg.server.adapter, specSource: cfg.server.spec });

  if (!args.noFail) {
    const fail = (cfg.doctorFailOn || ['undocumented']).some((k) => (result.totals[k] || 0) > 0);
    if (fail) process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const args = { command: 'check', json: false, noFail: false, config: null, help: false, html: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'check' || a === 'list' || a === 'orphans' || a === 'doctor') args.command = a;
    else if (a === '--json') args.json = true;
    else if (a === '--no-fail') args.noFail = true;
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--html') args.html = argv[++i] || 'seam-report.html';
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
  doctor     Diff native-parsed code routes vs the OpenAPI spec (needs server.spec):
             undocumented (in code, not in spec) + phantom (in spec, not in code)

OPTIONS
  --config <path>   Path to seam.config.json (default: search up from cwd)
  --json            Machine-readable output
  --html <file>     Write a self-contained HTML report (with a contract-flow chart)
  --no-fail         Always exit 0 (report only)
  -h, --help        Show this help
`);
}
