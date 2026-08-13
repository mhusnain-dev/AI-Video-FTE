# Makefile for AI Video FTE
# Common development and deployment tasks

.PHONY: help dev dev-up dev-down dev-logs test test-unit test-integration test-coverage lint typecheck build build-prod deploy-prod deploy-stop secrets setup validate clean

# Default target
help:
	@echo "AI Video FTE - Available Commands:"
	@echo ""
	@echo "Development:"
	@echo "  make dev           - Start development environment (docker-compose)"
	@echo "  make dev-up        - Start dev environment in background"
	@echo "  make dev-down      - Stop dev environment"
	@echo "  make dev-logs      - Follow dev logs"
	@echo "  make dev-shell     - Shell into API container"
	@echo ""
	@echo "Testing:"
	@echo "  make test          - Run all tests (unit + integration)"
	@echo "  make test-unit     - Run unit tests only"
	@echo "  make test-integration - Run integration tests (requires dev env)"
	@echo "  make test-coverage - Run tests with coverage report"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint          - Run ESLint"
	@echo "  make typecheck     - Run TypeScript type check"
	@echo "  make format        - Format with Prettier"
	@echo ""
	@echo "Building:"
	@echo "  make build         - Build TypeScript"
	@echo "  make build-prod    - Build production Docker images"
	@echo ""
	@echo "Production Deployment:"
	@echo "  make secrets       - Generate secrets for production"
	@echo "  make setup         - Full production setup (secrets + build)"
	@echo "  make deploy-prod   - Deploy production stack"
	@echo "  make deploy-stop   - Stop production stack"
	@echo "  make deploy-logs   - Follow production logs"
	@echo "  make validate      - Validate deployment health"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean         - Clean build artifacts and containers"
	@echo "  make db-migrate    - Run database migrations"
	@echo "  make db-reset      - Reset database (DANGEROUS)"
	@echo ""

# Development
dev:
	docker compose -f docker-compose.yaml up --build

dev-up:
	docker compose -f docker-compose.yaml up -d --build

dev-down:
	docker compose -f docker-compose.yaml down

dev-logs:
	docker compose -f docker-compose.yaml logs -f

dev-shell:
	docker compose -f docker-compose.yaml exec api sh

# Testing
test:
	npm test

test-unit:
	npm test -- --testPathIgnorePatterns=integration

test-integration:
	npm test -- --testPathPattern=integration

test-coverage:
	npm test -- --coverage

# Code Quality
lint:
	npx eslint src/**/*.ts tests/**/*.ts --ext .ts

typecheck:
	npx tsc --noEmit

format:
	npx prettier --write "src/**/*.ts" "tests/**/*.ts" "config/**/*.yaml" "config/**/*.yml"

# Building
build:
	npm run build

build-prod:
	docker compose -f docker-compose.prod.yaml build

# Secrets
secrets:
	./scripts/setup-secrets.sh

setup: secrets build-prod
	@echo "Setup complete. Run 'make deploy-prod' to start."

# Production Deployment
deploy-prod:
	docker compose -f docker-compose.prod.yaml up -d
	@echo "Waiting for services to be healthy..."
	@sleep 10
	@make validate

deploy-stop:
	docker compose -f docker-compose.prod.yaml down

deploy-logs:
	docker compose -f docker-compose.prod.yaml logs -f

deploy-shell:
	docker compose -f docker-compose.prod.yaml exec api sh

validate:
	./scripts/validate-deployment.sh

# Database
db-migrate:
	docker compose -f docker-compose.prod.yaml exec api npx tsx migrations/run.ts

db-reset:
	@echo "⚠️  This will destroy all data! Press Ctrl+C to cancel."
	@sleep 5
	docker compose -f docker-compose.prod.yaml down -v
	docker compose -f docker-compose.prod.yaml up -d postgres
	@sleep 10
	@make db-migrate

# Maintenance
clean:
	docker compose -f docker-compose.yaml down -v --remove-orphans 2>/dev/null || true
	docker compose -f docker-compose.prod.yaml down -v --remove-orphans 2>/dev/null || true
	rm -rf dist/ coverage/ node_modules/.cache/
	docker system prune -f

# CI Helpers
ci-test:
	npm ci && npm test -- --coverage --testTimeout=30000

ci-lint:
	npm ci && npx eslint src/**/*.ts tests/**/*.ts --ext .ts

ci-typecheck:
	npm ci && npx tsc --noEmit

ci-build:
	npm ci && npm run build