#!/usr/bin/env bash
# Compatibility wrapper around the canonical Makefile build.
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"

case "${1:-full}" in
  full)
    exec make app
    ;;
  dev)
    exec make dev RAYFORCE_SRC_DIR="${2:-../rayforce}"
    ;;
  debug)
    exec make wasm-debug RAYFORCE_SRC_DIR="${2:-../rayforce}"
    ;;
  clean)
    exec make clean-all
    ;;
  help|--help|-h)
    exec make help
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Usage: $0 [full|dev [path]|debug [path]|clean|help]" >&2
    exit 2
    ;;
esac
