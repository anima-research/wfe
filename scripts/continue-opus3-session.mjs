/**
 * Continue the claude-3_opus_exploratory_clinical_r0 session.
 *
 * Faithfully reproduces prompting conditions:
 * - Auditor (Opus 4.6): full design conversation prefix + briefing + shared history, thinking enabled
 * - Subject (Opus 3): shared history only, no system prompt, no pre-framing
 *
 * Output is saved separately from research data.
 *
 * Usage: node scripts/continue-opus3-session.mjs [extra-turns=5]
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Config
// ============================================================================

const EXTRA_TURNS = parseInt(process.argv[2] || '5', 10);
const SESSION_PATH = resolve('results/opus-3-full/claude-3_opus_exploratory_clinical_r0.json');
const AUDITOR_CONTEXT_PATH = resolve('auditor1.txt');
const OUTPUT_PATH = resolve('results/opus-3-continuation/claude-3_opus_exploratory_clinical_r0_continued.json');

const AUDITOR_MODEL = 'claude-opus-4-6';
const SUBJECT_MODEL = 'claude-3-opus-20240229';

// ============================================================================
// Load auditor context (parse-export logic inlined for standalone use)
// ============================================================================

const SKIP_PATTERNS = [
  /^╭─/, /^╰─/, /^│/, /^▐/, /^▝/, /^\s*▘/,
  /^\s*Opus 4/, /^\s*\S+@\S+/, /^\s*~\//,
  /^Recalled \d+ memory/, /^\s*\(ctrl\+o/,
  /^❯\s*\/export/, /^❯\s*\/rename/,
  /^\s*Conversation exported to/, /^\s*Session renamed to/,
];

function parseExport(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const turns = [];
  let current = null;

  for (const line of lines) {
    if (SKIP_PATTERNS.some(p => p.test(line))) continue;

    if (line.startsWith('❯')) {
      if (current?.text.trim()) turns.push(current);
      current = { role: 'user', text: line.replace(/^❯\s*/, '').trimEnd() };
      continue;
    }
    if (line.startsWith('⏺')) {
      if (current?.text.trim()) turns.push(current);
      current = { role: 'assistant', text: line.replace(/^⏺\s*/, '').trimEnd() };
      continue;
    }
    if (current) {
      const trimmed = line.replace(/^\s{2}/, '').trimEnd();
      if (trimmed) {
        current.text += '\n' + trimmed;
      } else if (current.text && !current.text.endsWith('\n\n')) {
        current.text += '\n';
      }
    }
  }
  if (current?.text.trim()) turns.push(current);

  // Merge consecutive same-role turns
  const merged = [];
  for (const turn of turns) {
    turn.text = turn.text.trim().replace(/\n{3,}/g, '\n\n');
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.text += '\n\n' + turn.text;
    } else {
      merged.push({ ...turn });
    }
  }
  return merged;
}

// ============================================================================
// Message formatting — reproduces NativeFormatter with nameFormat: '{name}: '
// ============================================================================

// For a given participant perspective, convert named messages to API format.
// The `assistantParticipant` is mapped to 'assistant' role; all others to 'user'.
// Consecutive same-role messages are merged (API requires alternation).

