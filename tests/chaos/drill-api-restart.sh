#!/usr/bin/env bash
# Chaos Drill: API Restart
# Kills the API process, verifies Docker restarts it, measures restart time
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULT_FILE="${RESULTS_DIR}/drill-api-restart-${TIMESTAMP}.txt"
API_URL="${API_URL:-http://localhost:3000}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yaml}"

echo "============================================"
echo "  Chaos Drill: API Restart"
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

mkdir -p "${RESULTS_DIR}"

DRILL_RESULT="PASS"
RESTART_TIME_MS=0
ISSUES=()

check_api_health() {
    curl -sf -o /dev/null -w "%{http_code}" "${API_URL}/health" 2>/dev/null || echo "000"
}

measure_recovery() {
    local start_time end_time elapsed
    start_time=$(date +%s%N)
    local max_wait=120
    local waited=0
    while [ $waited -lt $max_wait ]; do
        local code
        code=$(check_api_health)
        if [ "$code" = "200" ]; then
            end_time=$(date +%s%N)
            elapsed=$(( (end_time - start_time) / 1000000 ))
            echo "$elapsed"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done
    echo "-1"
    return 1
}

{
    echo "Chaos Drill: API Restart"
    echo "==============================="
    echo "Start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""

    # Step 1: Verify pre-chaos health
    echo "[Step 1] Verifying pre-chaos health..."
    PRE_HEALTH=$(check_api_health)
    if [ "$PRE_HEALTH" = "200" ]; then
        echo "  ✓ API is healthy (HTTP $PRE_HEALTH)"
    else
        echo "  ⚠ API not healthy before chaos (HTTP $PRE_HEALTH)"
        DRILL_RESULT="WARN"
        ISSUES+=("API not healthy before chaos (HTTP $PRE_HEALTH)")
    fi

    # Step 2: Kill the API process
    echo ""
    echo "[Step 2] Killing API process..."

    # Check if running in Docker
    if docker ps --format '{{.Names}}' | grep -q "fte-api"; then
        echo "  API running in Docker container 'fte-api'"
        docker kill fte-api 2>/dev/null || docker stop fte-api 2>/dev/null
        echo "  ✓ Docker container killed"
    else
        # Try to find node process on port 3000
        local pid
        pid=$(lsof -ti:3000 2>/dev/null || ss -tlnp | grep ':3000' | grep -oP 'pid=\K\d+' || echo "")
        if [ -n "$pid" ]; then
            kill -9 $pid 2>/dev/null || true
            echo "  ✓ Process $pid killed (port 3000)"
        else
            echo "  ⚠ No API process found on port 3000"
            ISSUES+=("Could not find API process to kill")
        fi
    fi

    # Step 3: Verify API is down
    echo ""
    echo "[Step 3] Verifying API is down..."
    sleep 2
    DOWN_HTTP=$(check_api_health)
    if [ "$DOWN_HTTP" = "000" ] || [ "$DOWN_HTTP" = "502" ] || [ "$DOWN_HTTP" = "503" ]; then
        echo "  ✓ API is down (HTTP $DOWN_HTTP)"
    else
        echo "  ⚠ API still responding (HTTP $DOWN_HTTP)"
        ISSUES+=("API still responding after kill (HTTP $DOWN_HTTP)")
    fi

    # Step 4: Wait for Docker to restart (if Docker)
    echo ""
    echo "[Step 4] Waiting for automatic restart..."
    sleep 3

    # Step 5: Measure recovery time
    echo ""
    echo "[Step 5] Measuring restart time..."
    RESTART_TIME_MS=$(measure_recovery) || RESTART_TIME_MS=-1

    if [ "$RESTART_TIME_MS" -ge 0 ]; then
        echo "  ✓ API recovered in ${RESTART_TIME_MS}ms"
        if [ "$RESTART_TIME_MS" -gt 30000 ]; then
            DRILL_RESULT="WARN"
            ISSUES+=("Restart time ${RESTART_TIME_MS}ms exceeds 30s threshold")
        fi
    else
        echo "  ✗ API did not recover within 120 seconds"
        DRILL_RESULT="FAIL"
        ISSUES+=("API failed to recover within 120 seconds")
    fi

    # Step 6: Verify full functionality
    echo ""
    echo "[Step 6] Verifying full functionality..."
    POST_HEALTH=$(check_api_health)
    if [ "$POST_HEALTH" = "200" ]; then
        echo "  ✓ API is healthy (HTTP $POST_HEALTH)"
    else
        echo "  ✗ API not healthy (HTTP $POST_HEALTH)"
        DRILL_RESULT="FAIL"
        ISSUES+=("API not healthy after recovery (HTTP $POST_HEALTH)")
    fi

    echo ""
    echo "============================================"
    echo "  Result: ${DRILL_RESULT}"
    echo "  Restart Time: ${RESTART_TIME_MS}ms"
    echo "  Issues: ${#ISSUES[@]}"
    for issue in "${ISSUES[@]+"${ISSUES[@]}"}"; do
        echo "    - ${issue}"
    done
    echo "============================================"

} | tee "${RESULT_FILE}"

cat > "${RESULTS_DIR}/drill-api-restart-result.json" <<EOF
{
  "drill": "api-restart",
  "result": "${DRILL_RESULT}",
  "recoveryTimeMs": ${RESTART_TIME_MS},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "issues": [$(printf '"%s",' "${ISSUES[@]+"${ISSUES[@]}"}" 2>/dev/null | sed 's/,$//')]
}
EOF

echo ""
echo "Results saved to: ${RESULT_FILE}"
