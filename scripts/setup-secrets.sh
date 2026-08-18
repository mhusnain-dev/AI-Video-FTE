#!/bin/bash
# Secrets Setup Script for AI Video FTE Production Deployment
# Run this script to generate all required secret files for docker-compose.prod.yaml
# IMPORTANT: Store these securely! Use a secrets manager in production (Vault, AWS Secrets Manager, etc.)

set -euo pipefail

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
    FORCE=true
fi

SECRETS_DIR="./secrets"
mkdir -p "$SECRETS_DIR"

echo "Generating secrets for AI Video FTE production deployment..."
echo "   Output directory: $SECRETS_DIR"
echo ""

# Function to generate random alphanumeric string
gen_secret() {
    local length=${1:-32}
    openssl rand -base64 "$length" | tr -d "=+/" | cut -c1-"$length"
}

# Function to generate random hex string
gen_hex() {
    local length=${1:-32}
    openssl rand -hex "$length" | cut -c1-"$length"
}

# Function to generate password
gen_password() {
    local length=${1:-24}
    openssl rand -base64 "$length" | tr -d "=+/" | cut -c1-"$length"
}

# Function to enforce secure permissions on secret files
secure_secret() {
    local file="$1"
    chmod 600 "$file"
}

# Function to mask a secret value (show first 4 chars)
mask_secret() {
    local file="$1"
    if [[ -f "$file" ]]; then
        local val
        val=$(cat "$file")
        local len=${#val}
        if [[ $len -le 4 ]]; then
            echo "****"
        else
            echo "${val:0:4}$(printf '%*s' $((len-4)) '' | tr ' ' '*')"
        fi
    else
        echo "(not found)"
    fi
}

# PostgreSQL password
if [[ ! -f "$SECRETS_DIR/postgres_password.txt" ]] || [[ "$FORCE" == "true" ]]; then
    gen_password 32 > "$SECRETS_DIR/postgres_password.txt"
    secure_secret "$SECRETS_DIR/postgres_password.txt"
    echo "Generated postgres_password.txt: $(mask_secret "$SECRETS_DIR/postgres_password.txt")"
else
    secure_secret "$SECRETS_DIR/postgres_password.txt"
    echo "postgres_password.txt already exists: $(mask_secret "$SECRETS_DIR/postgres_password.txt")"
fi

# Redis password
if [[ ! -f "$SECRETS_DIR/redis_password.txt" ]] || [[ "$FORCE" == "true" ]]; then
    gen_password 32 > "$SECRETS_DIR/redis_password.txt"
    secure_secret "$SECRETS_DIR/redis_password.txt"
    echo "Generated redis_password.txt: $(mask_secret "$SECRETS_DIR/redis_password.txt")"
else
    secure_secret "$SECRETS_DIR/redis_password.txt"
    echo "redis_password.txt already exists: $(mask_secret "$SECRETS_DIR/redis_password.txt")"
fi

# Vault root token (for production, use proper Vault init/unseal)
if [[ ! -f "$SECRETS_DIR/vault_token.txt" ]] || [[ "$FORCE" == "true" ]]; then
    gen_hex 32 > "$SECRETS_DIR/vault_token.txt"
    secure_secret "$SECRETS_DIR/vault_token.txt"
    echo "Generated vault_token.txt: $(mask_secret "$SECRETS_DIR/vault_token.txt")"
else
    secure_secret "$SECRETS_DIR/vault_token.txt"
    echo "vault_token.txt already exists: $(mask_secret "$SECRETS_DIR/vault_token.txt")"
fi

# ElevenLabs API key (user must provide)
if [[ ! -f "$SECRETS_DIR/elevenlabs_key.txt" ]] || [[ "$FORCE" == "true" ]]; then
    echo "YOUR_ELEVENLABS_API_KEY_HERE" > "$SECRETS_DIR/elevenlabs_key.txt"
    secure_secret "$SECRETS_DIR/elevenlabs_key.txt"
    echo "Created elevenlabs_key.txt - REPLACE with actual API key!"
else
    secure_secret "$SECRETS_DIR/elevenlabs_key.txt"
    echo "elevenlabs_key.txt already exists"
fi

# Veo (Google) API key (user must provide)
if [[ ! -f "$SECRETS_DIR/veo_key.txt" ]] || [[ "$FORCE" == "true" ]]; then
    echo "YOUR_VEO_API_KEY_HERE" > "$SECRETS_DIR/veo_key.txt"
    secure_secret "$SECRETS_DIR/veo_key.txt"
    echo "Created veo_key.txt - REPLACE with actual API key!"
else
    secure_secret "$SECRETS_DIR/veo_key.txt"
    echo "veo_key.txt already exists"
fi

# Runway API key (user must provide)
if [[ ! -f "$SECRETS_DIR/runway_key.txt" ]] || [[ "$FORCE" == "true" ]]; then
    echo "YOUR_RUNWAY_API_KEY_HERE" > "$SECRETS_DIR/runway_key.txt"
    secure_secret "$SECRETS_DIR/runway_key.txt"
    echo "Created runway_key.txt - REPLACE with actual API key!"
else
    secure_secret "$SECRETS_DIR/runway_key.txt"
    echo "runway_key.txt already exists"
fi

# KIE API key (user must provide)
if [[ ! -f "$SECRETS_DIR/kie_key.txt" ]] || [[ "$FORCE" == "true" ]]; then
    echo "YOUR_KIE_API_KEY_HERE" > "$SECRETS_DIR/kie_key.txt"
    secure_secret "$SECRETS_DIR/kie_key.txt"
    echo "Created kie_key.txt - REPLACE with actual API key!"
else
    secure_secret "$SECRETS_DIR/kie_key.txt"
    echo "kie_key.txt already exists"
fi

# LLM API key for prompt generation (user must provide - OpenAI, Gemini, etc.)
if [[ ! -f "$SECRETS_DIR/llm_api_key.txt" ]] || [[ "$FORCE" == "true" ]]; then
    echo "PASTE_YOUR_LLM_API_KEY_HERE" > "$SECRETS_DIR/llm_api_key.txt"
    secure_secret "$SECRETS_DIR/llm_api_key.txt"
    echo "Created llm_api_key.txt - REPLACE with actual LLM API key!"
else
    secure_secret "$SECRETS_DIR/llm_api_key.txt"
    echo "llm_api_key.txt already exists"
fi

# Grafana admin password
if [[ ! -f "$SECRETS_DIR/grafana_password.txt" ]] || [[ "$FORCE" == "true" ]]; then
    gen_password 24 > "$SECRETS_DIR/grafana_password.txt"
    secure_secret "$SECRETS_DIR/grafana_password.txt"
    echo "Generated grafana_password.txt: $(mask_secret "$SECRETS_DIR/grafana_password.txt")"
else
    secure_secret "$SECRETS_DIR/grafana_password.txt"
    echo "grafana_password.txt already exists: $(mask_secret "$SECRETS_DIR/grafana_password.txt")"
fi

# Vault TLS certificates (self-signed for local verification)
VAULT_TLS_DIR="./config/vault-tls"
mkdir -p "$VAULT_TLS_DIR"

if [[ ! -f "$VAULT_TLS_DIR/ca.crt" ]] || [[ ! -f "$VAULT_TLS_DIR/vault.crt" ]] || [[ ! -f "$VAULT_TLS_DIR/vault.key" ]]; then
    echo "Generating Vault TLS certificates..."

    # Generate CA
    openssl genrsa -out "$VAULT_TLS_DIR/ca.key" 2048
    openssl req -new -x509 -key "$VAULT_TLS_DIR/ca.key" -out "$VAULT_TLS_DIR/ca.crt" -days 365 -subj "/CN=AI Video FTE Vault CA"

    # Generate Vault server cert
    openssl genrsa -out "$VAULT_TLS_DIR/vault.key" 2048
    openssl req -new -key "$VAULT_TLS_DIR/vault.key" -out "$VAULT_TLS_DIR/vault.csr" -subj "/CN=vault" -config <(cat <<'EOF'
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no
[req_distinguished_name]
CN = vault
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = vault
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF
)
    openssl x509 -req -in "$VAULT_TLS_DIR/vault.csr" -CA "$VAULT_TLS_DIR/ca.crt" -CAkey "$VAULT_TLS_DIR/ca.key" -CAcreateserial -out "$VAULT_TLS_DIR/vault.crt" -days 365 -extensions v3_req -extfile <(cat <<'EOF'
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = vault
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF
)
    openssl pkcs8 -topk8 -inform PEM -outform PEM -in "$VAULT_TLS_DIR/vault.key" -out "$VAULT_TLS_DIR/vault.key.pkcs8" -nocrypt
    mv "$VAULT_TLS_DIR/vault.key.pkcs8" "$VAULT_TLS_DIR/vault.key"
    chmod 600 "$VAULT_TLS_DIR/vault.key"
    secure_secret "$VAULT_TLS_DIR/ca.crt"
    secure_secret "$VAULT_TLS_DIR/vault.crt"
    secure_secret "$VAULT_TLS_DIR/vault.key"
    # Remove CA private key after cert generation (not needed at runtime)
    rm -f "$VAULT_TLS_DIR/ca.key"
    # Clean up CSR and serial file
    rm -f "$VAULT_TLS_DIR/vault.csr" "$VAULT_TLS_DIR/ca.srl"
    echo "Generated Vault TLS certificates in $VAULT_TLS_DIR/"
else
    echo "Vault TLS certificates already exist in $VAULT_TLS_DIR/"
fi

# Nginx TLS certificates (self-signed for local verification)
NGINX_TLS_DIR="./config/nginx-tls"
mkdir -p "$NGINX_TLS_DIR"

if [[ ! -f "$NGINX_TLS_DIR/fullchain.pem" ]] || [[ ! -f "$NGINX_TLS_DIR/privkey.pem" ]]; then
    echo "Generating Nginx TLS certificates..."

    # Generate self-signed certificate for nginx
    openssl req -x509 -nodes -newkey rsa:2048 -keyout "$NGINX_TLS_DIR/privkey.pem" \
        -out "$NGINX_TLS_DIR/fullchain.pem" \
        -days 365 \
        -subj "/CN=ai-video-fte.local" \
        -addext "subjectAltName=DNS:ai-video-fte.local,DNS:localhost,IP:127.0.0.1"

    chmod 600 "$NGINX_TLS_DIR/privkey.pem"
    chmod 644 "$NGINX_TLS_DIR/fullchain.pem"
    echo "Generated Nginx TLS certificates in $NGINX_TLS_DIR/"
else
    echo "Nginx TLS certificates already exist in $NGINX_TLS_DIR/"
fi

echo ""
echo "Summary:"
echo "   All secret files created in $SECRETS_DIR/"
echo "   Vault TLS certificates in $VAULT_TLS_DIR/"
echo "   Nginx TLS certificates in $NGINX_TLS_DIR/"
echo ""
echo "IMPORTANT NEXT STEPS:"
echo "   1. Replace placeholder API keys with actual values:"
echo "      - $SECRETS_DIR/elevenlabs_key.txt"
echo "      - $SECRETS_DIR/veo_key.txt"
echo "      - $SECRETS_DIR/runway_key.txt"
echo "      - $SECRETS_DIR/kie_key.txt"
echo "      - $SECRETS_DIR/llm_api_key.txt (for prompt generation)"
echo ""
echo "   2. For production, use a proper secrets manager:"
echo "      - HashiCorp Vault (already in stack)"
echo "      - AWS Secrets Manager"
echo "      - Google Secret Manager"
echo "      - Azure Key Vault"
echo ""
echo "   3. Set file permissions (run as root in container):"
echo "      chmod 600 $SECRETS_DIR/*.txt"
echo "      chown root:root $SECRETS_DIR/*.txt"
echo ""
echo "   4. Add to .gitignore (already done):"
echo "      secrets/"
echo ""
echo "   5. Use --force to regenerate all secrets (overwrites existing):"
echo "      ./scripts/setup-secrets.sh --force"
echo ""

# Create .env.example for reference
cat > .env.example << 'EOF'
# AI Video FTE Production Environment Variables
# Copy to .env.production and fill in values

# Database
POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password

# Redis
REDIS_PASSWORD_FILE=/run/secrets/redis_password

# Vault
VAULT_TOKEN_FILE=/run/secrets/vault_token
VAULT_TRANSIT_KEY=biometric-encryption

# Model API Keys
ELEVENLABS_API_KEY_FILE=/run/secrets/elevenlabs_key
VEO_API_KEY_FILE=/run/secrets/veo_key
RUNWAY_API_KEY_FILE=/run/secrets/runway_key
KIE_API_KEY_FILE=/run/secrets/kie_key
LLM_API_KEY_FILE=/run/secrets/llm_api_key

# Monitoring
ALERTMANAGER_WEBHOOK_URL=https://alertmanager.example.com
ARCHIVE_BACKEND=s3
ARCHIVE_BUCKET=ai-video-fte-archives
ARCHIVE_LOCAL_PATH=/data/archive

# Grafana
GF_SECURITY_ADMIN_PASSWORD_FILE=/run/secrets/grafana_password
EOF

echo "Created .env.example"
echo ""
echo "Ready for deployment! Run:"
echo "   docker-compose -f docker-compose.prod.yaml up -d"
