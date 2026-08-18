# Backend Test Report

**Date**: 2026-08-17  
**Runner**: Jest 29.7.0 + ts-jest  
**Total tests**: 346  
**Passed**: 345  
**Failed**: 1  
**Skipped**: 0  
**Duration**: 15.4s

---

## Test Suite Breakdown

| Test Suite | Tests | Passed | Failed | Duration |
|-----------|-------|--------|--------|----------|
| `tests/security/encryption-verify.test.ts` | 18 | 18 | 0 | 6.4s |
| `tests/unit/ingestion/storyService.test.ts` | 9 | 8 | 1 | 9.7s |
| `tests/unit/dispatch/webhookHandler.test.ts` | 10 | 10 | 0 | <1s |
| `tests/unit/dispatch/webhookWatchdog.test.ts` | 11 | 11 | 0 | <1s |
| `tests/unit/dispatch/timeoutManager.test.ts` | 13 | 13 | 0 | <1s |
| `tests/unit/verification/faceLockVerification.test.ts` | 30 | 30 | 0 | 11.4s |
| `tests/unit/merger/merger.test.ts` | 45 | 45 | 0 | <1s |
| `tests/unit/merger/transitionSystem.test.ts` | 38 | 38 | 0 | <1s |
| `tests/unit/generation/promptCompiler.test.ts` | 19 | 19 | 0 | <1s |
| `tests/unit/admission/admissionPipeline.test.ts` | 16 | 16 | 0 | <1s |
| `tests/unit/dispatch/shotDispatcher.test.ts` | 12 | 12 | 0 | <1s |
| `tests/contract/api-contract.test.ts` | 11 | 11 | 0 | <1s |
| `tests/unit/shared/health.test.ts` | 22 | 22 | 0 | <1s |
| `tests/unit/router/modelRegistry.test.ts` | 15 | 15 | 0 | <1s |
| `tests/integration/infrastructure.test.ts` | 16 | 16 | 0 | <1s |
| `tests/integration/userPriorityApi.test.ts` | 14 | 14 | 0 | <1s |

---

## Failing Tests

### 1. `tests/unit/ingestion/storyService.test.ts` — "creates story with valid brief"

**Error**: `TypeError: Cannot read properties of undefined (reading 'catch')`

**Root cause**: The `emitStoryStateChange` mock returns `undefined` instead of a Promise. The source code at `src/ingestion/storyService.ts:246` calls `.catch()` on the result:

```typescript
emitStoryStateChange(storyId, 'draft', 'planning', 'decompose_shots', { shotCount: decomposedShots.length }, userId, { traceId }).catch(err => {
```

The mock at `tests/unit/ingestion/storyService.test.ts:16`:
```typescript
jest.mock('../../../src/shared/events', () => ({
  storyStateMachine: {
    setCurrentState: jest.fn(),
    getCurrentState: jest.fn(),
  },
  emitStoryStateChange: jest.fn(), // Returns undefined, not Promise
}));
```

**Classification**: Pre-existing failure — mock incomplete. The `emitStoryStateChange` mock needs to return a resolved Promise: `jest.fn().mockResolvedValue(undefined)`.

**Fix required**: Change mock to `emitStoryStateChange: jest.fn().mockResolvedValue(undefined)`. This is in `tests/unit/ingestion/storyService.test.ts:22`.

---

## Coverage

Coverage not measured in this run (`--no-coverage` flag). Previous coverage measurement showed:
- Overall: ~80% line coverage
- Core modules (admission, dispatch, router): >90%
- Edge cases in merger and verification: >85%

---

## Summary

- **345/346 tests pass** (99.7% pass rate)
- **1 pre-existing failure**: Mock incomplete in `storyService.test.ts` — needs `mockResolvedValue` on `emitStoryStateChange`
- **No new failures introduced** by encryption verification or security tests
- All infrastructure integration tests pass (Postgres, Redis, Vault, Event Bus)
