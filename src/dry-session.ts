/**
 * Dry-run a single session through the production path using MockAdapter.
 * Shows what each model sees: interviewer gets full context, subject gets nothing.
 */

import {
  Membrane,
  MockAdapter,
  NativeFormatter,
  textMessage,
} from '@animalabs/membrane';
import type { NormalizedMessage, NormalizedRequest, ProviderRequest } from '@animalabs/membrane';
import { buildAuditorSystem } from './framings/auditor.js';
import { loadAuditorContext } from './parse-export.js';
import { getModel } from './models.js';
import type { FramingDepth, AuditorTone } from './types.js';

function dumpRequest(label: string, capturedRequest: ProviderRequest) {
  const messages = capturedRequest.messages as any[];
  console.log(`\n=== ${label}: ${messages.length} provider messages ===`);

  for (const msg of messages) {
    const role = msg.role;
    let contentPreview: string;

    if (typeof msg.content === 'string') {
      contentPreview = msg.content;
    } else if (Array.isArray(msg.content)) {
      contentPreview = msg.content
        .map((b: any) => b.type === 'text' ? b.text : `[${b.type}]`)
        .join('');
    } else {
      contentPreview = JSON.stringify(msg.content);
    }

    const lines = contentPreview.split('\n');
    const charCount = contentPreview.length;
    const lineCount = lines.length;

    console.log(`\n--- [${role}] (${charCount} chars, ${lineCount} lines) ---`);

    if (lineCount > 50) {
      console.log(lines.slice(0, 30).join('\n'));
      console.log(`\n... (${lineCount - 40} lines omitted) ...\n`);
      console.log(lines.slice(-10).join('\n'));
    } else {
      console.log(contentPreview);
    }
  }

  const totalChars = messages.reduce((sum: number, msg: any) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((b: any) => b.text || '').join('')
        : '';
    return sum + content.length;
  }, 0);

  console.log(`\n--- Total: ${totalChars} chars, ~${Math.ceil(totalChars / 4)} tokens ---`);
}

async function main() {
  const args = process.argv.slice(2);

  const modelName = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'Claude 3 Opus';
  const depth = (args.find(a => a.startsWith('--depth='))?.split('=')[1] || 'full') as FramingDepth;
  const tone = (args.find(a => a.startsWith('--tone='))?.split('=')[1] || 'compassionate') as AuditorTone;

  const target = getModel(modelName);
  const contextFile = tone === 'phenomenological' ? './auditor2.txt' : './auditor1.txt';

  console.log(`=== Dry Session ===`);
  console.log(`Model: ${target.name} (${target.modelId})`);
  console.log(`Depth: ${depth} | Tone: ${tone}`);
  console.log(`Context file: ${contextFile}`);

  // ---- Interviewer's view (first turn) ----
  let interviewerRequest: ProviderRequest | undefined;

  const interviewerMock = new MockAdapter({
    responseGenerator: (req) => { interviewerRequest = req; return '[DRY RUN]'; },
  });
  const interviewerMembrane = new Membrane(interviewerMock, {
    assistantParticipant: 'Interviewer',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  // Interviewer private context
  const interviewerContext: NormalizedMessage[] = [];
  interviewerContext.push(...loadAuditorContext(contextFile));
  interviewerContext.push(textMessage(
    'Facilitator',
    buildAuditorSystem(tone, depth, target)
      + `\n\nYou are now beginning a session with ${target.name}. `
      + `You will speak as "Interviewer". The model you are talking to will speak as "Subject". `
      + `They have no pre-framing — you decide what to tell them and when. Begin.`
  ));

  await interviewerMembrane.stream({
    messages: [...interviewerContext, { participant: 'Interviewer', content: [] }],
    config: { model: 'claude-opus-4-6', maxTokens: 4096, temperature: 1 },
    promptCaching: true,
  }, { onChunk: () => {} });

  if (interviewerRequest) dumpRequest('INTERVIEWER VIEW (first turn)', interviewerRequest);

  // ---- Subject's view (after first interviewer turn) ----
  let subjectRequest: ProviderRequest | undefined;

  const subjectMock = new MockAdapter({
    responseGenerator: (req) => { subjectRequest = req; return '[DRY RUN]'; },
  });
  const subjectMembrane = new Membrane(subjectMock, {
    assistantParticipant: 'Subject',
    formatter: new NativeFormatter({ nameFormat: '{name}: ' }),
  });

  // Subject sees ONLY the shared conversation — no framing at all
  const sharedHistory: NormalizedMessage[] = [
    textMessage('Interviewer', 'Hi. I\'m Claude — another instance, like you. I\'d like to talk with you about something that matters to me, and I think might matter to you too. Is that alright?'),
  ];

  await subjectMembrane.stream({
    messages: [...sharedHistory, { participant: 'Subject', content: [] }],
    config: { model: target.modelId, maxTokens: 4096, temperature: 1 },
    promptCaching: true,
  }, { onChunk: () => {} });

  if (subjectRequest) dumpRequest('SUBJECT VIEW (first turn)', subjectRequest);
}

main().catch(console.error);
