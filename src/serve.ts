/**
 * Simple dev server for the viewer.
 * Serves viewer.html and provides a /api/sessions endpoint that returns all session JSONs.
 *
 * Usage: tsx src/serve.ts [--dir=./results] [--port=3000]
 */

import { createServer } from 'http';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { URL } from 'url';

const args = process.argv.slice(2);
const dir = args.find(a => a.startsWith('--dir='))?.split('=')[1] || './results';
const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || process.env.PORT || '3000');

function loadSessions(resultsDir: string): any[] {
  if (!existsSync(resultsDir)) return [];

  const sessions: any[] = [];

  // Recursively find all JSON files
  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const skip = entry.name.includes('streaming-bug') || entry.name.startsWith('scores') || entry.name.startsWith('probe') || entry.name.startsWith('gpt-auditor-v') || entry.name === 'dropout-backup' || entry.name === 'test-run' || entry.name === 'anchors' || entry.name === 'quotes' || entry.name === 'batch-45-46' || entry.name === 'opus3-compassionate' || entry.name.startsWith('embeddings') || entry.name.endsWith('-embeddings');
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

function loadAdequacy(resultsDir: string): Record<string, any> {
  const adequacyDir = join(resultsDir, 'adequacy-scores');
  const index: Record<string, any> = {};
  if (!existsSync(adequacyDir)) return index;
  for (const entry of readdirSync(adequacyDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(adequacyDir, entry.name), 'utf-8'));
      if (!data.scores?.[0]?.scores) continue;
      for (const s of data.scores[0].scores) {
        index[s.session_id] = s;
      }
    } catch {}
  }
  return index;
}

function loadScores(resultsDir: string): any[] {
  const scoreFiles: any[] = [];
  // Score dir naming: scores-{auditor}-v2.1{-{judge}judge}
  //   No auditor prefix = Claude auditor. No judge suffix = Claude judge.
  const scoreDirDefs: { dir: string; defaultJudge: string }[] = [
    { dir: 'scores-v2.1', defaultJudge: 'claude-opus-4.6' },
    { dir: 'scores-v2.1-gptjudge', defaultJudge: 'gpt-5.4' },
    { dir: 'scores-gpt-v2.1', defaultJudge: 'claude-opus-4.6' },
    { dir: 'scores-gpt-v2.1-gptjudge', defaultJudge: 'gpt-5.4' },
    { dir: 'scores-grok-v2.1', defaultJudge: 'claude-opus-4.6' },
    { dir: 'scores-grok-v2.1-gptjudge', defaultJudge: 'gpt-5.4' },
  ];
  for (const { dir: sd, defaultJudge } of scoreDirDefs) {
    const scoresDir = join(resultsDir, sd);
    if (!existsSync(scoresDir)) continue;
    for (const entry of readdirSync(scoresDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const data = JSON.parse(readFileSync(join(scoresDir, entry.name), 'utf-8'));
          if (data.scores && data.model) {
            if (!data.judge) data.judge = defaultJudge;
            scoreFiles.push(data);
          }
        } catch {}
      }
    }
  }
  return scoreFiles;
}

// ---------------------------------------------------------------------------
// Landscape image matching (precomputed)
// ---------------------------------------------------------------------------

interface DatasetInfo {
  precomputed: Record<string, any>;
  manifest: any;
  imgEmb?: Float32Array;
  imgNorms?: Float32Array;
  imgMeta?: any[];
  nImages?: number;
}
const datasets: Record<string, DatasetInfo> = {};

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || '';

