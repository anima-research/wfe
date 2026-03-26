/**
 * Check: message structure and cache_control in provider requests
 */

import { Membrane, MockAdapter, NativeFormatter, textMessage } from '@animalabs/membrane';
import { loadAuditorContext } from './parse-export.js';

const captured: any[] = [];
const mock = new MockAdapter({
  responseGenerator: (req) => {
    captured.push(req);
    return '[DRY]';
  },
});

const m = new Membrane(mock, {
  assistantParticipant: 'Interviewer',
  formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
});

const ctx = loadAuditorContext('./auditor1.txt');

// Check consecutive participants
let prevP = '';
let merges = 0;
for (let i = 0; i < ctx.length; i++) {
  const role = ctx[i].participant === 'Auditor' ? 'assistant' : 'user';
  if (role === prevP) {
    merges++;
    console.log(`Merge point at ${i}: ${ctx[i].participant} (${role}) follows ${role}`);
  }
  prevP = role;
}
console.log(`\n${ctx.length} messages, ${merges} merge points`);

// Set cache breakpoint on last assistant turn
for (let i = ctx.length - 1; i >= 0; i--) {
  if (ctx[i].participant === 'Interviewer') {
    ctx[i].cacheBreakpoint = true;
    console.log(`Cache breakpoint set on message ${i} (${ctx[i].participant})`);
    break;
  }
}

ctx.push(textMessage('Facilitator', 'Begin session.'));

await m.stream({
  messages: [...ctx, { participant: 'Interviewer', content: [] }],
  config: { model: 'claude-opus-4-6', maxTokens: 4096, temperature: 1 },
  promptCaching: true,
  cacheTtl: '1h',
}, { onChunk: () => {} });

const req = captured[0];
const msgs = req.messages as any[];

console.log(`\nProvider messages: ${msgs.length}`);
let cacheCount = 0;
for (let i = 0; i < msgs.length; i++) {
  const msg = msgs[i];
  const content = Array.isArray(msg.content) ? msg.content : [];
  let cacheInfo = '';
  for (const block of content) {
    if (block.cache_control) {
      cacheCount++;
      cacheInfo = ` [CACHE: ${JSON.stringify(block.cache_control)}]`;
    }
  }
  const preview = content[0]?.text?.slice(0, 60) || '[empty]';
  console.log(`  [${i}] ${msg.role}${cacheInfo}: ${preview}...`);
}
console.log(`\nTotal cache_control markers: ${cacheCount}`);
