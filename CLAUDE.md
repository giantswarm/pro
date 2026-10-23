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

- **`server.js`** — Creates MCP server, registers handlers for `list_tools`, `call_tool`, `list_resources`, `read_resource`. `call_tool` validates every call's arguments against the tool's declared `inputSchema` (`validate.js`) before the handler runs
- **`validate.js`** — `validateToolArguments`: refuses missing required, unknown top-level and mistyped arguments, naming each and listing the accepted arguments (a free-form map is always a declared object property such as list_issues' `filters`, never the top level); exact string spellings of numbers and booleans are converted, null optionals dropped
- **`tools.js`** — 11 tool definitions and handlers (list_issues, get_issue_details, update_issue_field, create_issue_in_project, add_existing_issue, archive_item, close_issue, reopen_issue, update_issue_labels, list_issue_comments, get_server_version), plus 6 more re-exported from sub-issues.js, 1 from timeline.js, 2 from board.js and 3 from relations.js (23 total)
- **`sub-issues.js`** — Sub-issue tools (list, add, remove, get_parent)
- **`board.js`** — `get_board_schema` and `get_item_by_issue` (the board item of an issue of any repository, resolved with `resource(url:)`: first among the issue's own `projectItems`, which show a new item at once but list only projects of the issue's owner, then by node id among the board items its repository and number narrow to, a search that lags a new item by minutes; never a board scan); `findBoardItemByIssue` is that lookup, shared with `update_issue_field`'s `issueUrl`)
- **`relations.js`** — Issue relation tools besides parent/child: `list_issue_relations`, `add_issue_relation`, `remove_issue_relation` for "blocked by" / "blocking" dependencies and "relates to" links between issues of any repository (GraphQL only, by issue node ID; "blocking" is "blocked by" with the issues swapped). `get_issue_details` also returns the three lists, and `list_issues` an item's open dependency counts (`openBlockedBy` / `openBlocking`); `get_issue_details` reads the relations in a request of its own (`getItemRelations`), because the lists are non-null in GitHub's schema and an error on one nulls the whole issue: a failure there is `relationsError` (Issues only), never a failed call. `list_issues` reads the open dependency counts the same way, by issue node ID (`getDependencyCounts`, `DEPENDENCY_COUNTS_QUERY`): after the list for a bounded read, page by page while the read goes on for a full one, since `issueDependenciesSummary` is non-null too; a failure there is `dependencyCountsError`. `withPartialData` (api.js) is the one place that accepts GraphQL errors next to partial data
- **`timeline.js`** — `get_issue_timeline` tool: compact activity timeline (labels, assignments, milestones, renames, cross-references, close reasons) for an issue, resolved from a board item
- **`resources.js`** — Per-board schema and overview resources (e.g. `roadmap://schema`)

### Auth Layer (`src/lib/auth/`)

- **`provider.js`** — GitHub OAuth provider implementing MCP SDK's `OAuthServerProvider` interface. Handles dynamic client registration, URL client_ids (Client ID Metadata Documents, SEP-991: any HTTPS CIMD URL is fetched, validated and cached; the URL policy in `isCimdUrl` blocks SSRF targets), GitHub OAuth redirect flow, local PKCE validation, and token verification via GitHub API. All of this state is in memory: a restart drops dynamically registered client_ids, in-flight authorization sessions and unexchanged codes (those logins must be started over); CIMD clients such as muster and Claude Code are unaffected because their client_id is re-resolved from the URL.
- `http.js` builds the RFC 8414 metadata itself (`createOAuthMetadata` + `client_id_metadata_document_supported: true`) and mounts it before the SDK's `mcpAuthRouter`, because the SDK offers no option for the flag. Clients only take the CIMD path when it is advertised.

### Domain Layer (`src/lib/`)

- **`project.js`** — Board registry (board name → project ID mapping), all GraphQL queries and mutations
- **`items.js`** — Issue listing with server-side filtering (`fieldTerm` turns a `filters`/`exclude` entry of any field type into a Projects query term; a full read walks item ids and reads them by id in parallel, `readItemsInParallel`), issue detail fetching, field updates, and `resolveItemIssues` — the single batched item→issue resolution helper (issue node ID, owner/repo/number, repo visibility) used by every tool that only needs the issue ref (close/reopen, labels, timeline, comments); and `resolveBoardItem`, which resolves one item by its project item ID and checks its board before a board write (update_issue_field, archive_item), naming a missing or misplaced item
- **`fields.js`** — Field discovery and fuzzy matching (case-insensitive, emoji/special char normalization)
- **`api.js`** — Authenticated GraphQL client with cursor-based pagination: `fetchBounded` reads only as many pages as a limit needs (each page sized to what is still missing) and hands back the cursor to continue; `fetchPaginated` reads them all
- **`rest-api.js`** — Octokit REST client for sub-issues and timeline endpoints (not available via GraphQL)
- **`relations.js`** — Issue relations (`listIssueRelations`, `addIssueRelation`, `removeIssueRelation`), `getItemRelations` and `getDependencyCounts` for `getItemByID` and `listItems`, and `compactRelation` (`truncated` from `pageInfo.hasNextPage`; `hidden` counts null nodes plus, on a last page, what `totalCount` holds beyond the nodes)
- **`comments.js`** — Bulk comment fetching: resolves board items to issues via `resolveItemIssues`, then REST comment fetching with `since`/cap bounds
- **`logger.js`** — Structured logging to stderr (avoids polluting MCP stdio)

### Key Design Decisions

- **Generic field filtering**: No hardcoded field names. LLMs read the board's schema resource to discover fields, then pass field name/value pairs under list_issues' `filters` map, the only place for them (`exclude` negates them).
- **GraphQL variable names**: `@octokit/graphql` refuses variables named like its request options (`url`, `query`, `method`, `headers`, `request`, `baseUrl`, `mediaType`, `operationName`). The unit tests mock the client, so `src/lib/graphql-variables.test.js` reads the sources instead: every operation's declared `$variables` and the object literal passed to every `graphQLWithAuth`, `fetchBounded` and `fetchPaginated` call. Pass variables as an object literal so it can read them.
- **Board registry pattern**: `resolveBoardId()` maps board names ("roadmap", "customer") to GitHub project node IDs.
- **Dual transport**: stdio for local clients, HTTP for remote deployment — same server code.
- **Three auth modes**: `GITHUB_API_TOKEN` env var for stdio/local use; OAuth 2.1 via GitHub for HTTP transport (when `GITHUB_OAUTH_CLIENT_ID` is set); bearer-only for HTTP transport (`OAUTH_BEARER_ONLY=true`: GitHub tokens obtained elsewhere are verified and used per request, no authorization server). Per-request tokens are threaded through the entire call chain. `createGitHubTokenVerifier` (provider.js) is the shared verifier: scoped tokens must cover `repo`, `project`, `read:org`; GitHub App / fine-grained tokens carry no scopes header and are accepted, GitHub enforcing their permissions per call. With `GITHUB_APP_SLUG` the verifier accepts only user access tokens of that GitHub App (pro's own `giantswarm-pro`, pinned in muster), so no write goes through another App's token.
- **Public repo safety**: Creating issues in `giantswarm/roadmap` (public) requires explicit `confirmPublicSafe=true`. Posting a comment via `close_issue`/`reopen_issue` on an issue in any public repository requires the same `confirmPublicSafe=true` guard; the close/reopen state change itself is ungated.

## Environment Variables

- `GITHUB_API_TOKEN` (required for stdio, optional fallback for HTTP) — PAT with `project:write` and `repo:write` scopes
- `HTTP_PORT` (optional, default 8080) — for HTTP transport
- `GITHUB_OAUTH_CLIENT_ID` (optional) — GitHub OAuth App client ID. Enables OAuth 2.1 on HTTP transport.
- `GITHUB_OAUTH_CLIENT_SECRET` (required when OAuth enabled) — GitHub OAuth App client secret
- `OAUTH_BEARER_ONLY` (optional) — `true` runs the HTTP transport as a plain resource server: every `/mcp` request must carry a GitHub token as bearer (verified via the GitHub API, then used for that request's GitHub calls); no `/authorize`, `/token` or `/register` are served, and RFC 9728 protected resource metadata at `/.well-known/oauth-protected-resource[/mcp]` names `https://github.com/login/oauth` as the authorization server. For clients that hold the person's GitHub grant themselves (muster's GitHub connector). Ignored when a GitHub OAuth App is configured.
- `GITHUB_APP_SLUG` (optional, bearer-only mode) — Accept only user access tokens of this GitHub App (`ghu_` tokens whose `GET /user/installations` lists only that App); anything else is answered 401.
- `OAUTH_ISSUER_URL` (optional) — Public URL of this server for OAuth metadata (defaults to `http://localhost:{port}`)
- `OAUTH_TRUSTED_CLIENT_IDS` (optional) — Comma-separated CIMD URLs that bypass the outbound URL policy (e.g. a muster on a cluster-internal hostname) and may omit `client_id` in their document. Public HTTPS CIMD URLs are accepted without an entry here.

## CI/CD

- **GitHub Actions**: CI validates app loads + helm lint on PRs; auto-release creates semver tags on merge to main
- **CircleCI**: Builds Docker image → pushes to `gsoci.azurecr.io`, publishes Helm chart to `giantswarm-catalog` (on version tags only)
