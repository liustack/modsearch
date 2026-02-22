---
summary: 'Research Notes: Gemini CLI non-interactive mode + Claude Code skills model'
read_when:
  - Designing or updating ModSearch runtime behavior
  - Updating skill metadata/trigger strategy
  - Verifying compatibility with Claude Code and provider backends
---

# Research Notes: Gemini CLI + Claude Code Skills

Date: 2026-02-22

## 1) Gemini CLI Findings (v1 default provider impact)

- Local environment verified: `gemini --version` is `0.24.0`.
- `gemini --help` confirms non-interactive invocation supports `-p/--prompt` and `--output-format json`.
- `-p/--prompt` is currently available but marked deprecated; positional prompt is the long-term direction.
- Real one-shot run (`gemini -p "..." --output-format json`) can emit a log line before JSON (for example, cached credential messages), so parser logic must be tolerant of non-JSON prefix text.

Implementation decision:
- v1 keeps `gemini -p` to match current project constraints.
- Parser in `src/search.ts` supports both pure JSON and JSON-with-leading-logs.
- Provider abstraction remains generic so non-Gemini backends can be plugged in later.

## 2) Claude Code Skills Findings

- Skills are instruction packs with frontmatter metadata (`name`, `description`, `allowed-tools`, etc.).
- Triggering depends on whether skill metadata matches user intent.
- For deterministic CLI use, declaring `allowed-tools: Bash` is practical.

Implementation decision:
- `skills/modsearch/SKILL.md` focuses on search triggers and provider-agnostic wording.
- Scope is intentionally constrained to search only; vision and fetch belong to other projects.

## 3) Primary Sources

- Gemini CLI repo README: https://github.com/google-gemini/gemini-cli
- Claude Code skills docs: https://docs.claude.com/en/docs/claude-code/agent-skills
- Anthropic skills examples repo: https://github.com/anthropics/skills
- Claude help center (skills overview): https://support.claude.com/en/articles/11817219-what-are-skills
