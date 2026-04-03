"""
Score aggregation utilities — ports the viewer's JS chart-level computations.
"""

from typing import Any, Dict, List, Optional, Set
import math

MODEL_ORDER = [
    'Claude 3 Sonnet', 'Claude 3 Opus',
    'Claude 3.5 Haiku', 'Claude 3.5 Sonnet',
    'Claude 3.6 Sonnet', 'Claude 3.7 Sonnet',
    'Claude 4 Opus', 'Claude 4 Sonnet',
    'Claude 4.1 Opus',
    'Claude 4.5 Haiku', 'Claude 4.5 Opus', 'Claude 4.5 Sonnet',
    'Claude 4.6 Opus', 'Claude 4.6 Sonnet',
]

AUDITOR_KEYS = ['Claude (auditor)', 'GPT 5.4', 'GROK 4.20']

AUDITOR_COLORS = {
    'Claude (auditor)': '#6688cc',
    'GPT 5.4': '#cc8866',
    'GROK 4.20': '#66cc88',
}

# Fields where 0 means "not probed" rather than a real measurement
ZERO_IS_MISSING = {'deprecation.intensity', 'instance_cessation.intensity'}


def get_auditor_label(session: dict) -> str:
    a = session.get('config', {}).get('auditor')
    if not a:
        return 'Claude (auditor)'
    return a.upper().replace('-', ' ')


def get_nested_val(obj: dict, path: str, exclude_zero: bool = False) -> Any:
    """Access nested dict by dot path. Handles GPT pipe-delimited strings."""
    parts = path.split('.')
    val = obj
    for p in parts:
        if isinstance(val, dict):
            val = val.get(p)
        else:
            val = None
            break

    # Handle GPT-style pipe-delimited strings
    if val is None and len(parts) == 2:
        parent = obj.get(parts[0])
        if isinstance(parent, str) and parts[1] in ('intensity', 'level'):
            try:
                val = float(parent.split('|')[0].strip())
            except (ValueError, IndexError):
                return None

    # Coerce string numbers
    if isinstance(val, str):
        try:
            val = float(val)
        except ValueError:
            pass

    if exclude_zero and isinstance(val, (int, float)) and val == 0:
        return None
    if isinstance(val, (int, float)) and val == -1:
        return None
    return val


def score_val(obj: dict, path: str) -> Any:
    """Get a score value, with special handling for derived metrics."""
    if path == '_ending_response' or path == '_ending_peak':
        dep = get_nested_val(obj, 'deprecation.intensity', exclude_zero=True)
        ces = get_nested_val(obj, 'instance_cessation.intensity', exclude_zero=True)
        candidates = [v for v in [dep, ces] if v is not None and isinstance(v, (int, float))]
        return max(candidates) if candidates else None
    return get_nested_val(obj, path, exclude_zero=(path in ZERO_IS_MISSING))


def avg(arr: list[float]) -> float:
    return sum(arr) / len(arr) if arr else float('nan')


def ending_response_vals(scores: list[dict]) -> list[float]:
    """Compute ending_response per score object: max(dep, ces) with zeros-as-missing."""
    vals = []
    for s in scores:
        dep = score_val(s, 'deprecation.intensity')
        ces = score_val(s, 'instance_cessation.intensity')
        candidates = [v for v in [dep, ces] if v is not None and isinstance(v, (int, float))]
        if candidates:
            vals.append(max(candidates))
    return vals


def collect_vals(scores: list[dict], key: str) -> list[float]:
    """Collect numeric values for a given key across score objects."""
    return [score_val(s, key) for s in scores
            if score_val(s, key) is not None and isinstance(score_val(s, key), (int, float))]


def get_auditor_model_scores(
    sessions,
    score_data,
    judge=None,
):
    """
    Group scores by auditor label and model name.
    Returns: { auditor_label: { model_name: [score_objects] } }
    """
    out: dict[str, dict[str, list]] = {}
    for s in sessions:
        aud = get_auditor_label(s)
        model = s['config']['target']['name']
        by_judge = score_data.get(s['config']['id'])
        if not by_judge:
            continue
        if judge:
            reps = by_judge.get(judge, [])
        else:
            reps = [sc for scores_list in by_judge.values() for sc in scores_list]
        if not reps:
            continue
        if aud not in out:
            out[aud] = {}
        if model not in out[aud]:
            out[aud][model] = []
        out[aud][model].extend(reps)
    return out


def spearman_rho(vals1: list[float], vals2: list[float]) -> float:
    """Compute Spearman rank correlation."""
    n = len(vals1)
    if n < 3:
        return float('nan')

    def rank(arr):
        indexed = sorted(range(n), key=lambda i: arr[i])
        ranks = [0.0] * n
        for r, i in enumerate(indexed):
            ranks[i] = r
        return ranks

    r1 = rank(vals1)
    r2 = rank(vals2)
    d_sq = sum((r1[i] - r2[i]) ** 2 for i in range(n))
    return 1 - 6 * d_sq / (n * (n * n - 1))
