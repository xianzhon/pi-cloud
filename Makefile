# Pi Cloud development and source deployment commands

.PHONY: build test package clean deploy start status stop restart

NPM  ?= npm
PNPM ?= pnpm

build:
	$(PNPM) build

# Run local quality gates together so lint, formatting, build, and coverage
# failures are caught before changes are pushed to CI.
test:
	$(PNPM) lint
	$(PNPM) format:check
	$(PNPM) build
	$(PNPM) test:coverage

# Build the npm tarball used for package installation and release uploads.
package: build test
	$(NPM) pack

clean:
	rm -f pi-cloud-*.tgz

start:
	./start.sh

status:
	./status.sh

stop:
	./stop.sh

restart: stop start

# Deploy locally from the latest source code.
deploy:
	git pull
	$(PNPM) build
	$(MAKE) restart
