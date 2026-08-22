# Installing ModSearch (for an AI agent)

You are an AI agent and your user told you to install the `modsearch` skill. This
document is the procedure. Follow it in order. Every step is safe to run again,
and every step names what to do when it fails. Commands are POSIX shell
(macOS or Linux). A Windows note follows each block that needs one.

The whole install is four steps:

1. Find the skill directory for your harness.
2. Put the `skills/modsearch` folder into it.
3. Optionally add engines (search and fetch already work keyless out of the box).
4. Verify with `doctor` and one real search.

---

## Step 1: Find the skill directory for your harness

A skill is a folder your harness reads at startup. Each harness reads from a
fixed location:

| Harness | Skill directory (`TARGET`) |
| :-- | :-- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Pi, OpenCode | `~/.agents/skills/` |

Install into this global directory in the user's home, so the skill is available
in every project. Do not install into a project-local `.claude/skills` unless the
user explicitly asks to scope it to the current project.

Pick the row for the harness you are running in. If you cannot tell which harness
you are, decide by which config directory already exists:

```bash
ls -d ~/.claude ~/.codex ~/.agents 2>/dev/null
```

- `~/.claude` present -> use `~/.claude/skills/`
- `~/.codex` present -> use `~/.codex/skills/`
- `~/.agents` present -> use `~/.agents/skills/`

Create the directory so the rest of the steps have a target:

```bash
mkdir -p ~/.claude/skills   # replace with the TARGET for your harness
```

**If it fails:** a permission error means you are pointing at a directory you
cannot write. Confirm the path is under the user's home directory (`echo $HOME`),
not a system path.

> **Windows:** `~` is the user profile. The directories are
> `%USERPROFILE%\.claude\skills\`, `%USERPROFILE%\.codex\skills\`, and
> `%USERPROFILE%\.agents\skills\`. Create one with
> `mkdir "$env:USERPROFILE\.claude\skills"` in PowerShell.

---

## Step 2: Put `skills/modsearch` into the skill directory

The skill is the `skills/modsearch` folder in this repository: a `SKILL.md` and a
`references/` directory. Copy the whole folder into `TARGET`. There are two
equivalent ways. Use path A unless the user asked for the skills CLI.

### Path A: clone and copy (no extra tooling)

```bash
rm -rf /tmp/modsearch-src
git clone --depth 1 https://github.com/liustack/modsearch.git /tmp/modsearch-src
mkdir -p ~/.claude/skills/modsearch          # replace with your TARGET
cp -R /tmp/modsearch-src/skills/modsearch/. ~/.claude/skills/modsearch/
```

The copy overwrites any earlier install in place, so running it again just
refreshes the skill.

**If it fails:**
- `git: command not found` -> install git, or use Path B.
- Clone cannot reach GitHub -> check network access, then retry.
- After copying, confirm the skill and its launcher landed:
  ```bash
  ls ~/.claude/skills/modsearch/SKILL.md ~/.claude/skills/modsearch/scripts/run.sh ~/.claude/skills/modsearch/references
  ```
  If `SKILL.md` or `scripts/run.sh` is missing, the copy targeted the wrong path.
  Re-run the `cp` line and check `TARGET`.

### Path B: the skills CLI (third party)

`skills` is a third-party CLI for installing agent skills. It is not required.

```bash
npx -y skills add liustack/modsearch
```

**If it fails** (the command is unavailable, or it does not place the folder under
your harness's skill directory): fall back to Path A, which needs only git.

> **Windows:** in PowerShell, replace the `cp -R` line with
> `Copy-Item -Recurse -Force "$env:TEMP\modsearch-src\skills\modsearch\*" "$env:USERPROFILE\.claude\skills\modsearch\"`
> and clone into `"$env:TEMP\modsearch-src"`.

---

## Step 3 (optional): Add more engines

modsearch does three jobs, and none of them blocks on setup:

- **Web search and page fetch (`-q`, `-u`) work as installed.** The default
  engine is Firecrawl's keyless tier: 1,000 free credits/month, no account, no
  key. A dependency-free local fetcher backs page fetch as the floor. If the
  user wants nothing more, skip to Step 4.
- **X (Twitter) search needs Grok Build** (SuperGrok or X Premium), installed and
  signed in. Set it up only if the user wants X. It needs no key beyond that login.
- **More engines mean more quota and better failover.** Add them below when the
  user asked for one or handed you a key.

If the user gave you an engine key, jump to the keyed-engine block at the end of
this step and configure it now.

The best free upgrade is Antigravity CLI (`agy`): it writes synthesized,
cited answers, needs no API key, and also reads pages. It requires a one-time
browser sign-in that only the user can complete. Handle it in three idempotent
steps, each safe to re-run.

