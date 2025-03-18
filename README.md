![Project Logo](./pro.svg)

# GitHub Project (v2) CLI Tool

A command-line tool for managing GitHub Projects (v2) through the GitHub GraphQL API.

## Features

- List projects for a repository or organization
- Create new projects
- Delete projects
- Update project details
- List items in a project with optional filtering (merged filter-items)
- List fields in a project
- Show field details
- Fix team field values using AI suggestions
- Fix function field values using AI suggestions
- Fix kind field values using AI suggestions
- Summarize and analyze issues with AI-generated insights
- Elegant terminal feedback with loading spinners

## Available Commands

- **list**  
  List all GitHub Project v2 boards for a repository or organization.

- **create**  
  Create a new GitHub Project v2 board.

- **delete**  
  Delete a GitHub Project v2 board.

- **update**  
  Update a GitHub Project v2 board title.

- **list-items**  
  List items in a GitHub Project v2 board. Supports filtering by kind, status, function, team, SIG, WG, and the special flag `--no-team` to show only items with an empty Team field.

- **list-fields**  
  List all fields in a GitHub Project v2 board.

- **show-field**  
  Show details of a specific field in a GitHub Project v2 board.  
  _Alias commands:_ `show-teams`, `show-sigs`, `show-wgs`, `show-functions` for common field IDs.

- **fix-team-field**  
  Fix team field values based on team labels, using AI suggestions and manual confirmation as needed.

- **fix-function-field**  
  Fix function field values using ChatGPT suggestions. Supports filtering by team name and items with no team assigned.

- **fix-kind-field**  
  Fix kind field values using ChatGPT suggestions. Supports filtering by team name and items with no team assigned.

- **summarize-issues**  
  Analyze and summarize issues with AI-generated insights. Provides a summary of themes, logical grouping by category, suggested priority order, and identifies potential dependencies between issues.

## Recommended Project Structure

````bash
pro/
├─ bin/
│  └─ index.js
├─ src/
│  ├─ commands/
│  ├─ lib/
│  └─ utils/
├─ package.json
└─ README.md
````

## Requirements

- Node.js
- A GitHub Personal Access Token with appropriate permissions
- An OpenAI API key (set as `OPENAI_API_KEY` in your environment)

## Installation

To install as a global CLI tool, run:
```bash
npm install -g
```

## Configuration

Set your GitHub token and OpenAI API key as environment variables:

```bash
export GITHUB_TOKEN=your_github_personal_access_token
export OPENAI_API_KEY=your_openai_api_key
```

## Usage

Use the CLI command `pro`:

```bash
# List projects at Giant Swarm
pro list

# List items in the roadmap board with optional filtering:
pro list-items --kind bug --no-team

# List fields in the roadmap board
pro list-fields

# Show details for a specific field in the roadmap board
pro show-field --field field_id

# Additional aliases for show-field with roadmap board fields:
pro show-teams
pro show-sigs
pro show-wgs
pro show-functions

# Fix team field values based on team labels, team projects and an AI assistant
pro fix-team-field

# Fix function field values using AI suggestions
pro fix-function-field

# Fix function field values for a specific team
pro fix-function-field --team "Team Name"

# Fix kind field values using AI suggestions
pro fix-kind-field

# Analyze and summarize issues
pro summarize-issues --kind feature

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
```

## Features

### AI-powered field suggestions

The tool uses OpenAI's models to intelligently suggest values for fields like team, function, and kind based on the issue's content, labels, and context.

### Smart filtering

All commands with filtering options support case-insensitive matching and ignore emojis and special characters. For example, filtering with `--team planeteers` will match fields with value "Planeteers 🪐".

### Enhanced terminal experience

The CLI features elegant loading spinners that provide visual feedback during:
- Data fetching operations
- Filtering processes
- AI analysis
- Issue updates

This improves the user experience by providing clear progress indicators during longer operations.

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
