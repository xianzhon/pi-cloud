# Pi WebUI development and source deployment commands

.PHONY: build test package clean deploy start status stop restart

NPM  ?= npm
PNPM ?= pnpm

build:
	$(PNPM) build

test:
	$(PNPM) test

# Build the npm tarball used for package installation and release uploads.
package: build test
	$(NPM) pack

clean:
	rm -f pi-webui-*.tgz

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
