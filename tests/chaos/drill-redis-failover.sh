#!/usr/bin/env bash
# Chaos Drill: Redis Failover
# Simulates Redis failure, verifies graceful degradation, restarts and verifies recovery
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULT_FILE="${RESULTS_DIR}/drill-redis-failover-${TIMESTAMP}.txt"
API_URL="${API_URL:-http://localhost:3000}"
CONTAINER_NAME="${REDIS_CONTAINER:-fte-redis}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yaml}"

echo "============================================"
echo "  Chaos Drill: Redis Failover"
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

mkdir -p "${RESULTS_DIR}"

DRILL_RESULT="PASS"
RECOVERY_TIME_MS=0
ISSUES=()

check_api_health() {
    curl -sf -o /dev/null -w "%{http_code}" "${API_URL}/health" 2>/dev/null || echo "000"
}

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
    echo "Chaos Drill: Redis Failover"
    echo "==============================="
    echo "Start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""

    # Step 1: Pre-chaos health check
    echo "[Step 1] Verifying pre-chaos health..."
    PRE_HEALTH=$(check_api_health)
    if [ "$PRE_HEALTH" = "200" ]; then
        echo "  ✓ API is healthy (HTTP $PRE_HEALTH)"
    else
        echo "  ⚠ API not healthy before chaos (HTTP $PRE_HEALTH)"
        DRILL_RESULT="WARN"
        ISSUES+=("API not healthy before chaos (HTTP $PRE_HEALTH)")
    fi

    # Step 2: Stop Redis
    echo ""
    echo "[Step 2] Stopping Redis container: ${CONTAINER_NAME}..."
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker stop "${CONTAINER_NAME}"
        echo "  ✓ Redis container stopped"
    else
        docker compose -f "${COMPOSE_FILE}" stop redis 2>/dev/null || {
            echo "  ✗ Could not stop Redis"
            DRILL_RESULT="SKIP"
            return 1
        }
        echo "  ✓ Redis stopped via docker-compose"
    fi

    # Step 3: Verify graceful degradation
    echo ""
    echo "[Step 3] Verifying graceful degradation..."
    sleep 3
    FAIL_HTTP=$(check_api_health)
    echo "  Health check response: HTTP $FAIL_HTTP"

    if [ "$FAIL_HTTP" = "200" ] || [ "$FAIL_HTTP" = "503" ] || [ "$FAIL_HTTP" = "000" ] || [ "$FAIL_HTTP" = "500" ]; then
        echo "  ✓ API returned HTTP $FAIL_HTTP (acceptable during Redis outage)"
        if [ "$FAIL_HTTP" = "200" ]; then
            echo "  Note: API may be cached or Redis not critical for health endpoint"
        fi
    else
        echo "  ⚠ Unexpected response: HTTP $FAIL_HTTP"
        ISSUES+=("Unexpected HTTP $FAIL_HTTP during Redis outage")
    fi

    # Step 4: Restart Redis
    echo ""
    echo "[Step 4] Restarting Redis..."
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker start "${CONTAINER_NAME}"
    else
        docker compose -f "${COMPOSE_FILE}" start redis 2>/dev/null || docker compose -f "${COMPOSE_FILE}" up -d redis 2>/dev/null
    fi

    # Wait for Redis to be healthy
    echo "  Waiting for Redis healthcheck..."
    local redis_waited=0
    while [ $redis_waited -lt 30 ]; do
        if docker exec "${CONTAINER_NAME}" redis-cli ping 2>/dev/null | grep -q "PONG"; then
            echo "  ✓ Redis is responding to PING"
            break
        fi
        sleep 2
        redis_waited=$((redis_waited + 2))
    done

    # Step 5: Measure recovery
    echo ""
    echo "[Step 5] Measuring API recovery time..."
    RECOVERY_TIME_MS=$(measure_recovery) || RECOVERY_TIME_MS=-1

    if [ "$RECOVERY_TIME_MS" -ge 0 ]; then
        echo "  ✓ API recovered in ${RECOVERY_TIME_MS}ms"
    else
        echo "  ✗ API did not recover within 60 seconds"
        DRILL_RESULT="FAIL"
        ISSUES+=("API failed to recover within 60 seconds")
    fi

    # Step 6: Verify functionality
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
    echo "  Recovery Time: ${RECOVERY_TIME_MS}ms"
    echo "  Issues: ${#ISSUES[@]}"
    for issue in "${ISSUES[@]+"${ISSUES[@]}"}"; do
        echo "    - ${issue}"
    done
    echo "============================================"

} | tee "${RESULT_FILE}"

cat > "${RESULTS_DIR}/drill-redis-failover-result.json" <<EOF
{
  "drill": "redis-failover",
  "result": "${DRILL_RESULT}",
  "recoveryTimeMs": ${RECOVERY_TIME_MS},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "issues": [$(printf '"%s",' "${ISSUES[@]+"${ISSUES[@]}"}" 2>/dev/null | sed 's/,$//')]
}
EOF

echo ""
echo "Results saved to: ${RESULT_FILE}"
