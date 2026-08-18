# Runbook: Database Pool Exhausted

**Alert**: `DatabasePoolExhausted`
**Severity**: Warning
**Prometheus Rule**: `ai_video_db_pool_usage_gauge > 0.9`

---

## Description

Database connection pool is more than 90% utilized. All new requests will be queued waiting for an available connection, causing latency spikes and potential timeouts.

## Impact

- **Immediate**: All API requests experience connection wait time
- **Background workers**: May fail to acquire connections
- **Risk**: If pool hits 100%, requests will fail with connection errors

## Diagnosis

1. **Check current pool usage**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_db_pool
   ```

2. **Check active connections by state**:
   ```sql
   SELECT state, count(*)
   FROM pg_stat_activity
   WHERE datname = 'ai_video_fte_dev'
   GROUP BY state;
   ```

3. **Check connections by application**:
   ```sql
   SELECT application_name, state, count(*)
   FROM pg_stat_activity
   WHERE datname = 'ai_video_fte_dev'
   GROUP BY application_name, state;
   ```

4. **Check for idle-in-transaction**:
   ```sql
   SELECT pid, now() - xact_start AS xact_duration, query
   FROM pg_stat_activity
   WHERE state = 'idle in transaction'
   ORDER BY xact_start;
   ```

## Remediation

### If idle-in-transaction connections:
```sql
-- Kill connections idle for more than 5 minutes
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
AND xact_start < NOW() - INTERVAL '5 minutes';
```

### If too many idle connections:
1. Reduce `idleInTransactionSessionTimeout`:
   ```sql
   ALTER SYSTEM SET idle_in_transaction_session_timeout = '30000'; -- 30s
   SELECT pg_reload_conf();
   ```

### If pool too small for workload:
1. Increase `poolSize` in config:
   ```yaml
   postgres:
     poolSize: 30  # Increased from 20
   ```
2. Restart the API service

### If connection leak:
1. Check application code for unclosed query clients
2. Ensure `pool.release()` is called after every checkout
3. Review `src/shared/db.ts` for leak patterns

## Escalation Path

1. **On-call engineer**: Kill idle connections and check for leaks
2. **DBA**: If PostgreSQL configuration tuning needed
3. **Platform team**: If infrastructure scaling required

---

*Runbook for AI Video Production Specialist Digital FTE — Connection pool*
