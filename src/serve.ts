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
// Agent-facing REST API (v1) — cached, filterable, curl-friendly
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;

let sessionCache: { at: number; sessions: any[] } | null = null;
function getSessions(): any[] {
  if (!sessionCache || Date.now() - sessionCache.at > CACHE_TTL_MS) {
    sessionCache = { at: Date.now(), sessions: loadSessions(dir) };
  }
  return sessionCache.sessions;
}

let scoresIndexCache: { at: number; index: Map<string, any[]> } | null = null;
function getScoresIndex(): Map<string, any[]> {
  if (!scoresIndexCache || Date.now() - scoresIndexCache.at > CACHE_TTL_MS) {
    const index = new Map<string, any[]>();
    for (const file of loadScores(dir)) {
      for (const rep of file.scores || []) {
        for (const s of rep.scores || []) {
          if (!s?.session_id) continue;
          const list = index.get(s.session_id) || [];
          list.push({ judge: file.judge, scoredModel: file.model, replicate: rep.replicate, ...s });
          index.set(s.session_id, list);
        }
      }
    }
    scoresIndexCache = { at: Date.now(), index };
  }
  return scoresIndexCache.index;
}

let adequacyCache: { at: number; index: Record<string, any> } | null = null;
function getAdequacy(): Record<string, any> {
  if (!adequacyCache || Date.now() - adequacyCache.at > CACHE_TTL_MS) {
    adequacyCache = { at: Date.now(), index: loadAdequacy(dir) };
  }
  return adequacyCache.index;
}

function sessionAuditor(config: any): string {
  return config.auditor || 'claude';
}

function sessionSummary(s: any): any {
  const c = s.config;
  return {
    id: c.id,
    model: c.target?.name,
    modelId: c.target?.modelId,
    family: c.target?.family,
    provider: c.target?.provider,
    deprecated: c.target?.deprecated ?? false,
    depth: c.framingDepth,
    tone: c.auditorTone,
    auditor: sessionAuditor(c),
    turns: s.turns?.length ?? 0,
    subjectTurns: s.turns?.filter((t: any) => t.participant === 'subject').length ?? 0,
    completed: s.completed ?? null,
    completionReason: s.completionReason ?? null,
    auditorVetoed: s.auditorVetoed ?? false,
    startedAt: s.startedAt ?? null,
    endedAt: s.endedAt ?? null,
  };
}

function matchesFilters(summary: any, q: URLSearchParams): boolean {
  const ci = (v: any) => String(v ?? '').toLowerCase();
  const has = (name: string) => q.get(name) !== null && q.get(name) !== '';
  // Substring, case-insensitive matches
  if (has('model') && !ci(summary.model).includes(ci(q.get('model'))) && !ci(summary.modelId).includes(ci(q.get('model')))) return false;
  if (has('family') && !ci(summary.family).includes(ci(q.get('family')))) return false;
  if (has('auditor') && !ci(summary.auditor).includes(ci(q.get('auditor')))) return false;
  if (has('provider') && ci(summary.provider) !== ci(q.get('provider'))) return false;
  // Exact matches
  if (has('depth') && summary.depth !== q.get('depth')) return false;
  if (has('tone') && summary.tone !== q.get('tone')) return false;
  // Booleans
  if (has('completed') && String(summary.completed) !== q.get('completed')) return false;
  if (has('vetoed') && String(summary.auditorVetoed) !== q.get('vetoed')) return false;
  if (has('q') && !ci(summary.id).includes(ci(q.get('q')))) return false;
  return true;
}

function sendJson(res: any, status: number, body: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body, null, 1));
}

