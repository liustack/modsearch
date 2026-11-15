// Head-to-head of the keyless engines on the built CLI, for deciding the
// default engine order. Each run is forced with -e, under an empty HOME so no
// user key or preference leaks in, and with project config off. Search is
// scored by where an authoritative host first appears in the ranked list
// (rank 1 to 10, MRR). Fetch is scored by whether the page's known phrase came
// back. Everything runs on keyless pools: no key, no paid quota.
//
//   pnpm build && pnpm eval:compare
//
// Rows and a summary land in evals/results/<date>/compare/ (gitignored).
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const CLI = join(dirname(evalsDir), 'dist', 'main.js');
const OUT = join(evalsDir, 'results', new Date().toISOString().slice(0, 10), 'compare');
mkdirSync(OUT, { recursive: true });
const HOME = mkdtempSync(join(tmpdir(), 'modsearch-compare-'));
const ENV = { ...process.env, HOME, MODSEARCH_PROJECT_CONFIG: 'off' };
for (const k of ['FIRECRAWL_API_KEY', 'KEENABLE_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY']) {
  delete ENV[k];
}

const SEARCH = [
  ['en-tech', 'Node.js release schedule', /(^|\.)nodejs\.org$|github\.com$/],
  ['en-tech', 'Python asyncio TaskGroup documentation', /docs\.python\.org$/],
  ['en-tech', 'TypeScript satisfies operator', /typescriptlang\.org$/],
  ['en-tech', 'Rust ownership and borrowing', /doc\.rust-lang\.org$/],
  ['en-tech', 'PostgreSQL GIN index jsonb', /postgresql\.org$/],
  ['en-tech', 'fetch API AbortController', /developer\.mozilla\.org$/],
  ['en-tech', 'React useEffect cleanup function', /react\.dev$/],
  ['en-tech', 'Kubernetes PodDisruptionBudget', /kubernetes\.io$/],
  ['en-tech', 'vitest mock global fetch', /vitest\.dev$/],
  ['en-tech', 'SQLite WAL mode', /sqlite\.org$/],
  ['en-tech', 'Go generics tutorial', /go\.dev$/],
  ['en-tech', 'pnpm workspace protocol', /pnpm\.io$/],
  ['en-tech', 'Tailwind CSS dark mode', /tailwindcss\.com$/],
  ['en-tech', 'curl --resolve option', /curl\.se$|everything\.curl\.dev$/],
  ['en-deep', 'sqlite PRAGMA quick_check vs integrity_check', /sqlite\.org$/],
  ['en-deep', 'Node.js http.Agent keepAlive maxSockets default', /nodejs\.org$/],
  ['en-legal', 'RFC 9110 HTTP semantics', /rfc-editor\.org$|ietf\.org$/],
  ['en-legal', 'GDPR Article 17 right to erasure', /gdpr-info\.eu$|eur-lex\.europa\.eu$/],
  ['zh', 'Vue 3 组合式 API 文档', /vuejs\.org$/],
  ['zh', '个人信息保护法 全文', /npc\.gov\.cn$|gov\.cn$|cac\.gov\.cn$/],
  ['zh', 'DeepSeek API 文档', /deepseek\.com$/],
  ['zh', '微信小程序 开发文档', /developers\.weixin\.qq\.com$/],
  // The tutorial's own source lives on GitHub, so that counts as authoritative.
  ['zh', '阮一峰 ES6 入门教程', /ruanyifeng\.com$|^github\.com$/],
  ['zh', 'Python 官方文档 中文', /docs\.python\.org$/],
];

const FETCH = [
  ['https://nodejs.org/en/about/previous-releases', /LTS/],
  ['https://docs.python.org/3/library/asyncio-task.html', /TaskGroup/],
  ['https://developer.mozilla.org/en-US/docs/Web/API/AbortController', /abort\(\)/],
  ['https://react.dev/reference/react/useEffect', /cleanup/i],
  ['https://github.com/liustack/modsearch', /modsearch/i],
  ['https://www.rfc-editor.org/rfc/rfc9110', /Semantics/],
  ['https://kubernetes.io/docs/concepts/workloads/pods/disruptions/', /PodDisruptionBudget/],
  ['https://pnpm.io/workspaces', /workspace:/],
  ['https://www.sqlite.org/wal.html', /Write-Ahead/],
  ['https://news.ycombinator.com/', /Hacker News|points/],
  ['https://www.npmjs.com/package/@liustack/modsearch', /modsearch/],
  ['https://play.tailwindcss.com/', /tailwind/i],
  ['https://cn.vuejs.org/guide/introduction.html', /渐进式/],
  ['https://api-docs.deepseek.com/zh-cn/', /DeepSeek/],
  ['https://www.gov.cn/', /国务院|中国政府网/],
];

