NO_UPDATER := '{"bundle":{"createUpdaterArtifacts":false}}'
# Single-instance keys on the identifier, so a dev build sharing the release's
# would focus an installed copy and exit. The suffix also keeps dev data apart.
DEV_CONFIG := '{"identifier":"com.nubenube.app.dev","productName":"Nube Nube Dev"}'

# Linux matches what CI ships; "all" there would also try an AppImage, which
# downloads linuxdeploy at build time.
ifeq ($(shell uname -s),Linux)
BUNDLES := --bundles deb,rpm
endif

.PHONY: install dev web build test

install:
	./scripts/system-deps.sh
	npm install

dev:
	npm run tauri dev -- --config $(DEV_CONFIG)

web:
	npm run dev

build:
	npm run tauri build -- $(BUNDLES) --config $(NO_UPDATER)

test:
	cargo test --manifest-path src-tauri/Cargo.toml
