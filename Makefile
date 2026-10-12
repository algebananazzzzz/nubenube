NO_UPDATER := '{"bundle":{"createUpdaterArtifacts":false}}'

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
	npm run tauri dev

web:
	npm run dev

build:
	npm run tauri build -- $(BUNDLES) --config $(NO_UPDATER)

test:
	cargo test --manifest-path src-tauri/Cargo.toml