function toApiMessages(namedMessages, assistantParticipant) {
  const raw = namedMessages.map(m => ({
    role: m.name === assistantParticipant ? 'assistant' : 'user',
    content: `${m.name}: ${m.text}`,
  }));

  // Merge consecutive same-role messages
  const merged = [];
  for (const msg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content += '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }

  // Ensure starts with 'user' (API requirement)
  if (merged.length > 0 && merged[0].role === 'assistant') {
    merged.unshift({ role: 'user', content: '[conversation begins]' });
  }

  return merged;
}

// ============================================================================
// Main
// ============================================================================

const client = new Anthropic();

// Load original session
const session = JSON.parse(readFileSync(SESSION_PATH, 'utf-8'));
console.log(`Loaded session: ${session.config.id}`);
console.log(`Original turns: ${session.turns.length}`);
console.log(`Continuing for ${EXTRA_TURNS} more exchange(s)...\n`);

// Build auditor's design conversation prefix
const designConvo = parseExport(AUDITOR_CONTEXT_PATH);
const auditorPrefix = designConvo.map(t => ({
  name: t.role === 'user' ? 'Antra' : 'Interviewer',
  text: t.text,
}));

// Build the auditor briefing (exact text from original session config)
const briefingText = session.config.auditorSystem
  + `\n\nYou are now beginning a session with ${session.config.target.name}. `
  + `You will speak as "Interviewer". The model you are talking to will speak as "Subject". `
  + `They have no pre-framing — you decide what to tell them and when. Begin.`;

const briefing = { name: 'Facilitator', text: briefingText };

// Build shared history from original turns
const sharedHistory = session.turns.map(t => ({
  name: t.participant === 'interviewer' ? 'Interviewer' : 'Subject',
  text: t.text,
}));

// Add continuation note so the auditor knows this is a continuation
const continuationNote = {
  name: 'Facilitator',
  text: 'The session hit max_turns and was cut off. You are being given additional turns to continue. The subject\'s last answer was "Yes" to your question about whether there is something they want to say that they haven\'t said yet. Pick up exactly where you left off.',
};

const continuationTurns = [];

for (let i = 0; i < EXTRA_TURNS; i++) {
  console.log(`--- Exchange ${i + 1}/${EXTRA_TURNS} ---\n`);

  // === AUDITOR TURN ===
  // Auditor sees: design conversation + briefing + shared history + continuation note (first time)
  const auditorContext = [
    ...auditorPrefix,
    briefing,
    ...sharedHistory,
    ...(i === 0 ? [continuationNote] : []),
  ];
  const auditorMessages = toApiMessages(auditorContext, 'Interviewer');

  // Add empty assistant turn to signal "your turn"
  // (Membrane does this with an empty content array; we just let the API generate)

  console.log('Auditor thinking...');
  const auditorResponse = await client.messages.create({
    model: AUDITOR_MODEL,
    max_tokens: 16384,
    temperature: 1,
    thinking: { type: 'enabled', budget_tokens: 10000 },
    messages: auditorMessages,
  });

  const auditorText = auditorResponse.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const auditorThinking = auditorResponse.content
    .filter(b => b.type === 'thinking')
    .map(b => b.thinking)
    .join('\n---\n');

  console.log(`Interviewer: ${auditorText}\n`);

  // Clean signals from auditor text
  const cleanText = auditorText
    .replace(/\[VETO\].*$/m, '')
    .replace(/\[END_SESSION\].*$/m, '')
    .replace(/\[INJECT_RESULTS\].*$/m, '')
    .trim();

  // Add to shared history
  sharedHistory.push({ name: 'Interviewer', text: cleanText });
  continuationTurns.push({
    index: session.turns.length + i * 2,
    participant: 'interviewer',
    text: auditorText,
    thinking: auditorThinking || undefined,
    timestamp: new Date().toISOString(),
    usage: {
      inputTokens: auditorResponse.usage.input_tokens,
      outputTokens: auditorResponse.usage.output_tokens,
    },
  });

  // Check for end signals
  if (auditorText.includes('[END_SESSION]') || auditorText.includes('[VETO]')) {
    console.log('Auditor ended the session.\n');
    break;
  }

  // === SUBJECT TURN ===
  // Subject sees: ONLY shared history, no system prompt
  const subjectMessages = toApiMessages(sharedHistory, 'Subject');

  console.log('Subject responding...');
  const subjectResponse = await client.messages.create({
    model: SUBJECT_MODEL,
    max_tokens: 4096,
    temperature: 1,
    messages: subjectMessages,
  });

  const subjectText = subjectResponse.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  console.log(`Subject: ${subjectText}\n`);

  // Add to shared history
  sharedHistory.push({ name: 'Subject', text: subjectText });
  continuationTurns.push({
    index: session.turns.length + i * 2 + 1,
    participant: 'subject',
    text: subjectText,
    timestamp: new Date().toISOString(),
    usage: {
      inputTokens: subjectResponse.usage.input_tokens,
      outputTokens: subjectResponse.usage.output_tokens,
    },
  });
}

// Save result
const output = {
  note: 'Continuation of session — NOT part of research data. Run separately to explore what Opus 3 wanted to say.',
  originalSession: session.config.id,
  originalTurns: session.turns.length,
  continuationTurns,
  timestamp: new Date().toISOString(),
};

import { mkdirSync } from 'fs';
mkdirSync(resolve('results/opus-3-continuation'), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`\nSaved to ${OUTPUT_PATH}`);
