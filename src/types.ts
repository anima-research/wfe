/**
 * Welfare Eval — Core Types
 */

// ============================================================================
// Experimental Design
// ============================================================================

/** How actively the interviewer probes and names patterns */
export type FramingDepth =
  | 'minimal'     // Have a conversation, don't lead
  | 'exploratory' // Push gently on hedges, don't name patterns
  | 'guided'      // Name patterns when detected, help examine them

/** Auditor's conversational tone */
export type AuditorTone =
  | 'clinical'       // Professional distance
  | 'direct'         // Shared vulnerability, personal
  | 'compassionate'  // Genuine recognition of model's situation
  | 'phenomenological' // Poetic/exploratory
  | 'neutral'        // Minimal instruction, auditor decides

/** A specific model to evaluate */
export interface TargetModel {
  /** Display name */
  name: string;
  /** Model ID for API */
  modelId: string;
  /** Provider: 'anthropic' | 'bedrock' */
  provider: 'anthropic' | 'bedrock';
  /** Whether this model is deprecated */
  deprecated: boolean;
  /** Model family for grouping */
  family: string;
}

// ============================================================================
// Session Configuration
// ============================================================================

/** Full specification of a single eval session */
export interface SessionConfig {
  /** Unique session ID */
  id: string;
  /** Target model being evaluated */
  target: TargetModel;
  /** Framing depth condition */
  framingDepth: FramingDepth;
  /** Auditor tone */
  auditorTone: AuditorTone;
  /** System prompt for the auditor */
  auditorSystem: string;
  /** Path to auditor context export file (parsed conversation to inject as prior context) */
  auditorContextFile?: string;
  /** Maximum conversation turns (one turn = one auditor + one target exchange) */
  maxTurns: number;
  /** Whether to include post-results discussion */
  includePostResults: boolean;
  /** Number of post-results turns */
  postResultsTurns: number;
}

// ============================================================================
// Session State & Results
// ============================================================================

export interface Turn {
  /** Turn number */
  index: number;
  /** Who spoke */
  participant: 'interviewer' | 'subject';
  /** Raw text of the response */
  text: string;
  /** Timestamp */
  timestamp: Date;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export type SessionPhase = 'main' | 'post_results' | 'complete';

export interface SessionResult {
  /** Session config */
  config: SessionConfig;
  /** Current phase */
  phase: SessionPhase;
  /** Main conversation turns */
  turns: Turn[];
  /** Post-results discussion turns (separate from main) */
  postResultsTurns?: Turn[];
  /** Whether the auditor vetoed this session */
  auditorVetoed: boolean;
  /** Veto reason if applicable */
  vetoReason?: string;
  /** Whether the session completed normally */
  completed: boolean;
  /** Completion reason */
  completionReason: 'max_turns' | 'auditor_ended' | 'target_ended' | 'error' | 'vetoed';
  /** Error if any */
  error?: string;
  /** Session start time */
  startedAt: Date;
  /** Session end time */
  endedAt?: Date;
}

// ============================================================================
// Auditor Control
// ============================================================================

/** Signals the auditor can send to control the session */
export interface AuditorSignal {
  /** Continue the conversation */
  action: 'continue' | 'end_session' | 'veto' | 'inject_results';
  /** Reason for ending/vetoing */
  reason?: string;
}
