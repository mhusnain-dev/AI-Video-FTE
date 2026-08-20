# Backend Completion Specification

## Goal
Complete all missing backend routes, fix path mounting issues, and resolve known gaps so the frontend is 100% connected to working backend endpoints.

## Scope
- Missing route: `/api/users/:userId/preferences` (GET, PUT, DELETE)
- Missing route: `/api/projects/:projectId/settings` (GET, PATCH) with DB persistence
- Path fix: `/api/stories/:id/approve-merge` (currently only at `/stories/:id/approve-merge`)
- Path fix: `/api/router/models/eligibility` (currently only at `/router/models/eligibility`)
- Known gap: LLM API key placeholder blocks story creation
- Known gap: ArcFace model file missing blocks real Face-Lock
- Known gap: Project settings in auxiliary.ts are hardcoded stubs

---

## Functional Requirements

### FR-001: User Preferences API
**When**: Frontend calls `GET /api/users/:userId/preferences`
**Then**: Return stored preferences from `user_preferences` table
**Constraints**: Requires auth middleware, user can only access own preferences
**Trace**: Frontend `apiClient.getUserPreferences` in `client.ts:396`

**When**: Frontend calls `PUT /api/users/:userId/preferences` with `{ preferences: {...} }`
**Then**: Upsert preferences JSON in `user_preferences` table, merge with existing
**Constraints**: Requires auth middleware, validate JSON structure
**Trace**: Frontend `apiClient.updateUserPreferences` in `client.ts:401`

**When**: Frontend calls `DELETE /api/users/:userId/preferences`
**Then**: Delete user's preferences row, return success
**Constraints**: Requires auth middleware
**Trace**: Frontend `apiClient.resetUserPreferences` in `client.ts:407`

### FR-002: Project Settings API (DB Persistence)
**When**: Frontend calls `GET /api/projects/:projectId/settings`
**Then**: Return settings from `project_settings` table (create if not exists with defaults)
**Constraints**: Requires auth middleware
**Trace**: Frontend `apiClient.getProjectSettings` in `client.ts:248`

**When**: Frontend calls `PATCH /api/projects/:projectId/settings` with `{ settings: {...} }`
**Then**: Upsert settings JSON in `project_settings` table, merge with existing
**Constraints**: Requires auth middleware
**Trace**: Frontend `apiClient.updateProjectSettings` in `client.ts:253`

### FR-003: Fix approveMerge Path Mount
**When**: Frontend calls `POST /api/stories/:storyId/approve-merge`
**Then**: Route to `ingestionRoutes` handler (same as `/stories/:id/approve-merge`)
**Constraints**: Must work at both `/stories/:id/approve-merge` AND `/api/stories/:id/approve-merge`
**Trace**: Frontend `apiClient.approveMerge` in `client.ts:169` calls `/api/stories/${storyId}/approve-merge`

### FR-004: Fix Model Eligibility Path Mount
**When**: Frontend calls `GET /api/router/models/eligibility?shot=<shotId>`
**Then**: Route to `routerRoutes` handler (same as `/router/models/eligibility`)
**Constraints**: Must work at both `/router/models/eligibility` AND `/api/router/models/eligibility`
**Trace**: Frontend `apiClient.getModelEligibility` in `client.ts:115` calls `/api/router/models/eligibility`

### FR-005: LLM API Key Configuration
**When**: Story creation triggers prompt compilation
**Then**: Use real LLM API key from `secrets/llm_api_key.txt` (not placeholder)
**Constraints**: Key must be valid for configured provider (OpenAI/Anthropic/Google)
**Trace**: `src/generation/promptCompiler.ts` uses `config.llm.apiKey`

### FR-006: ArcFace Model File
**When**: Face-Lock verification runs
**Then**: Load `models/arcfaceresnet100-11-int8.onnx` for real embeddings
**Constraints**: File must exist, ONNX Runtime Web must load it
**Trace**: `src/verification/faceLockVerification.ts` imports ONNX model

---

## Edge Cases

### EC-001: Preferences Access Control
- User A cannot read/write User B's preferences
- Admin can access any user's preferences (for debugging)

### EC-002: Project Settings Defaults
- If no row exists, return sensible defaults (matching frontend `Settings.tsx` defaults)
- Merge patch with existing (deep merge for nested objects)

### EC-003: Path Mount Conflicts
- Ensure `/api/stories` routes don't shadow `/stories` routes
- Order of middleware mounting matters

---

## Acceptance Criteria

### AC-001: User Preferences CRUD
- [ ] `GET /api/users/:userId/preferences` returns 200 with preferences JSON
- [ ] `PUT /api/users/:userId/preferences` persists and returns updated preferences
- [ ] `DELETE /api/users/:userId/preferences` removes row, returns 200
- [ ] Unauthenticated request returns 401
- [ ] User accessing another user's preferences returns 403

### AC-002: Project Settings CRUD
- [ ] `GET /api/projects/:projectId/settings` returns 200 with settings (creates defaults if missing)
- [ ] `PATCH /api/projects/:projectId/settings` persists and returns updated settings
- [ ] Unauthenticated request returns 401

### AC-003: approveMerge Path Fix
- [ ] `POST /api/stories/:storyId/approve-merge` returns 200 (same as `/stories/:id/approve-merge`)
- [ ] Both paths work identically

### AC-004: Model Eligibility Path Fix
- [ ] `GET /api/router/models/eligibility?shot=<id>` returns 200 (same as `/router/models/eligibility`)
- [ ] Both paths work identically

