APPLICATION := pro

##@ Development

.PHONY: install
install: node_modules ## Install npm dependencies

node_modules: package-lock.json
	npm ci
	@touch node_modules

.PHONY: start
start: ## Start the MCP server (stdio transport)
	node bin/index.js

.PHONY: start-http
start-http: ## Start the MCP server (HTTP transport)
	node bin/index.js --transport=streamable-http

##@ Testing

.PHONY: test
test: node_modules ## Run the unit tests (installs the npm dependencies first when missing)
	npm test

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
