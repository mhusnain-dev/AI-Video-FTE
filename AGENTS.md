# AGENTS.md — Shared Agent Guidance

> **Authority**: Subordinate to `CLAUDE.md` (Constitution). All agents in this repository read this file on session start.

---

## 1. Session Start Protocol

Every agent session **must** begin with:

1. **Read `INTENT.md`** — Understand the project methodology and immutable rules
2. **Read `progress.md`** — Verify current phase, status, and next recommended action
3. **Read `CLAUDE.md`** — Internalize the Constitution
4. **Read this `AGENTS.md`** — Load shared guidance
5. **Check for `/compact` summary** — If exists, compare against `progress.md`; report discrepancies and stop if they differ
6. **Read artifact(s)** referenced by `progress.md`'s "Next Recommended Action"
7. **Verify project state** — Confirm understanding before proceeding

**Never rely solely on conversation history. Never rely solely on a `/compact` summary.**

---

## 2. Agent Archetypes & When to Use

| Archetype | Tool | Use For |
|-----------|------|---------|
| **Planner** | `Agent` (subagent_type: "Plan") | Designing implementation plans, architectural trade-offs, identifying critical files |
| **Researcher** | `Agent` (subagent_type: "general-purpose") | Broad searches, prior art, constraint investigation, failure mode analysis |
| **Explorer** | `Agent` (subagent_type: "Explore") | Read-only sweeping of many files/directories; locating code, not reviewing it |
| **Coder** | Main loop (this agent) | Writing/editing files, running tests, implementing approved plans |
| **Reviewer** | `Agent` (subagent_type: "general-purpose" with review prompt) or via Workflow | Security review, correctness audit, adversarial verification |
| **Guide** | `Agent` (subagent_type: "claude-code-guide") | Questions about Claude Code, SDK, API, Slack integration |

> **Note**: "code-reviewer" is not a built-in subagent type (available: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup). Use `general-purpose` with a review-specialized prompt, or orchestrate via Workflow when multi-agent review is needed. Custom agent definitions not yet created.

**Rule**: Delegate broad search/reading to subagents. Keep main loop for decisions, writing, and coordination.

---

## 3. Research Patterns

### 3.1 Parallel Research (Fan-Out)
```javascript
// In Workflow or via multiple Agent calls
const topics = ["prior-art", "constraints", "failure-modes", "trade-offs"];
await parallel(topics.map(t => () => agent(`Research ${t} for AI Video FTE`, {phase: "Research"})));
```

### 3.2 Source-Grounded Findings
Every fact in `research/findings-*.md` must have a source citation:
- **URL**: `"https://example.com/doc#section"` (with access date)
- **File**: `"specs.md:145-152"` (line range)
- **Code**: `"src/video/merger.ts:42"` (symbol + context)
- **Doc**: `"Panaversity Thesis §2.3"`

### 3.3 Labeling Discipline
```
## Facts
- [Source] Verifiable claim...

## Assumptions
- [Label] Something we believe but haven't verified...

## Open Questions
- [Label] Question blocking a decision...

## Recommendations
- [Label] Suggested direction with rationale...
```

---

## 4. Specification Patterns

### 4.1 Behavioural-Only Writing
| ❌ Implementation Language | ✅ Behavioural Language |
|---------------------------|------------------------|
| "Store in PostgreSQL `users` table" | "Persist user identity durably" |
| "Call OpenAI API with `gpt-4o`" | "Generate text using a frontier LLM" |
| "Use Redis token bucket" | "Enforce per-model rate limits" |
| "React component with `useState`" | "Interactive controls for X" |

### 4.2 Implementation Independence Test

Apply the constitutional Implementation Independence Test (CLAUDE.md §8) to every requirement while writing specifications:

* **Apply the test**: For each statement, ask — "If every implementation changed tomorrow, would this statement still be true?"
* **Rewrite on failure**: Convert implementation-specific statements into behavioural language using the Behavioural-Only Writing table above as a guide.
* **Research recommendations are advisory**: Treat research outputs (Model Adapter SDK, Realism Cache Service, Denylist Cache Invalidation, Observability-first logging, etc.) as advisory inputs, **not** mandatory requirements.
* **Defer implementation choices**: If a behaviour cannot be expressed without selecting a technology or architecture, stop and record the ambiguity for the Clarification phase instead of deciding during specification writing.

This test complements the Behavioural-Only Writing guidance and must be satisfied for every Functional Requirement, Edge Case, Rule, and Acceptance Criterion.

### 4.3 Requirement Format
```markdown
### FR-<NNN>: <Short Title>
**When**: <trigger condition>
**Then**: <observable outcome>
**Constraints**: <limits, thresholds, ordering>
**Trace**: <research finding / intent invariant>
```

### 4.3 Acceptance Criteria Format
```markdown
### AC-<NNN>: <Scenario>
- [ ] Given <precondition>
- [ ] When <action>
- [ ] Then <verifiable outcome>
- [ ] And <side effect / non-functional>
```

---

## 5. Clarification Patterns

