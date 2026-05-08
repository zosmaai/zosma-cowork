# Contributing to Zosma Cowork

Thank you for your interest in contributing! This document will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (for Tauri v2 desktop shell)

On Linux you also need the system libs Tauri requires:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
    libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### Clone & Install

```bash
git clone https://github.com/zosmaai/zosma-cowork.git
cd zosma-cowork
npm install
```

### Running Locally

```bash
# Frontend only (Vite dev server)
npm run dev:frontend

# Full Tauri app (frontend + Rust relay + Node.js sidecar)
npm run dev
```

## Project Structure

```
zosma-cowork/
├── agent-sidecar/      # Node.js agent sidecar using pi-mono SDK
├── src/                # React frontend (TypeScript + Tailwind)
├── src-tauri/          # Tauri v2 desktop shell (thin Rust relay)
├── .github/workflows/  # CI/CD (GitHub Actions)
└── assets/             # Screenshots, icons, etc.
```

The agent sidecar (`agent-sidecar/`) runs the pi-mono TypeScript SDK and
communicates with the Tauri shell via stdin/stdout JSON lines.

## Workflow

1. **Fork** the repository (or work on a feature branch if you're a maintainer)
2. **Branch**: `git checkout -b feature/my-feature`
3. **Code**: Make your changes
4. **Test**: `npm run validate` (lint + typecheck + test)
5. **Commit**: Follow [Conventional Commits](https://www.conventionalcommits.org/)
6. **Push**: `git push fork feature/my-feature`
7. **PR**: Open a pull request to `zosmaai/zosma-cowork:main`

## Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add streaming support for tool calls
fix: resolve memory leak in usePiStream hook
docs: update README with new screenshots
style: format Rust code with cargo fmt
refactor: simplify event parsing logic
test: add tests for ThinkingBlock component
chore: update dependencies
```

## Code Style

### Frontend

- **Linting**: Biome (configured in `biome.json`)
- **Formatting**: `npm run format`
- **Testing**: Vitest + Testing Library + jsdom

```bash
npm run lint       # Check lint errors
npm run format     # Auto-format code
npm run test       # Run tests
npm run typecheck  # TypeScript check
npm run validate   # All of the above
```

### Backend

- **Formatting**: `cargo fmt`
- **Linting**: `cargo clippy -- -D warnings`
- **Testing**: `cargo test`

```bash
cd src-tauri
cargo fmt
cargo clippy -- -D warnings
cargo test
```

## Testing

### Frontend Tests

Tests live next to the components they test (`ComponentName.test.tsx`):

```bash
npm run test        # Run all tests once
npm run test:watch  # Run tests in watch mode
```

### Backend Tests

```bash
cd src-tauri
cargo test
```

## Pull Request Guidelines

- PRs should target the `main` branch
- Include a clear description of the change and why it's needed
- Ensure `npm run validate` passes
- For UI changes, include screenshots in the PR description
- For Rust changes, ensure `cargo clippy` and `cargo test` pass

## Release Process

Releases are automated via GitHub Actions:

1. Update version in `package.json` and `src-tauri/Cargo.toml`
2. Tag: `git tag v0.1.0 && git push origin --tags`
3. CI builds for macOS, Linux, and Windows
4. A draft release is created — publish it when ready

## Questions?

- Open a [GitHub Discussion](https://github.com/zosmaai/zosma-cowork/discussions)
- Or reach out via email: [hello@zosma.ai](mailto:hello@zosma.ai)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
