.DEFAULT_GOAL := dev
.PHONY: install dev start build preview desktop dist deploy clean

# One command to play locally. `make` is an alias for `make dev`.
install:
	npm install

dev: install
	npm run dev

start: dev

build: install
	npm run build

preview: install
	npm run build
	npm run preview

# Run the game in the Electron shell, or package it for this OS into release/.
desktop: install
	npm run desktop

dist: install
	npm run dist

# Publish dist/ to the gh-pages branch (GitHub Pages). Purge the Cloudflare
# cache afterwards to see it live. Old hashed assets are kept so a stale cached
# index.html still finds the JS/CSS it points at until the purge.
deploy: build
	@set -e; sha=$$(git rev-parse --short HEAD); url=$$(git remote get-url origin); \
	tmp=$$(mktemp -d); \
	git clone -q --depth 1 --branch gh-pages "$$url" "$$tmp" 2>/dev/null || git init -q -b gh-pages "$$tmp"; \
	find "$$tmp" -mindepth 1 -maxdepth 1 ! -name .git ! -name assets -exec rm -rf {} +; \
	cp -R dist/. "$$tmp"; touch "$$tmp/.nojekyll"; \
	cd "$$tmp"; git add -A; \
	if git diff --cached --quiet; then echo "gh-pages already up to date"; \
	else git commit -q -m "Deploy from main@$$sha" && git push -q "$$url" gh-pages && echo "deployed main@$$sha"; fi; \
	rm -rf "$$tmp"

clean:
	rm -rf dist release node_modules