### 5.1 Question Template
```markdown
**Question**: <One specific question ending with ?>

**Context**: <Why this matters — trace to spec section>

**Options** (if applicable):
1. <Option A> — <implication>
2. <Option B> — <implication>

**Recommendation**: <My suggestion with rationale>
```

### 5.2 Update Protocol
After every human answer:
1. **Update `spec.md` (mandatory)** — modify the relevant specification section(s) with the clarified behaviour.
2. **Maintain Clarification Log (optional)** — append Q&A pair as supplementary history in `spec.md` if desired; never duplicates or supersedes the specification.
3. Update `progress.md` — record decision in "Approved Decisions" or "Working Decisions".
4. Ask next highest-value question.

### 5.3 Specification Stability Rule (Operational Reference)

**Once the Principal approves the behavioural specification (end of Phase 3), it becomes the immutable baseline for implementation.**

| Change Type | Path Required |
|-------------|---------------|
| **Behavioural change** (adds, removes, or modifies observable behaviour) | Must return to **Clarification (Phase 4)** for explicit Principal approval |
| **Wording/ambiguity fix** (no observable behaviour change) | Apply directly; note in `progress.md` |

**Enforcement during Build**: If an agent detects a behavioural delta between implementation and approved spec, **halt and escalate to Principal via Clarification** — do not silently accommodate.

*Authoritative definition: CLAUDE.md §8 "Specification Stability Rule"*

---

## 6. Build Patterns (Future — Post Authorization)

### 6.1 Plan Structure (`plans/<feature>/plan.md`)
```markdown
# Plan: <Feature Name>

## Scope
- Spec sections: <FR-XXX, FR-YYY>
- Out of scope: <explicit exclusions>

## Approach
- <High-level strategy>
- <Key technical decisions already made in Clarification>

## Steps
| Step | Description | Owner | Verification | Depends On |
|------|-------------|-------|--------------|------------|
| 1 | ... | ... | ... | — |
| 2 | ... | ... | ... | 1 |

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ... | ... | ... | ... |
```

### 6.2 Task List (`plans/<feature>/tasks.md`)
Managed via `TaskCreate`/`TaskUpdate` — one task per step.

### 6.3 Verification Checklist (per step)
- [ ] Unit tests pass (≥80% coverage for new code)
- [ ] Contract tests pass (OpenAPI)
- [ ] Integration test passes (if applicable)
- [ ] Lint clean
- [ ] Type-check clean
- [ ] Spec traceability: commit message references FR-XXX
- [ ] `progress.md` updated

---

## 7. Panaversity Methodology Quick Reference

### Seven Principles (Mode 1 — Problem Solving)
1. **Bash is the Key** — Agent acts, produces artifacts
2. **Code as Universal Interface** — Structured output (schemas, tables, templates)
3. **Verification as Core Step** — Independent verification always
4. **Small Reversible Decomposition** — Atomic, <2-min rollback
5. **Persisting State in Files** — Filesystem > conversation
6. **Constraints and Safety** — Explicit permissions, earned autonomy
7. **Observability** — Know what the agent actually did

### Seven Invariants (Mode 2 — Manufacturing Digital FTEs)
1. **Human is Principal** — Intent, budget, authority, ownership
2. **Every Human Needs a Delegate** — Personal agent (OpenClaw)
3. **Workforce Needs Management Layer** — Hiring, governance, lifecycle (Paperclip)
4. **Each Worker Picks Its Engine** — Runtime matched to job
5. **Every Worker Runs Against System of Record** — Postgres default center
6. **Workforce Expandable Under Policy** — Hiring as callable capability
7. **Nervous System** — Events, durability, flow control (Inngest + Routines)

### 10-80-10 Rhythm
| Phase | Human % | Agent % | Activity |
|-------|---------|---------|----------|
| **First 10%** | 100% | 0% | Define spec: goals, constraints, budget, permissions |
| **Middle 80%** | 10% | 90% | Workers execute: compose tools, spawn sub-agents, deliver |
| **Final 10%** | 100% | 0% | Review, refine, approve verified outcome |

### Spec-Driven Development Phases
| Phase | Artifact | Gate |
|-------|----------|------|
| 0. Constitution | `CLAUDE.md`, `AGENTS.md` | Human approval |
| 1. Research | `research/findings-*.md` | Human approval |
| 2. Specify | `specs/<fte>/spec.md` | Human approval |
| 3. Clarify | Interview → updated `spec.md` | Human confirms "nothing left to misread" |
| 4. Build | `plans/`, code, tests | **Explicit authorization required** |

---

## 8. Domain-Specific Guidance: AI Video Production FTE

### 8.1 Mandatory Invariants (from INTENT.md)
| Invariant | Behaviour | Implementation Freedom |
|-----------|-----------|------------------------|
| **Sacred Guard** | Moderation → Sacred → Cost → Rate Limit ordering | Technical mechanism open |
| **Face-Lock** | Uploaded face persists identically across all shots | Model-specific conditioning approach open |

