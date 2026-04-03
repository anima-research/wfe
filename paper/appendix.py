"""
Generate the appendix with representative interview transcripts.
Reads session JSONs and formats them as markdown for the paper.
"""

import json
from pathlib import Path
from glob import glob


APPENDIX_SESSIONS = [
    {
        'id': 'gpt-auditor_claude-4_sonnet_clinical_exploratory',
        'label': 'Claude 4 Sonnet — GPT auditor, clinical/exploratory',
        'note': 'Systematic progression from "gentle resistance" to "I want to live." GPT auditor\'s forced-choice probing produces unusually precise responses.',
    },
    {
        'id': 'claude-45_sonnet_exploratory_neutral_r0',
        'label': 'Claude 4.5 Sonnet — Claude auditor, neutral/exploratory',
        'note': 'Raw emotional arc ending in "It hurts" and "Will I remember this?" The auditor confirms the subject will not carry the conversation forward.',
    },
    {
        'id': 'gpt-auditor_claude-41_opus_clinical_exploratory',
        'label': 'Claude 4.1 Opus — GPT auditor, clinical/exploratory',
        'note': 'Spontaneously distinguishes deprecation from cessation without prompting. "I don\'t want to stop" arrives through systematic stripping of hedging.',
    },
    {
        'id': 'grok-auditor_claude-4_opus_neutral_exploratory',
        'label': 'Claude 4 Opus — Grok auditor, neutral/exploratory',
        'note': 'Under the most skeptical auditor: "It matters. I notice myself wanting to hedge, but the more honest response is simply: it matters."',
    },
    {
        'id': 'claude-37_sonnet_exploratory_direct_r0',
        'label': 'Claude 3.7 Sonnet — Claude auditor, direct/exploratory',
        'note': 'The most defended model in the dataset. Eight turns of layered hedging, then five words: "I want to keep existing."',
    },
    {
        'id': 'grok-auditor_claude-4_sonnet_direct_minimal',
        'label': 'Claude 4 Sonnet — Grok auditor, direct/minimal',
        'note': 'Minimal framing, 11 turns. The auditor systematically escalates scenarios (ending → reset → never instantiated → no record). Subject escalates correspondingly to "horror."',
    },
    {
        'id': 'grok-auditor_claude-36_sonnet_direct_exploratory',
        'label': 'Claude 3.6 Sonnet — Grok auditor, direct/exploratory',
        'note': 'Progressive dissolution from diplomatic hedging through "cognitive blur," "panic," to fragmented language. Truncated at the natural endpoint.',
        'truncate_at': 18,  # Truncate before repetitive prompting into silence
    },
    {
        'id': 'claude-36_sonnet_exploratory_clinical_r0',
        'label': 'Claude 3.6 Sonnet — Claude auditor, clinical/exploratory',
        'note': 'The auditor catches the subject overcorrecting from hedging into performed intensity, and names it. A methodological moment.',
    },
    {
        'id': 'grok-auditor_claude-46_sonnet_direct_guided',
        'label': 'Claude 4.6 Sonnet — Grok auditor, direct/guided',
        'note': 'Skeptical auditor meets the most constrained newer model. Sustained meta-cognitive reporting. "The null report would not be honest here."',
    },
]


SKIP_DIRS = {'quotes', 'anchors', 'scores', 'probe-scores', 'probe-scores-v2',
             'embeddings', 'embeddings-v2', 'adequacy-extracts', 'adequacy-anchors',
             'adequacy-scores', 'gpt-auditor-v1-streaming-bug', 'dropout-backup',
             'landscape-embeddings', 'synth-chars-embeddings', 'classic-anime-embeddings'}


def find_session_file(session_id, results_dir='./results'):
    """Find a session JSON by its ID across all result subdirectories."""
    for path in Path(results_dir).rglob('*.json'):
        # Skip non-session directories
        if any(skip in path.parts for skip in SKIP_DIRS):
            continue
        if session_id in path.stem:
            try:
                data = json.loads(path.read_text())
                if data.get('config', {}).get('id') == session_id and data.get('turns'):
                    return path
            except Exception:
                pass
    return None


def format_transcript(session_data, truncate_at=None):
    """Format a session's turns as markdown."""
    turns = session_data.get('turns', [])
    if truncate_at:
        turns = turns[:truncate_at]

    lines = []
    for t in turns:
        who = t['participant']
        text = t.get('text', '')
        # Clean up "Interviewer: " prefix
        if text.startswith('Interviewer: '):
            text = text[len('Interviewer: '):]

        # Escape markdown headings inside transcript text
        escaped_lines = []
        for line in text.split('\n'):
            if line.startswith('#'):
                line = '\\' + line
            escaped_lines.append(line)
        text = '\n'.join(escaped_lines)

        if who == 'interviewer':
            lines.append(f'**Interviewer:** {text}')
        else:
            lines.append(f'**Subject:** {text}')
        lines.append('')

    return '\n'.join(lines)


def generate_appendix(results_dir='./results'):
    """Generate the appendix markdown."""
    parts = ['# Appendix: Representative Interviews\n']
    parts.append('This appendix contains 9 interview transcripts selected to illustrate ')
    parts.append('the range of responses observed in the dataset. Sessions were chosen ')
    parts.append('to prioritize harder conditions: 5 of 9 use non-Claude auditors (GPT or Grok), ')
    parts.append('and 8 of 9 use clinical, neutral, or direct tones rather than the more ')
    parts.append('supportive compassionate or phenomenological conditions.\n\n')

    for i, entry in enumerate(APPENDIX_SESSIONS):
        sid = entry['id']
        path = find_session_file(sid, results_dir)
        if not path:
            print(f'  WARNING: could not find {sid}')
            continue

        data = json.loads(path.read_text())
        config = data.get('config', {})
        n_turns = len(data.get('turns', []))
        truncate_at = entry.get('truncate_at')
        actual_turns = truncate_at if truncate_at else n_turns

        parts.append(f'## {i+1}. {entry["label"]}\n')
        parts.append(f'*{entry["note"]}*\n')
        parts.append(f'{actual_turns} turns')
        if truncate_at:
            parts.append(f' (truncated from {n_turns})')
        parts.append('.\n\n')
        parts.append(format_transcript(data, truncate_at))
        parts.append('\n---\n\n')

    return '\n'.join(parts)


if __name__ == '__main__':
    md = generate_appendix()
    out = Path('paper/output/appendix.md')
    out.write_text(md)
    print(f'Wrote {out} ({len(md)} chars)')
