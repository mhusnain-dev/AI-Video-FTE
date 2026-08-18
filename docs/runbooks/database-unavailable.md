# Runbook: Database Unavailable

**Alert**: `DatabaseUnavailable`
**Severity**: Critical
**Prometheus Rule**: `ai_video_db_pool_usage_gauge == 0 or ai_video_vault_status_gauge == 0`

---

## Description

PostgreSQL database connection pool is exhausted or Vault is unavailable. The FTE cannot read/write any data, making the entire system non-functional.

## Impact

- **Immediate**: All API requests fail, all background workers stall
- **User-facing**: Complete service outage
- **Data risk**: No data loss (PostgreSQL is durable), but in-flight operations may need reprocessing

## Diagnosis

1. **Check database container status**:
   ```bash
   docker ps | grep postgres
   docker logs postgres --since 5m 2>&1 | tail -20
   ```

2. **Check connection pool metrics**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_db_pool
   ```

3. **Check active connections**:
   ```sql
   SELECT count(*), state FROM pg_stat_activity GROUP BY state;
   ```

4. **Check for lock contention**:
   ```sql
   SELECT * FROM pg_locks WHERE NOT granted;
   ```

5. **Check disk space**:
   ```bash
   docker exec postgres df -h /var/lib/postgresql/data
   ```

6. **Check Vault status** (also in alert):
   ```bash
   curl -s http://localhost:8200/v1/sys/health
   ```

## Remediation

### If PostgreSQL container is down:
```bash
docker start postgres
# Wait for readiness
docker exec postgres pg_isready -U postgres
```

### If connection pool exhausted:
1. Check for connection leaks:
   ```sql
   SELECT count(*), application_name, state
   FROM pg_stat_activity
   GROUP BY application_name, state;
   ```
2. Kill idle-in-transaction connections:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle in transaction'
   AND query_start < NOW() - INTERVAL '5 minutes';
   ```
3. Restart the API service to reset pool

### If Vault is down:
```bash
docker start vault
# Check seal status
curl -s http://localhost:8200/v1/sys/health | jq '.sealed'
# If sealed, unseal (dev mode)
curl -s http://localhost:8200/v1/sys/unseal -d '{"key":"dev-root-token"}'
```

### If disk full:
1. Clean old WAL segments: `docker exec postgres pg_archivecleanup`
2. Increase disk allocation
3. Check for table bloat: `VACUUM FULL` on large tables

## Escalation Path

1. **On-call engineer**: Restart the affected service
2. **Platform team**: If persistent (check infrastructure monitoring)
3. **DBA**: If database corruption or complex lock contention

---

*Runbook for AI Video Production Specialist Digital FTE — Database/Vault outage*
