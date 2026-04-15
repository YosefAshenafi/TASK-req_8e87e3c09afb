.PHONY: dev test e2e build prod lint shell clean

## Start the Angular dev server (hot-reload on :4200)
dev:
	docker compose up dev

## Run Karma/Jasmine unit + component tests (CI mode)
test:
	docker compose run --rm test

## Run Playwright multi-tab e2e tests (headless Chromium)
e2e:
	docker compose run --rm e2e

## Build the production bundle into ./dist
build:
	docker compose run --rm build

## Build and serve the production nginx image on :8080
prod:
	docker compose up prod --build

## Run ESLint + Prettier check
lint:
	docker compose run --rm lint

## Open an interactive shell in the dev container
shell:
	docker compose run --rm dev sh

## Remove the node_modules named volume (forces a fresh npm ci on next boot)
clean:
	docker compose down -v
	docker rmi -f $$(docker images -q --filter=reference='secureroom*') 2>/dev/null || true

## Rebuild all images without cache
rebuild:
	docker compose build --no-cache dev test e2e build prod