const SEARCH_ENGINES = ['keenable', 'firecrawl', 'youcom'];
const FETCH_ENGINES = ['keenable', 'firecrawl'];

function cli(args) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(process.execPath, [CLI, ...args], { env: ENV, timeout: 90_000, maxBuffer: 32 << 20 }, (error, stdout, stderr) => {
      let entry = null;
      try {
        entry = JSON.parse(stdout).results[0];
      } catch {}
      resolve({ ms: Date.now() - started, entry, error: entry ? null : (stderr || String(error)).trim().slice(0, 300) });
    });
  });
}

function host(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const rows = [];
for (const [category, query, expected] of SEARCH) {
  // Engines for one query run side by side, so a time-of-day wobble hits all alike.
  const runs = await Promise.all(
    SEARCH_ENGINES.map(async (engine) => {
      const run = await cli(['-q', query, '-e', engine, '--max-results', '10']);
      const items = run.entry?.status === 'ok' ? run.entry.items ?? [] : [];
      const rank = items.findIndex((item) => expected.test(host(item.url))) + 1;
      return {
        kind: 'search', category, query, engine, ms: run.ms,
        ok: run.entry?.status === 'ok', count: items.length, rank: rank || null,
        top3: items.slice(0, 3).map((i) => i.url),
        error: run.error ?? (run.entry?.status === 'ok' ? null : JSON.stringify(run.entry?.attempts ?? '')),
      };
    }),
  );
  rows.push(...runs);
  process.stderr.write(`search ${query}: ${runs.map((r) => `${r.engine}=${r.ok ? r.rank ?? '-' : 'ERR'}`).join(' ')}\n`);
}

for (const [url, expected] of FETCH) {
  const runs = await Promise.all(
    FETCH_ENGINES.map(async (engine) => {
      const run = await cli(['-u', url, '-e', engine]);
      const content = run.entry?.status === 'ok' ? run.entry.content ?? '' : '';
      return {
        kind: 'fetch', url, engine, ms: run.ms, ok: run.entry?.status === 'ok',
        chars: content.length, hit: expected.test(content),
        error: run.error ?? (run.entry?.status === 'ok' ? null : JSON.stringify(run.entry?.attempts ?? '')),
      };
    }),
  );
  rows.push(...runs);
  process.stderr.write(`fetch ${url}: ${runs.map((r) => `${r.engine}=${r.ok ? (r.hit ? 'hit' : `miss(${r.chars})`) : 'ERR'}`).join(' ')}\n`);
}

writeFileSync(join(OUT, 'rows.json'), JSON.stringify(rows, null, 2));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const summary = {};
for (const engine of SEARCH_ENGINES) {
  const r = rows.filter((x) => x.kind === 'search' && x.engine === engine);
  const byCat = {};
  for (const x of r) {
    byCat[x.category] ??= { n: 0, hit3: 0 };
    byCat[x.category].n += 1;
    if (x.rank && x.rank <= 3) byCat[x.category].hit3 += 1;
  }
  summary[`search:${engine}`] = {
    ok: `${r.filter((x) => x.ok).length}/${r.length}`,
    hit1: r.filter((x) => x.rank === 1).length,
    hit3: r.filter((x) => x.rank && x.rank <= 3).length,
    hit10: r.filter((x) => x.rank).length,
    mrr: +(r.reduce((a, x) => a + (x.rank ? 1 / x.rank : 0), 0) / r.length).toFixed(3),
    medianMs: median(r.filter((x) => x.ok).map((x) => x.ms)),
    byCategoryHit3: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, `${v.hit3}/${v.n}`])),
  };
}
for (const engine of FETCH_ENGINES) {
  const r = rows.filter((x) => x.kind === 'fetch' && x.engine === engine);
  summary[`fetch:${engine}`] = {
    ok: `${r.filter((x) => x.ok).length}/${r.length}`,
    hit: `${r.filter((x) => x.hit).length}/${r.length}`,
    medianMs: median(r.filter((x) => x.ok).map((x) => x.ms)),
    medianChars: median(r.filter((x) => x.ok).map((x) => x.chars)),
  };
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
rmSync(HOME, { recursive: true, force: true });
console.log(JSON.stringify(summary, null, 2));
