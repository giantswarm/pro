# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

PRO (Portfolio Roadmap Organizer) is an MCP server that exposes Giant Swarm's GitHub Projects V2 boards to AI assistants. It manages two boards:
- **Roadmap Board** (#273) — company quarterly goals, team/SIG/WG issues
- **Customer Board** (#345) — customer activities from private repos

## Commands

```bash
# Install dependencies
npm install

# Run tests (Node.js built-in test runner)
npm test

# Run MCP server locally (stdio transport)
node bin/index.js

# Run with HTTP transport (port 8080)
node bin/index.js --transport=streamable-http

# Helm lint
helm lint helm/pro
```

No linters or formatters are configured. Tests use the Node.js built-in test runner (`node --test`).

## Architecture

Pure JavaScript (ES modules), no TypeScript. Node 20+.

### Entry Point & Transport

`bin/index.js` parses `--transport` flag and starts either stdio (default, for local AI clients) or streamable HTTP (for K8s/Docker). HTTP transport (`src/lib/mcp/http.js`) serves `/mcp`, `/healthz`, `/readyz` on port 8080. When OAuth is configured, also serves `/authorize`, `/token`, `/register`, `/github/callback`, and `/.well-known/*`.

### MCP Layer (`src/lib/mcp/`)

- **`server.js`** — Creates MCP server, registers handlers for `list_tools`, `call_tool`, `list_resources`, `read_resource`
- **`tools.js`** — 10 tool definitions and handlers (list_issues, get_issue_details, update_issue_field, create_issue_in_project, add_existing_issue, archive_item, close_issue, reopen_issue, update_issue_labels, list_issue_comments), plus 6 more re-exported from sub-issues.js and 1 more re-exported from timeline.js (17 total)
- **`sub-issues.js`** — Sub-issue tools (list, add, remove, get_parent)
- **`timeline.js`** — `get_issue_timeline` tool: compact activity timeline (labels, assignments, milestones, renames, cross-references, close reasons) for an issue, resolved from a board item
- **`resources.js`** — Per-board schema and overview resources (e.g. `roadmap://schema`)

### Auth Layer (`src/lib/auth/`)

- **`provider.js`** — GitHub OAuth provider implementing MCP SDK's `OAuthServerProvider` interface. Handles dynamic client registration, GitHub OAuth redirect flow, local PKCE validation, and token verification via GitHub API.

### Domain Layer (`src/lib/`)

- **`project.js`** — Board registry (board name → project ID mapping), all GraphQL queries and mutations
- **`items.js`** — Issue listing with server-side filtering, issue detail fetching, field updates
- **`fields.js`** — Field discovery and fuzzy matching (case-insensitive, emoji/special char normalization)
- **`api.js`** — Authenticated GraphQL client with cursor-based pagination
- **`rest-api.js`** — Octokit REST client for sub-issues and timeline endpoints (not available via GraphQL)
- **`comments.js`** — Bulk comment fetching: batched GraphQL resolution of board items to issues, then REST comment fetching with `since`/cap bounds
- **`logger.js`** — Structured logging to stderr (avoids polluting MCP stdio)

### Key Design Decisions

- **Generic field filtering**: No hardcoded field names. LLMs read the board's schema resource to discover fields, then pass field name/value pairs as filters.
- **Board registry pattern**: `resolveBoardId()` maps board names ("roadmap", "customer") to GitHub project node IDs.
- **Dual transport**: stdio for local clients, HTTP for remote deployment — same server code.
- **Dual auth**: `GITHUB_API_TOKEN` env var for stdio/local use; OAuth 2.1 via GitHub for HTTP transport (when `GITHUB_OAUTH_CLIENT_ID` is set). Per-request tokens are threaded through the entire call chain.
- **Public repo safety**: Creating issues in `giantswarm/roadmap` (public) requires explicit `confirmPublicSafe=true`. Posting a comment via `close_issue`/`reopen_issue` on an issue in any public repository requires the same `confirmPublicSafe=true` guard; the close/reopen state change itself is ungated.

## Environment Variables

- `GITHUB_API_TOKEN` (required for stdio, optional fallback for HTTP) — PAT with `project:write` and `repo:write` scopes
- `HTTP_PORT` (optional, default 8080) — for HTTP transport
- `GITHUB_OAUTH_CLIENT_ID` (optional) — GitHub OAuth App client ID. Enables OAuth 2.1 on HTTP transport.
- `GITHUB_OAUTH_CLIENT_SECRET` (required when OAuth enabled) — GitHub OAuth App client secret
- `OAUTH_ISSUER_URL` (optional) — Public URL of this server for OAuth metadata (defaults to `http://localhost:{port}`)
- `OAUTH_TRUSTED_CLIENT_IDS` (optional) — Comma-separated CIMD URLs of clients that skip `/register` (e.g. muster). Their metadata is fetched from the URL and cached.

## CI/CD

- **GitHub Actions**: CI validates app loads + helm lint on PRs; auto-release creates semver tags on merge to main
- **CircleCI**: Builds Docker image → pushes to `gsoci.azurecr.io`, publishes Helm chart to `giantswarm-catalog` (on version tags only)
