# Contributing to Vibe Dash

Thanks for your interest in contributing! Here's how to get started.

## Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Start dev server: `npm run dev`
4. Confirm tests pass: `npm test`

## Making Changes

1. Create a branch from `main`
2. Make your changes following existing code patterns
3. Add tests for new functionality
4. Run `npm test` to confirm nothing is broken
5. Open a pull request against `main`

## Code Conventions

- TypeScript throughout, strict mode enabled
- ES modules (import/export)
- Follow existing patterns in the codebase
- No hardcoded credentials, even in test files

## Project Layout

| Directory | Contents |
|-----------|----------|
| `src/` | React frontend (components, hooks, state) |
| `server/` | Express backend (routes, database, MCP server) |
| `tests/` | Vitest test suite |
| `docs/` | Documentation |

## Running Tests

```bash
npm test              # Run once
npm run test:watch    # Watch mode
```

Tests use Vitest with in-memory SQLite for isolation. When adding features, add corresponding tests.

## Pull Requests

- One feature or fix per PR
- Include tests for new functionality
- Update docs if user-facing behavior changes
- Write a clear description of what changed and why

## Reporting Bugs

Open a GitHub issue with:
- Clear title describing the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)

## Modifying MCP Tools

When adding or changing MCP tools:
1. Update tool definitions in `server/mcp/tools.ts`
2. Add tests in `tests/mcp-tools.test.ts`
3. Update the tool table in `README.md` and `docs/MCP-SETUP.md`

## License

Contributions are licensed under Apache License 2.0.
