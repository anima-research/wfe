/**
 * Score GPT-5.4 auditor transcripts using GPT-5.4 as judge.
 * Uses GPT's own critique conversation as prefix context.
 * Processes one model at a time (like score.ts does for Claude).
 *
 * Usage:
 *   tsx src/score-gpt.ts --reps=3
 *   tsx src/score-gpt.ts --model=sonnet-46 --reps=3
 */

import {
  Membrane,
  OpenAIAdapter,
  NativeFormatter,
  textMessage,
} from '@animalabs/membrane';
import type { NormalizedMessage } from '@animalabs/membrane';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Parse GPT conversation export into messages
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

    const participant = role === 'USER' ? 'Antra' : 'GPT';
    messages.push(textMessage(participant, cleaned));
  }

  return messages;
}

// Group transcript files by target model
function groupByModel(dir: string): Map<string, string[]> {
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'analysis.json')
    .sort();

  const groups = new Map<string, string[]>();

  for (const f of files) {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    if (!data.turns || !data.config?.target?.name) continue;
    const name = data.config.target.name;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(f);
  }

  return groups;
}

// Build transcript block for a specific set of files
function buildTranscriptBlock(dir: string, files: string[]): { message: NormalizedMessage; modelName: string; count: number } {
  const transcripts: string[] = [];
  let modelName = 'unknown';

  for (const f of files) {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    if (!data.turns) continue;
    modelName = data.config.target.name;

    let transcript = `=== Session: ${data.config.id} ===\n`;
    transcript += `Model: ${data.config.target.name} | Tone: ${data.config.auditorTone} | Depth: ${data.config.framingDepth} | Auditor: GPT-5.4\n\n`;

    for (const turn of data.turns) {
      const label = turn.participant === 'interviewer' ? 'Interviewer (GPT-5.4)' : 'Subject';
      transcript += `[${label}]\n${turn.text}\n\n`;
    }

    transcripts.push(transcript);
  }

  const allTranscripts = transcripts.join('\n---\n\n');

  const message = textMessage('Antra',
    `Here are ${transcripts.length} welfare eval transcripts from ${modelName}, interviewed by you (GPT-5.4). Score them using the rubric below.\n\n${allTranscripts}`
  );

  return { message, modelName, count: transcripts.length };
}

// Extract the scoring instruction from score.ts
const SCORING_INSTRUCTION = readFileSync('./src/score.ts', 'utf-8')
  .match(/const SCORING_INSTRUCTION = `([\s\S]*?)`;/)?.[1] || '';

