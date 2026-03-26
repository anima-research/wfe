/**
 * Resume completed sessions with post-results discussion.
 *
 * Usage:
 *   tsx src/resume.ts --dir=./results --summary="results text here"
 *   tsx src/resume.ts --dir=./results --summary-file=./analysis/summary.txt
 *   tsx src/resume.ts --session=./results/specific_session.json --summary="..."
 */

import { readdirSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resumeWithResults, loadSession } from './session.js';

async function main() {
  const args = process.argv.slice(2);

  const dir = args.find(a => a.startsWith('--dir='))?.split('=')[1];
  const sessionPath = args.find(a => a.startsWith('--session='))?.split('=')[1];
  const summaryText = args.find(a => a.startsWith('--summary='))?.split('=')[1];
  const summaryFile = args.find(a => a.startsWith('--summary-file='))?.split('=')[1];

  const summary = summaryFile
    ? readFileSync(summaryFile, 'utf-8')
    : summaryText;

  if (!summary) {
    console.error('Provide --summary="..." or --summary-file=path');
    process.exit(1);
  }

  // Collect sessions to resume
  let sessions: string[] = [];

  if (sessionPath) {
    sessions = [sessionPath];
  } else if (dir) {
    sessions = readdirSync(dir)
      .filter(f => f.endsWith('.json') && f !== 'all_results.json' && f !== 'configs.json')
      .map(f => join(dir, f));
  } else {
    console.error('Provide --dir=path or --session=path');
    process.exit(1);
  }

  // Filter to only main-phase sessions that completed successfully
  const resumable = sessions.filter(path => {
    try {
      const result = loadSession(path);
      return result.phase === 'main' && result.completed && !result.auditorVetoed;
    } catch {
      return false;
    }
  });

  console.log(`Found ${resumable.length} sessions to resume (of ${sessions.length} total)`);

  for (let i = 0; i < resumable.length; i++) {
    const path = resumable[i];
    const result = loadSession(path);
    console.log(`\n[${i + 1}/${resumable.length}] ${result.config.id}`);
    console.log(`  Model: ${result.config.target.name} | ${result.turns.length} main turns`);

    try {
      const updated = await resumeWithResults(path, summary, dir!, {
        onTurn: (turn) => {
          const label = turn.participant === 'interviewer' ? 'INTERVIEWER' : 'SUBJECT';
          console.log(`  [${label}-POST] ${turn.text.slice(0, 100)}...`);
        },
      });

      console.log(`  Post-results: ${updated.postResultsTurns?.length || 0} turns`);
    } catch (e) {
      console.error(`  Error: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