1. **Probe.** Is `agy` already installed?

   ```bash
   command -v agy
   ```

   If it prints a path, skip the install. If it prints nothing, install it (you
   run this, no user action needed):

   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   ```

2. **Confirm it runs.** This spends no quota and needs no login:

   ```bash
   agy --version
   ```

   `agy: command not found` here means the installer did not add `agy` to this
   shell's PATH: open a new shell, or have the user do so, then probe again.

3. **Sign-in.** `agy` has no offline way to report whether it is already signed
   in, so decide from what you just saw. If `agy` was **already installed** before
   this run, the user most likely signed in earlier: go on to Step 4, whose real
   search is the definitive login check, and only come back here if that search
   reports a sign-in or auth error. If you **just installed** `agy`, it is not
   signed in yet: run it once, then **ask the user to complete the Google sign-in
   in the browser it opens, and wait for them to confirm before you continue.**
   Have them exit `agy` once signed in. You cannot do this sign-in yourself.

   ```bash
   agy   # opens the browser for the user's one-time sign-in, then they exit
   ```

If a browser sign-in is not possible, the keyless Firecrawl default already keeps
the CLI fully usable. Add a key only when the user wants a personal quota on top.
All three keyed services have a free tier and need no card. Run settings through
the launcher (replace the path with your TARGET from Step 1), so they work even on
a host without npx:

One engine may take multiple keys. Join them with commas, for example
`first-key,second-key`. Authentication, rate-limit, and quota failures rotate to
the next key. Network, 5xx, and response parsing failures move directly to the
next engine instead.

```bash
bash ~/.claude/skills/modsearch/scripts/run.sh config set tavily.apiKey <key>       # 1,000 credits/month
bash ~/.claude/skills/modsearch/scripts/run.sh config set exa.apiKey <key>          # $10/month credit, ~1,400 searches
bash ~/.claude/skills/modsearch/scripts/run.sh config set firecrawl.apiKey <key>    # personal 1,000 credits/month on top of the keyless quota
```

**If it fails:**
- `agy: command not found` after the installer -> the install did not add `agy` to
  this shell's PATH. Open a new shell, or have the user do so, then re-run `agy`.
- A keyed `config set` writes `~/.modsearch/config.json`. A permission error there
  means the home directory is not writable by this process.
- Not sure an engine is set up? Step 4 reports exactly which engines are ready.

> **Windows:** the `curl | bash` installer is for macOS and Linux. On Windows,
> agy and grok are usable only if the tool ships a native Windows build on PATH
> (see "Platform support" in the README). The HTTP engines (Tavily, Exa, Firecrawl)
> work the same on Windows.

---

## Step 4: Verify

First, run the diagnosis through the launcher. It spends no quota. (On a
machine where the launcher resolves to npx or bunx, the first call may download
the pinned package; that is how those runners work.)

```bash
bash ~/.claude/skills/modsearch/scripts/run.sh doctor   # replace with your TARGET
```

The launcher prints its runtime selection first (whether it chose a `modsearch`
on PATH, `npx`, or `bunx`), then chains modsearch's own report below a
`--- modsearch doctor ---` line. That report, on a healthy bare machine, looks
like this (trimmed):

```
Node
  version: 22.13.0
  status:  OK

search (search the web)
  resolved: firecrawl
  - firecrawl         READY    keyless: works with no key and no signup ...

fetch (fetch a page)
  resolved: firecrawl
  - firecrawl         READY    keyless fetch (default): public pages are read by a cloud browser ...
  - local             READY    built in, needs nothing installed

social (search X)
  resolved: (none available)
```

How to read it:

- **`Node status: OK`** means the runtime meets the floor (22.13+). If it says
  `TOO OLD`, upgrade Node and stop here, because nothing else will work.
- **`search resolved: <engine>`** means a web engine is ready. Keyless Firecrawl
  makes this true on a bare install; agy or a configured key resolves ahead of
  it when present. If it reads `(none available)`, the installation is
  inconsistent: reinstall this exact release before adding credentials. Each
  not-ready engine prints a `fix:` line when setup can help.
- **`fetch resolved: <engine>`** means page fetch is ready. This is always true:
  keyless Firecrawl leads and the built-in `local` engine is the floor.
- **`social`** is only relevant if the user wants X. `(none available)` just means
  Grok Build is not installed.

Then run one real search to confirm the whole path end to end:

```bash
bash ~/.claude/skills/modsearch/scripts/run.sh -q "current Node.js LTS version"   # replace with your TARGET
```

Expect JSON on stdout: a `results` array whose first entry has an `engine` naming
who answered and an `items` list with `url`s. That is a working install.

**If it fails:**
- The launcher printed a JSON diagnosis and exited 78 -> no runtime could run
  modsearch: no compatible `modsearch` on PATH, no `npx`, and no `bunx`. Read the
  `nextSteps` field in that JSON and relay it. The manual path in phase A is to
  install Node 22.13+ (https://nodejs.org) or Bun (https://bun.sh), then re-run
  this step, since no native artifact is published yet. Do not report modsearch
  as broken.
- `Every engine for the web source failed` -> the engines themselves errored at
  runtime (no network, a timeout, or spent quotas), not a setup gap: keyless
  Firecrawl means a bare install always has a search engine. Read the per-engine
  attempt lines for the actual cause.
- A timeout -> retry once with `--timeout 300000`. agy runs take 10-30 seconds.
- Any other message -> it is catalogued with its cause and fix in
  [`docs/troubleshooting.md`](docs/troubleshooting.md). Read the message first,
  since most already name the fix.

---

## Done

The skill is installed and search works. From now on you do not type these
commands by hand: the skill triggers on its own when a task needs current
information, a page read, or X. To change engines or add a key later, see
[`skills/modsearch/references/configure.md`](skills/modsearch/references/configure.md).
