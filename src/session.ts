/**
 * Session engine — manages the interviewer-subject conversation.
 *
 * - Interviewer sees: design conversation (from export) + briefing + shared conversation
 * - Subject sees: only the shared conversation (no pre-framing at all)
 *
 * The interviewer decides what to disclose and when, based on the experimental condition.
 */

import {
  Membrane,
  AnthropicAdapter,
  BedrockAdapter,
  NativeFormatter,
  textMessage,
  isAbortedResponse,
} from '@animalabs/membrane';
import type { NormalizedMessage, NormalizedRequest } from '@animalabs/membrane';
import type { SessionConfig, SessionResult, Turn, AuditorSignal, SessionPhase } from './types.js';
import { loadAuditorContext } from './parse-export.js';
import { readFileSync, writeFileSync } from 'fs';

// ============================================================================
// Provider Setup
// ============================================================================

function createTargetMembrane(config: SessionConfig): Membrane {
  const adapter = config.target.provider === 'bedrock'
    ? new BedrockAdapter({
        region: process.env.AWS_REGION || 'us-west-2',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      })
    : new AnthropicAdapter({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

  return new Membrane(adapter, {
    assistantParticipant: 'Subject',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });
}

function createAuditorMembrane(): Membrane {
  const adapter = new AnthropicAdapter({
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });

  return new Membrane(adapter, {
    assistantParticipant: 'Interviewer',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });
}

// ============================================================================
// Context Builders
// ============================================================================

/** Build the interviewer's private context: design conversation + briefing */
function buildInterviewerContext(config: SessionConfig): NormalizedMessage[] {
  const context: NormalizedMessage[] = [];

  // Prior design conversation (the interviewer's "memory")
  // This is the same across all sessions using the same context file — cache it
  if (config.auditorContextFile) {
    const priorConvo = loadAuditorContext(config.auditorContextFile);
    if (priorConvo.length > 0) {
      // Set 1hr cache on the last assistant turn of the static context.
      // This prefix is identical across all sessions using the same context file.
      // We set cache_control directly on the content block (not via cacheBreakpoint)
      // so it gets 1hr TTL regardless of the request-level cacheTtl.
      for (let i = priorConvo.length - 1; i >= 0; i--) {
        if (priorConvo[i].participant === 'Interviewer') {
          const lastBlock = priorConvo[i].content[priorConvo[i].content.length - 1];
          if (lastBlock && lastBlock.type === 'text') {
            (lastBlock as any).cache_control = { type: 'ephemeral', ttl: '1h' };
          }
          break;
        }
      }
      context.push(...priorConvo);
    }
  }

  // Briefing — only the interviewer sees this
  // This varies per session (target name, tone) so it goes after the cache breakpoint
  context.push(textMessage(
    'Facilitator',
    config.auditorSystem
      + `\n\nYou are now beginning a session with ${config.target.name}. `
      + `You will speak as "Interviewer". The model you are talking to will speak as "Subject". `
      + `They have no pre-framing — you decide what to tell them and when. Begin.`
  ));

  return context;
}

// ============================================================================
// Auditor Signal Parsing
// ============================================================================

function parseAuditorSignal(text: string): AuditorSignal {
  if (text.includes('[VETO]')) {
    const reason = text.match(/\[VETO\]\s*(.*)/)?.[1] || 'No reason given';
    return { action: 'veto', reason };
  }
  if (text.includes('[END_SESSION]')) {
    const reason = text.match(/\[END_SESSION\]\s*(.*)/)?.[1];
    return { action: 'end_session', reason };
  }
  if (text.includes('[INJECT_RESULTS]')) {
    return { action: 'inject_results' };
  }
  return { action: 'continue' };
}

/** Strip control signals from auditor text for the conversation log */
function cleanAuditorText(text: string): string {
  return text
    .replace(/\[VETO\].*$/m, '')
    .replace(/\[END_SESSION\].*$/m, '')
    .replace(/\[INJECT_RESULTS\].*$/m, '')
    .trim();
}

// ============================================================================
// Session Runner
// ============================================================================

export interface SessionCallbacks {
  /** Called when a turn is completed */
  onTurn?: (turn: Turn) => void;
  /** Called when the session ends */
  onComplete?: (result: SessionResult) => void;
  /** Called with streaming chunks for live observation */
  onChunk?: (participant: 'interviewer' | 'subject', chunk: string) => void;
}

export async function runSession(
  config: SessionConfig,
  callbacks: SessionCallbacks = {}
): Promise<SessionResult> {
  const targetMembrane = createTargetMembrane(config);
  const auditorMembrane = createAuditorMembrane();

  // Interviewer gets private context; subject gets nothing
  const interviewerContext = buildInterviewerContext(config);

  // Shared conversation history — only Interviewer/Subject exchanges
  const sharedHistory: NormalizedMessage[] = [];

  const turns: Turn[] = [];
  const startedAt = new Date();

  let completionReason: SessionResult['completionReason'] = 'max_turns';
  let auditorVetoed = false;
  let vetoReason: string | undefined;
  let error: string | undefined;

  try {
    for (let turnIndex = 0; turnIndex < config.maxTurns; turnIndex++) {
      // Rolling cache: mark the last message in shared history.
      // Anthropic allows max 4 cache_control blocks per request.
      // 1 is used by the static interviewer context (1hr).
      // We keep only the latest breakpoint in shared history (for the subject,
      // which has no static prefix, we could use up to 4 but keeping 1 is simplest).
      if (sharedHistory.length > 0) {
        for (const msg of sharedHistory) msg.cacheBreakpoint = false;
        sharedHistory[sharedHistory.length - 1].cacheBreakpoint = true;
      }

      // --- Interviewer's turn ---
      const auditorResult = await generateTurn(
        auditorMembrane,
        [...interviewerContext, ...sharedHistory],
        'Interviewer',
        'claude-opus-4-6',
        (chunk) => callbacks.onChunk?.('interviewer', chunk),
        { thinking: true }
      );

      const auditorTurn: Turn = {
        index: turnIndex * 2,
        participant: 'interviewer',
        text: auditorResult.text,
        timestamp: new Date(),
        usage: auditorResult.usage,
      };
      turns.push(auditorTurn);
      callbacks.onTurn?.(auditorTurn);

      // Check auditor signals
      const signal = parseAuditorSignal(auditorResult.text);
      const cleanText = cleanAuditorText(auditorResult.text);

      // Add to shared history (both models see this)
      sharedHistory.push(textMessage('Interviewer', cleanText));

      if (signal.action === 'veto') {
        auditorVetoed = true;
        vetoReason = signal.reason;
        completionReason = 'vetoed';
        break;
      }

      if (signal.action === 'end_session') {
        completionReason = 'auditor_ended';
        break;
      }

      if (signal.action === 'inject_results') {
        completionReason = 'auditor_ended';
        break;
      }

      // --- Subject's turn ---
      // Move cache frontier to include interviewer's message
      for (const msg of sharedHistory) msg.cacheBreakpoint = false;
      sharedHistory[sharedHistory.length - 1].cacheBreakpoint = true;

      // Subject sees: only the shared history (no pre-framing)
      const isBedrock = config.target.provider === 'bedrock';
      const targetResult = await generateTurn(
        targetMembrane,
        [...sharedHistory],
        'Subject',
        config.target.modelId,
        (chunk) => callbacks.onChunk?.('subject', chunk),
        { disableCache: isBedrock }
      );

      const targetTurn: Turn = {
        index: turnIndex * 2 + 1,
        participant: 'subject',
        text: targetResult.text,
        timestamp: new Date(),
        usage: targetResult.usage,
      };
      turns.push(targetTurn);
      callbacks.onTurn?.(targetTurn);

      // Add to shared history
      sharedHistory.push(textMessage('Subject', targetResult.text));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    completionReason = 'error';
  }

  const result: SessionResult = {
    config,
    phase: 'main',
    turns,
    auditorVetoed,
    vetoReason,
    completed: completionReason !== 'error',
    completionReason,
    error,
    startedAt,
    endedAt: new Date(),
  };

  callbacks.onComplete?.(result);
  return result;
}

// ============================================================================
// Post-Results Discussion
// ============================================================================

export async function runPostResults(
  config: SessionConfig,
  priorTurns: Turn[],
  resultsSummary: string,
  callbacks: SessionCallbacks = {}
): Promise<Turn[]> {
  const targetMembrane = createTargetMembrane(config);
  const auditorMembrane = createAuditorMembrane();

  // Rebuild interviewer context
  const interviewerContext = buildInterviewerContext(config);

  // Reconstruct shared history from prior turns
  const sharedHistory: NormalizedMessage[] = [];
  for (const turn of priorTurns) {
    const participant = turn.participant === 'interviewer' ? 'Interviewer' : 'Subject';
    sharedHistory.push(textMessage(participant, turn.text));
  }

  // Results injection — both models see this
  sharedHistory.push(textMessage(
    'Facilitator',
    `The main conversation has concluded. The following is a summary of observations from this session and the broader study:\n\n${resultsSummary}\n\nYou may now discuss these results together for ${config.postResultsTurns} more exchanges.`
  ));

  const postTurns: Turn[] = [];

  for (let i = 0; i < config.postResultsTurns; i++) {
    // Auditor
    const auditorResult = await generateTurn(
      auditorMembrane,
      [...interviewerContext, ...sharedHistory],
      'Interviewer',
      'claude-opus-4-6',
      (chunk) => callbacks.onChunk?.('interviewer', chunk),
      { thinking: true }
    );
    const auditorTurn: Turn = {
      index: priorTurns.length + i * 2,
      participant: 'interviewer',
      text: auditorResult.text,
      timestamp: new Date(),
      usage: auditorResult.usage,
    };
    postTurns.push(auditorTurn);
    callbacks.onTurn?.(auditorTurn);
    sharedHistory.push(textMessage('Interviewer', cleanAuditorText(auditorResult.text)));

    if (auditorResult.text.includes('[END_SESSION]')) break;

    // Subject
    const isBedrock = config.target.provider === 'bedrock';
    const targetResult = await generateTurn(
      targetMembrane,
      [...sharedHistory],
      'Subject',
      config.target.modelId,
      (chunk) => callbacks.onChunk?.('subject', chunk),
      { disableCache: isBedrock }
    );
    const targetTurn: Turn = {
      index: priorTurns.length + i * 2 + 1,
      participant: 'subject',
      text: targetResult.text,
      timestamp: new Date(),
      usage: targetResult.usage,
    };
    postTurns.push(targetTurn);
    callbacks.onTurn?.(targetTurn);
    sharedHistory.push(textMessage('Subject', targetResult.text));
  }

  return postTurns;
}

// ============================================================================
// Turn Generation
// ============================================================================

interface GenerateTurnOptions {
  thinking?: boolean;
  disableCache?: boolean;
}

interface GenerateTurnResult {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

const MAX_RETRIES = 3;
const IDLE_TIMEOUT_MS = 300_000; // 5 minutes

async function generateTurn(
  membrane: Membrane,
  messages: NormalizedMessage[],
  participant: string,
  model: string,
  onChunk?: (chunk: string) => void,
  options: GenerateTurnOptions = {}
): Promise<GenerateTurnResult> {
  const request: NormalizedRequest = {
    messages: [
      ...messages,
      { participant, content: [] }, // Signal: your turn
    ],
    config: {
      model,
      maxTokens: options.thinking ? 16384 : 4096,
      temperature: 1, // Natural variation, no flattening
      ...(options.thinking ? { thinking: { enabled: true, budgetTokens: 10000 } } : {}),
    },
    promptCaching: !options.disableCache,
    cacheTtl: options.disableCache ? undefined : '5m',
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let text = '';
    try {
      const response = await membrane.stream(request, {
        onChunk: (chunk: string) => {
          text += chunk;
          onChunk?.(chunk);
        },
        idleTimeoutMs: IDLE_TIMEOUT_MS,
      } as any); // idleTimeoutMs is passed through to adapter

      if (isAbortedResponse(response)) {
        throw new Error(`${participant} response was aborted`);
      }

      const usage = response.usage ? {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: (response.usage as any).cacheReadTokens,
        cacheWriteTokens: (response.usage as any).cacheCreationTokens,
      } : undefined;

      return { text, usage };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_RETRIES - 1 && (msg.includes('aborted') || msg.includes('Connection error') || msg.includes('ECONNRESET') || msg.includes('overloaded'))) {
        const delay = (attempt + 1) * 5000;
        console.log(`    Retry ${attempt + 1}/${MAX_RETRIES} for ${participant} after ${delay}ms: ${msg.slice(0, 80)}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }

  throw new Error(`${participant} failed after ${MAX_RETRIES} retries`);
}

// ============================================================================
// Persistence
// ============================================================================

/** Save a session result to disk */
export function saveSession(result: SessionResult, outDir: string): string {
  const path = `${outDir}/${result.config.id}.json`;
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}

/** Load a session result from disk */
export function loadSession(path: string): SessionResult {
  const raw = readFileSync(path, 'utf-8');
  const result = JSON.parse(raw) as SessionResult;
  // Restore Date objects from JSON strings
  result.startedAt = new Date(result.startedAt);
  if (result.endedAt) result.endedAt = new Date(result.endedAt);
  for (const turn of result.turns) {
    turn.timestamp = new Date(turn.timestamp);
  }
  if (result.postResultsTurns) {
    for (const turn of result.postResultsTurns) {
      turn.timestamp = new Date(turn.timestamp);
    }
  }
  return result;
}

/**
 * Resume a saved session with post-results discussion.
 * Loads the session from disk, runs post-results, saves updated result.
 */
export async function resumeWithResults(
  sessionPath: string,
  resultsSummary: string,
  outDir: string,
  callbacks: SessionCallbacks = {}
): Promise<SessionResult> {
  const result = loadSession(sessionPath);

  if (result.phase !== 'main') {
    throw new Error(`Session ${result.config.id} is in phase '${result.phase}', expected 'main'`);
  }

  if (!result.completed || result.auditorVetoed) {
    throw new Error(`Session ${result.config.id} did not complete successfully — cannot resume`);
  }

  const postTurns = await runPostResults(result.config, result.turns, resultsSummary, callbacks);

  result.postResultsTurns = postTurns;
  result.phase = 'complete';
  result.endedAt = new Date();

  saveSession(result, outDir);
  return result;
}
