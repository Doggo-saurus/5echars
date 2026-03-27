#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/5etools-mirror-3/5etools-src.git"
TARGET_DIR="data/5etools-src"
PIN_REF="${1:-main}"

if [ -d "${TARGET_DIR}/.git" ]; then
  echo "Updating existing vendored repository in ${TARGET_DIR}"
  git -C "${TARGET_DIR}" fetch --tags origin
  git -C "${TARGET_DIR}" checkout "${PIN_REF}"
  git -C "${TARGET_DIR}" pull --ff-only origin "${PIN_REF}" || true
else
  echo "Cloning ${REPO_URL} into ${TARGET_DIR}"
  mkdir -p data
  git clone --depth 1 --branch "${PIN_REF}" "${REPO_URL}" "${TARGET_DIR}"
fi

echo "Vendored 5etools at:"
git -C "${TARGET_DIR}" rev-parse HEAD
