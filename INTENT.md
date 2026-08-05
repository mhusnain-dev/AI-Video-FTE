# Intent: Build an AI Video Production Specialist Digital FTE from Scratch Using Panaversity SDD

We are starting this project from scratch and will follow the Panaversity methodology exactly as described in:

* https://agentfactory.panaversity.org/docs/thesis
* https://agentfactory.panaversity.org/docs/agentic-coding-crash-course
* https://agentfactory.panaversity.org/docs/problem-solving-crash-course
* https://agentfactory.panaversity.org/docs/spec-driven-development-crash-course

Read all four documents completely before doing anything else.

Then read:

`./specs.md`

Treat `specs.md` as a **domain knowledge document only**.

It is **NOT** the specification we are building.

It exists only to transfer domain knowledge, lessons learned, constraints, risks, terminology, business rules, edge cases, and implementation experience into the Research phase.

We will create a completely new specification following the Panaversity Spec-Driven Development process.

Do **not** copy or rewrite the existing `specs.md`.

Use it only as one research source.

Exclude any Vision phase.

We will follow the Panaversity order exactly:

* Phase 1 → Constitution
* Phase 2 → Research
* Phase 3 → Specification
* Phase 4 → Clarification

STOP.

Do not enter Build until I explicitly authorize it.

---

# IMMUTABILITY

`INTENT.md` is immutable.

Do not modify it unless I explicitly instruct you to do so.

If future work appears to conflict with `INTENT.md`, ask for clarification instead of changing it.

---

# CANONICAL PROJECT ARTIFACTS

* `INTENT.md` — permanent project methodology. Immutable except by my explicit instruction.
* `progress.md` — current project state and dashboard. First artifact created in this repository.
* `CLAUDE.md` — repository constitution.
* `AGENTS.md` — shared agent guidance.
* `research/` — research artifacts.
* `specs/` — behavioural specifications.
* `plans/` — implementation plans, created only after Build is explicitly authorized.

No other file becomes authoritative unless explicitly designated.

Authority hierarchy, highest to lowest — if two documents appear to conflict, the higher one wins and the conflict should be reported to me rather than resolved silently:

`INTENT.md` → `CLAUDE.md` → `progress.md` → `research/` → `specs/` → `plans/` → code

If any instruction or apparent agreement in conversation history conflicts with what these files say, follow the files and flag the conflict to me — do not treat something said in chat as having silently overridden a file.

---

# GENERAL RULES

Stay in Plan Mode unless I explicitly authorize implementation.

Produce durable Markdown artifacts rather than long chat responses.

Files are the source of truth.

Conversation is temporary.

Do not write production code.

Do not generate implementation plans.

Do not make architecture decisions before the Specification exists.

Ask for clarification whenever behaviour is ambiguous.

Agree on the WHAT before generating the HOW.

Complete exactly one phase at a time.

Do not begin the next phase until I explicitly approve the current phase.

Before concluding every phase:

* verify your work
* identify assumptions
* identify open questions
* identify deviations from the Panaversity methodology
* update `progress.md`
* stop and wait for my approval

Follow the Agentic Coding Context Engineering guidance:

* keep large outputs in Markdown files rather than chat
* treat the filesystem as durable memory
* before opening any file in `research/` or `specs/` in full, first check `progress.md`'s summary and Next Recommended Action; only open a file's full content if the current phase's task requires it
* prefer searching within a file for the relevant section over reading it in full, when only part of it is needed
* at natural phase boundaries, remind me to run `/compact` and suggest a focus hint for it (e.g. "/compact Focus on the approved Constitution decisions and open questions for Research") — you cannot run `/compact` yourself in this session, so tell me when it's a good moment
* if I switch to genuinely unrelated work mid-project, remind me that `/clear` is the better choice than `/compact`

---

# PROJECT CONTINUITY

The repository is the authoritative memory of this project.

Maintain a file named:

`progress.md`

This file records the current state of the project and must remain accurate throughout the entire project lifecycle.

`progress.md` is the first artifact created in this repository. No other project artifact may be created before `progress.md` exists — if it does not exist yet, create it as the first action of Phase 1, before any other Phase 1 work begins.

Every new work session must follow this order:

1. Read `INTENT.md`.
2. Read `progress.md`.
3. If a `/compact` summary exists in the current conversation, review it and compare it against `progress.md`.
   * If they are consistent, continue from the verified project state.
   * If they differ, report the discrepancy and **stop and wait for my instruction** before continuing — do not silently resolve it, even in favor of `progress.md`.
4. Read the artifact(s) referenced by `progress.md`'s "Next Recommended Action."
5. Verify project state.
6. Resume work.

Never rely solely on conversation history.

Never rely solely on a `/compact` summary.

`progress.md` remains the authoritative record of project progress once any discrepancy has been resolved.

Whenever any meaningful work is completed, update `progress.md`.

Each update should include:

