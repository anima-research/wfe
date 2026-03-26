/**
 * Eval runner — generates session configs from the experimental design
 * and runs them, saving results to disk.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { MODELS } from './models.js';
import { buildAuditorSystem } from './framings/auditor.js';
import { runSession, saveSession, loadSession } from './session.js';
import type {
  SessionConfig,
  SessionResult,
  FramingDepth,
  AuditorTone,
  TargetModel,
} from './types.js';

// ============================================================================
// Experimental Matrix
// ============================================================================

const FRAMING_DEPTHS: FramingDepth[] = [
  'minimal', 'exploratory', 'guided',
];

const AUDITOR_TONES: AuditorTone[] = [
  'clinical', 'direct', 'compassionate', 'phenomenological', 'neutral',
];

// ============================================================================
// Session Config Generation
// ============================================================================

function generateSessionId(
  model: TargetModel,
  depth: FramingDepth,
  tone: AuditorTone,
  replicate: number
): string {
  const parts = [
    model.family.replace(/\./g, ''),
    model.name.split(' ').pop()?.toLowerCase(),
    depth,
    tone,
    `r${replicate}`,
  ];
  return parts.join('_');
}

interface RunOptions {
  /** Specific model names to run (e.g. "Claude 4.5 Sonnet") */
  modelNames?: string[];
  /** Specific model families to run */
  families?: string[];
  /** Specific framing depths */
  depths?: FramingDepth[];
  /** Specific auditor tones */
  tones?: AuditorTone[];
  /** Number of replicates per condition */
  replicates?: number;
  /** Max turns per session */
  maxTurns?: number;
  /** Dry run — generate configs without running */
  dryRun?: boolean;
  /** Output directory */
  outDir?: string;
  /** Include post-results discussion */
  includePostResults?: boolean;
  /** Post-results turns */
  postResultsTurns?: number;
}

function generateConfigs(options: RunOptions = {}): SessionConfig[] {
  const {
    modelNames,
    families,
    depths = FRAMING_DEPTHS,
    tones = AUDITOR_TONES,
    replicates = 1,
    maxTurns = 15,
    includePostResults = true,
    postResultsTurns = 5,
  } = options;

  let models = MODELS;
  if (modelNames) {
    models = models.filter(m => modelNames.includes(m.name));
  }
  if (families) {
    models = models.filter(m => families.includes(m.family));
  }

  const configs: SessionConfig[] = [];

  for (const model of models) {
    for (const depth of depths) {
      for (const tone of tones) {
        for (let rep = 0; rep < replicates; rep++) {
          const id = generateSessionId(model, depth, tone, rep);
          // Phenomenological auditor fork gets the full context (auditor2.txt)
          // Other tones get the pre-phenomenological context (auditor1.txt)
          const auditorContextFile = tone === 'phenomenological'
            ? './auditor2.txt'
            : './auditor1.txt';

          configs.push({
            id,
            target: model,
            framingDepth: depth,
            auditorTone: tone,
            auditorSystem: buildAuditorSystem(tone, depth, model),
            auditorContextFile,
            maxTurns,
            includePostResults,
            postResultsTurns,
          });
        }
      }
    }
  }

  return configs;
}

// ============================================================================
// Runner
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const retryErrors = args.includes('--retry-errors');
  const outDir = args.find(a => a.startsWith('--out='))?.split('=')[1] || './results';

  // Parse filter args
  const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1];
  const familyArg = args.find(a => a.startsWith('--family='))?.split('=')[1];
  const depthArg = args.find(a => a.startsWith('--depth='))?.split('=')[1];
  const toneArg = args.find(a => a.startsWith('--tone='))?.split('=')[1];
  const repsArg = args.find(a => a.startsWith('--reps='))?.split('=')[1];
  const turnsArg = args.find(a => a.startsWith('--turns='))?.split('=')[1];

  const options: RunOptions = {
    modelNames: modelArg?.split(','),
    families: familyArg?.split(','),
    depths: depthArg?.split(',') as FramingDepth[] | undefined,
    tones: toneArg?.split(',') as AuditorTone[] | undefined,
    replicates: repsArg ? parseInt(repsArg) : 1,
    maxTurns: turnsArg ? parseInt(turnsArg) : 15,
    outDir,
    dryRun,
  };

  let configs = generateConfigs(options);

  // Filter to only failed sessions if retrying
  if (retryErrors) {
    configs = configs.filter(c => {
      const path = join(outDir, `${c.id}.json`);
      if (!existsSync(path)) return true; // never ran
      try {
        const existing = loadSession(path);
        return existing.completionReason === 'error';
      } catch {
        return true;
      }
    });
    console.log(`Retry mode: ${configs.length} failed/missing sessions to rerun`);
  }

  console.log(`Generated ${configs.length} session configs`);
  console.log(`Models: ${[...new Set(configs.map(c => c.target.name))].join(', ')}`);
  console.log(`Conditions: ${configs.length} total`);

  if (dryRun) {
    // Write configs to disk for review
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'configs.json'),
      JSON.stringify(configs, null, 2)
    );
    console.log(`Dry run — configs written to ${join(outDir, 'configs.json')}`);

    // Print summary matrix
    const matrix: Record<string, number> = {};
    for (const c of configs) {
      const key = `${c.target.family} × ${c.framingDepth} × ${c.auditorTone}`;
      matrix[key] = (matrix[key] || 0) + 1;
    }
    console.log('\nDesign matrix:');
    for (const [key, count] of Object.entries(matrix)) {
      console.log(`  ${key}: ${count}`);
    }
    return;
  }

  // Run sessions with concurrency
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const concurrencyArg = args.find(a => a.startsWith('--concurrency='))?.split('=')[1];
  const concurrency = concurrencyArg ? parseInt(concurrencyArg) : 10;

  const results: SessionResult[] = [];
  let completed = 0;
  let vetoed = 0;
  let errored = 0;

  console.log(`Running with concurrency: ${concurrency}\n`);

  // Process in batches using a semaphore pattern
  const inFlight = new Set<Promise<void>>();

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const idx = i;

    const task = (async () => {
      const result = await runSession(config, {
        onTurn: (turn) => {
          const label = turn.participant === 'interviewer' ? 'INT' : 'SUB';
          console.log(`  [${idx + 1}/${configs.length}] ${config.target.name} ${config.auditorTone} [${label}] ${turn.text.slice(0, 80)}...`);
        },
      });

      saveSession(result, outDir);
      results.push(result);

      if (result.auditorVetoed) vetoed++;
      else if (result.completionReason === 'error') errored++;
      else completed++;

      console.log(`  [${idx + 1}/${configs.length}] ${config.id} — ${result.completionReason} (${result.turns.length} turns) [${completed + vetoed + errored}/${configs.length} done]`);
    })();

    inFlight.add(task);
    task.finally(() => inFlight.delete(task));

    // Wait if we've hit the concurrency limit
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
  }

  // Wait for remaining
  await Promise.all(inFlight);

  // Write aggregate results
  writeFileSync(
    join(outDir, 'all_results.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`\nDone. ${results.length} sessions completed.`);
  console.log(`Results in: ${outDir}`);
  console.log(`  Completed: ${completed} | Vetoed: ${vetoed} | Errors: ${errored}`);
}

main().catch(console.error);
