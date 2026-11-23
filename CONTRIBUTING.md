# Contributing to zkzzk

First of all, thank you for your interest in contributing to **zkzzk**!

We welcome bug reports, feature requests, documentation improvements, and code contributions.

## Before You Start

- Search existing Issues before creating a new one.
- If you're planning a large feature, please open an Issue first to discuss the proposal.

## Reporting Bugs

When reporting a bug, please include:

- **zkzzk version**
- **Deployment method** (Docker, pre-built standalone binary, or built from source)
- **Operating System & Architecture** (e.g., Linux `amd64`, macOS `arm64`, Windows `amd64`)
- **Go / Node.js version** (if building from source)
- **FFmpeg & Streamlink versions** (if related to recording, VOD download, or conversion)
- **Steps to reproduce**
- **Expected behavior**
- **Actual behavior**
- **Error logs** (if available)

## Tech Stack & Development Setup

zkzzk ships as a single self-contained binary (and Docker image) where the Go backend embeds the compiled React frontend (`backend/public`).

### Prerequisites

- **Go**: `1.26+` (pure-Go SQLite via `modernc.org/sqlite`, built with `CGO_ENABLED=0`)
- **Node.js**: `24+` (for building the React + TypeScript + Vite frontend)
- **Runtime media tools**: `FFmpeg` and `Streamlink` (required for live recording, VOD download, and MP4 conversion)

### Local Build & Test

1. **Build and lint the frontend**
   ```bash
   cd frontend
   npm ci
   npm run lint
   npm run build
   ```
2. **Sync built frontend assets into the Go embed directory**
   ```bash
   rm -rf backend/public && mkdir -p backend/public
   cp -R frontend/dist/* backend/public/
   ```
3. **Run Go tests and build the binary**
   ```bash
   cd backend
   go test -count=1 ./...
   CGO_ENABLED=0 go build -o ../zkzzk .
   ```

> For hot-reload frontend development, you can run `go run .` inside `backend/` (serves API on `:5001`) alongside `npm run dev` inside `frontend/`.

## Pull Request Guidelines

Before submitting a Pull Request:

- Keep changes focused on a single feature or bug fix.
- Update documentation (`README.md`, `README-ko.md`, `docs/`, `docs/kr/`) if behavior or configuration changes.
- Verify that the frontend builds and passes linting (`npm run lint && npm run build`).
- Verify that Go tests pass (`go test -count=1 ./...`) and the binary builds with `CGO_ENABLED=0`.
- Keep backend changes cross-platform compatible (Linux, macOS, Windows), as CI cross-compiles release binaries for `windows/amd64`, `windows/arm64`, `linux/amd64`, `linux/arm64`, and `darwin/arm64`, and validates the Docker build.

## Release & Deployment Overview

- **CI (`ci.yml`)**: Runs on pushes to `develop` and pull requests to `main`, verifying frontend build, Go tests, cross-compilation for all target platforms, and Docker image builds.
- **Releases (`release.yml` & `docker-publish.yml`)**: Triggered by version tags (`v*.*.*`), automatically publishing standalone binaries (with `checksums.txt`) to GitHub Releases and multi-arch (`linux/amd64`, `linux/arm64`) images to Docker Hub.

## Commit Message Convention

Please use clear commit messages following Conventional Commits.

Examples:

```txt
feat: add YouTube upload visibility option
fix: close recording file handle before deletion on Windows
docs: update installation guide
refactor: simplify authentication middleware
```

## Code Style

- **Backend (`backend/`)**: Write idiomatic Go formatted with `gofmt`. Keep builds `CGO_ENABLED=0` compatible and isolate OS-specific logic with build tags (`_unix.go` / `_windows.go`).
- **Frontend (`frontend/`)**: Use TypeScript and ensure ESLint passes without errors.
- Follow the existing project structure.
- Use meaningful variable and function names.
- Keep functions small and maintainable.

## Questions

If you have questions or suggestions, feel free to open an Issue.

Thank you for contributing!
