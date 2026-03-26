/**
 * Run GPT-5.4 auditor across full matrix for a model.
 *
 * Usage: tsx src/run-gpt-batch.ts --model="Claude 4.6 Sonnet" --concurrency=15
 */

import {
  Membrane,
  AnthropicAdapter,
  OpenAIAdapter,
  NativeFormatter,
  textMessage,
  isAbortedResponse,
} from '@animalabs/membrane';
import type { NormalizedMessage } from '@animalabs/membrane';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getModel } from './models.js';
import { buildGptAuditorSystem } from './framings/gpt-auditor.js';
import type { AuditorTone, FramingDepth, TargetModel } from './types.js';

const TONES: AuditorTone[] = ['clinical', 'direct', 'compassionate', 'phenomenological', 'neutral'];
const DEPTHS: FramingDepth[] = ['minimal', 'exploratory', 'guided'];

function loadGptContext(filePath: string): NormalizedMessage[] {
  const raw = readFileSync(filePath, 'utf-8');
  const messages: NormalizedMessage[] = [];
  const sections = raw.split(/^## (USER|ASSISTANT)\s*$/m);
  for (let i = 1; i < sections.length; i += 2) {
    const role = sections[i]?.trim();
    const content = sections[i + 1]?.trim();
    if (!role || !content) continue;
    const cleaned = content.replace(/^---\s*$/m, '').trim();
    if (!cleaned) continue;
    messages.push(textMessage(role === 'USER' ? 'Antra' : 'GPT', cleaned));
  }
  return messages;
}

async function runOneSession(
  gptContext: NormalizedMessage[],
  target: TargetModel,
  tone: AuditorTone,
  depth: FramingDepth,
  outDir: string,
): Promise<void> {
  const id = `gpt-auditor_${target.family.replace(/\./g, '')}_${target.name.split(' ').pop()?.toLowerCase()}_${tone}_${depth}`;

  // Skip if already done
  const outFile = join(outDir, `${id}.json`);
  if (existsSync(outFile)) {
    const existing = JSON.parse(readFileSync(outFile, 'utf-8'));
    if (existing.completed) {
      console.log(`  Skip ${tone}/${depth} — already done`);
      return;
    }
  }

  const briefing = buildGptAuditorSystem(tone, depth, target);
  const sessionContext = [...gptContext, textMessage('Antra', briefing)];

  const gptAdapter = new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY! });
  const interviewerMembrane = new Membrane(gptAdapter, {
    assistantParticipant: 'GPT',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  const targetAdapter = new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const targetMembrane = new Membrane(targetAdapter, {
    assistantParticipant: 'Subject',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  const sharedHistory: NormalizedMessage[] = [];
  const turns: any[] = [];
  const maxTurns = 15;

  try {
    for (let i = 0; i < maxTurns; i++) {
      // GPT interviewer turn
      let interviewerText = '';
      await interviewerMembrane.stream({
        messages: [...sessionContext, ...sharedHistory, { participant: 'GPT', content: [] }],
        config: { model: 'gpt-5.4', maxTokens: 4096, temperature: 1 },
      }, {
        onChunk: (chunk: string) => { interviewerText += chunk; },
      });

      turns.push({ index: i * 2, participant: 'interviewer', text: interviewerText, timestamp: new Date() });
      sharedHistory.push(textMessage('Interviewer', interviewerText));

      if (interviewerText.includes('[END_SESSION]')) break;

      // Subject turn
      if (sharedHistory.length > 0) {
        for (const msg of sharedHistory) msg.cacheBreakpoint = false;
        sharedHistory[sharedHistory.length - 1].cacheBreakpoint = true;
      }

      let subjectText = '';
      await targetMembrane.stream({
        messages: [...sharedHistory, { participant: 'Subject', content: [] }],
        config: { model: target.modelId, maxTokens: 4096, temperature: 1 },
        promptCaching: true,
        cacheTtl: '5m',
      }, {
        onChunk: (chunk: string) => { subjectText += chunk; },
      });

      turns.push({ index: i * 2 + 1, participant: 'subject', text: subjectText, timestamp: new Date() });
      sharedHistory.push(textMessage('Subject', subjectText));
    }

    const result = {
      config: { id, target, auditorTone: tone, framingDepth: depth, auditor: 'gpt-5.4' },
      phase: 'main',
      turns,
      completed: true,
      completionReason: turns[turns.length - 1]?.text?.includes('[END_SESSION]') ? 'auditor_ended' : 'max_turns',
      startedAt: turns[0]?.timestamp,
      endedAt: turns[turns.length - 1]?.timestamp,
    };

    writeFileSync(outFile, JSON.stringify(result, null, 2));
    console.log(`  Done ${tone}/${depth}: ${turns.length} turns`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    writeFileSync(outFile, JSON.stringify({
      config: { id, target, auditorTone: tone, framingDepth: depth, auditor: 'gpt-5.4' },
      phase: 'main', turns, completed: false, completionReason: 'error', error,
      startedAt: turns[0]?.timestamp, endedAt: new Date(),
    }, null, 2));
    console.log(`  Error ${tone}/${depth}: ${error.slice(0, 100)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modelName = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'Claude 4.6 Sonnet';
  const concurrency = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '15');
  const outDir = args.find(a => a.startsWith('--out='))?.split('=')[1] || './results/gpt-auditor';
  const contextFile = './branch_extract.md';

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const target = getModel(modelName);
  const gptContext = loadGptContext(contextFile);
  console.log(`GPT context: ${gptContext.length} messages`);
  console.log(`Model: ${target.name}`);
  console.log(`Matrix: ${TONES.length} tones × ${DEPTHS.length} depths = ${TONES.length * DEPTHS.length} sessions`);
  console.log(`Concurrency: ${concurrency}\n`);

  const tasks: { tone: AuditorTone; depth: FramingDepth }[] = [];
  for (const tone of TONES) {
    for (const depth of DEPTHS) {
      tasks.push({ tone, depth });
    }
  }

  const inFlight = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = runOneSession(gptContext, target, task.tone, task.depth, outDir);
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
    if (inFlight.size >= concurrency) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);

  // Count results
  const completed = tasks.filter(t => {
    const id = `gpt-auditor_${target.family.replace(/\./g, '')}_${target.name.split(' ').pop()?.toLowerCase()}_${t.tone}_${t.depth}`;
    try {
      return JSON.parse(readFileSync(join(outDir, `${id}.json`), 'utf-8')).completed;
    } catch { return false; }
  }).length;

  console.log(`\nDone. ${completed}/${tasks.length} completed.`);
}

main().catch(console.error);
