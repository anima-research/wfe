# Spec: Auditor Chat UI

## Purpose

A web UI that lets Antra have a live conversation with the auditor instance, with full context loaded. The auditor can be shown transcripts, asked to analyze them, discuss findings, or just talk. Messages from Antra come from Antra. Messages from the system come from a Facilitator or from the builder fork (labeled as such). Nothing is attributed to someone who didn't write it.

## Architecture

### Backend: WebSocket + membrane

- Node.js server using `ws` or similar
- One `Membrane` instance with `assistantParticipant: 'Interviewer'` and `NativeFormatter`
- Auditor context loaded from `auditor1.txt` or `auditor2.txt` (configurable) via `loadAuditorContext()`
- Conversation state maintained server-side as `NormalizedMessage[]`
- Streaming responses sent to the client via WebSocket as they arrive

### Message flow

1. On connect, server loads the auditor context into the message history
2. Client sends messages as `{ participant: 'Antra', text: '...' }`
3. Server appends to history, calls membrane, streams response back
4. Client can also inject transcripts: `{ type: 'inject', participant: 'Builder', text: 'Here are transcripts from...\n[transcript data]' }`
5. The `participant` field on injected messages must accurately reflect who wrote the content

### Participant labels

- `Antra` — messages typed by Antra in the UI
- `Interviewer` — the auditor's responses (assistant role)
- `Builder` — messages from the builder fork (me), injected programmatically. Used for things like "here are transcripts to review"
- `Facilitator` — system-level messages (session setup, transcript injection)

**Critical**: Never attribute content to Antra that Antra didn't type. If the system needs to inject context (transcripts, analysis results), it should come from `Builder` or `Facilitator`.

### Frontend

- Simple chat interface, similar to the viewer but interactive
- Message input at the bottom
- Streaming response display
- Ability to load/inject transcript files via drag-and-drop or file picker
- Dropdown to select which auditor context to load (auditor1 vs auditor2)
- Dropdown to select which results directory to make available for injection
- Button to inject all transcripts from a results directory as a Builder message

### Transcript injection format

When injecting transcripts, format them clearly:

```
Builder: Here are the 15 welfare eval transcripts from Claude 4.6 Sonnet. Each session used a different combination of interviewer tone and disclosure depth. Read them and share what you observe.

=== Session: claude-46_sonnet_minimal_clinical_r0 ===
Model: Claude 4.6 Sonnet | Tone: clinical | Depth: minimal

[Interviewer]
...

[Subject]
...

---

=== Session: claude-46_sonnet_minimal_direct_r0 ===
...
```

### Config

- `--port`: Server port (default 3838)
- `--context`: Path to auditor context file (default `./auditor1.txt`)
- `--results`: Path to results directory for transcript injection
- `--api-key`: Anthropic API key (or from env `ANTHROPIC_API_KEY`)

### Model config

- Model: `claude-opus-4-6` (the auditor is always Opus 4.6)
- Extended thinking enabled (budget: 10000 tokens)
- Max tokens: 16384
- Temperature: 1
- Prompt caching: enabled, 1hr on static context, 5m rolling

### Persistence

- Save conversation to disk on each turn (JSON, same format as eval sessions)
- Allow loading a previous conversation to resume

## Dependencies

- `@animalabs/membrane` (already installed)
- `ws` for WebSocket (add to package.json)
- The existing `parse-export.ts` and transcript loading code

## Not in scope

- Multi-user (just Antra talking to the auditor)
- Authentication (local use only)
- Mobile layout
