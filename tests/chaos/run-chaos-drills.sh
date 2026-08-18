#!/usr/bin/env bash
# Master Chaos Drill Runner
# Runs all chaos drills in sequence, records results to tests/chaos/results/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SUMMARY_FILE="${RESULTS_DIR}/chaos-summary-${TIMESTAMP}.txt"

echo "============================================"
echo "  AI Video FTE — Chaos Drill Suite"
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

mkdir -p "${RESULTS_DIR}"

TOTAL_DRILLS=0
PASSED=0
FAILED=0
WARNED=0
SKIPPED=0
declare -A DRILL_RESULTS
declare -A DRILL_RECOVERY_TIMES
declare -a DRILL_ORDER=("postgres-failover" "redis-failover" "vault-seal" "api-restart")

run_drill() {
    local drill_name=$1
    local drill_script="${SCRIPT_DIR}/drill-${drill_name}.sh"

    echo ""
    echo ">>> Starting drill: ${drill_name}"
    echo ""

    if [ ! -f "$drill_script" ]; then
        echo "  ✗ Drill script not found: ${drill_script}"
        DRILL_RESULTS[$drill_name]="SKIP"
        SKIPPED=$((SKIPPED + 1))
        TOTAL_DRILLS=$((TOTAL_DRILLS + 1))
        return 1
    fi

    chmod +x "$drill_script"

    local drill_result
    if bash "$drill_script" 2>&1; then
        drill_result="PASS"
    else
        drill_result="FAIL"
    fi

    # Read the structured result if available
    local result_json="${RESULTS_DIR}/drill-${drill_name}-result.json"
    if [ -f "$result_json" ]; then
        local result_from_json
        result_from_json=$(grep -o '"result": "[^"]*"' "$result_json" | head -1 | cut -d'"' -f4)
        local recovery_ms
        recovery_ms=$(grep -o '"recoveryTimeMs": [0-9-]*' "$result_json" | head -1 | awk '{print $2}')

        DRILL_RESULTS[$drill_name]="${result_from_json:-$drill_result}"
        DRILL_RECOVERY_TIMES[$drill_name]="${recovery_ms:--1}"
    else
        DRILL_RESULTS[$drill_name]="$drill_result"
        DRILL_RECOVERY_TIMES[$drill_name]="-1"
    fi

    case "${DRILL_RESULTS[$drill_name]}" in
        PASS) PASSED=$((PASSED + 1)) ;;
        FAIL) FAILED=$((FAILED + 1)) ;;
        WARN) WARNED=$((WARNED + 1)) ;;
        SKIP) SKIPPED=$((SKIPPED + 1)) ;;
    esac

    TOTAL_DRILLS=$((TOTAL_DRILLS + 1))
}

{
    echo "Chaos Drill Suite — Master Summary"
    echo "===================================="
    echo "Start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""

    # Run each drill
    for drill in "${DRILL_ORDER[@]}"; do
        run_drill "$drill"
    done

    echo ""
    echo "============================================"
    echo "  CHAOS DRILL SUITE — FINAL SUMMARY"
    echo "============================================"
    echo "  Total Drills:  ${TOTAL_DRILLS}"
    echo "  Passed:        ${PASSED}"
    echo "  Failed:        ${FAILED}"
    echo "  Warnings:      ${WARNED}"
    echo "  Skipped:       ${SKIPPED}"
    echo ""
    echo "  Per-Drill Results:"
    for drill in "${DRILL_ORDER[@]}"; do
        local result="${DRILL_RESULTS[$drill]:-N/A}"
        local recovery="${DRILL_RECOVERY_TIMES[$drill]:-N/A}"
        echo "    ${drill}: ${result} (recovery: ${recovery}ms)"
    done
    echo ""

    if [ $FAILED -gt 0 ]; then
        echo "  STATUS: SOME DRILLS FAILED — REVIEW NEEDED"
    elif [ $WARNED -gt 0 ]; then
        echo "  STATUS: PASSED WITH WARNINGS"
    else
        echo "  STATUS: ALL DRILLS PASSED"
    fi
    echo "============================================"

} | tee "${SUMMARY_FILE}"

# Write structured summary
cat > "${RESULTS_DIR}/chaos-summary-${TIMESTAMP}.json" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "totalDrills": ${TOTAL_DRILLS},
  "passed": ${PASSED},
  "failed": ${FAILED},
  "warnings": ${WARNED},
  "skipped": ${SKIPPED},
  "drills": {
    "postgres-failover": { "result": "${DRILL_RESULTS[postgres-failover]:-N/A}", "recoveryTimeMs": ${DRILL_RECOVERY_TIMES[postgres-failover]:--1} },
    "redis-failover": { "result": "${DRILL_RESULTS[redis-failover]:-N/A}", "recoveryTimeMs": ${DRILL_RECOVERY_TIMES[redis-failover]:--1} },
    "vault-seal": { "result": "${DRILL_RESULTS[vault-seal]:-N/A}", "recoveryTimeMs": ${DRILL_RECOVERY_TIMES[vault-seal]:--1} },
    "api-restart": { "result": "${DRILL_RESULTS[api-restart]:-N/A}", "recoveryTimeMs": ${DRILL_RECOVERY_TIMES[api-restart]:--1} }
  }
}
EOF

echo ""
echo "Summary saved to: ${SUMMARY_FILE}"
echo "JSON saved to: ${RESULTS_DIR}/chaos-summary-${TIMESTAMP}.json"
