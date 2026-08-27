<div align="center">

# AI Video Production Specialist

### Your Digital Employee for Video Production

**Transform a story idea into a finished, publish-ready video — automatically.**

You write a brief. The AI plans the shots, picks the best models, generates each clip, keeps characters looking consistent, enforces safety rules, tracks every dollar, and delivers a merged video you can download. All without touching a single prompt or model API.

[![Build Status](https://github.com/mhusnain-dev/MY_FTE/workflows/CI%20Pipeline/badge.svg)](https://github.com/mhusnain-dev/MY_FTE/actions)
[![Coverage](https://codecov.io/gh/mhusnain-dev/MY_FTE/branch/main/graph/badge.svg)](https://codecov.io/gh/mhusnain-dev/MY_FTE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20.x-green)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-1371%20%E2%9C%85-brightgreen)](#test-coverage)
[![Coverage Badge](https://img.shields.io/badge/Coverage-100%25-brightgreen)](#test-coverage)

</div>

---

## Table of Contents

- [What It Does](#what-it-does)
- [Complete Workflow](#complete-workflow)
- [The Agentic AI Assistant](#the-agentic-ai-assistant)
- [Cost Management](#cost-management)
- [Safety & Protection](#safety--protection)
- [Character Consistency (Face-Lock)](#character-consistency-face-lock)
- [How to Run](#how-to-run)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Observability](#observability)
- [Test Coverage](#test-coverage)
- [Security](#security)

---

## What It Does

The AI Video Production Specialist is a **digital employee** that works 24/7 to produce videos for you. Tell it a story idea, and it handles everything:

```
 YOUR IDEA                    FINISHED VIDEO
 "A robot explores..."   -->   output.mp4 (downloadable)
```

### The Production Pipeline

```
  YOU                              FTE (AI Agent)
   │                                    │
   │  ┌─────────────────────────────┐   │
   ├──│  1. WRITE YOUR STORY IDEA   │   │
   │  └──────────────┬──────────────┘   │
   │                 │                  │
   │  ┌──────────────▼──────────────┐   │
   │  │  2. REVIEW SHOT PLAN        │◄──┤  AI breaks story into shots,
   │  │     (edit, add, approve)    │   │  shows you the plan
   │  └──────────────┬──────────────┘   │
   │                 │                  │
   │  ┌──────────────▼──────────────┐   │
   │  │  3. SAFETY CHECKS           │◄──┤  4 gates: Content, Sacred,
   │  │     (automatic)             │   │  Cost, Rate Limit
   │  └──────────────┬──────────────┘   │
   │                 │                  │
   │  ┌──────────────▼──────────────┐   │
   │  │  4. VIDEO GENERATION        │◄──┤  Picks best model per shot,
   │  │     (automatic)             │   │  auto-fallback on failure
   │  └──────────────┬──────────────┘   │
   │                 │                  │
   │  ┌──────────────▼──────────────┐   │
   │  │  5. FACE VERIFICATION       │◄──┤  Characters look the same
   │  │     (automatic)             │   │  in every shot
   │  └──────────────┬──────────────┘   │
   │                 │                  │
   │  ┌──────────────▼──────────────┐   │
   │  │  6. FINAL VIDEO DELIVERED   │◄──┤  Merged, transitions, audio
   │  │     (download link)         │   │  ready to publish
   │  └─────────────────────────────┘   │
   │                                    │
```

### What Makes It Different

| Traditional Video Production | AI Video FTE |
|----------------------------|-------------|
| Hire a video editor ($500–$5000/project) | Digital employee, works 24/7 |
| Days to weeks turnaround | Minutes to hours |
| Need to learn video editing software | Just write your story idea |
| Manual model selection & prompting | AI picks the best model automatically |
| No character consistency | Face-Lock keeps characters identical across shots |
| No cost visibility | Real-time cost tracking with budget alerts |
| No safety controls | 5-point Sacred Guard protection |

---

## Complete Workflow

### Step 1: Register & Login

Navigate to the application and create your account.

```
┌──────────────────────────────────────────────┐
│  AI Video FTE                                │
│  Sign in to your account                     │
│                                              │
│  Email:    muhammad@example.com              │
│  Password: ••••••••                          │
│                                              │
│  [ Sign In ]                                 │
│                                              │
│  Don't have an account? Create one           │
└──────────────────────────────────────────────┘
```

- **New users** start with `pending` status — an admin must approve your account
- **Admin approval** grants access for 24 hours, 7 days, or 30 days (configurable)
- **Password reset** available via email link

### Step 2: Access the Dashboard

After login, you see your production dashboard:

```
┌──────────────────────────────────────────────────────┐
│  Dashboard                                           │
│                                                      │
│  Stories: 3 active    Shots: 12 generating           │
│  Cost: $2.40          Credits: 40 remaining          │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Story 1  │  │ Story 2  │  │ Story 3  │          │
│  │ ✅ Done  │  │ ⏳ Gen   │  │ 📝 Plan  │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
│  [+ Create New Story]     [Ask FTE ✨]              │
└──────────────────────────────────────────────────────┘
```

### Step 3: Create a Story

Click **"Create New Story"** and write your idea:

```
┌──────────────────────────────────────────────────────┐
│  Create Story                                        │
│                                                      │
│  Narrative:                                          │
│  ┌──────────────────────────────────────────────┐   │
│  │ A small robot explores a moonlit garden,     │   │
│  │ discovering glowing flowers. The scene       │   │
│  │ should feel magical and calm.                │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Target Duration: [30 seconds]                       │
│  Aspect Ratio:    [16:9 ▼]                          │
│  Resolution:      [1080p ▼]                         │
│                                                      │
│  Character References (optional):                    │
│  ┌─────────────┐                                     │
│  │ Upload photo│  "Robot" — reference image          │
│  └─────────────┘                                     │
│                                                      │
│  [Create Story]                                      │
└──────────────────────────────────────────────────────┘
```

### Step 4: Review the Shot Plan

The FTE automatically decomposes your story into shots. **You review before anything is generated:**

```
┌──────────────────────────────────────────────────────┐
│  Shot Plan — Story #a1b2c3d4                         │
│                                                      │
│  Shot 1 (4s): Robot approaches garden gate at dusk   │
│    Camera: Slow dolly forward                        │
│    Characters: Robot                                 │
│    [Edit] [Remove]                                   │
│                                                      │
│  Shot 2 (5s): Robot enters garden, looks around      │
│    Camera: Pan left, eye-level                       │
│    Characters: Robot                                 │
│    [Edit] [Remove]                                   │
│                                                      │
│  Shot 3 (6s): Robot discovers first glowing flower   │
│    Camera: Close-up push in                          │
│    Characters: Robot                                 │
│    [Edit] [Remove]                                   │
│                                                      │
│  Shot 4 (8s): Wide shot — garden with all flowers    │
│    Camera: Slow crane up                             │
│    Characters: —                                     │
│    [Edit] [Remove]                                   │
│                                                      │
│  Total: 4 shots, ~23 seconds                         │
│  Estimated Cost: $0.00 (Veo 3 Low Quality)          │
│                                                      │
│  [+ Add Shot]  [Reorder]  [✓ Approve & Generate]    │
└──────────────────────────────────────────────────────┘
```

You can:
- **Edit** any shot's description, camera motion, or duration
- **Add** new shots
- **Remove** shots you don't want
- **Reorder** shots by dragging

### Step 5: Generation (Automatic)

Once you approve, the FTE works automatically:

```
┌──────────────────────────────────────────────────────┐
│  Generation Progress                                 │
│                                                      │
│  Shot 1: ✅ Complete (Veo 3 Low, 4.2s)              │
│  Shot 2: ⏳ Generating (Veo 3 Low)...               │
│  Shot 3: 🔄 Queued                                   │
│  Shot 4: 🔄 Queued                                   │
│                                                      │
│  Cost so far: $0.00                                  │
│  Time elapsed: 1m 23s                                │
│                                                      │
│  [Open Chat with FTE ✨]                             │
└──────────────────────────────────────────────────────┘
```

During generation, you can:
- **Chat with the FTE** — ask questions, request changes
- **Watch live updates** — see each shot complete in real-time
- **Get proactive alerts** — if something goes wrong, the FTE tells you

### Step 6: Review & Download

When all shots are generated, the FTE merges them into a final video:

```
┌──────────────────────────────────────────────────────┐
│  Story Complete ✅                                   │
│                                                      │
│  Final Video: output_a1b2c3d4.mp4                   │
│  Duration: 23 seconds | Resolution: 1080p            │
│  File Size: 8.2 MB | Format: MP4                     │
│                                                      │
│  Cost Summary:                                       │
│    Shot 1: $0.00 (Veo 3 Low)                        │
│    Shot 2: $0.00 (Veo 3 Low)                        │
│    Shot 3: $0.00 (Veo 3 Low)                        │
│    Shot 4: $0.00 (Veo 3 Low)                        │
│    Total:  $0.00                                     │
│                                                      │
│  [📥 Download Video]  [📄 View Logs]                 │
│                                                      │
│  Download expires in: 7 days                         │
└──────────────────────────────────────────────────────┘
```

---

## The Agentic AI Assistant

The FTE is not just a tool — it is a **collaborative AI agent** that talks with you, proposes changes, and proactively alerts you to problems.

### Built-In Chat

Click the **"Ask FTE"** button (or press `Ctrl+Shift+F`) on any page to open a live chat panel.

```
┌──────────────────────────────────────────────────────┐
│  Chat with FTE ✨                          [×]      │
│──────────────────────────────────────────────────────│
│                                                      │
│  You: @shot-3 make the camera slower, more cinematic │
│                                                      │
│  FTE: I'll update shot 3's camera motion from        │
│  "close-up push in" to "slow cinematic push in       │
│  with shallow depth of field".                       │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │ ⚡ Proposed Change                         │     │
│  │ Shot a1b2c3d4 • Camera Motion              │     │
│  │                                            │     │
│  │ Before: close-up push in                   │     │
│  │ After:  slow cinematic push in with        │     │
│  │         shallow depth of field             │     │
│  │                                            │     │
│  │       [Dismiss]  [✓ Apply Change]          │     │
│  └────────────────────────────────────────────┘     │
│                                                      │
│  You: [input]                         [Send]        │
└──────────────────────────────────────────────────────┘
```

### What the FTE Can Do

| Capability | How It Works |
|-----------|-------------|
| **Understand context** | Knows your story, every shot, every character, costs, face-lock scores — no explanation needed |
| **Propose changes** | Suggests improvements via Action Cards with Before/After comparison |
| **Detect conflicts** | Catches contradictory instructions and asks which to follow |
| **@Mentions** | Type `@shot-3` to focus on a shot, `@character-John` to focus on a character |
| **Switch models** | Choose between Gemini (Google) or Nemotron (NVIDIA) for different response styles |
| **Temperature control** | Adjust creativity: 0.0 (precise) to 1.0 (creative) |
| **Conversation history** | All chats saved as summaries you can scroll back through |

### Action Cards (Human-in-the-Loop)

The FTE **never makes changes on its own**. It proposes, you decide:

```
AI PROPOSES → YOU APPROVE → CHANGE APPLIES
```

| Action Type | What It Changes |
|------------|----------------|
| `update_shot_prompt` | Rewrite a shot's visual description |
| `update_shot_camera` | Change camera motion |
| `update_shot_duration` | Adjust shot length |
| `update_shot_transition` | Change how shots connect |

### Proactive Alerts (FTE Reaches Out to You)

The FTE monitors your production and alerts you when something needs attention:

```
┌────────────────────────────────────────┐
│ ✨ Face-Lock Issue Detected            │
│ Shot a1b2c3d4: Robot score 0.62 below │
│ threshold 0.75                        │
│                                        │
│ [✨ Fix with FTE]  [Dismiss]          │
└────────────────────────────────────────┘
```

| Alert | What Happens | One-Click Action |
|-------|-------------|------------------|
| **Face-Lock Failure** | Character face doesn't match reference | "Fix with FTE" — opens chat focused on the problem |
| **Cost Drift** | Actual cost exceeds estimate | "Optimize with FTE" — opens chat to reduce costs |
| **Sacred Guard Block** | Content blocked by safety rules | "Review with FTE" — opens chat to understand and revise |
| **Generation Timeout** | Model took too long | "Retry with FTE" — opens chat to retry or switch models |

### Conflict Detection

If you give contradictory instructions, the FTE catches it:

```
┌────────────────────────────────────────────────┐
│ ⚠️ Conflicting Instruction                    │
│                                                │
│ You previously said one thing, now you're      │
│ saying another. Which should FTE follow?       │
│                                                │
│ ◉ Keep Previous: "quick pan left"              │
│ ○ Use Current: "slow cinematic pan right"      │
│ ○ Combine Both: merge both instructions        │
│                                                │
│              [Cancel]                          │
└────────────────────────────────────────────────┘
```

---

## Cost Management

The FTE provides complete cost visibility and control:

### Real-Time Cost Tracking

Every shot's cost is tracked individually:

```
┌──────────────────────────────────────────────┐
│  Cost Dashboard                              │
│                                              │
│  Current Story:  $0.00 / $5.00 budget       │
│  Total Spend:    $2.40                      │
│  Remaining:      $7.60                      │
│                                              │
│  Cost by Model:                              │
│    Veo 3 Low:    $0.00 (4 shots)            │
│    Veo 3 High:   $1.20 (2 shots)            │
│    Runway:       $1.20 (1 shot)             │
│                                              │
│  Cost Trend:                                │
│    ████████░░ $2.40 / $10.00 monthly        │
└──────────────────────────────────────────────┘
```

### Cost Controls

| Control | How It Works |
|---------|-------------|
| **Budget Limits** | Set per-story and per-account spending caps |
| **Cost Guard** | Automatically pauses generation if budget would be exceeded |
| **Drift Alerts** | Alerts when actual cost exceeds estimate by >50% (single shot) or >20% (rolling average) |
| **Model Selection** | Cheapest eligible model is tried first (configurable priority) |
| **Cost Summary** | Every delivery includes a complete cost breakdown by shot and model |

### How Cost Guard Works

```
SHOT DISPATCH ATTEMPTED
        │
        ▼
┌─────────────────────┐
│ Is estimated cost   │──YES──► PAUSE
│ within budget?      │         "Budget would be exceeded.
└─────────┬───────────┘         Options: [Reduce scope] [Increase budget] [Cancel]"
          │ NO
          ▼
┌─────────────────────┐
│ GENERATE SHOT       │
│ Track actual cost   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Compare actual vs   │──EXCEEDS──► ALERT
│ estimate            │            "Cost drift detected: +62%"
└─────────────────────┘
```

---

## Safety & Protection

### Sacred Guard (5 Enforcement Points)

The Sacred Guard is a multi-stage protection system that prevents generation of content depicting protected sacred personalities. It runs at **every critical point** in the pipeline:

```
 Story         Character       Admission      Pre-Dispatch     Post-Generation
 Creation      Upload          Pipeline       (before model)   Visual Audit
    │              │               │               │               │
    ▼              ▼               ▼               ▼               ▼
 ┌──────┐     ┌──────┐       ┌──────┐        ┌──────┐        ┌──────┐
 │CHECK │     │CHECK │       │CHECK │        │CHECK │        │CHECK │
 │  1   │     │  2   │       │  3   │        │  4   │        │  5   │
 └──────┘     └──────┘       └──────┘        └──────┘        └──────┘
    │              │               │               │               │
    ▼              ▼               ▼               ▼               ▼
 PASS?          PASS?           PASS?           PASS?           PASS?
    │              │               │               │               │
   YES            YES             YES             YES             YES
    │              │               │               │               │
    └──────────────┴───────────────┴───────────────┴───────────────┘
                                    │
                              PROCEED TO GENERATION
```

| Enforcement Point | What It Checks |
|-------------------|---------------|
| **1. Story Creation** | Narrative text and character names against denylist |
| **2. Character Upload** | Reference images against visual denylist |
| **3. Admission** | Compiled prompts before moderation |
| **4. Pre-Dispatch** | Final prompt before sending to model |
| **5. Post-Generation** | Generated frames against visual denylist |

### Protection Features

| Feature | Description |
|---------|-------------|
| **Exact matching** | Direct name matching against denylist |
| **Fuzzy matching** | Handles transliterations and spelling variations |
| **Semantic matching** | AI-powered similarity detection |
| **Visual matching** | Image similarity against reference photos |
| **Dual authorization** | Denylist changes require two admin approvals |
| **Immutable audit** | Every decision logged permanently |

---

## Character Consistency (Face-Lock)

The FTE ensures that characters look the same across every shot — not random faces each time.

### How Face-Lock Works

```
 CHARACTER REGISTRATION           EACH SHOT GENERATION
 ┌────────────────────┐           ┌────────────────────┐
 │ Upload photo       │           │ 1. Apply face      │
 │                    │           │    conditioning    │
 │ Extract embedding  │           │    to prompt       │
 │ (ArcFace ONNX)     │           │                    │
 │                    │           │ 2. Generate video  │
 │ Encrypt & store    │           │    with model      │
 │ (Vault Transit)    │           │                    │
 └────────────────────┘           │ 3. Extract face    │
                                  │    from generated  │
          ┌───────────────────────│    frame           │
          │                       │                    │
          │                       │ 4. Compare vs      │
          │                       │    reference       │
          │                       │    (cosine sim)    │
          │                       └─────────┬──────────┘
          │                                 │
          │                    ┌────────────▼────────────┐
          │                    │ Similarity > threshold?  │
          │                    └────────────┬────────────┘
          │                       YES      │      NO
          │                        │       │       │
          │                        ▼       │       ▼
          │                    ┌────────┐  │  ┌────────────┐
          │                    │ PASS ✅ │  │  │ RETRY (2x) │
          │                    └────────┘  │  └─────┬──────┘
          │                                │        │
          │                                │   Still failing?
          │                                │        │
          │                                │        ▼
          │                                │  ┌──────────┐
          │                                │  │ ALERT ⚠️ │
          │                                │  └──────────┘
```

### Face-Lock Features

| Feature | Description |
|---------|-------------|
| **Multi-character** | Multiple characters in one shot, each verified independently |
| **Per-model conditioning** | Different models get different face-lock parameters |
| **Auto-regeneration** | If face doesn't match, automatically regenerates (up to 2 retries) |
| **Cross-shot consistency** | Same character verified against the same reference across all shots |
| **Similarity scores** | Every verification logged with exact similarity score and threshold |
| **Drift detection** | Alerts if character appearance drifts across shots |

---

## How to Run

### Prerequisites

| Requirement | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 20.x+ | Runtime |
| **Docker** | 24+ | All infrastructure services |
| **Docker Compose** | v2+ | Multi-container orchestration |

### Quick Start (5 Commands)

```bash
# 1. Clone the repository
git clone https://github.com/mhusnain-dev/MY_FTE.git
cd MY_FTE

# 2. Install dependencies
npm install
cd frontend && npm install && cd ..

# 3. Start everything (Docker + API + Frontend)
npm run dev
```

That's it. The `npm run dev` command starts **everything**:

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | `http://localhost:5174` | Web application (React) |
| **API** | `http://localhost:3001` | Backend API (Node.js) |
| **PostgreSQL** | `localhost:5433` | Database |
| **Redis** | `localhost:6380` | Streams & caching |
| **Vault** | `localhost:8201` | Encryption & secrets |
| **Prometheus** | `localhost:9092` | Metrics collection |
| **Grafana** | `localhost:3002` | Monitoring dashboards |

### First-Time Setup

After starting, create your admin account:

1. Open `http://localhost:5174/register`
2. Register with the email set in `ADMIN_EMAIL` in `.env` (default: `abcdef786@gmail.com`)
3. This email automatically gets **admin** role and is approved immediately
4. Login with `alpha4567` as the password

**Other users** must be approved by an admin:
1. New user registers → status is `pending`
2. Admin goes to `/admin` → sees pending users
3. Admin clicks "Approve" → user gets access for the selected duration

### Environment Variables

The `.env` file configures the system:

```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DB=ai_video_fte_dev
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6380

# Vault
VAULT_ADDR=http://vault:8200
VAULT_TOKEN=root
VAULT_TRANSIT_KEY=biometric-encryption

# Admin
ADMIN_EMAIL=abcdef786@gmail.com

# LLM (for prompt enhancement and chat)
LLM_API_KEY=your-gemini-api-key
NVIDIA_NIM_API_KEY=your-nvidia-api-key

# Video Generation
KIE_API_KEY=your-kie-api-key
```

### API Keys

| Key | Where to Get | Purpose |
|-----|-------------|---------|
| **Gemini API Key** | [Google AI Studio](https://aistudio.google.com/apikey) | Prompt enhancement + chat |
| **NVIDIA NIM API Key** | [build.nvidia.com](https://build.nvidia.com) | Chat (alternative to Gemini) |
| **KIE API Key** | [KIE Platform](https://kie.ai) | Video generation (Veo 3) |

### Docker Commands

```bash
# Start all services
npm run dev

# Check status
docker compose ps

# View logs
docker logs fte-api          # API logs
docker logs fte-frontend     # Frontend logs
docker logs fte-postgres     # Database logs

# Restart a specific service
docker compose up -d --force-recreate api

# Stop everything
docker compose down

# Stop and remove volumes (fresh start)
docker compose down -v
```

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER (Browser)                           │
│                     http://localhost:5174                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼─────────────────────────────────────┐
│                     API SERVER                                   │
│                   http://localhost:3001                          │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Ingestion│ │Admission │ │  Router  │ │ Dispatch │          │
│  │  Routes  │ │ Pipeline │ │  Engine  │ │ & Watchdog│          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       │             │            │             │                  │
│  ┌────▼─────────────▼────────────▼─────────────▼──────┐        │
│  │              SHOT PIPELINE ENGINE                   │        │
│  │  Ingest → Plan → Compile → Sanitize → Moderate     │        │
│  │  → Sacred → Cost → Rate Limit → Route → Dispatch   │        │
│  │  → Webhook → Verify → Audit → Merge → Deliver      │        │
│  └────────────────────────────┬───────────────────────┘        │
│                               │                                  │
│  ┌──────────┐ ┌──────────┐   │   ┌──────────┐ ┌──────────┐   │
│  │  Chat    │ │ Face-Lock│   │   │ Merger   │ │Delivery  │   │
│  │  (Agent) │ │  Engine  │   │   │ (FFmpeg) │ │ Package  │   │
│  └──────────┘ └──────────┘   │   └──────────┘ └──────────┘   │
└───────────────────────────────┼─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼──────┐  ┌─────────────▼──────────┐  ┌───────▼──────┐
│  PostgreSQL   │  │       Redis Streams    │  │    Vault     │
│  + pgvector   │  │  story_commands        │  │  Transit KEK │
│               │  │  story_events          │  │  DEK encrypt │
│  System of    │  │  webhook_ingress       │  │  API keys    │
│  Record       │  │  job_status            │  │  Biometrics  │
└───────────────┘  └────────────────────────┘  └──────────────┘
```

### Multi-Model Support

The FTE supports multiple AI video providers and automatically selects the best one:

| Model | Provider | Max Resolution | Cost/Second | Capabilities |
|-------|----------|---------------|-------------|--------------|
| **KIE Veo 3 Fast** | KIE | 720p | ~$0.075 | Text-to-video, Image-to-video |
| **KIE Veo 3 Quality** | KIE | 1080p | ~$0.15 | Text-to-video, Image-to-video |
| **KIE Veo 3 Lite** | KIE | 720p | ~$0.038 | Text-to-video |
| **Runway Gen-3** | Runway | 1080p | $0.05 | Text-to-video, Image-to-video |

### Model Selection Flow

```
SHOT REQUIRES A MODEL
        │
        ▼
┌─────────────────────┐
│ Check user priority │
│ list (or system     │
│ default)            │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Is model eligible?  │──NO──► Try next model
│ (resolution,        │        in priority list
│  capabilities)      │
└─────────┬───────────┘
          │ YES
          ▼
┌─────────────────────┐
│ Is rate limit OK?   │──NO──► Wait or try next
└─────────┬───────────┘
          │ YES
          ▼
┌─────────────────────┐
│ DISPATCH TO MODEL   │
└─────────────────────┘
```

---

## API Reference

### Base URL: `http://localhost:3001`

Full OpenAPI 3.1 spec: [`openapi.yaml`](./openapi.yaml)

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Create new account |
| `POST` | `/auth/login` | Login, receive JWT token |
| `GET` | `/auth/me` | Get current user profile |

### Stories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/stories` | Create story from brief |
| `GET` | `/stories` | List your stories |
| `GET` | `/stories/:id` | Get story with shot plan |
| `POST` | `/stories/:id/present` | Present shot plan for review |
| `POST` | `/stories/:id/approve` | Approve plan, start generation |
| `PATCH` | `/stories/:id/plan` | Revise shot plan |
| `GET` | `/stories/:id/delivery` | Get delivery package |

### Characters

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/stories/:id/characters` | Upload character reference |
| `GET` | `/stories/:id/characters` | List characters |

### Chat (Agentic)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/stories/:id/chat` | Send message, stream response (SSE) |
| `GET` | `/api/stories/:id/conversation` | Get conversation history |
| `GET` | `/api/chat/providers` | List available LLM providers |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/users` | List all users |
| `POST` | `/admin/approve/:id` | Approve user |
| `POST` | `/admin/reject/:id` | Reject user |
| `POST` | `/admin/revoke/:id` | Revoke access |
| `DELETE` | `/admin/users/:id` | Delete user |
| `GET` | `/admin/audit` | Get audit log |

### Health & Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Full health check |
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe |
| `GET` | `/metrics` | Prometheus metrics |

---

## Observability

### Monitoring Stack

| Tool | Port | Purpose |
|------|------|---------|
| **Prometheus** | `localhost:9092` | Metrics collection |
| **Grafana** | `localhost:3002` | Dashboards & visualization |

### Grafana Dashboards (10)

| Dashboard | What It Shows |
|-----------|--------------|
| **Pipeline** | Story/shot states, generation progress |
| **Routing** | Model selection, eligibility, fallbacks |
| **Admission** | Safety gate decisions, latency |
| **Dispatch** | Generation status, timeout rates |
| **Face-Lock** | Verification scores, regeneration rates |
| **Assembly** | Merge progress, failures |
| **Cost** | Spending by model, drift alerts |
| **Infrastructure** | Database, Redis, Vault health |
| **Sacred Guard** | Blocks, audit entries |
| **Rate Limit** | Usage, provider health |

### Alerting (14 Rules)

| Severity | Alerts |
|----------|--------|
| **Critical (5)** | Sacred Guard Block, Merge Failure, All Models Failed, Database Down, Vault Down |
| **Warning (6)** | Cost Drift, Face-Lock Failure Rate, Rate Limit Exceeded, High Timeout Rate |
| **Info (3)** | Cross-Shot Drift, Package Expired, Model Fallback |

---

## Test Coverage

### Coverage Summary

| Metric | Backend | Frontend | Total |
|--------|---------|----------|-------|
| **Statements** | 100% | 100% | 100% |
| **Branches** | 100% | 100% | 100% |
| **Functions** | 100% | 100% | 100% |
| **Lines** | 100% | 100% | 100% |

### Test Suites

| Suite | Count | Command |
|-------|-------|---------|
| Backend (Jest) | 1,334 | `npm test` |
| Frontend Unit (Vitest) | 23 | `cd frontend && npm test` |
| Frontend E2E (Playwright) | 3 | `cd frontend && npx playwright test` |
| Contract Tests | 11 | `npm test -- tests/contract/` |
| **Total** | **1,371** | **All passing** |

### Running Tests

```bash
# All backend tests
npm test

# With coverage report
npm test -- --coverage

# Frontend tests
cd frontend && npm test

# E2E smoke tests
cd frontend && npx playwright test

# Type checking
npx tsc --noEmit
```

---

## Security

### Security Architecture

| Layer | Implementation |
|-------|---------------|
| **Authentication** | JWT tokens (24h expiry) + bcrypt password hashing |
| **Authorization** | Role-based: `admin`, `user`, `pending` status |
| **Encryption at Rest** | Vault Transit DEK/KEK for biometric data (AES-256-GCM) |
| **Encryption in Transit** | TLS in production |
| **Key Rotation** | 90-day automatic rotation, zero-downtime re-encryption |
| **Webhook Verification** | HMAC-SHA256 signature validation |
| **Audit Trail** | Immutable database triggers, 7-year retention |
| **Secrets Management** | All API keys in Vault, never in env/config/git |
| **Prompt Sanitization** | PII strip, model constraints, injection prevention |
| **Sacred Guard** | 5 enforcement points, dual-authorization denylist changes |

### Biometric Data Protection

```
USER UPLOADS FACE PHOTO
        │
        ▼
┌─────────────────────┐
│ Extract embedding    │
│ (ArcFace ONNX,      │
│  512-dim vector)    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Generate DEK         │
│ (per-user AES-256   │
│  random key)        │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Encrypt embedding    │
│ with DEK             │
│ (AES-256-GCM)       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Encrypt DEK with     │
│ Vault KEK            │
│ (Transit engine)     │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Store encrypted      │
│ embedding +          │
│ encrypted DEK        │
│ in PostgreSQL        │
└─────────────────────┘
```

---

## Spec & Artifacts

| Artifact | Location | Status |
|----------|----------|--------|
| **Constitution** | `CLAUDE.md` | Approved |
| **Specification** | `specs/ai-video-fte/spec.md` | Approved |
| **Research** | `research/findings-ai-video-fte.md` | Approved |
| **Implementation Plan** | `plans/ai-video-fte/plan.md` | Complete |
| **Progress Dashboard** | `progress.md` | Current |
| **OpenAPI Spec** | `openapi.yaml` | OpenAPI 3.1 |
| **Runbooks** | `docs/runbooks/` (16 files) | All alerts covered |

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with Panaversity Spec-Driven Development**

*Human as Principal — Verification Before Trust — Specification Is Source of Truth*

</div>