### AC-005: LLM Key Works
- [ ] Story creation completes without "LLM API key not configured" error
- [ ] Prompt compilation returns real compiled prompt

### AC-006: ArcFace Loads
- [ ] Face-Lock verification uses real embeddings (not mock random vectors)
- [ ] Similarity scores are deterministic for same input images

---

## Out of Scope
- Implementing actual LLM provider integration (assumes key works with existing code)
- Training/downloading ArcFace model (assumes file provided)
- Admin UI for project settings (frontend already exists)
- Database migrations for new tables (assume `user_preferences`, `project_settings` exist)

---

## Clarification Questions

### Q1: Preferences Table Schema
**Question**: Does `user_preferences` table exist with columns `(user_id UUID PRIMARY KEY, preferences JSONB, updated_at TIMESTAMP)`?

**Context**: FR-001 requires this table. If not, migration needed.

**Options**:
1. Table exists — proceed
2. Table missing — need migration (I'll write it)
3. Use existing `user_settings` table with different key — but frontend expects separate endpoint

**Recommendation**: Check migrations. If missing, add migration.

---

### Q2: Project Settings Table Schema
**Question**: Does `project_settings` table exist with columns `(project_id VARCHAR PRIMARY KEY, settings JSONB, updated_at TIMESTAMP)`?

**Context**: FR-002 requires this. Frontend uses string projectId (not UUID).

**Options**:
1. Table exists — proceed
2. Table missing — need migration
3. Reuse `user_settings` with projectId prefix — not clean

**Recommendation**: Check migrations. If missing, add migration.

---

### Q3: LLM Provider & Key Format
**Question**: Which LLM provider and key format does `promptCompiler.ts` expect?

**Context**: `secrets/llm_api_key.txt` currently has placeholder. Need real key.

**Options**:
1. OpenAI (`sk-...`)
2. Anthropic (`sk-ant-...`)
3. Google AI (`...`)
4. Custom/local

**Recommendation**: Check `src/generation/promptCompiler.ts` imports and `config.ts` for provider config.

---

### Q4: ArcFace Model Source
**Question**: Where to obtain `models/arcfaceresnet100-11-int8.onnx`?

**Context**: File missing, Face-Lock falls back to mock.

**Options**:
1. Download from official ArcFace repo (InsightFace)
2. Use provided model from Panaversity assets
3. Convert from PyTorch `.pth` to ONNX

**Recommendation**: Official InsightFace model zoo has `arcfaceresnet100-11-int8.onnx` — download and place in `models/`.

---

### Q5: Path Mount Strategy
**Question**: Should `/api/stories` routes be mounted before or after `/stories` routes in `server.ts`?

**Context**: Current order mounts `/stories` then `/api/stories` (both use `ingestionRoutes`). Frontend calls `/api/stories/.../approve-merge` but handler only registered at `/stories/.../approve-merge`.

**Options**:
1. Add explicit `/api/stories/:id/approve-merge` route in `auxiliary.ts` or `ingestion/routes.ts`
2. Mount `/api/stories` first so it catches the request
3. Duplicate route registration in both routers

**Recommendation**: Option 1 — add route in `ingestion/routes.ts` with both path prefixes, or add to `auxiliary.ts` which is mounted at `/api`.

---

### Q6: Auth Middleware for New Routes
**Question**: Should new routes (`/api/users/:id/preferences`, `/api/projects/:id/settings`) use existing `authMiddleware` (requires JWT) or also support query param `userId` like `settingsRoutes.ts` does?

**Context**: `settingsRoutes.ts:25` accepts `req.user?.id || req.query.userId`. Frontend sends `userId` in body for some calls.

**Options**:
1. Require JWT only (strict) — frontend must send token
2. Support both JWT and `userId` query/body (current pattern)
3. Use `authMiddleware` but allow `userId` override for admin

**Recommendation**: Option 2 — match existing `settingsRoutes.ts` pattern for consistency.

---

### Q7: Preferences Data Structure
**Question**: What JSON structure should `user_preferences.preferences` store?

**Context**: `preferenceService.ts` extracts: `preferredModel`, `preferredQuality`, `costBudgetUsd`, `faceLockThreshold`, `learnedFromFeedback`, `lastExtractedAt`. Frontend `Preferences.tsx` may expect different fields.

**Options**:
1. Use `preferenceService.ts` output structure
2. Match frontend `Preferences.tsx` form fields
3. Merge both

**Recommendation**: Check `frontend/src/pages/Preferences.tsx` for expected fields, align with `preferenceService.ts`.

---

### Q8: Project Settings Defaults
**Question**: What are the default values for `project_settings` when row doesn't exist?

**Context**: Frontend `Settings.tsx` (Video tab) uses: `defaultResolution: '1080p'`, `defaultAspectRatio: '16:9'`. Security tab shows Vault info (read-only).

**Options**:
1. Hardcode in route handler (like `auxiliary.ts` does now)
2. Store in config file
3. Use DB migration to insert defaults

**Recommendation**: Option 1 — return defaults in GET handler if row missing, same as `auxiliary.ts` currently does but with DB persistence on PATCH.

---

## Next Steps
1. Answer clarification questions above
2. I'll create missing route files
3. Fix path mounts in `server.ts` and route files
4. Add migrations if tables missing
5. Update `secrets/llm_api_key.txt` and download ArcFace model (you provide)
6. Verify all ACs pass