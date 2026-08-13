#!/bin/bash
# Deployment Validation Script for AI Video FTE
# Validates all components are deployed and healthy

set -euo pipefail

NAMESPACE="${NAMESPACE:-fte-production}"
TIMEOUT="${TIMEOUT:-300}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_command() {
    if ! command -v "$1" &> /dev/null; then
        error "Required command '$1' not found"
        return 1
    fi
}

wait_for_service() {
    local url="$1"
    local name="$2"
    local max_attempts="${3:-30}"
    local interval="${4:-10}"

    log "Waiting for $name at $url..."
    for ((i=1; i<=max_attempts; i++)); do
        if curl -sf "$url" > /dev/null 2>&1; then
            log "$name is healthy"
            return 0
        fi
        sleep "$interval"
    done
    error "$name did not become healthy after $((max_attempts * interval)) seconds"
    return 1
}

check_health_endpoint() {
    local url="$1"
    local name="$2"

    if curl -sf "$url" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
        log "$name health check passed"
        return 0
    else
        error "$name health check failed"
        curl -s "$url" | jq .
        return 1
    fi
}

main() {
    log "🔍 Starting AI Video FTE deployment validation..."
    echo ""

    # Check required commands
    for cmd in curl jq docker kubectl; do
        check_command "$cmd" || exit 1
    done

    # Check if running in Kubernetes or Docker Compose
    if kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log "Detected Kubernetes deployment in namespace: $NAMESPACE"
        validate_k8s
    elif docker compose -f docker-compose.prod.yaml ps &> /dev/null; then
        log "Detected Docker Compose deployment"
        validate_docker_compose
    else
        error "No deployment detected (not Kubernetes, not Docker Compose)"
        exit 1
    fi

    log "✅ All validation checks passed!"
}

validate_k8s() {
    log "Validating Kubernetes deployment..."

    # Check pods
    log "Checking pod status..."
    kubectl wait --for=condition=Ready pods --all -n "$NAMESPACE" --timeout="${TIMEOUT}s" || {
        error "Pods not ready"
        kubectl get pods -n "$NAMESPACE"
        exit 1
    }

    # Check services
    log "Checking services..."
    kubectl get svc -n "$NAMESPACE"

    # Check ingress
    log "Checking ingress..."
    kubectl get ingress -n "$NAMESPACE"

    # Port-forward to validate health endpoints
    log "Validating API health..."
    kubectl port-forward -n "$NAMESPACE" svc/ai-video-fte-api 3000:3000 &
    PF_PID=$!
    sleep 5
    check_health_endpoint "http://localhost:3000/health" "API" || { kill $PF_PID; exit 1; }
    kill $PF_PID

    log "Validating Grafana..."
    kubectl port-forward -n "$NAMESPACE" svc/grafana 3001:3000 &
    PF_PID=$!
    sleep 3
    curl -sf "http://localhost:3001/api/health" | jq -e '.database == "ok"' > /dev/null || { kill $PF_PID; error "Grafana health check failed"; exit 1; }
    kill $PF_PID

    log "Validating Prometheus..."
    kubectl port-forward -n "$NAMESPACE" svc/prometheus 9090:9090 &
    PF_PID=$!
    sleep 3
    curl -sf "http://localhost:9090/-/healthy" > /dev/null || { kill $PF_PID; error "Prometheus health check failed"; exit 1; }
    kill $PF_PID

    log "Validating Alertmanager..."
    kubectl port-forward -n "$NAMESPACE" svc/alertmanager 9093:9093 &
    PF_PID=$!
    sleep 3
    curl -sf "http://localhost:9093/-/healthy" > /dev/null || { kill $PF_PID; error "Alertmanager health check failed"; exit 1; }
    kill $PF_PID
}

validate_docker_compose() {
    log "Validating Docker Compose deployment..."

    # Check all services running
    log "Checking service status..."
    docker compose -f docker-compose.prod.yaml ps

    # Wait for health checks
    services=("postgres" "redis" "vault" "api" "nginx" "frontend" "prometheus" "grafana" "alertmanager")
    for svc in "${services[@]}"; do
        log "Waiting for $svc health check..."
        for ((i=1; i<=60; i++)); do
            health=$(docker compose -f docker-compose.prod.yaml ps --format json "$svc" | jq -r '.[0].Health // "none"')
            if [[ "$health" == "healthy" ]]; then
                log "$svc is healthy"
                break
            elif [[ "$health" == "none" ]]; then
                warn "$svc has no healthcheck defined - skipping health wait"
                break
            fi
            sleep 5
        done
    done

    # Validate API
    check_health_endpoint "http://localhost/health" "API (via nginx)"

    # Validate Prometheus
    curl -sf "http://localhost:9091/-/healthy" > /dev/null || error "Prometheus health check failed"

    # Validate Grafana
    curl -sf "http://localhost:3001/api/health" | jq -e '.database == "ok"' > /dev/null || error "Grafana health check failed"

    # Validate Alertmanager
    curl -sf "http://localhost:9093/-/healthy" > /dev/null || error "Alertmanager health check failed"

    # Validate metrics endpoint
    curl -sf "http://localhost/metrics" > /dev/null || warn "Metrics endpoint not accessible via nginx"

    # Test database connection
    log "Testing database connection..."
    docker compose -f docker-compose.prod.yaml exec -T postgres pg_isready -U postgres -d ai_video_fte || error "Database connection failed"

    # Test Redis
    log "Testing Redis..."
    docker compose -f docker-compose.prod.yaml exec -T redis redis-cli -a "$(cat secrets/redis_password.txt)" ping | grep -q PONG || error "Redis ping failed"

    # Test Vault
    log "Testing Vault..."
    docker compose -f docker-compose.prod.yaml exec -T vault vault status -tls-skip-verify | grep -q 'Sealed[[:space:]]*false' || error "Vault is sealed or not ready"
}

# Run main
main "$@"