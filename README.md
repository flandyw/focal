![A quiet study desk with a notebook and calendar](docs/banner.png)

# Focal

[![Release](https://img.shields.io/github/v/release/flandyw/focal)](https://github.com/flandyw/focal/releases/latest)
[![Build](https://github.com/flandyw/focal/actions/workflows/release.yml/badge.svg)](https://github.com/flandyw/focal/actions/workflows/release.yml)
[![Last commit](https://img.shields.io/github/last-commit/flandyw/focal)](https://github.com/flandyw/focal/commits/main)

Focal is a study companion for VCE students. Plan your week, track study sessions and practice exams, and turn mistakes into revision. It runs in the browser and as a desktop app built with Tauri.

## What you can do

- Plan study alongside classes and calendar events, then track time with the study timer.
- Record practice exams and mistakes, review progress, and explore VCAA and VTAC reference data.
- View study trends and subject breakdowns, and export your data.
- Sync supported data across devices and with Folio using a Focal account.
- Use optional AI chat, reminders, and friend comparisons.

## Get started

Download a desktop build from [GitHub Releases](https://github.com/flandyw/focal/releases), or run the web app locally:

```sh
git clone https://github.com/flandyw/focal.git
cd focal
bun install
bun run dev
```

Open `http://localhost:5173`. For account sync, copy `.env.example` to `.env.local` and configure the Supabase URL and publishable key. Local development and desktop prerequisites are covered in the [development guide](docs/development.md).

## Documentation

- [Documentation index](docs/README.md) — guides and technical references
- [Planning and tracking study](docs/study.md) — plans, timers, and shared sessions
- [Development](docs/development.md) — setup, commands, architecture, and verification
- [Deployment](docs/deployment.md) — Supabase, web hosting, and desktop configuration
- [Notifications](docs/notifications.md) — mobile installation and push setup
- [AI chat](docs/ai-chat.md) and [MCP server](docs/mcp.md) — optional integrations
- [Sync protocol](docs/sync-protocol.md) — shared data and session lifecycle

## Contributing

Changes are welcome. Run `bun run check`, `bun run build`, and `bun run build:desktop` before submitting a change. Keep historical `examtrack` storage and sync identifiers intact; existing data and Folio depend on them.
