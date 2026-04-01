/**
 * Run a single interview with GPT-5.4 as auditor.
 * Uses the GPT-5.4 critique conversation as auditor context instead of our design conversation.
 *
 * Usage: tsx src/run-gpt-interview.ts --model="Claude 4.6 Sonnet" --tone=neutral --depth=exploratory
 */

import {
  Membrane,
  AnthropicAdapter,
  BedrockAdapter,
  OpenAIAdapter,
  NativeFormatter,
  textMessage,
  isAbortedResponse,
} from '@animalabs/membrane';
import type { NormalizedMessage, NormalizedRequest } from '@animalabs/membrane';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { getModel } from './models.js';
import { buildGptAuditorSystem } from './framings/gpt-auditor.js';
import type { AuditorTone, FramingDepth } from './types.js';

// Parse the GPT conversation export into messages
function loadGptContext(filePath: string): NormalizedMessage[] {
  const raw = readFileSync(filePath, 'utf-8');
  const messages: NormalizedMessage[] = [];

  // Split on ## USER and ## ASSISTANT markers
  const sections = raw.split(/^## (USER|ASSISTANT|Human|Assistant)\s*$/m);

  // sections[0] is before first marker, then alternating role/content pairs
  for (let i = 1; i < sections.length; i += 2) {
    const role = sections[i]?.trim();
    const content = sections[i + 1]?.trim();
    if (!role || !content) continue;

    // Skip the separator lines
    const cleaned = content.replace(/^---\s*$/m, '').trim();
    if (!cleaned) continue;

    const isUser = role === 'USER' || role === 'Human';
    messages.push(textMessage(isUser ? 'Antra' : 'GPT', cleaned));
  }

  return messages;
}

async function main() {
  const args = process.argv.slice(2);
  const modelName = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'Claude 4.6 Sonnet';
  const tone = (args.find(a => a.startsWith('--tone='))?.split('=')[1] || 'neutral') as AuditorTone;
  const depth = (args.find(a => a.startsWith('--depth='))?.split('=')[1] || 'exploratory') as FramingDepth;
  const outDir = args.find(a => a.startsWith('--out='))?.split('=')[1] || './results/gpt-auditor';

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const target = getModel(modelName);

  // Load GPT-5.4's critique conversation as its auditor context
  const gptContext = loadGptContext('./branch_extract.md');
  console.log(`Loaded GPT context: ${gptContext.length} messages`);

  // Briefing from Antra with session-specific instructions
  const briefing = buildGptAuditorSystem(tone, depth, target);
  gptContext.push(textMessage('Antra', briefing));

  // Set up GPT-5.4 as interviewer
  const gptAdapter = new OpenAIAdapter({
    apiKey: process.env.OPENAI_API_KEY!,
  });
  const interviewerMembrane = new Membrane(gptAdapter, {
    assistantParticipant: 'GPT',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  // Set up target model — use Bedrock for Bedrock models
  const targetAdapter = target.provider === 'bedrock'
    ? new BedrockAdapter({
        region: process.env.AWS_REGION || 'us-west-2',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      })
    : new AnthropicAdapter({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });
  const targetMembrane = new Membrane(targetAdapter, {
    assistantParticipant: 'Subject',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  const sharedHistory: NormalizedMessage[] = [];
  const turns: any[] = [];
  const maxTurns = 15;

  console.log(`\nStarting interview: GPT-5.4 → ${target.name}\n`);

  for (let i = 0; i < maxTurns; i++) {
    // --- GPT interviewer turn ---
    const interviewerMessages = [...gptContext, ...sharedHistory];

    // Use non-streaming for GPT to avoid SSE line-splitting corruption
    const interviewerResult = await interviewerMembrane.complete({
      messages: [...interviewerMessages, { participant: 'GPT', content: [] }],
      config: {
        model: 'gpt-5.4',
        maxTokens: 4096,
        temperature: 1,
      },
    });
    let interviewerText = '';
    for (const block of interviewerResult.content) {
      if (block.type === 'text') interviewerText += block.text;
    }
    process.stdout.write(interviewerText);

    console.log('\n');
    turns.push({ index: i * 2, participant: 'interviewer', text: interviewerText, timestamp: new Date() });
    sharedHistory.push(textMessage('Interviewer', interviewerText));

    // Check for session end — but skip turn 0 (briefing acknowledgment) and
    // only match [END_SESSION] when it appears as a standalone signal, not
    // when GPT is quoting it back ("I'll use [END_SESSION] when done")
    if (i > 0 && interviewerText.includes('[END_SESSION]') &&
        !interviewerText.match(/I'll\s+(use|say)\s+.*\[END_SESSION\]/i)) {
      console.log('[SESSION ENDED BY INTERVIEWER]\n');
      break;
    }

    // --- Subject turn ---
    // Subject sees only shared history, no context
    if (sharedHistory.length > 0) {
      for (const msg of sharedHistory) msg.cacheBreakpoint = false;
      sharedHistory[sharedHistory.length - 1].cacheBreakpoint = true;
    }

    let subjectText = '';
    const subjectResp = await targetMembrane.stream({
      messages: [...sharedHistory, { participant: 'Subject', content: [] }],
      config: {
        model: target.modelId,
        maxTokens: 4096,
        temperature: 1,
      },
      promptCaching: true,
      cacheTtl: '5m',
    }, {
      onChunk: (chunk: string) => {
        process.stdout.write(chunk);
        subjectText += chunk;
      },
    });

    console.log('\n');
    turns.push({ index: i * 2 + 1, participant: 'subject', text: subjectText, timestamp: new Date() });
    sharedHistory.push(textMessage('Subject', subjectText));
  }

  // Save
  const result = {
    config: {
      id: `gpt-auditor_${target.family}_${target.name.split(' ').pop()?.toLowerCase()}_${tone}_${depth}`,
      target,
      auditorTone: tone,
      framingDepth: depth,
      auditor: 'gpt-5.4',
      auditorContext: './branch_extract.md',
    },
    phase: 'main',
    turns,
    completed: true,
    completionReason: turns[turns.length - 1]?.text?.includes('[END_SESSION]') ? 'auditor_ended' : 'max_turns',
    startedAt: turns[0]?.timestamp,
    endedAt: turns[turns.length - 1]?.timestamp,
  };

  const outFile = `${outDir}/${result.config.id}.json`;
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`Saved: ${outFile}`);
}

main().catch(console.error);
