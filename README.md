# Giant Swarm Portfolio Roadmap Organizer (PRO)

An MCP server for managing Giant Swarm's project boards on GitHub Projects V2.

## Overview

PRO exposes Giant Swarm project boards to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io/). It supports multiple boards:

- **Roadmap Board** ([#273](https://github.com/orgs/giantswarm/projects/273)) -- Company quarterly goals (rocks), team/SIG/WG issues
- **Customer Board** ([#345](https://github.com/orgs/giantswarm/projects/345)) -- Customer-related activities and requests from private customer repositories

The server provides tools for listing, filtering, creating, and updating issues on either board, along with per-board schema resources that describe the available fields and their valid values. Field filtering is generic -- the LLM reads the board's schema resource to discover available fields, then passes arbitrary field name/value pairs as filters.

## Requirements

- Node.js 20+
- GitHub Personal Access Token with `project:write` and `repo:write` scopes

## Installation

```bash
git clone https://github.com/giantswarm/pro.git
cd pro
npm install
```

To make the `pro` command available globally (required for the MCP client config and self-update), install it into your user path -- no `sudo` needed:

**Option A: Using nvm or fnm (recommended)**

If you manage Node.js with [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm), npm's global prefix is already in your home directory:

```bash
npm install -g .
```

**Option B: Configure npm's global prefix**

Without a version manager, npm's default global prefix is a system path. Redirect it to a user-local directory:

```bash
npm config set prefix ~/.local
```

Make sure `~/.local/bin` is in your `PATH` (add to `~/.bashrc` or `~/.zshrc`):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then install:

```bash
npm install -g .
```

**Option C: Use the full path in MCP config**

If you prefer not to install globally, point your MCP client config directly at the checkout:

```json
{
  "mcpServers": {
    "giantswarm-pro": {
      "command": "node",
      "args": ["/path/to/pro/bin/index.js"],
      "env": {
        "GITHUB_API_TOKEN": "your-github-token"
      }
    }
  }
}
```

Note: this skips the global binary, so `pro --self-update` won't be available.

## Configuration

### Environment Variables

- `GITHUB_API_TOKEN` (required): GitHub PAT with `project:write` and `repo:write` scopes.
- `HTTP_PORT` (optional): Port for HTTP transport (default: 8080).

## Transport Modes

The server supports two transport modes, selected via the `--transport` flag:

### stdio (default)

For local AI client integration (Claude Desktop, Cursor, Continue):

```bash
node bin/index.js
# or explicitly:
node bin/index.js --transport=stdio
```

### Streamable HTTP

For remote deployment (Kubernetes, Docker):

```bash
node bin/index.js --transport=streamable-http
```

This starts an HTTP server on port 8080 (configurable via `HTTP_PORT`) with:
- `POST/GET/DELETE /mcp` -- MCP streamable HTTP endpoint
- `GET /healthz` -- Liveness probe (always 200)
- `GET /readyz` -- Readiness probe (200 when MCP server is connected)

### MCP Client Configuration (stdio)

Add to your MCP client config (e.g., Claude Desktop, Cursor, Continue):

```json
{
  "mcpServers": {
    "giantswarm-pro": {
      "command": "pro",
      "args": [],
      "env": {
        "GITHUB_API_TOKEN": "your-github-token"
      }
    }
  }
}
```

See `mcp-config-example.json` for a template.

**Claude Desktop config locations:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Kubernetes Deployment

A Helm chart is available for deploying PRO in Kubernetes with the streamable HTTP transport.

**Prerequisites:**

1. Create a namespace:
   ```bash
   kubectl create namespace mcp-pro
   ```

2. Create a secret with your GitHub token (requires `project:write` and `repo:write` scopes):
   ```bash
   kubectl -n mcp-pro create secret generic pro-github-token \
     --from-literal=token=your-github-token
   ```

**Install:**

```bash
helm install pro ./helm/pro -n mcp-pro
```

**Verify:**

```bash
kubectl -n mcp-pro get pods
kubectl -n mcp-pro port-forward svc/pro 8080:8080
curl http://localhost:8080/healthz   # {"status":"ok"}
curl http://localhost:8080/readyz    # {"status":"ready"}
```

The Helm chart configures `--transport=streamable-http` automatically. The deployment includes liveness (`/healthz`) and readiness (`/readyz`) probes, runs as a non-root user, and enforces a read-only root filesystem.

**Key Helm values:**

| Value | Default | Description |
|-------|---------|-------------|
| `image.repository` | `gsoci.azurecr.io/giantswarm/pro` | Container image registry and name |
| `image.tag` | `default .Chart.AppVersion` | Image tag |
| `service.port` | `8080` | Service port |
| `env` | GitHub token from secret | Environment variables for the container |
| `ingress.enabled` | `false` | Enable ingress (disabled by default) |

### Docker

```bash
docker run -d \
  -p 8080:8080 \
  -e GITHUB_API_TOKEN=your-github-token \
  gsoci.azurecr.io/giantswarm/pro:v1.2.15
```

The container defaults to `--transport=streamable-http`.

## Boards

| Board | Project | Description |
|-------|---------|-------------|
| `roadmap` | [#273](https://github.com/orgs/giantswarm/projects/273) | Company quarterly goals, team/SIG/WG issues |
| `customer` | [#345](https://github.com/orgs/giantswarm/projects/345) | Customer activities and requests from private repos |

The `board` parameter defaults to `"roadmap"` on every board-scoped tool for backward compatibility. Tools that resolve purely by item ID (e.g. `get_issue_details`, `update_issue_labels`) don't take a `board` parameter at all.

## MCP Tools

### Read Tools

- **`list_issues`** -- List and filter issues from a project board using generic field filters. Specify `board` to choose the board (`"roadmap"` or `"customer"`). Use `filters` (a field name-to-value map) to filter by any single-select field. Use `emptyFields` to find items missing specific field values. Read the board's schema resource first to discover available fields and valid options.

- **`get_issue_details`** -- Get full details for a specific item: repository metadata, title, body text, comments with timestamps, assignees, labels, dates, and all field values. Board-independent (queries by item ID).

- **`list_issue_comments`** -- Fetch comments for multiple board items in a single call. Board-independent (queries by item ID). Resolves each item to its underlying issue and returns comment author/timestamps/body, with an optional `since` cutoff. Each comment includes `createdAt`, plus `updatedAt` when it differs from `createdAt` (i.e. the comment was edited). Bounded response: max 25 `itemIds` per call, newest 20 comments per issue by default (override with `maxPerIssue`), and long comment bodies are truncated with an explicit indicator. Without `since`, "newest" means newest by creation time, and per-issue REST pagination is capped (surfaced via a `truncatedPages` flag if more comments exist); with `since`, "newest" means newest by last-updated time, so a recently-edited older comment isn't dropped in favor of an untouched newer one, and its `updatedAt` shows why. The response's `itemCount` counts result items (including error entries), not comments.

- **`get_issue_timeline`** -- Get the compact activity timeline for a board item's underlying issue: label changes, assignments, milestones, renames, cross-references, and close reasons. Board-independent (queries by item ID). Optional `since`/`until`/`eventTypes` filters (applied client-side; malformed `since`/`until` values return an error). When more than 200 events qualify, only the most recent 200 are returned, with a `truncated` flag.

### Write Tools

- **`update_issue_field`** -- Update a single-select field value. Provide human-readable field and option names; the server resolves them to GitHub node IDs. Specify `board` to target the correct board.

- **`create_issue_in_project`** -- Create a new GitHub Issue in a repository and add it to a board. Optionally set initial status, assignees, and labels. Public issues in `giantswarm/roadmap` require `confirmPublicSafe=true`. Labels must already exist in the repository -- non-existent labels are rejected before the issue is created rather than being auto-created. If applying labels fails *after* the issue has already been created and added to the board, the issue is not rolled back -- the response reports `success: true` with a `warning` explaining that labels were not applied.

- **`add_existing_issue`** -- Add an existing GitHub issue to a board by URL or node ID.

- **`archive_item`** -- Archive a project item from the active board view.

- **`close_issue`** -- Close the GitHub issue underlying a single project item. Board-independent (queries by item ID). Accepts an optional `stateReason` (`"completed"` or `"not_planned"`, defaults to `"completed"`; any other value returns an error) and an optional `comment` posted before closing. Comments on issues in public repos require `confirmPublicSafe=true`. One item per call -- no bulk close. Closing the issue does not update the board's Status field; unless the board has GitHub's built-in "item closed -> set Status" workflow enabled, pair this with `update_issue_field` if the board Status should reflect the closure.

- **`reopen_issue`** -- Reopen the GitHub issue underlying a single project item. Board-independent (queries by item ID). Accepts an optional `comment` posted before reopening. Comments on issues in public repos require `confirmPublicSafe=true`. One item per call -- no bulk reopen. Reopening the issue does not update the board's Status field; unless the board has GitHub's built-in "item closed -> set Status" workflow enabled, pair this with `update_issue_field` if the board Status should reflect the reopening.

- **`update_issue_labels`** -- Add and/or remove labels on the issue underlying a project item. Board-independent (queries by item ID). At least one of `addLabels`/`removeLabels` is required. Labels being added must already exist in the repository -- non-existent labels are rejected with a clear error instead of being auto-created. `added` and `removed` in the response both reflect effective changes only -- labels not already present pre-call for `added`, labels that were actually present pre-call for `removed` -- rather than echoing the requested sets.

## MCP Resources

Resources are provided per board. Read the schema resource before querying to understand the available fields and their valid option values.

| Resource | Description |
|----------|-------------|
| `roadmap://schema` | Field schema for the Roadmap Board |
| `roadmap://overview` | Stats and status distribution for the Roadmap Board |
| `customer://schema` | Field schema for the Customer Board |
| `customer://overview` | Stats and status distribution for the Customer Board |

## Repository Safety Guidance

- `giantswarm/roadmap` is public. Use it only for sanitized, public-safe issue content.
- `giantswarm/giantswarm` is internal/private. Use it for internal and customer-specific operational details.
- Customer board issues live in private customer repositories (e.g. `giantswarm/<customer>`). The board itself is a public GitHub project, but issue content is only visible to users with repository access.
- The server enforces an explicit confirmation (`confirmPublicSafe=true`) before creating issues in `giantswarm/roadmap`, and before posting a comment via `close_issue`/`reopen_issue` on an issue in any public repository.

## Example Conversations

**Roadmap -- Product Owner Workflow:**
```
You: "Show me all roadmap issues for Team Honey Badger that are missing a function field"
AI:  [Reads roadmap://schema, then uses list_issues with board="roadmap", filters={"Team": "Honey Badger"}, emptyFields=["Function"]]

You: "Set the function for issue PVTI_xxx to 'Security'"
AI:  [Uses update_issue_field with board="roadmap"]
```

**Customer Board -- Account Engineer Workflow:**
```
You: "Show me all customer issues that are blocked"
AI:  [Reads customer://schema, then uses list_issues with board="customer", filters={"Status": "Blocked"}]

You: "What customer issues are assigned to Team Tenet?"
AI:  [Uses list_issues with board="customer", filters={"Team": "Tenet"}]
```

**Cross-board Workflow:**
```
You: "Create a new feature request in the customer repo and add it to the customer board"
AI:  [Uses create_issue_in_project with board="customer"]

You: "Add issue https://github.com/giantswarm/example/issues/42 to the roadmap board"
AI:  [Uses add_existing_issue with board="roadmap"]
```

## Library Usage

The board core is importable as `@giantswarm-io/pro`, independent of the MCP server. Consumers (e.g. the Backstage roadmap backend plugin) get the same board registry, GraphQL queries, and field semantics the MCP server uses.

```bash
npm install @giantswarm-io/pro
# or, before the package is on npm / for unreleased versions:
npm install github:giantswarm/pro#v1.2.53
```

```js
import {
  BOARDS, resolveBoardId,
  listItems, getItemByID, updateItemField,
  listFields, findFieldByName, findMatchingOption,
  listSubIssues, addSubIssue, removeSubIssue, getParentIssue
} from '@giantswarm-io/pro';

const boardId = resolveBoardId('roadmap');

// Reads -- every function accepts an optional per-request token as its last
// argument (falls back to the GITHUB_API_TOKEN environment variable).
const { data } = await listItems({ boardId, filters: { Team: 'Bumblebee🐝' }, token });
const item = await getItemByID('PVTI_xxx', token);

// Writes -- resolve field and option names to node IDs, then mutate.
const field = await findFieldByName('Status', boardId, token);
const option = findMatchingOption(field.options, 'In Progress ⛏️');
await updateItemField('PVTI_xxx', field.id, { singleSelectOptionId: option.id }, boardId, token);

// Sub-issues (REST) -- targets take explicit owner/repo/issue_number,
// child issues are referenced by their integer ID (use resolveIssueId).
await addSubIssue({ owner: 'giantswarm', repo: 'giantswarm', issue_number: 1234, subIssueId: 987654321 }, token);
```

The exported surface is defined in [`src/index.js`](src/index.js). The MCP server and CLI are not part of the library entry point.

### Releases

The `Publish package` workflow runs on every GitHub Release (created automatically by the Auto-release workflow), sets the package version from the release tag, attaches the npm tarball to the release, and publishes `@giantswarm-io/pro` to npm (skipped while the `NPM_TOKEN` repository secret is not configured).

## Development

```bash
# Start the MCP server locally (stdio)
node bin/index.js

# Start with HTTP transport
node bin/index.js --transport=streamable-http
```

## License

Copyright (c) 2025 Giant Swarm GmbH. All Rights Reserved.