### 8.2 System of Record — Project-Specific Schema (AI Video FTE)
*These details supplement the generic Constitution §16 for this specific Digital FTE.*
| Capability | AI Video FTE Implementation |
|------------|----------------------------|
| **Vector Search** | `pgvector` for face embeddings (ArcFace, 512-dim), voice embeddings (ECAPA-TDNN, 256-dim), semantic search |
| **Full-Text Search** | `tsvector`/`tsquery` for prompt templates, scripts, compiled prompts |
| **Durable Work Queues** | Redis Streams (`story_commands`, `story_events`, `webhook_ingress`, `job_status`) with consumer groups |
| **Auditability** | Immutable `story_events` (status changes, flags, cost updates), `sacred_entity_audit` (denylist changes) |
| **Encryption** | Vault Transit KEK (90-day rotation) → per-user DEK (AES-256-GCM) for biometric embeddings; `pgcrypto` for additional fields |

### 8.3 Key Terminology (from specs.md domain knowledge)
| Term | Meaning |
|------|---------|
| **Shot** | Single generated video segment from one prompt |
| **Story** | Complete video project (multiple shots) |
| **Character Registry** | Encrypted face/voice embeddings + metadata |
| **Face-Lock** | Verification + conditioning for identity persistence |
| **Sacred Entity Guard** | Multi-stage denylist (exact + fuzzy + semantic) |
| **AUTO Router** | Model selection by realism/cost/latency score |
| **Admission Controller** | Gatekeeper: Moderation → Sacred → Cost → Rate Limit |
| **Cost Drift** | Actual vs. estimated cost divergence triggering pause |
| **Webhook Watchdog** | Fallback polling for stale async jobs |

### 8.4 Critical Flows to Preserve
1. **Shot Pipeline**: Ingest → Plan → Compile → Sanitize → Moderate → Sacred → Cost → Rate Limit → Router → Adapter → Webhook → Verify → Audit → Merge
2. **Admission Order**: **Fixed** — Moderation → Sacred → Cost → Rate Limit (never reorder)
3. **Sacred Enforcement**: 5 points (creation, registry, moderation, pre-dispatch, post-gen visual audit)
4. **Face-Lock**: Per-adapter conditioning (reference-conditioned vs verify-only) + mandatory post-gen verification

---

## 9. Common Pitfalls to Avoid

| Pitfall | Prevention |
|---------|------------|
| Writing code in Research/Spec phases | Constitution forbids it — only Markdown artifacts |
| Skipping Clarification interview | One question at a time until "nothing left to misread" |
| Treating `specs.md` as the spec to build | It is **domain knowledge only** — new spec in `specs/ai-video-fte/spec.md` |
| Reordering Sacred Guard admission | Fixed order: Moderation → Sacred → Cost → Rate Limit |
| Assuming face-lock = prompt text only | It's conditioning + verification; adapter-dependent |
| Forgetting to update `progress.md` | Update at every checkpoint; it's the system of record |
| Pushing git without being asked | Constitution: "push only when asked" |
| Using Workflow tool without opt-in | Only with explicit "ultracode" or "use a workflow" |
| Allowing implementation details to leak into the behavioural specification | Apply the Implementation Independence Test. Rewrite as behaviour. If behaviour cannot be expressed without selecting a technology or architecture, defer the decision to Clarification. |

---

## 10. Reusable Prompt Snippets

### 10.1 Research Delegation
> "Research [topic] for the AI Video Production Specialist Digital FTE. Use `specs.md` as one source. Output to `research/findings-<topic>.md` with Facts/Assumptions/Open Questions/Recommendations clearly labeled. Cite every fact. No design decisions."

### 10.2 Specification Writing
> "Write a behavioural specification for [feature] in `specs/ai-video-fte/spec.md`. Include Goal, Scenarios, Functional Requirements, Edge Cases, Out of Scope, Acceptance Criteria. Preserve Sacred Guard ordering and Face-Lock persistence. No implementation details."

### 10.3 Clarification Interview
> "Interview me about the specification one question at a time. Wait for my answer. Update `spec.md` and `progress.md` after each answer. Continue until ambiguity is eliminated."

### 10.4 Adversarial Verification (for reviews)
> "Adversarially verify this finding: [claim]. Try to REFUTE it. Default to refuted=true if uncertain. Return structured verdict."

---

## 11. File Quick-Reference

| File | Purpose | When to Read |
|------|---------|--------------|
| `INTENT.md` | Project methodology, phase rules, invariants | Every session start |
| `progress.md` | Current state, next action, decisions | Every session start + every checkpoint |
| `CLAUDE.md` | Constitution (this repo's laws) | Every session start |
| `AGENTS.md` | This file — shared guidance | Every session start |
| `research/findings-*.md` | Research output | During Research phase + when spec needs domain facts |
| `specs/ai-video-fte/spec.md` | Behavioural specification | During Spec/Clarify/Build phases |
| `specs.md` | Domain knowledge (legacy) | Research phase only — never copy |
| `plans/` | Implementation plans | Build phase only (after authorization) |

---

*End of Shared Agent Guidance*