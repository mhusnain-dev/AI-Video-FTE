# Runbook: High Database Latency

**Alert**: `HighDatabaseLatency`
**Severity**: Warning
**Prometheus Rule**: `histogram_quantile(0.99, sum(rate(ai_video_db_query_duration_seconds_bucket[5m])) by (le, operation)) > 5`

---

## Description

Database query P99 latency has exceeded 5 seconds for one or more operations. This affects all API responses and background workers.

## Impact

- **Immediate**: Slow API responses, potential request timeouts
- **Background workers**: Metrics aggregation, audit archival, dashboard updates may lag
- **Cascading**: May trigger shot timeouts if admission pipeline is slow

## Diagnosis

1. **Check query latency by operation**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_db_query_duration
   ```

2. **Check slow queries**:
   ```sql
   SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
   FROM pg_stat_activity
   WHERE state != 'idle'
   ORDER BY duration DESC LIMIT 10;
   ```

3. **Check connection pool**:
   ```bash
   curl -s http://localhost:9090/metrics | grep ai_video_db_pool
   ```

4. **Check table bloat**:
   ```sql
   SELECT schemaname, relname, n_dead_tup, n_live_tup,
          round(n_dead_tup::numeric / NULLIF(n_live_tup, 0) * 100, 1) AS dead_ratio
   FROM pg_stat_user_tables
   WHERE n_dead_tup > 10000
   ORDER BY n_dead_tup DESC;
   ```

## Remediation

### If missing index:
1. Check `EXPLAIN ANALYZE` on slow queries
2. Add appropriate indexes
3. Common: shots.story_id, cost_records.story_id

### If table bloat:
```sql
VACUUM ANALYZE <table_name>;
-- For severe bloat:
VACUUM FULL <table_name>;
```

### If connection pool saturated:
1. Increase pool size in config
2. Kill idle connections
3. Check for connection leaks in application code

### If CPU bound:
1. Check PostgreSQL CPU usage
2. Consider read replicas for heavy queries
3. Optimize query patterns

## Escalation Path

1. **On-call engineer**: Check slow queries and pool metrics
2. **DBA**: If complex performance tuning needed
3. **Platform team**: If infrastructure scaling required

---

*Runbook for AI Video Production Specialist Digital FTE — Database performance*
