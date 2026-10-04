.PHONY: help dev tauri-dev build build-only lint lint-fix typecheck check install clean distclean format bump-version release release-dry-run

# ---------------------------------------------------------------------------
# Help (default)
# ---------------------------------------------------------------------------
help:
	@echo "Focal — VCE study management app"
	@echo ""
	@echo "Development:"
	@echo "  make dev            Vite dev server (port 1420)"
	@echo "  make tauri-dev      Full Tauri desktop app in dev mode"
	@echo ""
	@echo "Build:"
	@echo "  make build          Lint-fix, bump version, Tauri build, install to /Applications"
	@echo "  make build-only     Tauri production build (no lint, no version bump, no install)"
	@echo "  make install        Copy built .app to /Applications"
	@echo ""
	@echo "Quality:"
	@echo "  make lint           Oxlint check"
	@echo "  make lint-fix       Oxlint auto-fix"
	@echo "  make typecheck      TypeScript check (app + Vite config)"
	@echo "  make check          lint + typecheck (CI gate)"
	@echo ""
	@echo "Release:"
	@echo "  make release        Build with VERSION=x.y.z"
	@echo "  make release-dry-run  Check without building"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean          Remove dist + bundled .app"
	@echo "  make distclean      clean + remove src-tauri/target/"
	@echo "  make format         Oxlint auto-fix"

# Detect CPU count for cargo parallelism
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
	NPROC := $(shell sysctl -n hw.ncpu)
else ifeq ($(UNAME_S),Linux)
	NPROC := $(shell nproc)
else
	NPROC := 4
endif
export CARGO_BUILD_JOBS ?= $(NPROC)

APP_NAME  := Focal
APP_SRC   := src-tauri/target/release/bundle/macos/$(APP_NAME).app
APP_DST   := /Applications/$(APP_NAME).app

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------
dev:
	bun run dev

tauri-dev:
	bun run tauri dev

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
bump-version:
	@bun scripts/bump-version.cjs

build: lint-fix bump-version
	VERSION=$$(bun -e "const fs = require('fs'); console.log(JSON.parse(fs.readFileSync('package.json', 'utf8')).version)") && \
	git add package.json src-tauri/tauri.conf.json && \
	git commit -m "chore: bump version to v$$VERSION" && \
	bun run tauri build && \
	ditto "$(APP_SRC)" "$(APP_DST)" && \
	echo "✓ Installed to $(APP_DST) (v$$VERSION)"

build-only:
	bun run tauri build
	@echo "✓ Built $(APP_SRC)"

install:
	@test -d "$(APP_SRC)" || { echo "✗ $(APP_SRC) not found — run 'make build' first"; exit 1; }
	ditto "$(APP_SRC)" "$(APP_DST)"
	@echo "✓ Installed to $(APP_DST)"

# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------
lint:
	bun run lint

lint-fix:
	bun run lint:fix

typecheck:
	bun run typecheck

check: lint typecheck
	@echo "✓ All checks passed"

# ---------------------------------------------------------------------------
# Release
# ---------------------------------------------------------------------------
release: check
	@test -n "$(VERSION)" || { echo "✗ Set VERSION=x.y.z"; exit 1; }
	@echo "Building release $(VERSION)…"
	bun run tauri build
	ditto "$(APP_SRC)" "$(APP_DST)"
	@echo "✓ Release $(VERSION) installed to $(APP_DST)"

release-dry-run: check
	@echo "✓ Dry run — ready to release"

# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------
clean:
	rm -rf dist
	rm -rf src-tauri/target/release/bundle
	@echo "✓ Cleaned frontend dist + bundled .app"

distclean: clean
	rm -rf src-tauri/target
	@echo "✓ Cleaned all Rust build artifacts"

format:
	bun run lint:fix
	@echo "✓ Formatted"
