# 🚀 PRO - Giant Swarm Roadmap Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 📋 Command-line tool for managing Giant Swarm's roadmap board in GitHub Projects

## ✨ Features

- 📊 View and filter roadmap items directly from the terminal
- 🔄 Synchronize project fields and item data
- 🤖 AI-powered field suggestions using OpenAI
- 🏷️ Automatically categorize issues by team, function, and kind
- 📈 Generate AI summaries and insights for issues
- 🎨 Beautiful terminal output with colors and spinners
- 🌐 Web interface with all features accessible via browser

> ⚠️ **Note on Terminal Links**: This tool uses ANSI escape sequences for clickable links in the terminal. For the best experience, use a modern terminal that supports hyperlinks such as iTerm2, VS Code's integrated terminal, or recent versions of GNOME Terminal. If links don't display properly, you may need to enable them in your terminal settings.

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/giantswarm/pro.git
cd pro

# Install dependencies
npm install

# Install globally
npm install -g .
```

## 🔑 Requirements

This tool requires the following environment variables:

```bash
# GitHub Personal Access Token with repo and project permissions
export GITHUB_API_TOKEN=your_github_token

# OpenAI API Key for AI suggestions
export OPENAI_API_KEY=your_openai_api_key
```

## 📋 Commands

### List Items

```bash
# List all items in the roadmap board
pro list-items

# Filter items by various fields
pro list-items --kind "Feature"
pro list-items --team "Honey Badger"
pro list-items --status "In Progress"
pro list-items --function "Development"

# Show items with no team assigned
pro list-items --no-team
```

### List and Show Fields

```bash
# List all fields in the roadmap board
pro list-fields

# Show details of a specific field
pro show-field --field field_id

# Show team options
pro show-teams

# Show function options
pro show-functions

# Show SIGs
pro show-sigs

# Show Working Groups
pro show-wgs
```

### Fix Fields

```bash
# Fix team field values based on team labels
pro fix-team-field

# Fix function field values using AI suggestions
pro fix-function-field
pro fix-function-field --team "Honey Badger"
pro fix-function-field --no-team

# Fix kind field values using AI suggestions
pro fix-kind-field
pro fix-kind-field --team "Honey Badger"
pro fix-kind-field --no-team
```

### AI Analysis

```bash
# Generate AI summaries and insights for issues
pro summarize-issues

# Filter issues to summarize
pro summarize-issues --team "Honey Badger"
pro summarize-issues --kind "Feature"
pro summarize-issues --function "Development"
```

### Web Server

```bash
# Start the web server with default port (3000)
pro server

# Start the web server with a custom port
pro server --port 8080
```

After starting the server, open your browser and navigate to http://localhost:3000 (or your custom port) to access the web interface.

## 🧩 How It Works

Pro connects to GitHub's GraphQL API to interact with your project board. It can:

1. 📥 Fetch items and fields from your GitHub Projects roadmap board
2. 🔍 Apply filters to find specific items
3. 🧠 Use OpenAI to suggest appropriate values for fields
4. 📝 Update fields in GitHub Projects
5. 📊 Generate summaries and insights for groups of issues

## 🧪 Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate test coverage
npm run test:coverage

# Start the web server in development mode
npm run start
```

## 📚 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👤 Author

- **Timo Derstappen**

---

Made with ❤️ at Giant Swarm 