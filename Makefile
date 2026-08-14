# Pi WebUI development and source deployment commands

.PHONY: build package clean deploy start status stop restart

NPM  ?= npm
PNPM ?= pnpm

build:
	$(PNPM) build

# Build the npm tarball used for package installation and release uploads.
package:
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
