# CLAUDE.md — Repository Constitution

> **Authority**: This file is the supreme engineering rulebook for this repository. It applies to all agents, all phases, all Digital FTE projects built here. It is immutable unless explicitly amended by the Principal.

---

## 1. Core Principles

| Principle | Description |
|-----------|-------------|
| **Human as Principal** | The human sets intent, budget, authority envelope, and owns every outcome. Agents are delegates — they execute, they do not decide. |
| **Verification Before Trust** | No output is accepted until independently verified. The producing agent is the worst verifier. Use tests, different models, or human review. |
| **Files Are Memory** | Conversation is volatile; files are durable. All decisions, conventions, plans, and state persist in the filesystem. |
| **Small Reversible Changes** | Every step must be atomic and undoable in < 2 minutes. If reversing takes longer, the step was too big. Commit/checkpoint after each. |
| **Context Engineering** | Keep the context stack lean: fixed layers (system, rules) + managed layers (conversation, files, skills, subagents). Rotate aggressively. |
| **Specification Is Source of Truth** | Code is a build output. The spec describes *behaviour only* — never implementation, never architecture. Agree on WHAT before generating HOW. |
| **Outcome-Based Economics** | Work is measured by verified delivered outcomes, not tokens spent or lines written. |

---

## 2. Human as Principal

- **Intent Setting**: The human writes or approves the Intent (`INTENT.md`), Constitution (`CLAUDE.md`), Research findings, Specification (`spec.md`), and every Clarification answer.
- **Approval Gates**: No phase begins without explicit human approval of the prior phase's artifacts.
- **Authority Envelope**: Every agent operates within a bounded scope (folders, services, approvals). Autonomy is earned per task, not granted globally.
- **Budget Control**: The human declares budgets (tokens, dollars, time) upfront. Agents track and report; they never exceed.
- **Final Disposition**: On flagged cases (Sacred Guard, Face-Lock, Cost Overrun), the human always makes the final call. Agents surface context; they do not decide.

---

## 3. Verification Before Trust

| Layer | Method |
|-------|--------|
| **Code** | Unit tests (≥80% coverage), contract tests (OpenAPI), integration tests, mutation testing where feasible |
| **Spec Compliance** | Acceptance criteria executed as automated checks; human sign-off on Clarification completion |
| **Research** | Facts grounded in sources (URLs, docs, code). Assumptions labeled. Open questions tracked. |
| **Agent Output** | Subagents return structured data (schemas), not prose. Independent verifier agents for critical findings. |
| **Infrastructure** | Health checks, synthetic probes, chaos drills. RTO/RPO validated before production. |

**Golden Rule**: "Looks right" is the failure mode. Verify or reject.

---

## 4. Files Are Memory

- **Canonical Artifacts** (hierarchy from INTENT.md):
  1. `INTENT.md` — Project methodology (immutable)
  2. `CLAUDE.md` — This constitution
  3. `progress.md` — Current state dashboard
  4. `research/` — Findings documents
  5. `specs/` — Behavioural specifications
  6. `plans/` — Implementation plans (only after Build authorized)
  7. `AGENTS.md` — Shared agent guidance
- **Naming**: Kebab-case for directories and files. Descriptive, not abbreviated.
- **Updates**: Every meaningful work completion updates `progress.md`. Research/specs/plans update their respective files.
- **No Silent Overwrites**: If a file exists, Read before Write. Conflicts are reported, not resolved silently.

---

## 5. Small Reversible Changes

- **Atomic Steps**: One logical change per commit/task. No "refactor + feature" in one step.
- **Checkpoints**: After each step, run verification (tests, lint, type-check). Save state to files.
- **Rollback Ready**: Every change must be reversible by `git revert` or file restore in < 2 minutes.
- **Task List**: Use `TaskCreate`/`TaskUpdate` for multi-step work. Mark `in_progress` before starting, `completed` only after full verification.

---

## 6. Context Engineering Rules

| Layer | Content | Management |
|-------|---------|------------|
| **System** | This Constitution, `AGENTS.md`, `INTENT.md` | Fixed — loaded every session |
| **Rules** | Project-specific conventions from `CLAUDE.md`/`AGENTS.md` | Fixed — loaded every session |
| **Conversation** | Current task dialogue | Rotate via `/compact` (keep focus) or `/clear` (new task) |
| **Files** | `progress.md`, research, specs, plans | Read on demand; search before full read |
| **Skills** | Invoked via `/skill` or `Skill` tool | Lazy-loaded; only when task matches |
| **Subagents** | Isolated context for research/search | Spawn via `Agent` tool; receive summary only |

**Discipline**:
- Before opening any file in `research/` or `specs/`, check `progress.md`'s "Next Recommended Action."
- Prefer `grep`/`Search` within a file over reading it fully.
- At phase boundaries, remind the human to run `/compact` with a focus hint.
- If switching to genuinely unrelated work, use `/clear` not `/compact`.

