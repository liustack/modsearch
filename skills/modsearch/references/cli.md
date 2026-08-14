# ModSearch CLI manual

English | [简体中文](cli.zh-CN.md)

The skill drives this CLI through its launcher. This page is for running it directly.

## Direct usage

With the skill installed you do not type commands: ask anything that needs checking, or paste a URL, and it fires on its own, with the launcher choosing how to run modsearch. The commands below are for driving the CLI yourself on a machine with Node:

```bash
modsearch -q "current Node.js LTS version"     # search the web
modsearch -u "https://nodejs.org/en/about"     # read one page, add -q for a focus
modsearch -q "reactions on X" --source x       # search X, automatic for queries about X
```

Output is always a `results` array, one entry per corpus:

```json
{
  "mode": "search",
  "results": [{
    "source": "web",
    "engine": "antigravity-cli",
    "summary": "The current Node.js LTS is v24.19.0 (Krypton), released 2026-08-03.",
    "items": [{ "title": "...", "url": "https://...", "published_at": "2026-08-03" }],
    "uncertainty": [],
    "warnings": [],
    "durationSeconds": 5.5
  }]
}
```

`uncertainty` is what the engine could not pin down about the facts. `warnings` is how the answer was routed (a fallback, a stand-in for X, redirects), and `attempts` records each engine tried.

## Flags

| Flag | Meaning | Default |
| :-- | :-- | :-- |
| `-q, --query <text>` | Query, or the extraction focus when paired with `-u` | |
| `-u, --url <url>` | Fetch this page instead of searching | |
| `-s, --source <list>` | Corpora: `web`, `x`, or `web,x` | from the query, else `web` |
| `-e, --engine <name>` | Use only this engine for this run. On failure the run errors instead of switching engines | automatic |
| `-o, --output <path>` | Also write JSON to a file | |
| `-m, --model <name>` | Engine model | `gemini-3.6-flash-low` |
| `--prompt <text>` | Extra constraints for this run, passed to the engine | |
| `--max-results <n>` | Maximum search results | `8` |
| `--timeout <ms>` | Engine timeout | `180000` |
| `--workdir <path>` | Working directory for engines that run a command | current directory |
| `--allow-private-network` | Let the local fetcher reach reserved ranges, for VPNs that map public hosts into them | off |

Configuration is optional. `~/.modsearch/config.json` holds one main decision: which engine searches (`modsearch config set engine tavily`, empty means automatic). Fetching and X search need no settings. Quota cooldown failover is on by default, `modsearch config set cooldown off` disables it, and `modsearch state clear` resets the cooldown records. The full file structure and every field (including the top-level `allowPrivateNetwork` switch) are documented in the [configuration doc](configure.md).

`modsearch doctor` prints a local diagnosis: Node version, each task's engines with their readiness and reasons, where each config value comes from, the private-network setting, and any engines currently cooling. It spends no quota and makes no network request, and `--json` makes the output machine-readable. Run it first when routing does not behave as expected.

## Platform support

macOS and Linux are fully supported and run the whole test suite in CI on Node 22 and 24. The skill ships two launchers, `scripts/run.sh` for macOS and Linux and `scripts/run.ps1` for Windows, which pick a working way to run modsearch automatically and behave the same on all three platforms.

The CI matrix also includes `windows-latest` on Node 22 and 24, running the same typecheck, test, and build gate. What works on Windows follows from what each part depends on:

- **The CLI, its routing and config logic, and the HTTP engines** (`local` fetch, Tavily, Exa, Firecrawl) are pure Node: they use `fetch` and the filesystem alone, so they are cross-platform.
- **agy and grok are external CLIs.** modsearch runs them by name with no shell, so a native Windows executable on PATH works, while an npm-style `.cmd` shim does not. Whether a Windows build exists is each tool's own decision, not modsearch's.
- **The cooldown state file** is written through a temp file and an atomic rename. On Windows that rename replaces the target, but the OS cannot replace a file another process holds open, so a rare simultaneous-writer race can drop one write. The store is a best-effort cache that merges on read, so a later run rediscovers anything lost.

