#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SecureRoom — Full Test Suite Runner
#  Runs all tests inside Docker. No local binaries required.
#
#  Usage:
#    ./run_tests.sh
#    KEEP_PROD=0 ./run_tests.sh  # stop prod at the end (default: keep running)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colour codes ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}${BOLD}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}${BOLD}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}${BOLD}[ERROR]${RESET} $*" >&2; }

separator() {
  echo -e "${CYAN}${DIM}────────────────────────────────────────────────────────${RESET}"
}

banner() {
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${BLUE}║        SecureRoom — Full Test Suite (Docker)         ║${RESET}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

# ── Validate Docker is available ─────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  error "Docker CLI not found. Please install Docker Desktop or Docker Engine."
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  error "Docker daemon is not running."
  error "Please start Docker Desktop (or run 'sudo systemctl start docker') and retry."
  exit 1
fi

# ── Move to repo root ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

banner

# Persist Vitest / Playwright JSON reports on the host (see docker-compose coverage mounts).
mkdir -p coverage/unit coverage/api coverage/e2e

# ── Tracking variables ────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0
declare -a SUITE_RESULTS=()
START_TIME=$(date +%s)

# ── run_suite <display-name> <compose-service> [extra flags...] ──────────────
run_suite() {
  local name="$1"
  local service="$2"
  shift 2

  separator
  echo -e "\n${BOLD}${YELLOW}▶  $name${RESET}\n"

  local exit_code=0
  # --no-deps: we start/health-check dependencies ourselves (prod) to avoid
  # docker compose recreating the prod container on every e2e run.
  docker compose --profile test run --rm --no-deps "$@" "$service" || exit_code=$?

  echo ""
  if [ "$exit_code" -eq 0 ]; then
    PASS=$((PASS + 1))
    SUITE_RESULTS+=("${GREEN}${BOLD}  ✔  $name${RESET}")
    success "$name PASSED"
  else
    FAIL=$((FAIL + 1))
    SUITE_RESULTS+=("${RED}${BOLD}  ✘  $name${RESET}  (exit $exit_code)")
    error "$name FAILED (exit code $exit_code)"
    # Continue running remaining suites even on failure
  fi
}

# ── Parse flags ───────────────────────────────────────────────────────────────
REBUILD="${REBUILD:-0}"
KEEP_PROD="${KEEP_PROD:-1}"
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --stop-prod) KEEP_PROD=0 ;;
    -h|--help)
      echo "Usage: $0 [--rebuild] [--stop-prod]"
      exit 0
      ;;
  esac
done

# ── Step 1 — Build test images only if missing (or --rebuild) ─────────────────
separator
REQUIRED_IMAGES=(repo-unit-test repo-api-test repo-e2e-test repo-prod)
MISSING=()
for img in "${REQUIRED_IMAGES[@]}"; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    MISSING+=("$img")
  fi
done

if [ "$REBUILD" = "1" ] || [ ${#MISSING[@]} -gt 0 ]; then
  if [ "$REBUILD" = "1" ]; then
    info "Rebuilding all test images (forced)…"
  else
    info "Building missing test images: ${MISSING[*]}"
  fi
  echo ""
  docker compose --profile test build
  docker compose build prod
  success "All images built."
else
  info "All test images already present — skipping build."
  info "Pass --rebuild (or REBUILD=1) to force a rebuild."
fi

# ── Step 2 — Ensure prod is running and healthy (needed by E2E) ──────────────
separator
info "Starting prod service…"
docker compose up -d prod

info "Waiting for prod to become healthy…"
HEALTH_WAIT=0
HEALTH_TIMEOUT=90
PROD_CONTAINER="$(docker compose ps -q prod)"
while true; do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$PROD_CONTAINER" 2>/dev/null || echo "missing")"
  if [ "$status" = "healthy" ]; then
    success "prod is healthy."
    break
  fi
  if [ "$HEALTH_WAIT" -ge "$HEALTH_TIMEOUT" ]; then
    error "prod did not become healthy within ${HEALTH_TIMEOUT}s (last status: $status)"
    docker logs "$PROD_CONTAINER" --tail 50 || true
    exit 1
  fi
  sleep 2
  HEALTH_WAIT=$((HEALTH_WAIT + 2))
done

# ── Step 3 — Run unit tests ───────────────────────────────────────────────────
run_suite "Unit Tests  (Vitest)" "unit-test"

# ── Step 4 — Run API / integration tests ─────────────────────────────────────
run_suite "API Tests   (Vitest)" "api-test"

# ── Step 5 — Run E2E tests ────────────────────────────────────────────────────
#  prod is already running and healthy — we skip compose's depends_on handling
#  via --no-deps in run_suite so the container isn't recreated on every run.
run_suite "E2E Tests   (Playwright)" "e2e-test"

# ── Step 6 — Optionally stop prod ────────────────────────────────────────────
separator
if [ "$KEEP_PROD" = "0" ]; then
  info "Stopping prod service…"
  docker compose stop prod 2>/dev/null || true
else
  info "Leaving prod running for faster subsequent runs (pass --stop-prod to stop)."
fi

# ── Summary ──────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
TOTAL=$((PASS + FAIL + SKIP))

echo ""
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${BLUE}║                   Test Summary                       ║${RESET}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""

for result in "${SUITE_RESULTS[@]}"; do
  echo -e "$result"
done

echo ""
echo -e "  Total suites : ${BOLD}$TOTAL${RESET}"
echo -e "  Passed       : ${GREEN}${BOLD}$PASS${RESET}"
echo -e "  Failed       : ${RED}${BOLD}$FAIL${RESET}"
echo -e "  Elapsed      : ${DIM}${ELAPSED}s${RESET}"
echo ""

# Detailed counts + per-suite coverage (from JSON written under ./coverage/)
if command -v node >/dev/null 2>&1; then
  node "$SCRIPT_DIR/scripts/print-test-summary.mjs" || true
else
  warn "node not found — skipping overall stats (install Node to print test/coverage summary)."
fi

separator

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${BOLD}  RESULT: $FAIL suite(s) FAILED${RESET}"
  echo ""
  exit 1
else
  echo -e "${GREEN}${BOLD}  RESULT: ALL $PASS SUITES PASSED${RESET}"
  echo ""
  exit 0
fi
