# Changelog

## [Unreleased]

### Added
- Trusted client auto-registration via `OAUTH_TRUSTED_CLIENT_IDS` env var: CIMD URLs in the allowlist are fetched and registered on first use, enabling muster to authenticate via OAuth without dynamic client registration

### Fixed
- Streamable HTTP transport now creates a new transport and MCP server per session, fixing "Server already initialized" errors when multiple clients connect
- Helm values schema: allow plain `value:` env vars on `env[*]` items (previously only `name` + `valueFrom` were permitted, causing HelmRelease install failures)

### Added
- REST API client (`@octokit/rest`) for GitHub sub-issues endpoints with `X-GitHub-Api-Version: 2026-03-10` header
- Sub-issues MCP tools: `list_sub_issues`, `add_sub_issue`, `remove_sub_issue`, `get_parent_issue`, `reprioritize_sub_issue`, `migrate_task_list_to_sub_issues`
- `migrate_task_list_to_sub_issues` tool parses markdown task-list items (bare URLs, short refs, same-repo #N, markdown links, embedded refs) and converts them to sub-issue relationships
- `list_issues` now supports server-side filtering by `assignee`, `label`, `state`, `keyword`, `updated`, and `reason` parameters — all using GitHub Projects V2 built-in query syntax (no client-side filtering)
- `list_issues` output now includes `assignees` and `labels` arrays when non-empty
- Board schema resource includes an `issueFilters` section documenting the new filter parameters
- Customer Board support (GitHub Project #345) alongside the existing Roadmap Board
- Generic field filtering: `list_issues` accepts arbitrary field name/value pairs via `filters` parameter
- `repository` parameter on `list_issues` to filter by repository (e.g. `"myrepo"` or `"giantswarm/myrepo"`); uses server-side GitHub Projects `repo:` query for efficient filtering
- Board schema resources now include `repositoryFilter` section documenting which repositories each board uses and how to filter by them
- `emptyFields` parameter replaces specific `noTeam`/`noFunction`/etc. booleans
- `board` parameter on all write tools to target roadmap or customer board
- New resources: `customer://schema` and `customer://overview`
- Board registry in `project.js` with `resolveBoardId()` helper for easy multi-board management

### Changed
- Schema resources now return a compact format: no internal IDs, no empty values, only actionable fields (single-select, date, text, iteration); non-empty option descriptions collected in a `hints` map; repository info condensed. Reduces context token usage by ~50%.
- Overview resource uses a lightweight GraphQL query (Status + repository only) instead of the full item query, fixing 60-second MCP timeout on large boards like the roadmap.
- **BREAKING**: `list_issues` no longer has hardcoded field-specific parameters (team, function, kind, etc.); use `filters` object instead
- LLM agents should read the board schema resource to discover available fields before querying
- Server name changed from `giantswarm-roadmap` to `giantswarm-pro`
- `listFields()` and `findFieldByName()` now require an explicit board ID parameter
- `updateItemField()` now requires an explicit board ID parameter
- Moved repository policy and available field options from the overview resource into the schema resource to remove duplication; the overview now only contains runtime stats (counts and distributions)
- Version bumped to 3.0.0 (breaking change)

## [2.0.0]

### Fixed
- Eliminated stdout pollution in MCP server that caused JSON parsing errors
  - Added 'silent' parameter to listItems(), getItemByID(), and getAISuggestion() to suppress console output when called from MCP
  - Updated all MCP tool handlers to use silent mode
  - Removed noisy log messages for routine operations
  - Simplified startup banner and reduced logging verbosity
  - All console output now correctly goes to stderr, ensuring pure JSON-RPC communication over stdout

### Changed
- Updated all npm dependencies to latest versions
  - Major version updates: @modelcontextprotocol/sdk (0.5.0 → 1.24.3), express (4.21.2 → 5.2.1), react (18.2.0 → 19.2.1), react-dom (18.2.0 → 19.2.1), openai (4.86.2 → 6.10.0), jest (29.7.0 → 30.2.0)
  - Minor/patch updates: @octokit/graphql, chalk, commander, inquirer, ora, uuid, ws

## [1.1.2] - 2024-03-25

### Added
- Environment variables for data and cache directories
- Helm chart for Kubernetes deployment
- Docker container support
- Updated documentation with installation methods

### Changed
- Switched from command-line parameters to environment variables for directory configuration
- Improved documentation with Docker and Helm installation instructions

## [1.1.1] - 2024-03-23

### Added
- Reports Module for creating and running comprehensive analyses
- Tabbed Navigation for report results
- Minimal Loading Indicators
- Copy to Clipboard functionality
- Version Check system
- Persistent Storage in user's home directory

### Changed
- Improved notification system
- Enhanced error handling
- Updated dependencies

## [1.0.0] - 2024-02-23

Initial release

### Features
- AI-powered roadmap analysis
- Field management automation
- Web interface
- Modern notification system
