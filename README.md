# GitHub Project (v2) CLI Tool

![Project Logo](./logo pro.svg)

A command-line tool for managing GitHub Projects (v2) through the GitHub GraphQL API.

## Features

- List projects for a repository or organization
- Create new projects
- Delete projects
- Update project details
- List items in a project
- List fields in a project
- Show field details
- Fix team field issues

## Requirements

- Node.js
- GitHub Personal Access Token with appropriate permissions

## Installation

To install as a global CLI tool, run:
```bash
npm install -g
```

## Configuration

Set your GitHub token as an environment variable:

```bash
export GITHUB_TOKEN=your_github_personal_access_token
```

## Usage

Instead of running with "node index.js", use the CLI command "pro":
```bash
# List projects in a repository
pro list --owner organization_name --repo repository_name

# List projects in an organization
pro list --owner organization_name

# Create a new project
pro create --owner organization_name --repo repository_name --title "Project Title"

# Delete a project
pro delete --id project_id

# Update a project
pro update --id project_id --title "New Title"

# List items in a project
pro list-items --id project_id

# List fields in a project
pro list-fields --id project_id

# Show field details
pro show-field --project project_id --field field_id

# Fix team field issues
pro fix-team-field --id project_id
```

## Development

### Running Tests

```bash
npm test
```

### Code Coverage

```bash
npm run test:coverage
```

## License

[MIT License](LICENSE)