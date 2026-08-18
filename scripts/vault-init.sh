#!/bin/sh
# Vault initialization script - sets up transit engine and encryption key
# Runs after Vault starts in dev mode

sleep 5  # Wait for Vault to be ready

export VAULT_ADDR=http://localhost:8201
export VAULT_TOKEN=root

# Enable transit secrets engine (ignore error if already enabled)
vault secrets enable transit 2>/dev/null || true

# Create the biometric encryption key (ignore error if already exists)
vault write -f transit/keys/biometric-encryption-dev 2>/dev/null || true

echo "Vault initialization complete"
