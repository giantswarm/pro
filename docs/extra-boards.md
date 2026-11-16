# Extra boards

PRO serves the `roadmap` and `customer` boards out of the box. An installation
can serve further GitHub Projects V2 boards next to them, such as a team's own
board or a person's board in their user account, by setting `PRO_EXTRA_BOARDS`
where the server starts.

## Configuration

`PRO_EXTRA_BOARDS` is a JSON object of board key to board:

```json
{
  "team": {
    "id": "PVT_kwDOAbCdEf4AaBbCc",
    "number": 7,
    "owner": "octo-org",
    "name": "Team Board"
  }
}
```

| Property | Required | Meaning |
|----------|----------|---------|
| `id` | yes | The project's node ID (`PVT_...`) |
| `number` | yes | The project's number, as in its URL |
| `owner` | yes | The user or organization a short repository name resolves to on this board: `repository: "myrepo"` means `<owner>/myrepo` |
| `name` | no | Display name in resource listings and messages; defaults to `<Key> Board` |

The project's node ID is in the output of the GitHub CLI:

```bash
gh project view 7 --owner octo-org --format json --jq .id
```

A board key is lowercase letters, digits and hyphens, starting with a letter,
because it is also the scheme of the board's resources (`team://schema`). The
built-in keys `roadmap` and `customer` cannot be redefined. The server refuses
to start on a value it cannot read (invalid JSON, a missing or unknown
property), naming the board and the property.

For a stdio client the variable goes next to the token:

```json
{
  "mcpServers": {
    "giantswarm-pro": {
      "command": "pro",
      "args": [],
      "env": {
        "GITHUB_API_TOKEN": "your-github-token",
        "PRO_EXTRA_BOARDS": "{\"team\":{\"id\":\"PVT_kwDOAbCdEf4AaBbCc\",\"number\":7,\"owner\":\"octo-org\"}}"
      }
    }
  }
}
```

## What an extra board gets

- Its key is a value of the `board` argument of every board-scoped tool
  (`list_issues`, `get_board_schema`, `get_item_by_issue`,
  `update_issue_field`, `create_issue_in_project`, `add_existing_issue`,
  `archive_item`).
- Its `{key}://schema` and `{key}://overview` resources. The schema is read
  from the board, so its fields can differ from the built-in boards'; it names
  `<owner>/<repository>` as the repository pattern and carries no content
  policy.
- Short repository names resolve to the board's `owner` in `list_issues`'
  `repository` filter and in `create_issue_in_project`. On the built-in boards
  they resolve to `giantswarm`, as before.

`roadmap` stays the default board of every tool. The tools that work by item
ID or issue URL alone (`get_issue_details`, `close_issue`, the sub-issue and
relation tools, ...) need no board and work for items of any board.

## Access

The server reads and writes an extra board as whoever its GitHub calls run as:
the `GITHUB_API_TOKEN` in stdio and env-token mode, the caller in the OAuth and
bearer-only modes. A private board is visible only to the people GitHub shows it
to, so on a shared deployment every caller sees the board's key, but only those
with access to the project can use it.
