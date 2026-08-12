<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>Give a text-only model the web: search, X, and any page.</b></p>

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

Models like DeepSeek-V4-Flash have no web access, or a weak one. ModSearch is a plug-in that greatly strengthens the model's web search, X search, and single-page fetch.

## Talk to us

Something broken, or something missing? [Open an issue](https://github.com/liustack/modsearch/issues/new/choose). For everything else, come find me on X: **[@liustack](https://x.com/liustack)**. What you built with it, which harness you are on, what should come next. New releases land there first, and a proper community space is on the way.

## Features

- **Completely free.** The default channel is Antigravity CLI, no API key needed. All three fallback channels (Tavily, Exa, Firecrawl) offer monthly free tiers with no card required.
- **Automatic failover.** When a channel fails or exhausts its quota, the next one takes over.
- **Searches X (Twitter).** With Grok Build installed, ModSearch queries the corpus that web indexes cannot reach.
- **Install once, use everywhere.** Works in Claude Code, Codex, Pi, and OpenCode.

## Installation

**Step 1, set up a search engine (the only part that needs your hands).** The default engine, Antigravity CLI, requires a browser sign-in that only you can complete:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy                                                           # sign in, then exit
```

Prefer not to install it? Register a free key with Tavily, Exa, or Firecrawl instead (Tavily 1,000 credits a month, Exa about 1,400 searches a month, Firecrawl 1,000 credits a month, no card required by any of them).

**Step 2, hand the rest to your AI.** Send it this line, along with the key if you chose one:

> Install and configure the modsearch skill following https://github.com/liustack/modsearch/blob/main/INSTALL.md, then run the health check and tell me the result.

## Usage

Once installed, just chat. Ask anything that needs checking, or paste a URL, and the skill triggers on its own: it picks an engine, runs the search or fetch, and the answer comes back with sources.

## See it work

Both screenshots are unedited runs from the Codex desktop app, driving a text-only DeepSeek-V4-Flash.

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
