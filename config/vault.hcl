# Vault Production Configuration
# HashiCorp Vault server configuration for AI Video FTE

# Storage backend (using integrated storage - raft)
storage "raft" {
  path    = "/vault/data"
  node_id = "fte-vault-1"
}

# Listener configuration
listener "tcp" {
  address            = "0.0.0.0:8200"
  cluster_address    = "0.0.0.0:8201"
  tls_disable        = false
  tls_cert_file      = "/vault/tls/vault.crt"
  tls_key_file       = "/vault/tls/vault.key"
  tls_client_ca_file = "/vault/tls/ca.crt"
}

# Telemetry
telemetry {
  prometheus_retention_time = "30s"
  disable_hostname = true
  filter_default = false
}

# Audit device for security logging
audit "file" {
  path = "/vault/logs/audit.log"
  mode = "0644"
  log_raw = false
  hmac_accessor = true
}

# Disable mlock if running in containers without IPC_LOCK
disable_mlock = false

# Default lease TTLs
default_lease_ttl = "768h"
max_lease_ttl     = "8760h"

# Cluster name for monitoring
cluster_name = "ai-video-fte"

# API address for UI
api_addr = "https://vault:8200"
cluster_addr = "https://vault:8201"

# UI configuration
ui = false

# Plugin directory
plugin_directory = "/vault/plugins"

# License (if enterprise)
# license_path = "/vault/license.hcl"