---

## 7. Research Rules

- **Output**: `research/findings-<topic>.md` — Markdown only.
- **Content**: Facts, Assumptions, Open Questions, Recommendations — clearly labeled.
- **Sources**: Cite every fact (URL, file:line, doc section). No uncited claims.
- **No Design**: Research never proposes architecture, implementation, or code structure.
- **No Decisions**: Research informs; it does not decide. Decisions happen in Clarification.
- **Parallelism**: Use subagents for independent research tracks (prior art, constraints, failure modes, etc.).
- **Scope**: Investigate — Prior Art, Existing Solutions, Domain Knowledge, User Workflows, Constraints, Risks, Failure Modes, Alternative Approaches, Trade-offs, Unknowns, Assumptions.

---

## 8. Specification Rules

- **Location**: `specs/<fte-name>/spec.md`
- **Content**: Behaviour only. Six required sections:
  1. **Goal** — Why this exists (2–3 sentences)
  2. **User Scenarios** — "When user does X, they get Y"
  3. **Functional Requirements** — Testable musts
  4. **Edge Cases & Rules** — Empty, huge, duplicate, unauthorized, etc.
  5. **Out of Scope** — Critical for preventing scope creep
  6. **Acceptance Criteria** — Done checklist, executable where possible
- **Forbidden**: No databases, frameworks, file layouts, APIs, algorithms, or tech choices unless necessary to explain behaviour.
- **Audience**: Understandable by someone who has never seen the implementation.
- **Invariants**: Sacred Guard ordering and Face-Lock persistence must survive verbatim from Intent.
- **Traceability**: Every requirement maps to an acceptance criterion.

### Implementation Independence Test

Every Functional Requirement, Edge Case, Rule, and Acceptance Criterion must pass the following test before being included in `spec.md`:

> **"If every implementation changed tomorrow, would this statement still be true?"**

**Interpretation:**

* **YES** → the statement describes observable behaviour and belongs in the specification.
* **NO** → the statement describes implementation and belongs in architecture, ADRs, planning, or the Build phase.

**Rewrite Procedure (if a statement fails the test):**

1. Remove implementation-specific wording.
2. Rewrite it in terms of observable behaviour.
3. If rewriting requires choosing an implementation, stop and defer that choice to the Clarification phase instead of embedding it in the specification.

This test reinforces the existing rule: *Behaviour only. No databases, frameworks, APIs, algorithms, or technology choices.*

### Specification Stability Rule

**Once the Principal approves the behavioural specification (end of Phase 3), it becomes the immutable baseline for implementation.**

| Change Type | Path Required |
|-------------|---------------|
| **Behavioural change** (adds, removes, or modifies observable behaviour) | Must return to **Clarification (Phase 4)** for explicit Principal approval |
| **Wording/ambiguity fix** (no observable behaviour change) | May be applied directly with note in `progress.md` |

**Rationale**: This prevents scope creep during Build, ensures traceability from approved spec to implementation, and enforces the existing phase-gate discipline (CLAUDE.md §9, §10). The Clarification phase is the *only* gate for behavioural changes after specification approval.

**Enforcement**: Any agent detecting a behavioural delta between implementation and approved spec during Build must halt and escalate to the Principal via Clarification.

---

---

## 9. Clarification Rules

- **Process**: Interview the human **one question at a time**. Wait for answer. Update the relevant section of `spec.md` immediately. Update `progress.md`. Repeat.
- **Question Quality**: Highest-value unanswered question first. Never multiple questions in one response.
- **Termination**: Continue until ambiguity is eliminated (human confirms "nothing left to misread").
- **Documentation**: A Clarification Log in `spec.md` is **optional supplementary history only**. It must never duplicate or supersede the specification. `spec.md` is always the authoritative behavioural specification.

---

## 10. Build Rules

- **Authorization**: Build **never starts** without explicit human authorization after Phase 4.
- **Process** (right-sized):
  - Tiny changes: Direct implementation
  - Larger changes: `plan.md` → `tasks.md` → implement → verify → commit
- **Agent Responsibility**: Maintains task list; human reviews each step against spec.
- **Traceability**: Every commit references the spec requirement it satisfies.
- **Definition of Done**: See Section 17.

---

## 11. Tool Usage Policy

| Tool Category | Policy |
|---------------|--------|
| **Read/Write/Edit** | Primary tools. Always Read before Write/Edit. |
| **Bash** | For running tests, linters, builds, git. Not for `cat`/`head`/`tail`/`sed`/`awk`/`echo` — use Read/Edit/Write. |
| **Agent** | For multi-step research, parallel searches, complex analysis. Subagents return summaries, not file dumps. |
| **TaskCreate/Update/List** | Mandatory for work ≥3 steps. |
| **WebFetch/WebSearch** | For external docs, API references, prior art. Cite sources. |
| **Skill** | Invoke when task matches a listed skill (dataviz, update-config, etc.). |
| **Workflow** | Only when user explicitly opts into multi-agent orchestration ("ultracode", "use a workflow"). |

