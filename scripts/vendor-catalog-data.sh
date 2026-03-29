#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-}"
PIN_REF="${2:-main}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${PROJECT_ROOT}/data/catalog-src"

if [ -z "${REPO_URL}" ]; then
  echo "Please provide a link to GitHub for your favourite 5e tools."
  echo "Usage: bash ./scripts/vendor-catalog-data.sh <repo-url> [ref]"
  echo "Example: bash ./scripts/vendor-catalog-data.sh https://github.com/example/source-data.git v1.0.0"
  exit 1
fi

mkdir -p "${PROJECT_ROOT}/data"

if [ -d "${TARGET_DIR}/.git" ]; then
  echo "Updating existing vendored repository in ${TARGET_DIR}"
  git -C "${TARGET_DIR}" remote set-url origin "${REPO_URL}"
  git -C "${TARGET_DIR}" fetch --depth 1 --tags origin "${PIN_REF}"
  git -C "${TARGET_DIR}" checkout --force FETCH_HEAD
else
  echo "Cloning ${REPO_URL} into ${TARGET_DIR}"
  git clone --depth 1 --filter=blob:none --sparse --branch "${PIN_REF}" "${REPO_URL}" "${TARGET_DIR}"
fi

git -C "${TARGET_DIR}" sparse-checkout set \
  "data/class" \
  "data/spells" \
  "data/races.json" \
  "data/backgrounds.json" \
  "data/feats.json" \
  "data/optionalfeatures.json" \
  "data/items.json" \
  "data/items-base.json" \
  "data/magicvariants.json" \
  "data/conditionsdiseases.json" \
  "data/books.json" \
  "data/generated/gendata-spell-source-lookup.json"

git -C "${TARGET_DIR}" read-tree -mu HEAD

echo "Vendored catalog data at:"
git -C "${TARGET_DIR}" rev-parse HEAD
