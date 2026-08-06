#!/usr/bin/env node
// modsearch eval runner (v1). Runs the seed cases against the real CLI, writes
// one evidence artifact per case under evals/results/<date>/, and prints a
// pass-rate and latency summary. Meant to be run locally, on demand, not in CI:
// most cases spend real engine quota. The SSRF case spends nothing and always
// runs; the rest run only when this machine has the engine each one needs.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const evalsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(evalsDir);
const cliPath = path.join(repoRoot, 'dist', 'main.js');
const casesDir = path.join(evalsDir, 'cases');

const RUN_TIMEOUT_MS = 240_000;

/** Run the built CLI with args; resolve with stdout, stderr, exit code, latency. */
function runCli(args, { timeoutMs = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: repoRoot });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, latencyMs: Date.now() - startedAt });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: String(error), code: -1, latencyMs: Date.now() - startedAt });
    });
  });
}

/** Read what this machine can do, so cases with unmet prerequisites are skipped. */
async function readCapabilities() {
  const { stdout, code } = await runCli(['doctor', '--json'], { timeoutMs: 20_000 });
  if (code !== 0) {
    return { search: false, social: false };
  }
  try {
    const report = JSON.parse(stdout);
    const resolved = (name) => Boolean(report.roles?.find((r) => r.role === name)?.resolved);
    return { search: resolved('search'), social: resolved('social') };
  } catch {
    return { search: false, social: false };
  }
}

/** Does this machine meet a case's requirement? Returns a skip reason or null. */
function skipReason(requirement, caps) {
  switch (requirement) {
    case 'none':
    case 'fetch':
      return null;
    case 'search':
      return caps.search ? null : 'no search engine is set up (agy or a Tavily key)';
    case 'search-no-social':
      if (!caps.search) return 'no search engine is set up to answer the degraded query';
      if (caps.social) return 'Grok is signed in here, so there is nothing to degrade';
      return null;
    default:
      return `unknown requirement "${requirement}"`;
  }
}

function gitCommit() {
  return new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.on('close', () => resolve(out.trim() || null));
    child.on('error', () => resolve(null));
  });
}

function toolVersion() {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version ?? null
    );
  } catch {
    return null;
  }
}

async function loadCases() {
  const files = fs
    .readdirSync(casesDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
  const cases = [];
  for (const file of files) {
    const mod = await import(path.join(casesDir, file));
    if (mod.default) {
      cases.push(mod.default);
    }
  }
  return cases;
}

async function main() {
  if (!fs.existsSync(cliPath)) {
    process.stderr.write(`Build first: ${cliPath} is missing. Run "pnpm build".\n`);
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  const resultsDir = path.join(evalsDir, 'results', date);
  fs.mkdirSync(resultsDir, { recursive: true });

  const [caps, commit, version, cases] = await Promise.all([
    readCapabilities(),
    gitCommit(),
    Promise.resolve(toolVersion()),
    loadCases(),
  ]);

  const summary = [];

  for (const testCase of cases) {
    const reason = skipReason(testCase.requirement, caps);
    const command = `modsearch ${testCase.args.join(' ')}`;
    const base = {
      case: testCase.id,
      title: testCase.title,
      runAt: new Date().toISOString(),
      command,
      tool: { version, commit },
      requirement: testCase.requirement,
      expectation: testCase.expectation,
    };

    if (reason) {
      const artifact = { ...base, skipped: true, skipReason: reason };
      fs.writeFileSync(
        path.join(resultsDir, `${testCase.id}.json`),
        `${JSON.stringify(artifact, null, 2)}\n`,
      );
      summary.push({ id: testCase.id, status: 'SKIP', latencyMs: null, detail: reason });
      continue;
    }

    const run = await runCli(testCase.args);
    let result = null;
    if (!testCase.expectError) {
      try {
        result = JSON.parse(run.stdout);
      } catch {
        // Left null: the check will fail, and the raw output is kept below.
      }
    }

    let verdict = { pass: false, detail: 'check threw' };
    try {
      verdict = testCase.expectError ? testCase.check(run) : testCase.check(result ?? {}, run);
    } catch (error) {
      verdict = { pass: false, detail: `check error: ${error?.message ?? error}` };
    }

    const entry = result?.results?.[0] ?? null;
    const artifact = {
      ...base,
      skipped: false,
      query: result?.query ?? null,
      url: result?.url ?? null,
      pass: verdict.pass,
      detail: verdict.detail ?? null,
      exitCode: run.code,
      latencyMs: run.latencyMs,
      metaDurationSeconds: result?.meta?.durationSeconds ?? null,
      engine: entry?.engine ?? null,
      model: entry?.model ?? null,
      status: entry?.status ?? null,
      uncertainty: entry?.uncertainty ?? null,
      warnings: entry?.warnings ?? null,
      attempts: entry?.attempts ?? null,
      tokens: null, // not surfaced by the CLI envelope today
      rawStdout: run.stdout,
      rawStderr: run.stderr,
    };
    fs.writeFileSync(
      path.join(resultsDir, `${testCase.id}.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    summary.push({
      id: testCase.id,
      status: verdict.pass ? 'PASS' : 'FAIL',
      latencyMs: run.latencyMs,
      detail: verdict.detail ?? '',
    });
  }

  // Summary
  const ran = summary.filter((s) => s.status !== 'SKIP');
  const passed = ran.filter((s) => s.status === 'PASS').length;
  const latencies = ran.map((s) => s.latencyMs).filter((n) => typeof n === 'number');
  const avg = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const max = latencies.length ? Math.max(...latencies) : 0;

  process.stdout.write('\nmodsearch evals\n');
  for (const s of summary) {
    const lat = s.latencyMs == null ? '     -' : `${s.latencyMs}`.padStart(6);
    process.stdout.write(`  ${s.status.padEnd(4)} ${s.id.padEnd(16)} ${lat}ms  ${s.detail}\n`);
  }
  process.stdout.write(
    `\n  ${passed}/${ran.length} passed` +
      (summary.length - ran.length ? `, ${summary.length - ran.length} skipped` : '') +
      (latencies.length ? `. latency avg ${avg}ms, max ${max}ms` : '') +
      `\n  artifacts: ${path.relative(repoRoot, resultsDir)}/\n`,
  );

  process.exit(ran.length > 0 && passed < ran.length ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`eval runner failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
