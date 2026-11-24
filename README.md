![A quiet study desk with a notebook and calendar](docs/banner.png)

# Focal

[![Release](https://img.shields.io/github/v/release/flandyw/focal)](https://github.com/flandyw/focal/releases/latest)
[![Build](https://github.com/flandyw/focal/actions/workflows/release.yml/badge.svg)](https://github.com/flandyw/focal/actions/workflows/release.yml)
[![Last commit](https://img.shields.io/github/last-commit/flandyw/focal)](https://github.com/flandyw/focal/commits/main)

Focal is a study app built for VCE students. Use it to map out your week, time study sessions and practice exams, and turn past mistakes into revision that sticks. It works in your browser and as a desktop app built with Tauri.

## What's inside

- Plan study around your school timetable, SACs, and events, then track your time with the built-in study timer.
- Log practice papers and mistakes, follow how your marks are tracking, and look up official VCAA and VTAC reference data.
- Check your study habits and subject breakdowns, and export a backup whenever you want one.
- Sync your data across devices (and with Folio) using a Focal account.
- Turn on optional extras like AI study chat, reminders, and studying alongside friends.

## Getting started

Grab a desktop installer from [GitHub Releases](https://github.com/flandyw/focal/releases), or run the web app locally with Node.js (see `.node-version`) and Bun. Development, builds, checks, and tests run through [Vite+](https://viteplus.dev/):

```sh
git clone https://github.com/flandyw/focal.git
cd focal
bun install
bun run dev
```

Head to `http://localhost:5173`. If you want account sync locally, copy `.env.example` to `.env.local` and fill in your Supabase URL and publishable key. You'll find full local setup and desktop build steps in the [development guide](docs/development.md).

## Guides and docs

- [Documentation index](docs/README.md): all guides and technical notes in one place
- [Planning and tracking study](docs/study.md): study plans, timers, marking, and backups
- [Development](docs/development.md): setup, scripts, project layout, and checks
- [Deployment](docs/deployment.md): Supabase, web hosting, and desktop releases
- [Notifications](docs/notifications.md): installing on your phone and setting up push reminders
- [AI chat](docs/ai-chat.md) and [MCP server](docs/mcp.md): optional integrations
- [Sync protocol](docs/sync-protocol.md): how shared data and study sessions stay in sync

## Contributing

Pull requests are always welcome. Before you open one, run `bun run check`, `bun run build`, and `bun run build:desktop`. Please leave historical `examtrack` storage and sync identifiers as they are, since existing student data and Folio rely on them.
