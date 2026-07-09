APPLICATION := pro

##@ Development

.PHONY: install
install: ## Install npm dependencies
	npm ci

.PHONY: start
start: ## Start the MCP server (stdio transport)
	node bin/index.js

.PHONY: start-http
start-http: ## Start the MCP server (HTTP transport)
	node bin/index.js --transport=streamable-http

##@ Testing

.PHONY: helm-lint
helm-lint: ## Lint Helm chart
	@echo "Linting Helm chart..."
	@helm lint ./helm/pro

##@ Docker

.PHONY: docker-build
docker-build: ## Build Docker image locally
	docker build -t pro:local .

.PHONY: docker-run
docker-run: ## Run Docker image locally
	docker run --rm -it -p 8080:8080 -e GITHUB_API_TOKEN pro:local