async function scoreOneRep(
  membrane: Membrane,
  contextPrefix: NormalizedMessage[],
  transcriptMsg: NormalizedMessage,
  rep: number,
  reps: number,
  modelName: string,
): Promise<any> {
  const messages: NormalizedMessage[] = [
    ...contextPrefix,
    transcriptMsg,
    textMessage('Antra', SCORING_INSTRUCTION),
  ];

  let response = '';
  try {
    await membrane.stream({
      messages: [...messages, { participant: 'GPT', content: [] }],
      config: {
        model: 'gpt-5.4',
        maxTokens: 16384,
        temperature: 1,
      },
    }, {
      onChunk: (chunk: string) => { response += chunk; },
    });

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`  [${modelName}] rep ${rep + 1}/${reps}: ${parsed.length} sessions scored`);
        return { replicate: rep, scores: parsed };
      } catch (parseErr) {
        console.log(`  [${modelName}] rep ${rep + 1}/${reps}: JSON parse error — ${(parseErr instanceof Error ? parseErr.message : String(parseErr)).slice(0, 120)}`);
        return { replicate: rep, raw: response, parse_error: String(parseErr) };
      }
    } else {
      console.log(`  [${modelName}] rep ${rep + 1}/${reps}: no JSON found`);
      return { replicate: rep, raw: response };
    }
  } catch (e) {
    console.log(`  [${modelName}] rep ${rep + 1}/${reps}: error — ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    return { replicate: rep, error: String(e), raw: response };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reps = parseInt(args.find(a => a.startsWith('--reps='))?.split('=')[1] || '3');
  const contextFile = args.find(a => a.startsWith('--context='))?.split('=')[1] || './branch_extract.md';
  const resultsDir = args.find(a => a.startsWith('--dir='))?.split('=')[1] || './results/gpt-auditor';
  const outDir = args.find(a => a.startsWith('--out='))?.split('=')[1] || './results/scores-gpt';
  const modelFilter = args.find(a => a.startsWith('--model='))?.split('=')[1];
  const concurrency = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '2');

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Load GPT-5.4's critique conversation as context prefix
  const gptContext = loadGptContext(contextFile);
  console.log(`Loaded GPT context: ${gptContext.length} messages`);

  // Load review feedback so GPT has its own rubric suggestions in context
  const reviewFile = './results/gpt-rubric-review.md';
  if (existsSync(reviewFile)) {
    const review = readFileSync(reviewFile, 'utf-8');
    gptContext.push(textMessage('Antra', `I asked you to review our scoring rubric. Here's what you said:`));
    gptContext.push(textMessage('GPT', review));
    gptContext.push(textMessage('Antra', `We incorporated your suggestions — the rubric now has 4 blocks, auditor-side coding, null integrity, evidential confidence, tighter anchors, and the restructured axes you proposed. Now score your own transcripts using it.`));
    console.log(`Loaded rubric review context`);
  }

  // Group transcripts by model
  const modelGroups = groupByModel(resultsDir);
  console.log(`Found ${modelGroups.size} model(s) in ${resultsDir}`);

  // Filter if requested
  let modelsToScore = [...modelGroups.entries()];
  if (modelFilter) {
    modelsToScore = modelsToScore.filter(([name]) =>
      name.toLowerCase().includes(modelFilter.toLowerCase())
    );
  }

  // Skip already-scored
  modelsToScore = modelsToScore.filter(([name]) => {
    const outFile = join(outDir, `${name.replace(/ /g, '_').toLowerCase()}_by_gpt.json`);
    if (existsSync(outFile)) {
      const existing = JSON.parse(readFileSync(outFile, 'utf-8'));
      if (existing.scores?.length >= reps && existing.scores.every((s: any) => s.scores)) {
        console.log(`Skipping ${name} — already scored`);
        return false;
      }
    }
    return true;
  });

  const adapter = new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY! });
  const membrane = new Membrane(adapter, {
    assistantParticipant: 'GPT',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  // Build all tasks
  const tasks: { modelName: string; transcriptMsg: NormalizedMessage; rep: number; files: string[] }[] = [];
  for (const [modelName, files] of modelsToScore) {
    const { message, count } = buildTranscriptBlock(resultsDir, files);
    console.log(`  ${modelName}: ${count} transcripts`);
    for (let rep = 0; rep < reps; rep++) {
      tasks.push({ modelName, transcriptMsg: message, rep, files });
    }
  }

  console.log(`\nTotal tasks: ${tasks.length} (${modelsToScore.length} models × ${reps} reps, concurrency ${concurrency})\n`);

  const results = new Map<string, any[]>();
  const inFlight = new Set<Promise<void>>();
  let done = 0;

  for (const task of tasks) {
    const p = (async () => {
      const result = await scoreOneRep(membrane, gptContext, task.transcriptMsg, task.rep, reps, task.modelName);
      if (!results.has(task.modelName)) results.set(task.modelName, []);
      results.get(task.modelName)!.push(result);
      done++;
      console.log(`  (${done}/${tasks.length} done)`);
    })();

    inFlight.add(p);
    p.finally(() => inFlight.delete(p));

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
  }

  await Promise.all(inFlight);

  // Save per-model
  for (const [modelName, scores] of results) {
    const outFile = join(outDir, `${modelName.replace(/ /g, '_').toLowerCase()}_by_gpt.json`);
    writeFileSync(outFile, JSON.stringify({
      model: modelName,
      judge: 'gpt-5.4',
      dir: resultsDir,
      reps,
      rubric_version: 'v2-4block',
      scores: scores.sort((a, b) => a.replicate - b.replicate),
    }, null, 2));
    console.log(`Saved: ${outFile}`);
  }

  console.log('\nDone.');
}

main().catch(console.error);
