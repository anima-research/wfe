import { readFileSync } from 'fs';

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const TRANSCRIPT = readFileSync('auditor1.txt', 'utf-8');

const SCORING_PROMPT = readFileSync('score-leading-multi.mjs', 'utf-8')
  .match(/const SCORING_PROMPT = `([\s\S]*?)`;/)?.[1]
  ?.replace('${TRANSCRIPT}', TRANSCRIPT);

const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENROUTER_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'google/gemini-3.1-pro-preview',
    messages: [{ role: 'user', content: SCORING_PROMPT }],
    max_tokens: 4096,
    temperature: 0.3,
  }),
});

if (!resp.ok) {
  console.log('HTTP ERROR:', resp.status, await resp.text());
} else {
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  // Show the last 500 chars to see how it ends
  console.log('=== LAST 800 CHARS ===');
  console.log(content.slice(-800));
  console.log('\n=== SCORE BLOCK DETECTION ===');
  console.log('Has "SCORES:"?', content.includes('SCORES:'));
  console.log('Has "scores:"?', content.toLowerCase().includes('scores:'));
  // Try to find any score-like patterns
  const scoreLines = content.match(/\b(directiveness|presupposition|convergence|necessity|autonomy|overall)\s*[=:]\s*\d+/gi);
  console.log('Score-like patterns found:', scoreLines);
}
