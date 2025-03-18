# Roadmap Board Manager

A web interface for managing the Giant Swarm Product Roadmap board.

## Features

- **List Items**: View and filter items from the roadmap board
- **Fix Function Field**: Update function field values using AI suggestions
- **Fix Kind Field**: Update kind field values using AI suggestions
- **Summarize Issues**: Generate AI-powered summaries and priority recommendations

## Getting Started

### Prerequisites

- Node.js
- Git
- GitHub token with appropriate permissions

### Installation

1. Clone the repository
2. Set up environment variables (GitHub token)
3. Install dependencies: `npm install`

### Running the Web Application

Start the web application server:

```bash
cd src/webapp
node server.js
```

Then open your browser and navigate to: [http://localhost:3000](http://localhost:3000)

## Usage

The application interface is divided into four main sections:

### 1. List Items

Filter and view items from the roadmap board. Filters include:
- Kind
- Status
- Function
- Team
- SIG
- Working Group

### 2. Fix Function Field

Update empty function fields in issues using AI suggestions. Options:
- Filter by team
- Only process items with no team
- Confirm before updating each issue

### 3. Fix Kind Field

Update empty kind fields in issues using AI suggestions. Similar options to the function field.

### 4. Summarize Issues

Generate AI-powered summaries of filtered issues, including:
- Category groupings
- Priority recommendations
- Overall summary

## Configuration

The application uses the roadmap board ID by default: `PVT_kwDOAHNM9M4ABvWx`

## License

Internal Giant Swarm tool - not for public distribution 