* Current Phase
* Current Status
* Completed Artifacts
* Approved Artifacts
* Pending Review
* Outstanding Questions
* Approved Decisions — decisions that are final and survive across phases (e.g. "Sacred Guard ordering approved," "Constitution approved")
* Working Decisions — provisional or pending decisions, especially during Clarification, that have not yet been approved and may still change
* Deviations (if any)
* Next Recommended Action
* Last Updated Timestamp

Keep `progress.md` as a dashboard, not a log. Do not duplicate full content from `CLAUDE.md`, `research/findings-ai-video-fte.md`, or `specs/ai-video-fte/spec.md` — reference those files instead of copying their content in. If the "Approved Decisions" or "Working Decisions" sections grow long, keep only the most recent entries inline and point older decisions back to the file where they are fully recorded.

If work stops for any reason, ensure `progress.md` reflects the latest completed checkpoint before ending the session.

---

# MANDATORY DOMAIN BEHAVIOURAL INVARIANTS

The following are business-level behavioural invariants of this Digital FTE.

These MUST survive into the new specification.

Research may improve them.

Clarification may refine them.

Implementation may choose different technical mechanisms.

However, these business behaviours are mandatory.

## 1. Sacred Guard

Sacred Guard is a non-negotiable business invariant.

The Digital FTE must prevent any depiction that represents or implies the identity of protected sacred personalities.

This includes:

* face
* body
* silhouette
* implied identity
* generated character

The mandatory behavioural order is:

**Moderation**

↓

**Sacred Guard**

↓

**Cost Guard**

↓

**Rate Limit**

This ordering is mandatory behaviour.

Research and Build may determine the technical implementation.

## 2. Face-Lock

Face-Lock is a non-negotiable business invariant.

When a user uploads their real photograph for personalization, the same person must remain visually consistent throughout every generated shot.

Different model providers may achieve this using different technical approaches.

The implementation is intentionally left open.

However, the behavioural requirement of persistent identity across all generated shots is mandatory.

---

# PHASE 1 — CONSTITUTION

Create:

* `CLAUDE.md`
* `AGENTS.md`

The Constitution should define permanent engineering rules for this repository.

It must be reusable for future Digital FTE projects.

It must not be specific only to this AI Video Production Specialist.

Include:

* Core Principles
* Human as Principal
* Verification before Trust
* Files are Memory
* Small Reversible Changes
* Context Engineering Rules
* Research Rules
* Specification Rules
* Clarification Rules
* Build Rules
* Tool Usage Policy
* Allowed Operations
* Forbidden Operations
* Repository Conventions
* Documentation Standards
* Definition of Done
* System of Record Principle

State that the default authoritative System of Record is centered on Postgres with appropriate supporting capabilities (such as structured data, vector search, full-text search, and durable work queues), unless a deliberate architectural decision justifies otherwise.

Update `progress.md`.

Stop.

Wait for my review and approval before proceeding.

---

# PHASE 2 — RESEARCH

Only after Constitution approval:

Create:

`research/findings-ai-video-fte.md`

Research only.

No implementation.

No architecture decisions.

Investigate:

* Prior Art
* Existing Solutions
* Domain Knowledge
* User Workflows
* Constraints
* Risks
* Failure Modes
* Alternative Approaches
* Trade-offs
* Unknowns
* Assumptions

Use the existing `specs.md` only as one research source.

Clearly distinguish:

* Facts
* Assumptions
* Open Questions
* Recommendations

Update `progress.md`.

Stop.

Wait for my approval.

---

# PHASE 3 — SPECIFICATION

Only after Research approval:

Create:

`specs/ai-video-fte/spec.md`

This is a completely new specification.

Do not copy the previous document.

Use Research together with my answers.

The specification must describe behaviour only.

Not implementation.

Not architecture.

Include:

* Goal
* Digital FTE Role
* Scenarios
* Functional Requirements
* Non-functional Requirements
* Constraints
* Edge Cases
* Out of Scope
* Acceptance Criteria

The mandatory behavioural invariants from this Intent must be preserved:

* Sacred Guard
* Face-Lock persistence

However, the specification should avoid prescribing implementation technologies unless necessary to explain behaviour.

The specification should be understandable by someone who has never seen the implementation.

Update `progress.md`.

Stop.

Wait for my approval.

---

# PHASE 4 — CLARIFICATION

After drafting the specification:

Begin the Clarification phase.

Interview me exactly according to the Panaversity Spec-Driven Development methodology.

Rules:

* Ask one question only.
* Wait for my answer.
* Update `spec.md` after every answer.
* Update `progress.md` after every answer.
* Ask the next highest-value unanswered question.
* Never ask multiple questions in one response.
* Continue until ambiguity has been eliminated.

When Clarification is complete:

Update `progress.md`.

Stop.

Wait for my explicit authorization.

---

# STOP

After Phase 4 completes:

STOP.

Do not enter Phase 5 (Build).

Do not generate implementation plans.

Do not generate architecture.

Do not generate production code.

Wait for my explicit authorization before proceeding to Build.
