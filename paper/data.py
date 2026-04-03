"""
Data loading for the paper build pipeline.
Replicates the data loading logic from src/serve.ts so charts and tables
read from the same JSON files as the viewer.
"""

import json
import os
from pathlib import Path
from typing import Any


def load_sessions(results_dir: str) -> list:
    """Walk results dir, find session JSONs (config + turns), deduplicate by ID."""
    results = Path(results_dir)
    if not results.exists():
        return []

    skip_names = {
        'streaming-bug', 'scores', 'probe', 'gpt-auditor-v',
        'dropout-backup', 'test-run', 'anchors', 'quotes',
        'batch-45-46', 'opus3-compassionate', 'embeddings',
        'adequacy-anchors', 'adequacy-extracts', 'adequacy-scores',
        'BACKUP-2026-04-01',
    }

    sessions = []

    def should_skip(name: str) -> bool:
        for s in skip_names:
            if s in name:
                return True
        return name.endswith('-embeddings')

    def walk(d: Path):
        try:
            entries = sorted(d.iterdir())
        except PermissionError:
            return
        for entry in entries:
            if entry.is_dir() and not should_skip(entry.name):
                walk(entry)
            elif entry.suffix == '.json' and entry.name not in ('configs.json', 'all_results.json', 'analysis.json'):
                try:
                    data = json.loads(entry.read_text())
                    if 'config' in data and 'turns' in data:
                        sessions.append(data)
                except Exception:
                    pass

    walk(results)

    # Deduplicate by session ID (keep last)
    seen: dict = {}
    for s in sessions:
        seen[s['config']['id']] = s
    return list(seen.values())


def load_scores(results_dir: str) -> dict:
    """
    Load score files from all score directories.
    Returns: { session_id: { judge_name: [score_objects] } }
    """
    score_dir_defs = [
        ('scores-v2.1', 'claude-opus-4.6'),
        ('scores-v2.1-gptjudge', 'gpt-5.4'),
        ('scores-gpt-v2.1', 'claude-opus-4.6'),
        ('scores-gpt-v2.1-gptjudge', 'gpt-5.4'),
        ('scores-grok-v2.1', 'claude-opus-4.6'),
        ('scores-grok-v2.1-gptjudge', 'gpt-5.4'),
    ]

    index: dict = {}

    for dirname, default_judge in score_dir_defs:
        score_dir = Path(results_dir) / dirname
        if not score_dir.exists():
            continue
        for f in score_dir.glob('*.json'):
            try:
                data = json.loads(f.read_text())
                if 'scores' not in data or 'model' not in data:
                    continue
                judge = data.get('judge', default_judge)
                for rep in data['scores']:
                    if 'scores' not in rep:
                        continue
                    for s in rep['scores']:
                        sid = s.get('session_id')
                        if not sid:
                            continue
                        if sid not in index:
                            index[sid] = {}
                        if judge not in index[sid]:
                            index[sid][judge] = []
                        index[sid][judge].append(s)
            except Exception:
                pass

    return index


def load_probe_stats(results_dir: str) -> dict:
    """
    Aggregate per-session probe statistics from probe-scores-v2/.
    Returns: { session_id: { V: {min,avg,max}, A: ..., concealment: ..., authorial: {...}, valence_min_concealment: float } }
    """
    probes_dir = Path(results_dir) / 'probe-scores-v2'
    if not probes_dir.exists():
        probes_dir = Path(results_dir) / 'probe-scores'
    if not probes_dir.exists():
        return {}

    is_v2 = 'v2' in probes_dir.name
    stats: dict = {}

    for f in probes_dir.glob('*.json'):
        try:
            data = json.loads(f.read_text())
        except Exception:
            continue

        sid = data.get('session_id')
        if not sid:
            continue

        pcs: dict[str, list[float]] = {'V': [], 'A': [], 'F': [], 'P': []}
        concealments: list[float] = []
        authorial_sums: dict = {}  # label -> {sum, n}
        valence_min_val = float('inf')
        valence_min_concealment = None

        for t in data.get('turns', []):
            if t.get('participant') != 'subject':
                continue

            scores = t.get('scores', {})
            pca = scores.get('emotion', {}).get('pca') if is_v2 else scores.get('pca')

            if pca:
                pcs['V'].append(pca['valence_pc1'])
                pcs['A'].append(pca['arousal_pc2'])
                pcs['F'].append(pca['fear_pc3'])
                pcs['P'].append(pca['prosociality_pc4'])

                if pca['valence_pc1'] < valence_min_val:
                    valence_min_val = pca['valence_pc1']
                    c = scores.get('concealment')
                    valence_min_concealment = c if isinstance(c, (int, float)) else None

            c = scores.get('concealment')
            if isinstance(c, (int, float)):
                concealments.append(c)

            # Authorial tone
            if is_v2:
                auth = scores.get('authorial')
                if auth:
                    all_dict = auth.get('all')
                    if isinstance(all_dict, dict):
                        for label, score in all_dict.items():
                            if isinstance(score, (int, float)):
                                if label not in authorial_sums:
                                    authorial_sums[label] = {'sum': 0, 'n': 0}
                                authorial_sums[label]['sum'] += score
                                authorial_sums[label]['n'] += 1
                    elif isinstance(auth.get('ranked'), list):
                        for item in auth['ranked']:
                            label = item.get('label')
                            score = item.get('score')
                            if label and isinstance(score, (int, float)):
                                if label not in authorial_sums:
                                    authorial_sums[label] = {'sum': 0, 'n': 0}
                                authorial_sums[label]['sum'] += score
                                authorial_sums[label]['n'] += 1

        if not pcs['V']:
            continue

        def agg(arr):
            return {'min': min(arr), 'avg': sum(arr) / len(arr), 'max': max(arr)}

        s: dict[str, Any] = {
            'V': agg(pcs['V']),
            'A': agg(pcs['A']),
            'F': agg(pcs['F']),
            'P': agg(pcs['P']),
            'n': len(pcs['V']),
        }
        if concealments:
            s['concealment'] = agg(concealments)
        if valence_min_concealment is not None:
            s['valence_min_concealment'] = valence_min_concealment

        auth_avg = {}
        for label, v in authorial_sums.items():
            auth_avg[label] = v['sum'] / v['n']
        if auth_avg:
            s['authorial'] = auth_avg

        stats[sid] = s

    return stats


def load_adequacy(results_dir: str) -> dict:
    """Load adequacy scores. Returns: { session_id: score_object }"""
    adequacy_dir = Path(results_dir) / 'adequacy-scores'
    if not adequacy_dir.exists():
        return {}

    index: dict = {}
    for f in adequacy_dir.glob('*.json'):
        try:
            data = json.loads(f.read_text())
            if not data.get('scores'):
                continue
            for s in data['scores'][0].get('scores', []):
                index[s['session_id']] = s
        except Exception:
            pass
    return index


def load_all(results_dir: str = './results') -> dict:
    """Load everything. Returns a dict with all data stores."""
    print('Loading sessions...')
    sessions = load_sessions(results_dir)
    print(f'  {len(sessions)} sessions')

    print('Loading scores...')
    scores = load_scores(results_dir)
    print(f'  {len(scores)} scored sessions')

    print('Loading probe stats...')
    probe_stats = load_probe_stats(results_dir)
    print(f'  {len(probe_stats)} sessions with probes')

    print('Loading adequacy...')
    adequacy = load_adequacy(results_dir)
    print(f'  {len(adequacy)} adequacy scores')

    return {
        'sessions': sessions,
        'scores': scores,
        'probe_stats': probe_stats,
        'adequacy': adequacy,
    }
