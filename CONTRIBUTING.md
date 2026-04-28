# Contributing to rethunk-mcp-ts

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- **Bun** 1.2.0 or later
- **Node.js** 20.0 or later

### Clone and Setup

```bash
git clone https://github.com/Rethunk-AI/rethunk-mcp-ts.git
cd rethunk-mcp-ts
bun install
```

## Development Scripts

| Command | Purpose |
|---|---|
| `bun run devcheck` | **Primary quality gate** — lint, format, typecheck, security, tests |
| `bun run rebuild` | Clean, rebuild, and clear logs (run after dependency changes) |
| `bun run test` | Run the test suite |
| `bun run test:coverage` | Run tests with coverage report |
| `bun run dev:stdio` | Development mode via stdio transport |
| `bun run dev:http` | Development mode via HTTP transport |
| `bun run lint` | Run Biome linter |
| `bun run lint:fix` | Auto-fix linting issues |
| `bun run build` | Compile TypeScript to `dist/` |
| `bun run build:worker` | Build Cloudflare Worker bundle |

Always run `bun run devcheck` before submitting a PR. It runs lint, formatting, type-checking, security audit, and the full test suite in one step.

## Project Structure

```
src/
├── mcp-server/       MCP server (tools, resources, prompts, transports)
│   ├── tools/        Tool definitions and handler utilities
│   ├── resources/    Resource definitions and handler utilities
│   ├── prompts/      Prompt template definitions
│   ├── transports/   HTTP and stdio transport implementations
│   ├── roots/        Client root URI registry
│   └── tasks/        Async task infrastructure (experimental)
├── container/        Dependency injection (tsyringe tokens and registrations)
├── services/         External service integrations (LLM, graph, etc.)
├── storage/          Persistence layer (in-memory, filesystem, Supabase, SurrealDB, Cloudflare)
├── config/           Zod-validated configuration from environment variables
├── types-global/     Shared type definitions
└── utils/            Utilities (logging, security, telemetry, parsing, formatting)

tests/                Test files mirroring src/ structure
docs/                 Developer reference documents
scripts/              Build and developer tooling scripts
```

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must follow this format:

```
<type>(<scope>): <short description>

<optional body explaining why, not what>
```

**Types:**

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructure with no behavior change |
| `chore` | Maintenance, dependency bumps, tooling |
| `docs` | Documentation changes only |
| `test` | Adding or updating tests |
| `build` | Build system or script changes |
| `perf` | Performance improvements |

**Examples:**

```bash
feat(tools): add rate-limited fetch tool with SSRF protection

fix(storage): correct KV provider deleteMany to use batch delete

docs(contributing): add commit convention table

chore(deps): upgrade @modelcontextprotocol/sdk to 1.26.0
```

**Atomic commits:** Each commit should represent one logical change. Use `git add <specific-files>` rather than `git add .` to control what goes into each commit.

## Coding Guidelines

- Use **TypeScript strict mode** (enforced by `tsconfig.json`)
- Add explicit return types to all functions
- Use interfaces for object types; avoid `any`
- Keep components small and focused (Single Responsibility)
- Follow Biome formatting (enforced by `bun run devcheck`)
- All Zod schema fields must include `.describe()` for LLM-facing visibility
- Tool and resource logic functions must not contain `try/catch` — throw `McpError` instead; the handler factory catches it
- See [AGENTS.md](AGENTS.md) for full architectural constraints

## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** following the coding guidelines above
3. **Run the quality gate:**
   ```bash
   bun run devcheck
   ```
   This runs lint, format, typecheck, security audit, and tests. All checks must pass.
4. **Verify transports work locally:**
   ```bash
   bun run dev:stdio   # or dev:http
   ```
5. **Submit a PR** with a clear description covering what changed and why
6. **Address review feedback** in follow-up commits (do not force-push after review starts)

## Testing

- Add tests for new functionality in `tests/` mirroring the `src/` path
- Run the full test suite before submitting: `bun run test`
- Coverage thresholds are enforced: lines ≥65%, functions ≥60%, branches ≥55%, statements ≥65%
- Use property-based tests (`fast-check`) for parsing and security-sensitive utilities
- See `tests/fixtures/index.ts` for shared `RequestContext`, `SdkContext`, and mock factory helpers

## Reporting Issues

- **Bug:** Steps to reproduce, expected vs. actual behavior, version number
- **Feature request:** Use case and desired behavior
- **Security issue:** See [SECURITY.md](SECURITY.md) for responsible disclosure (do not open a public issue)

---

**Last updated:** 2026-04-27
