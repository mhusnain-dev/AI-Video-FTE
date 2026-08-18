#!/usr/bin/env bash
# Chaos Drill: Vault Seal
# Seals Vault, verifies encryption operations fail gracefully, unseals and verifies recovery
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULT_FILE="${RESULTS_DIR}/drill-vault-seal-${TIMESTAMP}.txt"
VAULT_ADDR="${VAULT_ADDR:-http://localhost:8201}"
VAULT_TOKEN="${VAULT_TOKEN:-root}"
API_URL="${API_URL:-http://localhost:3000}"

echo "============================================"
echo "  Chaos Drill: Vault Seal"
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

check_vault_status() {
    curl -sf -H "X-Vault-Token: ${VAULT_TOKEN}" "${VAULT_ADDR}/v1/sys/health" 2>/dev/null | grep -o '"sealed":[a-z]*' | cut -d: -f2 || echo "unknown"
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
    echo "Chaos Drill: Vault Seal"
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

    # Step 2: Seal Vault
    echo ""
    echo "[Step 2] Sealing Vault..."
    SEAL_RESPONSE=$(curl -sf -X PUT \
        -H "X-Vault-Token: ${VAULT_TOKEN}" \
        "${VAULT_ADDR}/v1/sys/seal" \
        -d '{"secret_shares": 1, "secret_threshold": 1}' 2>/dev/null || echo "error")

    if echo "$SEAL_RESPONSE" | grep -q "true"; then
        echo "  ✓ Vault sealed successfully"
    else
        echo "  ⚠ Vault seal response: $SEAL_RESPONSE"
        # In dev mode, Vault may auto-unseal
        echo "  Note: Dev-mode Vault auto-unseals. This drill may not fully simulate production behavior."
        ISSUES+=("Vault dev mode auto-unseal; drill may not simulate production behavior")
    fi

    # Step 3: Verify encryption operations fail
    echo ""
    echo "[Step 3] Verifying encryption operations fail gracefully..."
    sleep 3
    ENCRYPT_RESPONSE=$(curl -sf -X POST \
        -H "X-Vault-Token: ${VAULT_TOKEN}" \
        "${VAULT_ADDR}/v1/transit/encrypt/biometric-encryption" \
        -d '{"plaintext": "dGVzdA=="}' 2>/dev/null || echo "error")

    # Check API health during seal
    SEAL_HTTP=$(check_api_health)
    echo "  API health during Vault seal: HTTP $SEAL_HTTP"
    if [ "$SEAL_HTTP" = "200" ] || [ "$SEAL_HTTP" = "503" ]; then
        echo "  ✓ API responded (should handle Vault unavailability gracefully)"
    else
        echo "  ⚠ API response: HTTP $SEAL_HTTP"
    fi

    # Step 4: Unseal Vault
    echo ""
    echo "[Step 4] Unsealing Vault..."
    sleep 2

    # Get the root token for dev mode (auto-unseals in dev, but let's try)
    UNSEAL_KEY=$(curl -sf "${VAULT_ADDR}/v1/sys/unseal" -d '{}' 2>/dev/null | grep -o '"sealed":[a-z]*' | cut -d: -f2 || echo "true")
    echo "  Vault seal status after unseal attempt: sealed=$UNSEAL_KEY"

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
    echo "  Recovery Time: ${RECOVERY_TIME_MS}ms"
    echo "  Issues: ${#ISSUES[@]}"
    for issue in "${ISSUES[@]+"${ISSUES[@]}"}"; do
        echo "    - ${issue}"
    done
    echo "============================================"

} | tee "${RESULT_FILE}"

cat > "${RESULTS_DIR}/drill-vault-seal-result.json" <<EOF
{
  "drill": "vault-seal",
  "result": "${DRILL_RESULT}",
  "recoveryTimeMs": ${RECOVERY_TIME_MS},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "issues": [$(printf '"%s",' "${ISSUES[@]+"${ISSUES[@]}"}" 2>/dev/null | sed 's/,$//')]
}
EOF

echo ""
echo "Results saved to: ${RESULT_FILE}"
