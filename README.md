# GitHub Project (v2) CLI Tool

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

```bash
npm install
```

## Configuration

Set your GitHub token as an environment variable:

```bash
export GITHUB_TOKEN=your_github_personal_access_token
```

## Usage

```bash
# List projects in a repository
node index.js list --owner organization_name --repo repository_name

# List projects in an organization
node index.js list --owner organization_name

# Create a new project
node index.js create --owner organization_name --repo repository_name --title "Project Title"

# Delete a project
node index.js delete --id project_id

# Update a project
node index.js update --id project_id --title "New Title"

# List items in a project
node index.js items --id project_id

# List fields in a project
node index.js fields --id project_id

# Show field details
node index.js field --project project_id --field field_id

# Fix team field issues
node index.js fix-team-field --project project_id
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