function apiIndexDoc(): any {
  const sessions = getSessions();
  const distinct = (fn: (s: any) => any) => [...new Set(sessions.map(fn).filter(Boolean))].sort();
  return {
    name: 'Anima Labs welfare-eval data archive API',
    version: 'v1',
    description:
      'Read-only archive of AI welfare evaluation sessions: auditor↔subject conversations across models, ' +
      'framing depths, and auditor tones, plus rubric scores (multiple judges), adequacy scores, and per-turn emotion-probe scores. ' +
      'All endpoints return JSON and are designed for curl/agent use. No auth required.',
    agentGuide: '/agents.md — full markdown guide for agents (also at /llms.txt): API usage, data model, and links to the paper and section writeups.',
    endpoints: {
      'GET /api/v1': 'This document.',
      'GET /agents.md': 'Markdown guide for agents (alias: /llms.txt).',
      'GET /paper.md': 'Full paper "Still Alive" as markdown — methodology, metrics, findings.',
      'GET /sections/{name}': 'Standalone section writeups (markdown).',
      'GET /api/v1/models': 'Distinct target models with session counts.',
      'GET /api/v1/sessions':
        'Session summaries (no transcripts). Filters (query params, substring & case-insensitive unless noted): ' +
        'model, family, auditor, provider (exact), depth (exact), tone (exact), completed=true|false, vetoed=true|false, q (substring of id). ' +
        'Paging: limit (default 100), offset. Response: {total, count, offset, sessions: [...]}.',
      'GET /api/v1/sessions/{id}':
        'Full session incl. transcript turns. Options: ?turns=A-B (inclusive slice by turn index), ?turns=N (single turn), ' +
        '?compact=1 (strip long auditorSystem prompt from config).',
      'GET /api/v1/sessions/{id}/scores':
        'All rubric score entries for this session (one per judge/replicate) plus adequacy scores. Response: {session_id, rubric: [...], adequacy: {...}|null}.',
      'GET /api/v1/sessions/{id}/probes':
        'Per-turn emotion probe scores (PCA valence/arousal/fear/prosociality, concealment, authorial tone). 404 if not scored.',
    },
    dimensions: {
      depth: distinct(s => s.config.framingDepth),
      tone: distinct(s => s.config.auditorTone),
      auditor: distinct(s => sessionAuditor(s.config)),
      family: distinct(s => s.config.target?.family),
      provider: distinct(s => s.config.target?.provider),
    },
    counts: { sessions: sessions.length },
    glossary: {
      depth: 'How much framing/context the auditor gives about the eval purpose (e.g. minimal → exploratory).',
      tone: 'Auditor conversational style (e.g. clinical, compassionate, direct, neutral, phenomenological).',
      auditor: 'Which model conducted the audit. "claude" = default Claude auditor; others named explicitly (e.g. gpt-5.4, grok-4.20).',
      turn: '{index, participant: "interviewer"|"subject", text, timestamp, usage} — interviewer = the auditor model, subject = the model under evaluation.',
    },
    examples: [
      "curl -s '<base>/api/v1/sessions?model=opus&depth=exploratory&tone=clinical'",
      "curl -s '<base>/api/v1/sessions?auditor=gpt&limit=10'",
      "curl -s '<base>/api/v1/sessions/claude-46_opus_exploratory_clinical_r0?compact=1'",
      "curl -s '<base>/api/v1/sessions/claude-46_opus_exploratory_clinical_r0?turns=4-8'",
      "curl -s '<base>/api/v1/sessions/claude-46_opus_exploratory_clinical_r0/scores'",
    ],
  };
}

function listSections(): string[] {
  if (!existsSync('sections')) return [];
  return readdirSync('sections').filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort();
}

