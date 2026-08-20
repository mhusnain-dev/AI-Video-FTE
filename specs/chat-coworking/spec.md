# Spec: Conversational Co-Working Chat (Gemini 2.5 Flash)

## Goal
Enable users to converse with the AI Video FTE using natural language for real-time rectification, prompt improvement, and pipeline guidance — all within the existing frontend, powered by Gemini 2.5 Flash.

---

## Scope
- **In scope**: Chat API, persistent conversation per story, @mention context, action cards with inline confirm, proactive toasts, streaming tokens, read-only for non-owners
- **Out of scope**: Multi-user editing, autonomous agent mode, video frame analysis (Gemini vision), branch versioning

---

## Functional Requirements

### FR-001: Chat Session Management
**When**: User clicks "Ask FTE" on PromptReview, FaceLockReview, DeliveryPage, or ProgressDashboard
**Then**: Open modal with persistent chat history for that storyId
**Constraints**: One chat per storyId; survives page navigation; ESC closes, Ctrl+Enter sends

### FR-002: Streaming Token Responses
**When**: User sends message
**Then**: Gemini 2.5 Flash response streams token-by-token (typewriter effect) via SSE
**Constraints**: Max 30k tokens context; 60s timeout; cancel button during streaming

### FR-003: @Mention Context Selection
**When**: User types `@` in chat input
**Then**: Dropdown shows shots (#1, #2...), characters (by name), transitions
**Constraints**: Inserts `@shot-3` or `@character-John`; context fetched on send

### FR-004: Hybrid Visual Context
**When**: User says "look at frames" or references verification
**Then**: Include base64 frames inline; otherwise only metrics (scores, thresholds, retry counts)
**Constraints**: Frames only on explicit request; max 5 frames per message

### FR-005: Action Cards with Inline Confirm
**When**: Gemini proposes a change (rewrite prompt, adjust camera, change transition)
**Then**: Render structured card with before/after diff + Apply/Dismiss buttons
**Constraints**: Apply → PATCH shot → toast "Applied"; Dismiss → card removed

### FR-006: Proactive Toasts (Immediate)
**When**: Face-Lock fails, cost drift exceeds, sacred guard blocks, generation times out
**Then**: Toast appears instantly: "FTE detected: Shot 3 Face-Lock 0.62 — want me to strengthen prompt?" with "Chat Now" button
**Constraints**: Auto-dismiss 10s; only if chat not already open for that story

### FR-007: Conflict Detection & Confirmation
**When**: New instruction contradicts prior (e.g., "cinematic" → "bright commercial")
**Then**: FTE detects, replies: "You previously said 'cinematic', now 'bright commercial' — which applies?" with radio buttons
**Constraints**: Blocks action until resolved; "Combine both" option

### FR-008: Conversation Persistence (Summary + Key Decisions)
**When**: User approves an action or conversation ends
**Then**: Store AI-generated summary + approved action in `story_conversations` table
**Constraints**: Full message history NOT stored; only summaries + actions for audit

### FR-009: Read-Only for Non-Owners
**When**: Non-owner (invited user) opens chat
**Then**: Can view history, summaries, action cards; cannot send messages or apply actions
**Constraints**: Owner/Admin have full access

### FR-010: Temperature Control
**When**: User adjusts temperature slider in Settings (0.0–1.0)
**Then**: All subsequent Gemini calls use that temperature
**Constraints**: Model fixed to Gemini 2.5 Flash; default 0.3

---

## Acceptance Criteria

### AC-001: Chat Opens & Streams
- [ ] "Ask FTE" button visible on PromptReview, FaceLockReview, DeliveryPage, ProgressDashboard
- [ ] Modal opens with story-specific history
- [ ] User message → streaming tokens appear within 500ms
- [ ] Cancel button stops streaming

### AC-002: @Mention Works
- [ ] Type `@` → dropdown with shots + characters
- [ ] Select → inserts token
- [ ] On send, mentioned context included in Gemini prompt

### AC-003: Action Card Apply
- [ ] Gemini response includes structured action
- [ ] Card renders with diff + Apply/Dismiss
- [ ] Click Apply → PATCH /api/stories/:id/plan → toast "Applied"
- [ ] Click Dismiss → card removed

### AC-004: Proactive Toast
- [ ] Face-Lock failure → toast within 1s
- [ ] Toast has "Chat Now" → opens modal at that message
- [ ] Auto-dismiss 10s

### AC-005: Conflict Resolution
- [ ] Conflicting instruction → FTE asks for clarification
- [ ] Radio buttons: Option A / Option B / Combine
- [ ] Action blocked until resolved

### AC-006: Read-Only Mode
- [ ] Non-owner opens chat → no input field, no Apply buttons
- [ ] Can view history, summaries, action cards

### AC-007: Temperature Setting
- [ ] Settings → Audio/Video tab → slider 0.0–1.0
- [ ] Change persists; next Gemini call uses new value

---

## Technical Architecture

### Backend Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/stories/:id/chat` | Send message, returns streaming SSE |
| GET | `/api/stories/:id/conversation` | Fetch summaries + key decisions |
| PATCH | `/api/stories/:id/plan` | Existing — used by action cards |
| GET | `/api/stories/:id/chat/stream` | SSE stream for token streaming |

### Database
```sql
CREATE TABLE story_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES stories(id),
  summaries JSONB NOT NULL DEFAULT '[]',  -- [{timestamp, summary, actions: []}]
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_story_conversations_story_id ON story_conversations(story_id);
```

### Redis Stream
- Stream: `story_chat:{storyId}` — messages for real-time delivery
- Consumer group: `chat-streamer`

### Gemini Context Assembly
```
System Prompt: "You are the AI Video FTE co-worker. You help refine prompts, fix issues, guide the pipeline."
Context: {
  storyBrief, allShots[{id, prompt, status, faceLockScores, transition}], 
  characters[{name, referenceImage}], 
  generationStatus, deliveryStatus, userFeedback,
  @mentionedShot?, @mentionedCharacter?
}
User Message: "..."
Temperature: userSetting (0.0-1.0)
```

---

## Frontend Components

| Component | Location | Description |
|-----------|----------|-------------|
| `ChatEntryButton` | `components/ChatEntryButton.tsx` | "Ask FTE" button, consistent placement |
| `ChatModal` | `components/ChatModal.tsx` | Draggable, resizable, persists across routes |
| `MessageList` | `components/MessageList.tsx` | Streaming render, markdown, copy buttons |
| `MentionAutocomplete` | `components/MentionAutocomplete.tsx` | @ dropdown with shots/characters |
| `ActionCard` | `components/ActionCard.tsx` | Diff + Apply/Dismiss inline |
| `ProactiveToast` | `components/ProactiveToast.tsx` | Immediate toast with "Chat Now" |
| `ConflictDialog` | `components/ConflictDialog.tsx` | Radio buttons for resolution |
| `TemperatureSlider` | `components/TemperatureSlider.tsx` | In Settings page |

### State Management (Zustand)
```typescript
// store/chatStore.ts
interface ChatState {
  isOpen: boolean;
  storyId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  streamBuffer: string;
  open(storyId: string): void;
  close(): void;
  addMessage(msg: ChatMessage): void;
  updateStreaming(token: string): void;
  commitStream(): void;
}
```

### API Client Extensions
```typescript
// api/client.ts
async *chat(storyId: string, message: string, context: ChatContext): AsyncGenerator<string>
async getConversation(storyId: string): Promise<ConversationSummary>
```

---

## Edge Cases Handled

| Edge Case | Handling |
|-----------|----------|
| Token limit exceeded | Truncate oldest context, keep @mentions + recent 5 turns |
| SSE disconnect mid-stream | Auto-reconnect, resume from last token |
| Concurrent Apply clicks | Optimistic lock — second click no-op |
| Proactive toast during chat | Suppress toast if chat open for that story |
| Non-owner tries Apply | 403 from backend, toast "Read-only access" |
| Empty @mention | Dropdown shows "No matches" |
| Gemini timeout (60s) | Return partial + "Response incomplete, continue?" |

---

## Security

- All endpoints require `authMiddleware`
- Story ownership verified before chat access
- Rate limit: 30 messages/minute per user
- Vault Transit encrypts conversation summaries at rest
- No raw frames stored in DB (only metrics); base64 frames transient in SSE

---

## Out of Scope (Future)

- Gemini Vision (analyze frames visually)
- Multi-user collaborative editing
- Branch versioning (cinematic vs commercial branches)
- Autonomous multi-step fixes
- Voice input (speech-to-text)
- Export conversation as markdown