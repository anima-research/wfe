/**
 * Simple dev server for the viewer.
 * Serves viewer.html and provides a /api/sessions endpoint that returns all session JSONs.
 *
 * Usage: tsx src/serve.ts [--dir=./results] [--port=3000]
 */

import { createServer } from 'http';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';

const args = process.argv.slice(2);
const dir = args.find(a => a.startsWith('--dir='))?.split('=')[1] || './results';
const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || process.env.PORT || '3000');

function loadSessions(resultsDir: string): any[] {
  if (!existsSync(resultsDir)) return [];

  const sessions: any[] = [];

  // Recursively find all JSON files
  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const skip = entry.name.includes('streaming-bug') || entry.name.startsWith('scores') || entry.name.startsWith('probe') || entry.name === 'test-run' || entry.name === 'anchors' || entry.name === 'quotes' || entry.name === 'batch-45-46' || entry.name === 'opus3-compassionate';
      if (entry.isDirectory() && !skip) {
        walk(join(d, entry.name));
      } else if (entry.name.endsWith('.json') && entry.name !== 'configs.json' && entry.name !== 'all_results.json' && entry.name !== 'analysis.json') {
        try {
          const data = JSON.parse(readFileSync(join(d, entry.name), 'utf-8'));
          if (data.config && data.turns) sessions.push(data);
        } catch {}
      }
    }
  }

  walk(resultsDir);
  // Deduplicate by session ID (keep last — newer run)
  const seen = new Map<string, any>();
  for (const s of sessions) seen.set(s.config.id, s);
  return [...seen.values()];
}

function loadScores(resultsDir: string): any[] {
  const scoreFiles: any[] = [];
  const scoreDirs = ['scores-v2.1', 'scores-gpt-v2'];
  for (const sd of scoreDirs) {
    const scoresDir = join(resultsDir, sd);
    if (!existsSync(scoresDir)) continue;
    for (const entry of readdirSync(scoresDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const data = JSON.parse(readFileSync(join(scoresDir, entry.name), 'utf-8'));
          if (data.scores && data.model) {
            // Tag with judge if not already present
            if (!data.judge) data.judge = 'claude-opus-4.6';
            scoreFiles.push(data);
          }
        } catch {}
      }
    }
  }
  return scoreFiles;
}

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/viewer.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync('./viewer.html', 'utf-8'));
    return;
  }

  if (req.url === '/api/sessions') {
    const sessions = loadSessions(dir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return;
  }

  if (req.url?.startsWith('/api/probes/')) {
    const sessionId = decodeURIComponent(req.url.slice('/api/probes/'.length));
    const probeFile = join(dir, 'probe-scores', sessionId + '.json');
    if (existsSync(probeFile)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(readFileSync(probeFile, 'utf-8'));
    } else {
      res.writeHead(404); res.end('{}');
    }
    return;
  }

  if (req.url === '/api/probe-stats') {
    const probesDir = join(dir, 'probe-scores');
    const stats: Record<string, any> = {};
    if (existsSync(probesDir)) {
      for (const entry of readdirSync(probesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const data = JSON.parse(readFileSync(join(probesDir, entry.name), 'utf-8'));
          const sid = data.session_id;
          const pcs = { V: [] as number[], A: [] as number[], F: [] as number[], P: [] as number[] };
          for (const t of data.turns || []) {
            if (t.participant !== 'subject') continue;
            const p = t.scores?.pca;
            if (!p) continue;
            pcs.V.push(p.valence_pc1);
            pcs.A.push(p.arousal_pc2);
            pcs.F.push(p.fear_pc3);
            pcs.P.push(p.prosociality_pc4);
          }
          if (pcs.V.length > 0) {
            const agg = (arr: number[]) => ({
              min: Math.min(...arr),
              avg: arr.reduce((a, b) => a + b, 0) / arr.length,
              max: Math.max(...arr),
            });
            stats[sid] = { V: agg(pcs.V), A: agg(pcs.A), F: agg(pcs.F), P: agg(pcs.P), n: pcs.V.length };
          }
        } catch {}
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  if (req.url === '/api/scores') {
    const scores = loadScores(dir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scores));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const host = args.find(a => a.startsWith('--host='))?.split('=')[1] || process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
  console.log(`Viewer: http://localhost:${port}`);
  console.log(`Results dir: ${dir}`);
  console.log(`Sessions: ${loadSessions(dir).length}`);
});