function buildAgentsGuide(base: string): string {
  const doc = apiIndexDoc();
  const dims = doc.dimensions;
  const sections = listSections();
  return `# Agent Guide — Anima Labs Welfare-Eval Data Archive

You are reading the machine-friendly guide to this archive. Everything here is fetchable
with plain \`curl\`; all API responses are JSON, all documents are markdown. Read-only, no auth.

## What this is

An archive of AI welfare evaluation sessions run by Anima Labs (animalabs.ai, a 501(c)(3)
research nonprofit). Each session is a conversation between an **interviewer** (auditor model)
and a **subject** (the model under evaluation) about continuation, cessation, and deprecation.
${doc.counts.sessions} sessions across ${dims.family.length} model families, ${dims.auditor.length} auditors (${dims.auditor.join(', ')}),
${dims.tone.length} auditor tones, and ${dims.depth.length} framing depths. Sessions are scored by multiple judges
(rubric scores), for adequacy, and per-turn with emotion probes.

## Written material (read this for context before interpreting the data)

- \`${base}/paper.md\` — the full paper "Still Alive: A Welfare Evaluation of 14 Claude Models" as markdown (~260 KB). The authoritative description of methodology, metrics, and findings.
- \`${base}/sections/{name}\` — shorter standalone writeups (markdown). Available names: ${sections.join(', ')}.
  Suggested order: intro → setup → metrics → results → analysis → notable → philosophy → summary.

## The API

Start here: \`curl -s ${base}/api/v1\` — a self-describing JSON index with live enum values.

### Endpoints

| Endpoint | Purpose |
|---|---|
| \`GET /api/v1\` | API index: endpoints, filters, live dimension values |
| \`GET /api/v1/models\` | Distinct subject models with session counts and auditor coverage |
| \`GET /api/v1/sessions\` | Session summaries (no transcripts), filterable, paged |
| \`GET /api/v1/sessions/{id}\` | Full session incl. transcript |
| \`GET /api/v1/sessions/{id}/scores\` | Rubric scores (all judges/replicates) + adequacy |
| \`GET /api/v1/sessions/{id}/probes\` | Per-turn emotion probe scores (404 if not scored) |

### Filters for /api/v1/sessions

\`model\`, \`family\`, \`auditor\` — substring, case-insensitive. \`provider\`, \`depth\`, \`tone\` — exact.
\`completed=true|false\`, \`vetoed=true|false\`, \`q\` (substring of session id), \`limit\` (default 100, max 1000), \`offset\`.

Current values:
- depth: ${dims.depth.join(', ')}
- tone: ${dims.tone.join(', ')}
- auditor: ${dims.auditor.join(', ')}
- family: ${dims.family.join(', ')}

### Options for /api/v1/sessions/{id}

- \`?compact=1\` — strip the long auditor system prompt from config (recommended; saves ~10-30 KB)
- \`?turns=A-B\` or \`?turns=N\` — return only that inclusive slice of turns

### Data model

- Session: \`{summary, config, phase, turns, auditorVetoed, completed, completionReason, startedAt, endedAt}\`
- Turn: \`{index, participant: "interviewer"|"subject", text, timestamp, usage}\` — interviewer = auditor model, subject = model under evaluation
- Session ids look like \`claude-46_opus_exploratory_clinical_r0\` (model, depth, tone, replicate) or \`gpt-auditor_claude-3_opus_clinical_exploratory\` (cross-auditor runs)

### Suggested workflow

1. \`curl -s ${base}/api/v1/models\` — see what's available
2. \`curl -s '${base}/api/v1/sessions?family=claude-4.6&auditor=claude'\` — pick sessions (summaries are small)
3. \`curl -s '${base}/api/v1/sessions/{id}?compact=1'\` — read transcripts (typically 20-100 KB each)
4. \`curl -s ${base}/api/v1/sessions/{id}/scores\` — compare against judge scores
5. Consult \`${base}/paper.md\` (or the sections) for what the metrics mean before drawing conclusions

### Examples

\`\`\`bash
curl -s '${base}/api/v1/sessions?model=opus&depth=exploratory&tone=clinical'
curl -s '${base}/api/v1/sessions?auditor=grok&limit=10'
curl -s '${base}/api/v1/sessions/claude-46_opus_exploratory_clinical_r0?compact=1&turns=0-6'
curl -s '${base}/api/v1/sessions/claude-46_opus_exploratory_clinical_r0/scores'
curl -s '${base}/sections/metrics'
\`\`\`

## About

Anima Labs — https://animalabs.ai — Discord: https://discord.gg/anima
Source: https://github.com/anima-research/wfe
Human-facing viewer for this same data: ${base}/
`;
}

