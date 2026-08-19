<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>Give the web to any model without it: search, X, and any page. Free, no signup, no API key.</b></p>

<p align="center">🥇 <b>The most powerful web search plugin for DeepSeek Harness (dsh)</b> 🥇</p>

<p align="center">Engines: <b>Firecrawl</b> (keyless, default) · <b>Antigravity CLI</b> · <b>Tavily</b> · <b>Exa</b> · <b>Grok (X)</b> · <b>local</b>, with automatic failover</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="docs/troubleshooting.md">Troubleshooting</a> ·
  <a href="skills/modsearch/references/configure.md">Configuration</a> ·
  <a href="skills/modsearch/references/output-schema.md">Output contract</a> ·
  <a href="docs/security.md">Security</a> ·
  <a href="https://github.com/liustack/modlens">ModLens (vision)</a>
</p>

<p align="center">
  <a href="https://x.com/liustack"><img src="https://img.shields.io/badge/follow-%40liustack-black?style=flat-square&logo=x&logoColor=white" alt="Follow @liustack on X"></a>
  <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch?style=flat-square&label=npm&color=cb3837" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@liustack/modsearch?style=flat-square" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/Not%20backed%20by-Y%20Combinator-FF6600?style=flat-square&logo=ycombinator&logoColor=white" alt="Not backed by Y Combinator">
  <img src="https://img.shields.io/badge/users-unknown-lightgrey?style=flat-square" alt="Users unknown">
</p>

