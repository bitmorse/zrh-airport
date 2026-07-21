# Makefile for the zrh-airport stats backend.
#
# Run local dev tasks anywhere; run the deploy targets from YOUR machine (the one
# with your NearlyFreeSpeech SSH key / ~/.ssh/config already set up).
#
#   make test              run the PHP test suite
#   make lint              php -l every source file
#   make deploy-nfs        push backend code (src, bin) + the web front controller.
#                          SEEDS config on first deploy but NEVER overwrites an
#                          existing config/*.php, the .htaccess, or the database.
#   make deploy-frontend   build the SPA (tsc + vite) and deploy it to /airports
#   make deploy-all        deploy-nfs + deploy-frontend
#   make deploy-nfs-dry    preview exactly what deploy-nfs would transfer
#   make deploy-nfs-config push config/ on purpose (overwrites app.php + airports.json)
#   make restart-daemon    bounce the collector so it picks up the new code
#
# The NFS locations (from the SFTP paths):
#   /home/public/airports       → the built frontend SPA (bitmorse.com/airports)
#   /home/public/airports-api   → index.php + .htaccess  (API front controller)
#   /home/protected/backend     → src/ bin/ config/ data/ (code + DB, outside docroot)
#
# Override the remote or paths if your setup differs, e.g. with an SSH Host alias:
#   make deploy-nfs NFS_SSH=nfs
#   make deploy-nfs NFS_USER=bitmorse_bitmorse NFS_HOST=ssh.nyc1.nearlyfreespeech.net

NFS_USER  ?= bitmorse_bitmorse
NFS_HOST  ?= ssh.nyc1.nearlyfreespeech.net
NFS_SSH   ?= $(NFS_USER)@$(NFS_HOST)

PUBLIC    ?= /home/public/airports-api
PROTECTED ?= /home/protected/backend

# Frontend (the SPA lives at the repo root, one level up from this Makefile).
FRONTEND        ?= ..
FRONTEND_PUBLIC ?= /home/public/airports

PHP   ?= php
NPM   ?= npm
RSYNC ?= rsync -avz --human-readable

.DEFAULT_GOAL := help
.PHONY: help test lint deploy-nfs deploy-nfs-dry deploy-nfs-code deploy-nfs-web \
        deploy-nfs-config restart-daemon build-frontend deploy-frontend \
        deploy-frontend-dry deploy-all

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n",$$1,$$2}'

# ---- local dev ----

test: ## Run the PHP test suite
	$(PHP) tests/run.php

lint: ## php -l every source file
	@find src bin airports-api -name '*.php' -print0 | xargs -0 -n1 $(PHP) -l >/dev/null \
		&& echo "lint OK"

# ---- deploy (run from your machine) ----

deploy-nfs: deploy-nfs-code deploy-nfs-web ## Deploy code + web controller (keeps config + DB)
	@echo ""
	@echo "Deployed. The DB migration (new columns) runs on the next collector start —"
	@echo "run 'make restart-daemon' to bounce it, then check /airports-api/health."

# Target-specific --dry-run flows down into the prerequisites below.
deploy-nfs-dry: RSYNC += --dry-run
deploy-nfs-dry: deploy-nfs-code deploy-nfs-web ## Preview the deploy without changing anything

deploy-nfs-code:
	@echo ">> code → $(NFS_SSH):$(PROTECTED)"
	# src/ and bin/ are pure code: mirror them (--delete removes files you deleted in the repo).
	$(RSYNC) --delete src/ $(NFS_SSH):$(PROTECTED)/src/
	$(RSYNC) --delete bin/ $(NFS_SSH):$(PROTECTED)/bin/
	# config/: SEED only — --ignore-existing never overwrites an app.php/airports.json
	# you've already tuned on the server. Use 'make deploy-nfs-config' to push it on purpose.
	$(RSYNC) --ignore-existing config/ $(NFS_SSH):$(PROTECTED)/config/

deploy-nfs-web:
	@echo ">> web  → $(NFS_SSH):$(PUBLIC)"
	# index.php is code → always update it.
	$(RSYNC) airports-api/index.php $(NFS_SSH):$(PUBLIC)/index.php
	# .htaccess carries your SetEnv lines → seed only, never clobber your edits.
	$(RSYNC) --ignore-existing airports-api/.htaccess $(NFS_SSH):$(PUBLIC)/.htaccess

deploy-nfs-config: ## Force-push config/ (overwrites app.php + airports.json; never the DB)
	$(RSYNC) --exclude 'stats.db*' config/ $(NFS_SSH):$(PROTECTED)/config/

# ---- frontend (SPA → bitmorse.com/airports) ----

build-frontend: ## Build the SPA (tsc + vite) into ../dist (installs deps if missing)
	cd $(FRONTEND) && [ -d node_modules ] || $(NPM) ci
	cd $(FRONTEND) && $(NPM) run build

deploy-frontend: build-frontend ## Build + deploy the SPA to bitmorse.com/airports
	@echo ">> frontend → $(NFS_SSH):$(FRONTEND_PUBLIC)"
	# dist/ is a complete build → mirror it (--delete drops stale hashed assets).
	$(RSYNC) --delete $(FRONTEND)/dist/ $(NFS_SSH):$(FRONTEND_PUBLIC)/

deploy-frontend-dry: RSYNC += --dry-run
deploy-frontend-dry: build-frontend ## Build, then preview the frontend deploy
	$(RSYNC) --delete $(FRONTEND)/dist/ $(NFS_SSH):$(FRONTEND_PUBLIC)/

deploy-all: deploy-nfs deploy-frontend ## Deploy backend + frontend
	@echo ""
	@echo "Backend + frontend deployed. Run 'make restart-daemon' if backend code changed."

restart-daemon: ## Stop the collector so NFS restarts it on the new code
	ssh $(NFS_SSH) 'pkill -f "bin/collect.php" || true'
	@echo "Signalled the daemon to stop; NFS restarts it within ~a minute."
	@echo "Verify: curl https://bitmorse.com/airports-api/health"