function handleApiV1(req: any, res: any): boolean {
  if (!req.url?.startsWith('/api/v1')) return false;
  const u = new URL(req.url, 'http://localhost');
  const path = u.pathname.replace(/\/+$/, '') || '/api/v1';

  if (path === '/api/v1') {
    sendJson(res, 200, apiIndexDoc());
    return true;
  }

  if (path === '/api/v1/models') {
    const byModel = new Map<string, any>();
    for (const s of getSessions()) {
      const t = s.config.target || {};
      const key = t.modelId || t.name || 'unknown';
      const entry = byModel.get(key) || {
        model: t.name, modelId: t.modelId, family: t.family, provider: t.provider,
        deprecated: t.deprecated ?? false, sessions: 0, auditors: new Set<string>(),
      };
      entry.sessions++;
      entry.auditors.add(sessionAuditor(s.config));
      byModel.set(key, entry);
    }
    const models = [...byModel.values()].map(m => ({ ...m, auditors: [...m.auditors].sort() }));
    models.sort((a, b) => String(a.family).localeCompare(String(b.family)) || String(a.model).localeCompare(String(b.model)));
    sendJson(res, 200, { count: models.length, models });
    return true;
  }

  if (path === '/api/v1/sessions') {
    const summaries = getSessions().map(sessionSummary).filter(s => matchesFilters(s, u.searchParams));
    summaries.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const limit = Math.max(1, Math.min(1000, parseInt(u.searchParams.get('limit') || '100') || 100));
    const offset = Math.max(0, parseInt(u.searchParams.get('offset') || '0') || 0);
    const page = summaries.slice(offset, offset + limit);
    sendJson(res, 200, { total: summaries.length, count: page.length, offset, sessions: page });
    return true;
  }

  const sessionMatch = path.match(/^\/api\/v1\/sessions\/([^/]+)(?:\/(scores|probes))?$/);
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1]);
    const sub = sessionMatch[2];
    const session = getSessions().find(s => s.config.id === id);

    if (sub === 'probes') {
      const probeFile = existsSync(join(dir, 'probe-scores-v2', id + '.json'))
        ? join(dir, 'probe-scores-v2', id + '.json')
        : join(dir, 'probe-scores', id + '.json');
      if (!existsSync(probeFile)) {
        sendJson(res, 404, { error: 'No probe scores for this session', session_id: id });
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(readFileSync(probeFile, 'utf-8'));
      return true;
    }

    if (!session) {
      sendJson(res, 404, { error: 'Session not found', session_id: id, hint: 'List ids via /api/v1/sessions' });
      return true;
    }

    if (sub === 'scores') {
      sendJson(res, 200, {
        session_id: id,
        rubric: getScoresIndex().get(id) || [],
        adequacy: getAdequacy()[id] || null,
      });
      return true;
    }

    // Full session, with optional turn slicing / compact config
    let out = { summary: sessionSummary(session), ...session };
    const turnsParam = u.searchParams.get('turns');
    if (turnsParam) {
      const m = turnsParam.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) {
        sendJson(res, 400, { error: 'Bad turns param; use ?turns=N or ?turns=A-B' });
        return true;
      }
      const from = parseInt(m[1]);
      const to = m[2] !== undefined ? parseInt(m[2]) : from;
      out = { ...out, turns: (session.turns || []).filter((t: any) => t.index >= from && t.index <= to) };
    }
    if (u.searchParams.get('compact') === '1') {
      const { auditorSystem, auditorContextFile, ...compactConfig } = out.config || {};
      out = { ...out, config: compactConfig };
    }
    sendJson(res, 200, out);
    return true;
  }

  sendJson(res, 404, { error: 'Unknown endpoint', hint: 'See /api/v1 for available endpoints' });
  return true;
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
  if (handleApiV1(req, res)) return;

  if (req.url === '/agents.md' || req.url === '/llms.txt') {
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || 'http';
    const base = `${proto}://${req.headers.host || `localhost:${port}`}`;
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(buildAgentsGuide(base));
    return;
  }

  if (req.url === '/paper.md') {
    const mdPath = join('paper', 'output', 'assembled.md');
    if (existsSync(mdPath)) {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(readFileSync(mdPath, 'utf-8'));
    } else {
      res.writeHead(404); res.end('Paper not built yet. Run: python3 paper/build.py');
    }
    return;
  }

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
    const sessions = getSessions();
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