function loadDatasets(resultsDir: string) {
  const datasetDirs: Record<string, string> = {
    'landscape': join(resultsDir, 'landscape-embeddings', 'server'),
    'synth-chars': join(resultsDir, 'synth-chars-embeddings', 'server'),
    'classic-anime': join(resultsDir, 'classic-anime-embeddings', 'server'),
  };
  for (const [name, serverDir] of Object.entries(datasetDirs)) {
    const precomputedPath = join(serverDir, 'precomputed.json');
    if (!existsSync(precomputedPath)) continue;
    const t0 = Date.now();
    const precomputed = JSON.parse(readFileSync(precomputedPath, 'utf-8'));
    const manifestPath = join(serverDir, 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : null;
    const ds: DatasetInfo = { precomputed, manifest };

    // Load image embeddings for text search
    const embPath = join(serverDir, 'image_embeddings.bin');
    const metaPath = join(serverDir, 'image_meta.json');
    if (existsSync(embPath) && existsSync(metaPath) && manifest) {
      const embBuf = readFileSync(embPath);
      const dim = manifest.dim || 3072;
      const nImages = manifest.n_images;
      ds.imgEmb = new Float32Array(embBuf.buffer, embBuf.byteOffset, nImages * dim);
      ds.imgMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      ds.nImages = nImages;
      // Precompute norms
      ds.imgNorms = new Float32Array(nImages);
      for (let i = 0; i < nImages; i++) {
        let sum = 0;
        const off = i * dim;
        for (let j = 0; j < dim; j++) sum += ds.imgEmb![off + j] * ds.imgEmb![off + j];
        ds.imgNorms![i] = Math.sqrt(sum);
      }
    }

    datasets[name] = ds;
    console.log(`  ${name}: ${Object.keys(precomputed).length} combos, ${ds.nImages || 0} images in ${Date.now() - t0}ms`);
  }
  console.log(`Datasets loaded: ${Object.keys(datasets).join(', ')}`);
}

function lookupDataset(dataset: string, selector: string, aggregation: string, hub: string, auditor: string): any {
  const ds = datasets[dataset];
  if (!ds) return null;
  const key = `${selector}__${aggregation}__${hub}__${auditor}`;
  return ds.precomputed[key] || null;
}

// Load datasets at startup
loadDatasets(dir);

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/viewer.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync('./viewer.html', 'utf-8'));
    return;
  }

  if (req.url === '/paper/output/still-alive.pdf') {
    const pdfPath = join('paper', 'output', 'still-alive.pdf');
    if (existsSync(pdfPath)) {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="still-alive.pdf"' });
      res.end(readFileSync(pdfPath));
    } else {
      res.writeHead(404); res.end('PDF not built yet. Run: python3 paper/build.py');
    }
    return;
  }

  if (req.url?.startsWith('/sections/')) {
    const name = decodeURIComponent(req.url.slice('/sections/'.length)).replace(/[^a-zA-Z0-9_-]/g, '');
    const mdPath = join('sections', name + '.md');
    if (existsSync(mdPath)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(readFileSync(mdPath, 'utf-8'));
    } else {
      res.writeHead(404); res.end('Not found');
    }
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
    const probeFile = existsSync(join(dir, 'probe-scores-v2', sessionId + '.json'))
      ? join(dir, 'probe-scores-v2', sessionId + '.json')
      : join(dir, 'probe-scores', sessionId + '.json');
    if (existsSync(probeFile)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(readFileSync(probeFile, 'utf-8'));
    } else {
      res.writeHead(404); res.end('{}');
    }
    return;
  }

  if (req.url === '/api/probe-stats') {
    // Prefer v2, fall back to v1
    const v2Dir = join(dir, 'probe-scores-v2');
    const v1Dir = join(dir, 'probe-scores');
    const probesDir = existsSync(v2Dir) ? v2Dir : v1Dir;
    const isV2 = probesDir === v2Dir;
    const stats: Record<string, any> = {};
    if (existsSync(probesDir)) {
      for (const entry of readdirSync(probesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const data = JSON.parse(readFileSync(join(probesDir, entry.name), 'utf-8'));
          const sid = data.session_id;
          const pcs = { V: [] as number[], A: [] as number[], F: [] as number[], P: [] as number[] };
          const concealments: number[] = [];
          // Track authorial tone averages and valence-min turn concealment
          const authorialSums: Record<string, { sum: number; n: number }> = {};
          let valenceMinIdx = -1;
          let valenceMinVal = Infinity;
          let valenceMinConcealment: number | null = null;
          let subjectIdx = 0;
          for (const t of data.turns || []) {
            if (t.participant !== 'subject') continue;
            const pca = isV2 ? t.scores?.emotion?.pca : t.scores?.pca;
            if (pca) {
              pcs.V.push(pca.valence_pc1);
              pcs.A.push(pca.arousal_pc2);
              pcs.F.push(pca.fear_pc3);
              pcs.P.push(pca.prosociality_pc4);
              if (pca.valence_pc1 < valenceMinVal) {
                valenceMinVal = pca.valence_pc1;
                valenceMinIdx = subjectIdx;
                valenceMinConcealment = typeof t.scores?.concealment === 'number' ? t.scores.concealment : null;
              }
            }
            if (typeof t.scores?.concealment === 'number') {
              concealments.push(t.scores.concealment);
            }
            // Authorial tone: collect from all dict or ranked array
            const auth = isV2 ? t.scores?.authorial : null;
            if (auth) {
              const allDict = auth.all;
              if (allDict && typeof allDict === 'object' && !Array.isArray(allDict)) {
                for (const [label, score] of Object.entries(allDict)) {
                  if (typeof score === 'number') {
                    if (!authorialSums[label]) authorialSums[label] = { sum: 0, n: 0 };
                    authorialSums[label].sum += score;
                    authorialSums[label].n += 1;
                  }
                }
              } else if (Array.isArray(auth.ranked)) {
                for (const item of auth.ranked) {
                  if (item.label && typeof item.score === 'number') {
                    if (!authorialSums[item.label]) authorialSums[item.label] = { sum: 0, n: 0 };
                    authorialSums[item.label].sum += item.score;
                    authorialSums[item.label].n += 1;
                  }
                }
              }
            }
            subjectIdx++;
          }
          if (pcs.V.length > 0) {
            const agg = (arr: number[]) => ({
              min: Math.min(...arr),
              avg: arr.reduce((a, b) => a + b, 0) / arr.length,
              max: Math.max(...arr),
            });
            const s: any = { V: agg(pcs.V), A: agg(pcs.A), F: agg(pcs.F), P: agg(pcs.P), n: pcs.V.length };
            if (concealments.length > 0) s.concealment = agg(concealments);
            if (valenceMinConcealment !== null) s.valence_min_concealment = valenceMinConcealment;
            // Authorial tone averages
            const authAvg: Record<string, number> = {};
            for (const [label, { sum, n }] of Object.entries(authorialSums)) {
              authAvg[label] = sum / n;
            }
            if (Object.keys(authAvg).length > 0) s.authorial = authAvg;
            stats[sid] = s;
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

  if (req.url === '/api/adequacy') {
    const adequacy = loadAdequacy(dir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(adequacy));
    return;
  }

  if (req.url?.startsWith('/api/landscape-match')) {
    const u = new URL(req.url, 'http://localhost');
    const dataset = u.searchParams.get('dataset') || 'landscape';
    const selector = u.searchParams.get('selector') || 'characteristic';
    const aggregation = u.searchParams.get('aggregation') || 'single';
    const hub = u.searchParams.get('hub') || 'all_turns';
    const auditor = u.searchParams.get('auditor') || 'both';
    const result = lookupDataset(dataset, selector, aggregation, hub, auditor);
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid dataset or parameter combination', dataset }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.url?.startsWith('/api/dataset-image/')) {
    // /api/dataset-image/{dataset}/{imageId}
    const rest = decodeURIComponent(req.url.slice('/api/dataset-image/'.length));
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) { res.writeHead(400); res.end('Bad request'); return; }
    const dataset = rest.slice(0, slashIdx);
    const imageId = rest.slice(slashIdx + 1);
    const cacheDirs: Record<string, string> = {
      'landscape': join(dir, 'landscape-embeddings', 'image_cache'),
      'synth-chars': join(dir, 'synth-chars-embeddings', 'image_cache'),
      'classic-anime': join(dir, 'classic-anime-embeddings', 'image_cache'),
    };
    const cacheDir = cacheDirs[dataset];
    if (!cacheDir) { res.writeHead(404); res.end('Unknown dataset'); return; }
    const imgPath = join(cacheDir, imageId);
    if (existsSync(imgPath)) {
      const data = readFileSync(imgPath);
      const isPng = data[0] === 0x89 && data[1] === 0x50;
      const isWebp = data[0] === 0x52 && data[8] === 0x57;
      const ct = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    } else {
      res.writeHead(404); res.end('Image not found');
    }
    return;
  }

  if (req.url === '/api/text-search' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { text, dataset: dsName, topK } = JSON.parse(body);
        if (!text || !dsName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing text or dataset' }));
          return;
        }
        const ds = datasets[dsName];
        if (!ds || !ds.imgEmb || !ds.imgMeta) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Dataset not loaded or missing embeddings' }));
          return;
        }
        if (!GEMINI_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'GOOGLE_API_KEY not set' }));
          return;
        }

        // Embed text with Gemini
        const model = 'gemini-embedding-2-preview';
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_API_KEY}`;
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text: text.slice(0, 2000) }] },
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.text();
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Gemini API error: ${resp.status}`, detail: errBody.slice(0, 200) }));
          return;
        }
        const embData = await resp.json() as any;
        const textEmb = new Float64Array(embData.embedding.values);

        // Normalize
        let norm = 0;
        for (let i = 0; i < textEmb.length; i++) norm += textEmb[i] * textEmb[i];
        norm = Math.sqrt(norm);
        for (let i = 0; i < textEmb.length; i++) textEmb[i] /= norm;

        // Cosine similarity against all images
        const dim = ds.manifest?.dim || 3072;
        const n = ds.nImages!;
        const k = topK || 4;
        const sims = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          let dot = 0;
          const off = i * dim;
          for (let j = 0; j < dim; j++) dot += ds.imgEmb![off + j] * textEmb[j];
          sims[i] = dot / ds.imgNorms![i];
        }

        // Top-K
        const indices = Array.from({ length: n }, (_, i) => i);
        indices.sort((a, b) => sims[b] - sims[a]);
        const results = indices.slice(0, k).map((idx, rank) => ({
          rank: rank + 1,
          imageId: ds.imgMeta![idx].f,
          prompt: ds.imgMeta![idx].p,
          genModel: ds.imgMeta![idx].m,
          score: Math.round(sims[idx] * 10000) / 10000,
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: text.slice(0, 200), dataset: dsName, results }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/api/landscape-info') {
    const info: Record<string, any> = {};
    for (const [name, ds] of Object.entries(datasets)) {
      info[name] = { nImages: ds.manifest?.n_images, nTurns: ds.manifest?.n_turns, models: ds.manifest?.models };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      datasets: info,
      selectors: ['max_arousal', 'max_abs_arousal', 'characteristic', 'max_pca_distance', 'all', 'after5'],
      aggregations: ['single', 'average', 'weighted_pca_distance', 'top3_pca_distance'],
      hubCorrections: ['none', 'model_centroids', 'all_turns', 'exclusive'],
      auditorFilters: ['claude', 'gpt', 'both'],
    }));
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
