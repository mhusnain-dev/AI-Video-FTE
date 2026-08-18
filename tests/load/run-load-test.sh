#!/usr/bin/env bash
# Load test runner for AI Video FTE
# Uses Artillery for HTTP load testing
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
CONFIG_FILE="${SCRIPT_DIR}/artillery-config.yaml"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="${RESULTS_DIR}/load-test-${TIMESTAMP}.txt"
EXIT_CODE=0

echo "============================================"
echo "  AI Video FTE — Load Test Runner"
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

mkdir -p "${RESULTS_DIR}"

# Check if Artillery is installed
if ! command -v artillery &>/dev/null; then
    echo "[INFO] Artillery not found. Installing..."
    npm install -g artillery
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install Artillery"
        exit 1
    fi
    echo "[INFO] Artillery installed successfully"
fi

echo "[INFO] Using config: ${CONFIG_FILE}"
echo "[INFO] Results will be saved to: ${RESULTS_FILE}"
echo ""

# Verify target is reachable
echo "[INFO] Checking if target API is reachable at http://localhost:3000..."
if ! curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    echo "[WARN] Target API is not reachable. Starting dev environment..."
    cd "${SCRIPT_DIR}/../.."
    docker compose -f docker-compose.dev.yaml up -d
    echo "[INFO] Waiting 15 seconds for services to initialize..."
    sleep 15
    cd "${SCRIPT_DIR}"
fi

# Run the load test
echo "[INFO] Starting load test..."
echo ""
{
    echo "AI Video FTE Load Test Report"
    echo "=============================="
    echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    artillery run --config "${CONFIG_FILE}" --output "${RESULTS_DIR}/report-${TIMESTAMP}.json" "${CONFIG_FILE}" 2>&1
} | tee "${RESULTS_FILE}"
EXIT_CODE=${PIPESTATUS[0]}

echo ""

# Generate HTML report if possible
if [ -f "${RESULTS_DIR}/report-${TIMESTAMP}.json" ]; then
    echo "[INFO] Generating HTML report..."
    artillery report --output "${RESULTS_DIR}/report-${TIMESTAMP}.html" "${RESULTS_DIR}/report-${TIMESTAMP}.json" 2>/dev/null || true
    echo "[INFO] HTML report: ${RESULTS_DIR}/report-${TIMESTAMP}.html"
fi

echo ""
echo "============================================"
if [ $EXIT_CODE -eq 0 ]; then
    echo "  LOAD TEST PASSED"
else
    echo "  LOAD TEST FAILED (exit code: ${EXIT_CODE})"
fi
echo "============================================"
echo ""
echo "Summary file: ${RESULTS_FILE}"

exit $EXIT_CODE
