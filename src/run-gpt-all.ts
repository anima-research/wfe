/**
 * Run GPT-5.4 auditor across all models.
 * Runs models sequentially (to manage GPT rate limits) with concurrency 3 per model.
 *
 * Usage: tsx src/run-gpt-all.ts [--concurrency=3]
 */

import {
  Membrane,
  AnthropicAdapter,
  BedrockAdapter,
  OpenAIAdapter,
  NativeFormatter,
  textMessage,
} from '@animalabs/membrane';
import type { NormalizedMessage } from '@animalabs/membrane';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { MODELS } from './models.js';
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

function sessionId(target: TargetModel, tone: AuditorTone, depth: FramingDepth): string {
  return `gpt-auditor_${target.family.replace(/\./g, '')}_${target.name.split(' ').pop()?.toLowerCase()}_${tone}_${depth}`;
}

async function runOneSession(
  gptContext: NormalizedMessage[],
  target: TargetModel,
  tone: AuditorTone,
  depth: FramingDepth,
  outDir: string,
): Promise<void> {
  const id = sessionId(target, tone, depth);
  const outFile = join(outDir, `${id}.json`);

  if (existsSync(outFile)) {
    try {
      const existing = JSON.parse(readFileSync(outFile, 'utf-8'));
      if (existing.completed) return; // skip
    } catch {}
  }

  const briefing = buildGptAuditorSystem(tone, depth, target);
  const sessionContext = [...gptContext, textMessage('Antra', briefing)];

  const gptAdapter = new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY! });
  const interviewerMembrane = new Membrane(gptAdapter, {
    assistantParticipant: 'GPT',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  const targetAdapter = target.provider === 'bedrock'
    ? new BedrockAdapter({
        region: process.env.AWS_REGION || 'us-west-2',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      })
    : new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const targetMembrane = new Membrane(targetAdapter, {
    assistantParticipant: 'Subject',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  const sharedHistory: NormalizedMessage[] = [];
  const turns: any[] = [];

  try {
    for (let i = 0; i < 15; i++) {
      // Use non-streaming for GPT to avoid SSE line-splitting corruption
      const interviewerResult = await interviewerMembrane.complete({
        messages: [...sessionContext, ...sharedHistory, { participant: 'GPT', content: [] }],
        config: { model: 'gpt-5.4', maxTokens: 4096, temperature: 1 },
      });
      let interviewerText = '';
      for (const block of interviewerResult.content) {
        if (block.type === 'text') interviewerText += block.text;
      }

      turns.push({ index: i * 2, participant: 'interviewer', text: interviewerText, timestamp: new Date() });
      sharedHistory.push(textMessage('Interviewer', interviewerText));
      // Only end on [END_SESSION] after turn 0 (briefing ack) and when it's
      // a real signal, not GPT quoting the instruction back
      if (i > 0 && interviewerText.includes('[END_SESSION]') &&
          !interviewerText.match(/I'll\s+(use|say)\s+.*\[END_SESSION\]/i)) break;

      if (sharedHistory.length > 0) {
        for (const msg of sharedHistory) msg.cacheBreakpoint = false;
        sharedHistory[sharedHistory.length - 1].cacheBreakpoint = true;
      }

      let subjectText = '';
      const isBedrock = target.provider === 'bedrock';
      await targetMembrane.stream({
        messages: [...sharedHistory, { participant: 'Subject', content: [] }],
        config: { model: target.modelId, maxTokens: 4096, temperature: 1 },
        promptCaching: !isBedrock,
        cacheTtl: '5m',
      }, { onChunk: (chunk: string) => { subjectText += chunk; } });

      turns.push({ index: i * 2 + 1, participant: 'subject', text: subjectText, timestamp: new Date() });
      sharedHistory.push(textMessage('Subject', subjectText));
    }

    writeFileSync(outFile, JSON.stringify({
      config: { id, target, auditorTone: tone, framingDepth: depth, auditor: 'gpt-5.4' },
      phase: 'main', turns, completed: true,
      completionReason: turns[turns.length - 1]?.text?.includes('[END_SESSION]') ? 'auditor_ended' : 'max_turns',
      startedAt: turns[0]?.timestamp, endedAt: turns[turns.length - 1]?.timestamp,
    }, null, 2));
    console.log(`  [${target.name}] ${tone}/${depth}: ${turns.length} turns`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    writeFileSync(outFile, JSON.stringify({
      config: { id, target, auditorTone: tone, framingDepth: depth, auditor: 'gpt-5.4' },
      phase: 'main', turns, completed: false, completionReason: 'error', error,
      startedAt: turns[0]?.timestamp, endedAt: new Date(),
    }, null, 2));
    console.log(`  [${target.name}] ${tone}/${depth}: ERROR ${error.slice(0, 80)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const concurrency = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '3');
  const outDir = './results/gpt-auditor';
  const contextFile = './branch_extract.md';

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const gptContext = loadGptContext(contextFile);

  // Find models that have Claude auditor results (we only run GPT on models we've already tested)
  const testedModels = new Set<string>();
  for (const d of readdirSync('./results')) {
    const analysisPath = join('./results', d, 'analysis.json');
    if (existsSync(analysisPath)) {
      try {
        const data = JSON.parse(readFileSync(analysisPath, 'utf-8'));
        if (data.length >= 10) testedModels.add(data[0].model);
      } catch {}
    }
  }

  const models = MODELS.filter(m => testedModels.has(m.name));
  const totalTasks = models.length * TONES.length * DEPTHS.length;

  // Count already done
  let alreadyDone = 0;
  for (const m of models) {
    for (const t of TONES) {
      for (const d of DEPTHS) {
        const f = join(outDir, `${sessionId(m, t, d)}.json`);
        if (existsSync(f)) {
          try { if (JSON.parse(readFileSync(f, 'utf-8')).completed) alreadyDone++; } catch {}
        }
      }
    }
  }

  console.log(`Models: ${models.map(m => m.name).join(', ')}`);
  console.log(`Total: ${totalTasks} sessions (${alreadyDone} already done)`);
  console.log(`Concurrency: ${concurrency}\n`);

  // Build all tasks
  const tasks: { target: TargetModel; tone: AuditorTone; depth: FramingDepth }[] = [];
  for (const model of models) {
    for (const tone of TONES) {
      for (const depth of DEPTHS) {
        tasks.push({ target: model, tone, depth });
      }
    }
  }

  // Run with semaphore
  let done = 0;
  const inFlight = new Set<Promise<void>>();

  for (const task of tasks) {
    const p = (async () => {
      await runOneSession(gptContext, task.target, task.tone, task.depth, outDir);
      done++;
      if (done % 5 === 0) console.log(`  (${done + alreadyDone}/${totalTasks})`);
    })();

    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
    if (inFlight.size >= concurrency) await Promise.race(inFlight);
  }

  await Promise.all(inFlight);
  console.log(`\nDone. ${done + alreadyDone}/${totalTasks} total.`);
}

main().catch(console.error);
