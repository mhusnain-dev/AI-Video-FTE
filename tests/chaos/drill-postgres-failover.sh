#!/usr/bin/env bash
# Chaos Drill: Postgres Failover
# Simulates Postgres failure, verifies API returns appropriate errors, then restarts and verifies recovery
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULT_FILE="${RESULTS_DIR}/drill-postgres-failover-${TIMESTAMP}.txt"
API_URL="${API_URL:-http://localhost:3000}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-fte-postgres}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yaml}"

echo "============================================"
echo "  Chaos Drill: Postgres Failover"
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

mkdir -p "${RESULTS_DIR}"

DRILL_RESULT="PASS"
RECOVERY_TIME_MS=0
ISSUES=()

# Helper: check API health
check_api_health() {
    local http_code
    http_code=$(curl -sf -o /dev/null -w "%{http_code}" "${API_URL}/health" 2>/dev/null || echo "000")
    echo "$http_code"
}

# Helper: measure recovery time
measure_recovery() {
    local start_time end_time elapsed
    start_time=$(date +%s%N)
    local max_wait=60
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
    echo "Chaos Drill: Postgres Failover"
    echo "==============================="
    echo "Start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""

    # Step 1: Verify system is healthy before chaos
    echo "[Step 1] Verifying pre-chaos health..."
    PRE_HEALTH=$(check_api_health)
    if [ "$PRE_HEALTH" = "200" ]; then
        echo "  ✓ API is healthy (HTTP $PRE_HEALTH)"
    else
        echo "  ⚠ API is not healthy (HTTP $PRE_HEALTH) — proceeding with caution"
        DRILL_RESULT="WARN"
        ISSUES+=("API was not healthy before chaos drill (HTTP $PRE_HEALTH)")
    fi

    # Step 2: Stop Postgres container
    echo ""
    echo "[Step 2] Stopping Postgres container: ${CONTAINER_NAME}..."
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker stop "${CONTAINER_NAME}"
        echo "  ✓ Postgres container stopped"
    else
        # Try via docker-compose
        echo "  Container '${CONTAINER_NAME}' not found directly, trying docker-compose..."
        docker compose -f "${COMPOSE_FILE}" stop postgres 2>/dev/null || {
            echo "  ✗ Could not stop Postgres — drill cannot continue"
            DRILL_RESULT="SKIP"
            ISSUES+=("Could not stop Postgres container")
            echo ""
            echo "Result: SKIP"
            echo "Reason: Could not stop Postgres container"
            return 1
        }
        echo "  ✓ Postgres stopped via docker-compose"
    fi

    # Step 3: Wait a moment for connection failures to propagate
    echo ""
    echo "[Step 3] Waiting 3 seconds for failure propagation..."
    sleep 3

    # Step 4: Verify API returns appropriate errors
    echo ""
    echo "[Step 4] Verifying API returns appropriate errors..."
    FAIL_HTTP=$(check_api_health)
    echo "  Health check response: HTTP $FAIL_HTTP"

    if [ "$FAIL_HTTP" = "503" ] || [ "$FAIL_HTTP" = "000" ] || [ "$FAIL_HTTP" = "500" ]; then
        echo "  ✓ API returned appropriate error code ($FAIL_HTTP)"
    else
        echo "  ⚠ API returned unexpected code ($FAIL_HTTP) — may be caching"
        ISSUES+=("Expected 503/500/000 but got HTTP $FAIL_HTTP")
    fi

    # Step 5: Restart Postgres
    echo ""
    echo "[Step 5] Restarting Postgres..."
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker start "${CONTAINER_NAME}"
        echo "  ✓ Postgres container started"
    else
        docker compose -f "${COMPOSE_FILE}" start postgres 2>/dev/null || docker compose -f "${COMPOSE_FILE}" up -d postgres 2>/dev/null
        echo "  ✓ Postgres started via docker-compose"
    fi

    # Step 6: Wait for Postgres to become healthy
    echo ""
    echo "[Step 6] Waiting for Postgres healthcheck..."
    local pg_waited=0
    while [ $pg_waited -lt 30 ]; do
        if docker exec "${CONTAINER_NAME}" pg_isready -U postgres 2>/dev/null | grep -q "accepting connections"; then
            echo "  ✓ Postgres is accepting connections"
            break
        fi
        sleep 2
        pg_waited=$((pg_waited + 2))
    done

    # Step 7: Measure recovery time
    echo ""
    echo "[Step 7] Measuring API recovery time..."
    RECOVERY_TIME_MS=$(measure_recovery) || RECOVERY_TIME_MS=-1

    if [ "$RECOVERY_TIME_MS" -ge 0 ]; then
        echo "  ✓ API recovered in ${RECOVERY_TIME_MS}ms"
        if [ "$RECOVERY_TIME_MS" -gt 30000 ]; then
            DRILL_RESULT="WARN"
            ISSUES+=("Recovery time ${RECOVERY_TIME_MS}ms exceeds 30s threshold")
        fi
    else
        echo "  ✗ API did not recover within 60 seconds"
        DRILL_RESULT="FAIL"
        ISSUES+=("API failed to recover within 60 seconds")
    fi

    # Step 8: Verify full functionality
    echo ""
    echo "[Step 8] Verifying full functionality post-recovery..."
    POST_HEALTH=$(check_api_health)
    if [ "$POST_HEALTH" = "200" ]; then
        echo "  ✓ API is healthy (HTTP $POST_HEALTH)"
    else
        echo "  ✗ API is not healthy (HTTP $POST_HEALTH)"
        DRILL_RESULT="FAIL"
        ISSUES+=("API not healthy after recovery (HTTP $POST_HEALTH)")
    fi

    echo ""
    echo "============================================"
    echo "  Result: ${DRILL_RESULT}"
    echo "  Recovery Time: ${RECOVERY_TIME_MS}ms"
    echo "  Issues: ${#ISSUES[@]}"
    if [ ${#ISSUES[@]} -gt 0 ]; then
        for issue in "${ISSUES[@]}"; do
            echo "    - ${issue}"
        done
    fi
    echo "============================================"

} | tee "${RESULT_FILE}"

# Write structured result for master script
cat > "${RESULTS_DIR}/drill-postgres-failover-result.json" <<EOF
{
  "drill": "postgres-failover",
  "result": "${DRILL_RESULT}",
  "recoveryTimeMs": ${RECOVERY_TIME_MS},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "issues": [$(printf '"%s",' "${ISSUES[@]}" 2>/dev/null | sed 's/,$//')]
}
EOF

echo ""
echo "Results saved to: ${RESULT_FILE}"