Models like DeepSeek-V4-Flash have no web access, or a weak one. ModSearch is a plug-in that greatly strengthens the model's web search, X search, and single-page fetch. It works the moment it lands: the default engine is Firecrawl's keyless tier, [1,000 free credits every month](https://www.firecrawl.dev/blog/firecrawl-keyless-launch) with no account, no API key, and no card.

## Talk to us

Something broken, or something missing? [Open an issue](https://github.com/liustack/modsearch/issues/new/choose). For everything else, come find me on X: **[@liustack](https://x.com/liustack)**. What you built with it, which harness you are on, what should come next. New releases land there first, and a proper community space is on the way.

## Features

- **🥇 The most powerful web search plugin for DeepSeek Harness (dsh):** one command, `npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.6.0`, and dsh's built-in `web_search` runs on the modsearch engine chain with no API key, keeping its native citation cards. Two tools dsh does not have land beside it: `x_search` for X (Twitter) and `read_page` for focused single-page reading. Updating is the same command again. The version is named rather than `@latest` because pnpm 11 holds back releases published in the last 24 hours and resolves the tag against the older versions that remain. Details in [harness setup](docs/harness-setup.md#deepseek-harness-dsh).
- **Free out of the box, no signup.** Search and page fetch run on Firecrawl Keyless by default: [1,000 free credits/month](https://www.firecrawl.dev/blog/firecrawl-keyless-launch), no account, no API key, no card. Every fallback channel is free too: Antigravity CLI needs only a browser sign-in, and Tavily, Exa, and a free Firecrawl key each add their own monthly quota with no card required.
- **Automatic failover.** When a channel fails or exhausts its quota, the next one takes over.
- **Searches X (Twitter).** With Grok Build installed, ModSearch queries the corpus that web indexes cannot reach.
- **Install once, use everywhere.** Works in Claude Code, Codex, Pi, and OpenCode.

## Supported engines

Firecrawl works with zero setup; every other engine is one command away. Keys are stored in `~/.modsearch/config.json` (0600, masked when shown):

| Engine | Does | Free tier | Turn it on |
| :-- | :-- | :-- | :-- |
| Firecrawl (default) | web search + page fetch | keyless: 1,000 free credits/month, no signup. A free key adds your own 1,000/month | nothing, it works as installed |
| Antigravity CLI | web search + page fetch | free, browser sign-in | install `agy` and sign in |
| Tavily | web search | 1,000 credits/month, no card | `modsearch config set tavily.apiKey <key>` |
| Exa | web search | $10/month recurring credit (~1,400 searches), no card | `modsearch config set exa.apiKey <key>` |
| Grok Build | X (Twitter) search | rides SuperGrok or X Premium | install `grok` and sign in |
| local | page fetch | built in, nothing to install | nothing |

Keys can also come from the environment (`TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`). Multiple engines configured means automatic failover, best first. Using a Tavily-, Exa-, or Firecrawl-compatible third-party or self-hosted endpoint? Point the engine at it: `modsearch config set tavily.baseURL <url>`. Every knob, engine by engine, is in the [configuration guide](skills/modsearch/references/configure.md).

## Installation

**Step 1, hand it to your AI.** Search and page fetch work as soon as the skill lands, on Firecrawl's free keyless quota, so installation is one message:

> Install and configure the modsearch skill following https://github.com/liustack/modsearch/blob/main/INSTALL.md, then run the health check and tell me the result.

**Step 2 (optional), add more free engines.** Antigravity CLI writes better synthesized answers, and a free Tavily, Exa, or Firecrawl key adds a personal quota on top of the keyless one. None requires a card. agy's browser sign-in is the only step that needs your hands:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy                                                           # sign in, then exit
```

Chose a key instead? Send it to your AI with one line: "set my tavily key to tvly-...".

## Usage

Once installed, just chat. Ask anything that needs checking, or paste a URL, and the skill triggers on its own: it picks an engine, runs the search or fetch, and the answer comes back with sources.

## See it work

Both screenshots are unedited runs from the Codex desktop app, driving a DeepSeek-V4-Flash that has no web access of its own.

Give it a blog link and ask what the post says. Twenty-five seconds later: a structured summary of the whole post, with no browser involved.

![Text-only DeepSeek summarising a blog link through ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

Give it no target at all, just "anything interesting in AI today?". Thirty-six seconds later: six sourced stories, with a closing note on which details came from aggregation and deserve a second look. The note comes from the `uncertainty` field.

![An open-ended question comes back as six sourced stories with a stated confidence caveat](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## Documentation

| Doc | Read it when |
| :-- | :-- |
| [INSTALL.md](INSTALL.md) | Installing the skill step by step (written for an agent) |
| [CLI manual](skills/modsearch/references/cli.md) | The CLI the skill drives: flags, config, doctor |
| [Troubleshooting](docs/troubleshooting.md) | A command failed and the message needs decoding |
| [Configuration](skills/modsearch/references/configure.md) | Setting a key, switching engines, fixing config |
| [Output contract](skills/modsearch/references/output-schema.md) | Parsing the JSON or building on it |
| [dsh plugin](docs/dsh.md) | Installing, configuring, verifying, and updating the native dsh bundle |
| [Harness setup](docs/harness-setup.md) | Wiring it into Codex, Claude Code, OpenCode, or Pi |
| [Security](docs/security.md) | SSRF guards, DNS-rebinding protection, untrusted input |
| [CHANGELOG](CHANGELOG.md) | Finding what changed in a version |

## Contributing

ModSearch does not accept pull requests. The project is maintained by a single author who reviews every line, which is a deliberate choice for reliability. Two effective ways to contribute:

- **[Open an issue](https://github.com/liustack/modsearch/issues).** Bugs, suggestions, confusing errors, unclear docs. Issues are read and shape what gets built next.
- **Fork it.** Under MIT your copy is fully yours to modify and publish.

## Shameless plug

This project runs on LIUSTACK Skills: `shaping` before you build, `coding` while you build, `dig` when it breaks, `snapshot` when you hand off. Lighter than Superpowers, and stronger.

```bash
npx -y skills add liustack/liustack -g
```

⭐ If it helps, star [ModSearch](https://github.com/liustack/modsearch) and [liustack](https://github.com/liustack/liustack). Stars are how the next developer finds them.

## Star History

<a href="https://www.star-history.com/?repos=liustack%2Fmodlens%2Cliustack%2Fmodsearch&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liustack/modlens%2Cliustack/modsearch&type=date&theme=dark&legend=top-left&sealed_token=Or7BuI_WngbmbQXmU5MOkRi0mu8ZaeY9zRa58EIgcS7P3rwC-hgRNTUvf0IRK2SJL86kdzcR15m7kFiQNWljDgM_z-aroCB17QE25tS-e2dUlNmU7N6r2w" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liustack/modlens%2Cliustack/modsearch&type=date&legend=top-left&sealed_token=Or7BuI_WngbmbQXmU5MOkRi0mu8ZaeY9zRa58EIgcS7P3rwC-hgRNTUvf0IRK2SJL86kdzcR15m7kFiQNWljDgM_z-aroCB17QE25tS-e2dUlNmU7N6r2w" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liustack/modlens%2Cliustack/modsearch&type=date&legend=top-left&sealed_token=Or7BuI_WngbmbQXmU5MOkRi0mu8ZaeY9zRa58EIgcS7P3rwC-hgRNTUvf0IRK2SJL86kdzcR15m7kFiQNWljDgM_z-aroCB17QE25tS-e2dUlNmU7N6r2w" />
 </picture>
</a>

## Disclaimer

ModSearch is MIT-licensed, so use is not restricted. The author gives no warranty and no endorsement for any particular use, commercial or otherwise. The upstream engines it drives (Antigravity CLI, Tavily, Exa, Firecrawl, Grok Build) each carry their own terms and quotas, and complying with them is the user's responsibility.

## License

MIT
