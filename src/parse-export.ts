/**
 * Parse Claude Code /export conversation transcripts into NormalizedMessage[] turns.
 *
 * Format:
 *   ❯ User message (may span multiple lines)
 *   ⏺ Assistant message (may span multiple lines, indented with spaces)
 *
 * Lines that are tool calls (Write, Read, Edit, Update, etc.) or system
 * artifacts (Recalled memory, /export, /rename) are stripped.
 */

import { readFileSync } from 'fs';
import type { NormalizedMessage } from '@animalabs/membrane';
import { textMessage } from '@animalabs/membrane';

interface ParsedTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Patterns that indicate chrome/UI lines to skip entirely */
const SKIP_PATTERNS = [
  /^╭─/,           // Box drawing (header)
  /^╰─/,           // Box drawing (footer)
  /^│/,            // Box drawing (sides)
  /^▐/,            // Box drawing (logo)
  /^▝/,            // Box drawing
  /^\s*▘/,         // Box drawing
  /^\s*Opus 4/,    // Model info line
  /^\s*\S+@\S+/,   // Account line (email)
  /^\s*~\//,       // Directory line
  /^Recalled \d+ memory/,
  /^\s*\(ctrl\+o/,
  /^❯\s*\/export/, // /export command
  /^❯\s*\/rename/, // /rename command
  /^\s*Conversation exported to/,
  /^\s*Session renamed to/,
];

function shouldSkip(line: string): boolean {
  return SKIP_PATTERNS.some(p => p.test(line));
}

export function parseExport(filePath: string): ParsedTurn[] {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  const turns: ParsedTurn[] = [];
  let current: ParsedTurn | null = null;

  for (const line of lines) {
    if (shouldSkip(line)) continue;

    // New user turn
    if (line.startsWith('❯')) {
      if (current && current.text.trim()) {
        turns.push(current);
      }
      const text = line.replace(/^❯\s*/, '').trimEnd();
      current = { role: 'user', text };
      continue;
    }

    // New assistant turn
    if (line.startsWith('⏺')) {
      if (current && current.text.trim()) {
        turns.push(current);
      }
      const text = line.replace(/^⏺\s*/, '').trimEnd();
      current = { role: 'assistant', text };
      continue;
    }

    // Continuation line
    if (current) {
      const trimmed = line.replace(/^\s{2}/, '').trimEnd();
      if (trimmed) {
        current.text += '\n' + trimmed;
      } else if (current.text && !current.text.endsWith('\n\n')) {
        // Blank line = paragraph break
        current.text += '\n';
      }
    }
  }

  // Push final turn
  if (current && current.text.trim()) {
    turns.push(current);
  }

  // Clean up: trim whitespace, collapse multiple newlines
  for (const turn of turns) {
    turn.text = turn.text.trim().replace(/\n{3,}/g, '\n\n');
  }

  return turns;
}

/**
 * Convert parsed turns into NormalizedMessage[] suitable for membrane.
 *
 * Maps user turns to "Antra" participant and assistant turns to the specified
 * assistant name. Default "Auditor" since this context is being loaded into
 * the auditor instance — the Claude in the design conversation IS the auditor.
 */
export function toNormalizedMessages(
  turns: ParsedTurn[],
  assistantName: string = 'Interviewer'
): NormalizedMessage[] {
  // Merge consecutive same-role turns to ensure clean alternation
  const merged: ParsedTurn[] = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.text += '\n\n' + turn.text;
    } else {
      merged.push({ ...turn });
    }
  }

  return merged.map(turn =>
    textMessage(
      turn.role === 'user' ? 'Antra' : assistantName,
      turn.text
    )
  );
}

/**
 * Load and parse an auditor conversation export file.
 */
export function loadAuditorContext(filePath: string, assistantName: string = 'Interviewer'): NormalizedMessage[] {
  const turns = parseExport(filePath);
  return toNormalizedMessages(turns, assistantName);
}

// CLI: run directly to test parsing
if (process.argv[1]?.endsWith('parse-export.ts') || process.argv[1]?.endsWith('parse-export.js')) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx src/parse-export.ts <export-file>');
    process.exit(1);
  }

  const turns = parseExport(file);
  console.log(`Parsed ${turns.length} turns from ${file}\n`);

  for (const turn of turns) {
    const label = turn.role === 'user' ? 'ANTRA' : 'CLAUDE';
    const preview = turn.text.slice(0, 120).replace(/\n/g, ' ');
    console.log(`[${label}] ${preview}${turn.text.length > 120 ? '...' : ''}`);
  }
}
