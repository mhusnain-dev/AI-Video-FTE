# Runbook: Sacred Guard Block

**Alert**: `SacredGuardBlock`
**Severity**: Critical
**Prometheus Rule**: `increase(ai_video_sacred_guard_block_total[5m]) > 0`

---

## Description

Sacred Guard blocked a shot at one of its five enforcement points. This is a **non-negotiable business invariant** — the FTE must prevent any depiction that represents or implies the identity of protected sacred personalities.

Enforcement points:
1. Story creation (initial narrative scan)
2. Character upload (face detection + registry check)
3. Pre-moderation (prompt text scan)
4. Pre-dispatch (final gate before model call)
5. Post-generation (visual audit of generated frames)

## Impact

- **Immediate**: One or more shots are blocked and the story is paused in `paused_sacred_guard` state
- **User-facing**: The user sees a Sacred Guard block notification and must choose disposition
- **Compliance**: Mandatory — cannot be bypassed without dual-authorization appeal

## Diagnosis

1. **Check which enforcement point triggered**:
   ```bash
   curl -s http://localhost:3000/health | jq '.checks.admission'
   ```

2. **Query the admission audit log**:
   ```sql
   SELECT * FROM admission_audit
   WHERE gate = 'sacred_guard'
   ORDER BY timestamp DESC LIMIT 20;
   ```

3. **Check match type**: `exact`, `transliterated`, `fuzzy`, or `visual_semantic`

4. **Identify the blocked entity**: Look at `matched_reference` in the audit entry

5. **Check if this is a repeat block** (same model_id + user_id):
   ```sql
   SELECT COUNT(*) FROM admission_audit
   WHERE gate = 'sacred_guard' AND model_id = '<model_id>' AND user_id = '<user_id>'
   AND timestamp > NOW() - INTERVAL '1 hour';
   ```

## Remediation

### If legitimate block (correctly identified sacred personality):
1. The block is working as designed — no action required
2. Inform the user their content was blocked per policy
3. Guide them to revise the narrative or character references
4. If they appeal, follow the dual-authorization process (CL-009)

### If false positive:
1. Verify the matched reference against the denylist
2. If the denylist entry needs adjustment, use the dual-authorization API:
   ```bash
   curl -X DELETE http://localhost:3000/admission/denylist/<id> \
     -H "Content-Type: application/json" \
     -d '{"approver1": "<uuid1>", "approver2": "<uuid2>"}'
   ```
3. Document the false positive in the audit log
4. Review similarity thresholds per model (CL-001)

### Appeal process (CL-009):
```bash
curl -X POST http://localhost:3000/admission/denylist/<id>/appeal \
  -H "Content-Type: application/json" \
  -d '{"appellantId": "<uuid>", "reason": "Legitimate use case..."}'
```

## Escalation Path

1. **On-call engineer**: Verify the block is from Sacred Guard (not a bug)
2. **Security team**: If false positive rate exceeds 5% of total shots
3. **Principal**: For policy interpretation or threshold changes
4. **Legal/Compliance**: If regulatory implications arise

## Alertmanager Routing

- Routes to: `#fte-security` (Slack) + PagerDuty (security key)
- Group wait: 0s (immediate)
- Repeat interval: 30m
- Inhibition: SacredGuardBlock repeats for same model_id + user_id are suppressed

---

*Runbook for AI Video Production Specialist Digital FTE — Sacred Guard enforcement*