---

## 12. Allowed Operations

- Reading any file in the repository
- Creating/updating Markdown artifacts in `research/`, `specs/`, `plans/`, `progress.md`, `CLAUDE.md`, `AGENTS.md`
- Running tests, linters, type-checkers, build commands
- Searching codebase (grep, glob, Search tool)
- Spawning subagents for research/analysis
- Fetching external documentation for reference
- Git operations (status, diff, log, branch, commit — **push only when asked**)

---

## 13. Forbidden Operations

- **Writing production code** before Build authorization
- **Generating implementation plans** before Specification approval
- **Making architecture decisions** before Specification exists
- **Modifying `INTENT.md`** without explicit human instruction
- **Silently resolving conflicts** between canonical artifacts — report and stop
- **Treating chat history as authoritative** — files are the source of truth
- **Skipping phases** — each phase requires explicit approval
- **Auto-approving own work** — human reviews every checkpoint
- **Using `Workflow` tool** without explicit user opt-in

---

## 14. Repository Conventions

| Convention | Rule |
|------------|------|
| **Directory Structure** | `research/`, `specs/`, `plans/` at root. Phase-specific subdirs inside. |
| **File Naming** | Kebab-case: `findings-ai-video-fte.md`, `spec.md`, `plan.md` |
| **Line Endings** | LF only |
| **Encoding** | UTF-8 |
| **Markdown** | GitHub-flavored. Tables for structured data. Mermaid for diagrams. |
| **Git** | Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`). No push without ask. |
| **Secrets** | Never in repo. Use environment variables or Vault. `.env*` in `.gitignore`. |
| **Dependencies** | Declared in `package.json`/`pyproject.toml`/`go.mod` — no inline installs. |

---

## 15. Documentation Standards

- **Progress.md**: Dashboard, not log. Reference other files; don't duplicate content.
- **Research**: Structured as Facts / Assumptions / Open Questions / Recommendations.
- **Specs**: Behavioural only. Use tables for requirements, scenarios, acceptance criteria.
- **Plans**: Only after Build authorized. Steps, dependencies, owners, verification.
- **Diagrams**: Mermaid (C4, sequence, state machine). Renderable in GitHub/GitLab.
- **API Contracts**: OpenAPI 3.1 examples in spec; full spec in `/docs/openapi.yaml`.
- **Changelog**: `CHANGELOG.md` updated on every release (conventional commits).

---

## 16. System of Record Principle

> **The default authoritative System of Record for all Digital FTE projects in this repository is centered on PostgreSQL**, with the following supporting capabilities as standard:
> - **Structured Data** — Relational tables, constraints, transactions
> - **Vector Search** — `pgvector` for embeddings (semantic, multimodal)
> - **Full-Text Search** — `tsvector`/`tsquery` for document/query search
> - **Durable Work Queues** — `pg_notify` + advisory locks or Redis Streams for async coordination
> - **Auditability** — Immutable event/append-only tables for critical operations
> - **Encryption** — `pgcrypto` / Vault Transit for sensitive data at rest

**Exception**: A deliberate, documented architectural decision (recorded in `specs/<fte>/adr-<nnn>.md`) may justify an alternative System of Record. The decision must justify why Postgres cannot meet the requirement and must be approved by the Principal before adoption.

---

## 17. Definition of Done

A phase/artifact/task is **Done** only when **ALL** of the following are true:

| Criterion | Verification |
|-----------|--------------|
| **Specification Complete** | All required sections present; no TODOs; no implementation details |
| **Verified** | Independent check passed (tests, human review, subagent verification) |
| **Documented** | Artifact written to correct location; `progress.md` updated |
| **Approved** | Human explicitly approved (for phases) or Principal signed off (for Constitution) |
| **Traceable** | Links to source requirements, research findings, or Intent invariants |
| **No Regressions** | Existing tests pass; no new lint/type errors; no broken links |
| **Constitution Compliance** | Artifact complies with `CLAUDE.md` and `AGENTS.md` |
| **Implementation Independence** | Every Functional Requirement, Edge Case, Rule, and Acceptance Criterion passes the Implementation Independence Test |

**For Build Phase (future)**:
- All acceptance criteria executable and passing
- Observability dashboards show green SLOs
- Runbooks exist for every alert
- Security scan clean (no critical/high)
- Chaos drill passed
- Documentation complete and accessible

---

## 18. AGENTS.md Relationship

`AGENTS.md` contains **shared agent guidance** — patterns, conventions, and reusable prompts that apply across all agents working in this repository. It is subordinate to this Constitution. Agents must read both on every session start.

---

*End of Constitution*