# Runbook: High Redis Latency

**Alert**: `HighRedisLatency`
**Severity**: Warning
**Prometheus Rule**: `histogram_quantile(0.99, sum(rate(ai_video_redis_command_duration_seconds_bucket[5m])) by (le, command)) > 1`

---

## Description

Redis command P99 latency has exceeded 1 second. Redis is used for Streams (story_commands, story_events, webhook_ingress, job_status) and caching. High latency affects all event-driven operations.

## Impact

- **Immediate**: Slow event publishing and consumption
- **Background workers**: Stream consumers may lag behind
- **Cascading**: May cause shot state machine transitions to lag

## Diagnosis

1. **Check Redis latency**:
   ```bash
   docker exec redis redis-cli --latency-history -i 5
   ```

2. **Check Redis memory**:
   ```bash
   docker exec redis redis-cli info memory | grep used_memory_human
   ```

3. **Check stream lengths**:
   ```bash
   docker exec redis redis-cli XLEN story_commands
   docker exec redis redis-cli XLEN story_events
   docker exec redis redis-cli XLEN webhook_ingress
   docker exec redis redis-cli XLEN job_status
   ```

4. **Check connected clients**:
   ```bash
   docker exec redis redis-cli info clients
   ```

5. **Check for slow commands**:
   ```bash
   docker exec redis redis-cli slowlog get 10
   ```

## Remediation

### If memory pressure:
```bash
# Check memory usage
docker exec redis redis-cli info memory
# If near maxmemory, consider:
# 1. Increase maxmemory
# 2. Evict old stream entries
# 3. Scale Redis
```

### If slow commands (KEYS, SORT, etc.):
1. Check application code for expensive Redis commands
2. Replace with scan-based alternatives
3. Add command timeout

### If network latency:
1. Check network between API and Redis containers
2. Check Docker network configuration
3. Consider using Unix socket for local Redis

### If too many clients:
1. Check connection pool settings in ioredis
2. Reduce connection pool size
3. Check for connection leaks

## Escalation Path

1. **On-call engineer**: Check Redis metrics and slowlog
2. **Platform team**: If infrastructure scaling needed
3. **DBA**: If Redis configuration tuning needed

---

*Runbook for AI Video Production Specialist Digital FTE — Redis performance*
