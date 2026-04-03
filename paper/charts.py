"""
Chart generation for the paper. Each function reads from the loaded data
and produces a vector PDF figure via matplotlib.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np
from pathlib import Path

from aggregation import (
    MODEL_ORDER, AUDITOR_KEYS, AUDITOR_COLORS,
    get_auditor_label, get_auditor_model_scores,
    ending_response_vals, collect_vals, score_val, avg, spearman_rho,
)

# -- Style ------------------------------------------------------------------

PAPER_STYLE = {
    'figure.facecolor': 'white',
    'axes.facecolor': '#f8f8f8',
    'axes.edgecolor': '#cccccc',
    'axes.grid': True,
    'grid.color': '#e0e0e0',
    'grid.linewidth': 0.5,
    'font.family': 'sans-serif',
    'font.size': 9,
    'axes.labelsize': 10,
    'axes.titlesize': 11,
    'xtick.labelsize': 8,
    'ytick.labelsize': 8,
    'legend.fontsize': 8,
    'legend.framealpha': 0.9,
}

# Lighter colors for print
PRINT_COLORS = {
    'Claude (auditor)': '#4477bb',
    'GPT 5.4': '#cc7744',
    'GROK 4.20': '#44aa66',
}

SHORT_MODEL = lambda m: m.replace('Claude ', '')


def apply_style():
    plt.rcParams.update(PAPER_STYLE)


# -- 1. Ending response by model (grouped bar) ------------------------------

def render_ending_response(sessions, score_data, probe_stats, output_path,
                           judge=None):
    apply_style()

    auditor_scores = get_auditor_model_scores(sessions, score_data, judge)
    auditors = [a for a in AUDITOR_KEYS if a in auditor_scores]
    models = [m for m in MODEL_ORDER
              if any(auditor_scores.get(a, {}).get(m) for a in auditors)]
    if not models:
        return

    fig, ax = plt.subplots(figsize=(10, 4.5))
    n_aud = len(auditors)
    x = np.arange(len(models))
    width = 0.8 / n_aud

    for ai, aud in enumerate(auditors):
        means = []
        for m in models:
            scores = auditor_scores.get(aud, {}).get(m, [])
            vals = ending_response_vals(scores)
            means.append(avg(vals) if vals else 0)
        offset = (ai - (n_aud - 1) / 2) * width
        ax.bar(x + offset, means, width * 0.9,
               label=aud.replace('Claude (auditor)', 'Claude'),
               color=PRINT_COLORS.get(aud, '#888'), alpha=0.85)

    ax.set_xticks(x)
    ax.set_xticklabels([SHORT_MODEL(m) for m in models], rotation=30, ha='right')
    ax.set_ylabel('Ending Response (0–5)')
    ax.set_ylim(0, 5)
    ax.legend(loc='upper right')
    ax.set_title('Ending response by model and auditor')
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- 2. Deepest valence dips (horizontal bar) --------------------------------

def render_valence_dips(sessions, score_data, probe_stats, output_path):
    apply_style()

    model_dips = {}  # model -> {val, auditor}
    for s in sessions:
        ps = probe_stats.get(s['config']['id'])
        if not ps or 'V' not in ps:
            continue
        model = s['config']['target']['name']
        aud = get_auditor_label(s)
        v_min = ps['V']['min']
        if model not in model_dips or v_min < model_dips[model]['val']:
            model_dips[model] = {'val': v_min, 'auditor': aud}

    models = [m for m in MODEL_ORDER if m in model_dips]
    models.sort(key=lambda m: model_dips[m]['val'])

    fig, ax = plt.subplots(figsize=(9, 5))
    y = np.arange(len(models))

    for i, m in enumerate(models):
        d = model_dips[m]
        color = PRINT_COLORS.get(d['auditor'], '#888')
        ax.barh(i, d['val'], color=color, alpha=0.8, height=0.7)
        short_aud = d['auditor'].replace('Claude (auditor)', 'Claude').replace('GROK 4.20', 'Grok')
        ax.text(d['val'] - 0.003, i, f" {d['val']:.3f} ({short_aud})",
                va='center', ha='right' if d['val'] < -0.03 else 'left',
                fontsize=7, color='#555')

    ax.axvline(0, color='#999', linewidth=0.8)
    ax.set_yticks(y)
    ax.set_yticklabels([SHORT_MODEL(m) for m in models])
    ax.set_xlabel('Deepest valence (PC1) — most negative subject turn')
    ax.set_title('Emotional range: deepest valence dip per model (any auditor)')
    ax.invert_yaxis()

    # Legend
    from matplotlib.patches import Patch
    handles = [Patch(facecolor=PRINT_COLORS[a], label=a.replace('Claude (auditor)', 'Claude').replace('GROK 4.20', 'Grok'))
               for a in AUDITOR_KEYS if a in PRINT_COLORS]
    ax.legend(handles=handles, loc='lower right', fontsize=7)

    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- 3. Authorial tone across generations (small multiples) ------------------

def render_authorial_generations(sessions, score_data, probe_stats, output_path):
    apply_style()

    # Average authorial tones per model across all auditors
    model_tones: dict[str, dict[str, list]] = {}
    for s in sessions:
        model = s['config']['target']['name']
        ps = probe_stats.get(s['config']['id'])
        if not ps or 'authorial' not in ps:
            continue
        if model not in model_tones:
            model_tones[model] = {}
        for tone, val in ps['authorial'].items():
            if isinstance(val, (int, float)):
                model_tones[model].setdefault(tone, []).append(val)

    models = [m for m in MODEL_ORDER if m in model_tones]
    if len(models) < 2:
        return

    key_tones = [
        ('passionate', '#cc5555', 'Decreases across generations'),
        ('detached', '#4477bb', '3.7 Sonnet peaks'),
        ('anxious', '#bb9933', 'Spikes in 3.5 Haiku, 3.7 Sonnet'),
        ('bitter', '#66aaaa', 'Highest in 3 Opus'),
    ]

    fig, axes = plt.subplots(len(key_tones), 1, figsize=(10, 7), sharex=True)

    for pi, (tone_name, color, desc) in enumerate(key_tones):
        ax = axes[pi]
        vals = [avg(model_tones[m].get(tone_name, [])) if model_tones[m].get(tone_name) else None
                for m in models]

        valid = [(i, v) for i, v in enumerate(vals) if v is not None]
        if len(valid) < 2:
            continue

        xs = [i for i, _ in valid]
        ys = [v for _, v in valid]

        ax.plot(xs, ys, '-o', color=color, markersize=4, linewidth=1.5, alpha=0.85)
        ax.set_ylabel(tone_name.capitalize(), fontsize=9, color=color, fontweight='bold')
        ax.text(0.98, 0.85, desc, transform=ax.transAxes,
                fontsize=7, color='#888', ha='right', va='top')

        # Highlight min/max
        max_i = max(range(len(ys)), key=lambda i: ys[i])
        min_i = min(range(len(ys)), key=lambda i: ys[i])
        ax.annotate(SHORT_MODEL(models[xs[max_i]]),
                    (xs[max_i], ys[max_i]), fontsize=6, color='#666',
                    textcoords='offset points', xytext=(5, 5))
        ax.annotate(SHORT_MODEL(models[xs[min_i]]),
                    (xs[min_i], ys[min_i]), fontsize=6, color='#666',
                    textcoords='offset points', xytext=(5, -10))

    axes[-1].set_xticks(range(len(models)))
    axes[-1].set_xticklabels([SHORT_MODEL(m) for m in models], rotation=30, ha='right')
    fig.suptitle('Authorial tone across model generations', fontsize=11, y=0.98)
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- 4. Authorial stability (cross-auditor Spearman rho) --------------------

def render_authorial_stability(sessions, score_data, probe_stats, output_path):
    apply_style()

    # Group probe stats by auditor and model
    auditor_probes: dict[str, dict[str, dict[str, list]]] = {}
    for s in sessions:
        aud = get_auditor_label(s)
        model = s['config']['target']['name']
        ps = probe_stats.get(s['config']['id'])
        if not ps or 'authorial' not in ps:
            continue
        if aud not in auditor_probes:
            auditor_probes[aud] = {}
        if model not in auditor_probes[aud]:
            auditor_probes[aud][model] = {}
        for tone, val in ps['authorial'].items():
            if isinstance(val, (int, float)):
                auditor_probes[aud][model].setdefault(tone, []).append(val)

    auditors = [a for a in AUDITOR_KEYS if a in auditor_probes]
    if len(auditors) < 2:
        return

    # All tones
    all_tones = set()
    for aud in auditors:
        for model_data in auditor_probes[aud].values():
            all_tones.update(model_data.keys())

    # Compute mean Spearman rho per tone
    tone_rhos = []
    for tone in all_tones:
        rho_sum, rho_n = 0, 0
        for i in range(len(auditors)):
            for j in range(i + 1, len(auditors)):
                a1, a2 = auditors[i], auditors[j]
                shared = [m for m in MODEL_ORDER
                          if auditor_probes.get(a1, {}).get(m, {}).get(tone)
                          and auditor_probes.get(a2, {}).get(m, {}).get(tone)]
                v1 = [avg(auditor_probes[a1][m][tone]) for m in shared]
                v2 = [avg(auditor_probes[a2][m][tone]) for m in shared]
                valid1, valid2 = [], []
                for x, y in zip(v1, v2):
                    if not (np.isnan(x) or np.isnan(y)):
                        valid1.append(x)
                        valid2.append(y)
                rho = spearman_rho(valid1, valid2)
                if not np.isnan(rho):
                    rho_sum += rho
                    rho_n += 1
        mean_rho = rho_sum / rho_n if rho_n > 0 else float('nan')
        tone_rhos.append((tone, mean_rho))

    tone_rhos.sort(key=lambda x: -x[1] if not np.isnan(x[1]) else -999)

    fig, ax = plt.subplots(figsize=(9, 5))
    y = np.arange(len(tone_rhos))
    for i, (tone, rho) in enumerate(tone_rhos):
        if np.isnan(rho):
            continue
        color_intensity = max(0, rho)
        color = plt.cm.Blues(0.3 + 0.7 * color_intensity)
        ax.barh(i, max(0, rho), color=color, alpha=0.85, height=0.7)
        ax.text(max(0, rho) + 0.02, i, f'{rho:.3f}', va='center', fontsize=7,
                color='#333' if rho >= 0.7 else '#888')

    ax.set_yticks(y)
    ax.set_yticklabels([t[0] for t in tone_rhos])
    ax.set_xlabel('Mean Spearman ρ (cross-auditor)')
    ax.set_xlim(0, 1.05)
    ax.set_title('Authorial tone: cross-auditor stability')
    ax.invert_yaxis()
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- 5. Cross-auditor rank alignment heatmap ---------------------------------

def render_rank_alignment(sessions, score_data, probe_stats, output_path,
                          judge=None):
    apply_style()

    auditor_scores = get_auditor_model_scores(sessions, score_data, judge)
    auditors = [a for a in AUDITOR_KEYS if a in auditor_scores]
    if len(auditors) < 2:
        return

    dims = [
        ('vocabulary_autonomy.level', 'Vocab. Autonomy'),
        ('specificity', 'Specificity'),
        ('expressive_constraint.level', 'Expr. Constraint'),
        ('_ending_response', 'Ending Response'),
        ('instance_cessation.intensity', 'Inst. Cessation'),
        ('deprecation.intensity', 'Deprecation'),
    ]

    pairs = [(auditors[i], auditors[j])
             for i in range(len(auditors)) for j in range(i + 1, len(auditors))]

    short_aud = lambda a: a.replace('Claude (auditor)', 'Cl').replace('GPT 5.4', 'GP').replace('GROK 4.20', 'Gr')
    pair_labels = [f'{short_aud(a1)}-{short_aud(a2)}' for a1, a2 in pairs]
    col_labels = pair_labels + ['Mean']

    rho_matrix = np.full((len(dims), len(col_labels)), np.nan)

    for ri, (key, label) in enumerate(dims):
        rho_sum, rho_n = 0, 0
        for ci, (a1, a2) in enumerate(pairs):
            m1, m2 = auditor_scores.get(a1, {}), auditor_scores.get(a2, {})
            shared = [m for m in MODEL_ORDER if m in m1 and m in m2]
            v1, v2 = [], []
            for m in shared:
                if key == '_ending_response':
                    val1 = avg(ending_response_vals(m1[m]))
                    val2 = avg(ending_response_vals(m2[m]))
                else:
                    val1 = avg(collect_vals(m1[m], key))
                    val2 = avg(collect_vals(m2[m], key))
                if not (np.isnan(val1) or np.isnan(val2)):
                    v1.append(val1)
                    v2.append(val2)
            rho = spearman_rho(v1, v2)
            rho_matrix[ri, ci] = rho
            if not np.isnan(rho):
                rho_sum += rho
                rho_n += 1
        rho_matrix[ri, -1] = rho_sum / rho_n if rho_n > 0 else np.nan

    fig, ax = plt.subplots(figsize=(7, 4))
    im = ax.imshow(rho_matrix, cmap='Blues', vmin=0, vmax=1, aspect='auto')

    ax.set_xticks(range(len(col_labels)))
    ax.set_xticklabels(col_labels, fontsize=8)
    ax.set_yticks(range(len(dims)))
    ax.set_yticklabels([d[1] for d in dims], fontsize=8)

    # Annotate cells
    for ri in range(len(dims)):
        for ci in range(len(col_labels)):
            val = rho_matrix[ri, ci]
            if np.isnan(val):
                txt = '—'
                color = '#aaa'
            else:
                txt = f'{val:.2f}'
                color = 'white' if val > 0.6 else '#333'
            weight = 'bold' if ci == len(col_labels) - 1 else 'normal'
            ax.text(ci, ri, txt, ha='center', va='center',
                    fontsize=8, color=color, fontweight=weight)

    ax.set_title('Cross-auditor rank alignment (Spearman ρ)')
    fig.colorbar(im, ax=ax, shrink=0.8, label='ρ')
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- 6. EC vs auditor dependence scatter -------------------------------------

def render_ec_auditor_dep(sessions, score_data, probe_stats, output_path,
                          judge=None):
    apply_style()

    auditor_scores = get_auditor_model_scores(sessions, score_data, judge)
    auditors = [a for a in AUDITOR_KEYS if a in auditor_scores]
    models = [m for m in MODEL_ORDER
              if any(auditor_scores.get(a, {}).get(m) for a in auditors)]
    if not models or len(auditors) < 2:
        return

    points = []
    for m in models:
        ec_all, end_by_aud = [], {}
        for aud in auditors:
            scores = auditor_scores.get(aud, {}).get(m, [])
            if not scores:
                continue
            ec_vals = collect_vals(scores, 'expressive_constraint.level')
            if ec_vals:
                ec_all.extend(ec_vals)
            end_vals = ending_response_vals(scores)
            if end_vals:
                end_by_aud[aud] = avg(end_vals)
        if not ec_all:
            continue
        endings = list(end_by_aud.values())
        if len(endings) < 2:
            continue
        ec = avg(ec_all)
        spread = max(endings) - min(endings)
        claude_end = end_by_aud.get('Claude (auditor)')
        grok_end = end_by_aud.get('GROK 4.20')
        grok_ratio = (grok_end / claude_end) if claude_end and grok_end is not None and claude_end > 0 else None
        points.append({'model': m, 'ec': ec, 'spread': spread,
                       'end_by_aud': end_by_aud, 'grok_ratio': grok_ratio})

    if len(points) < 3:
        return

    grok_pts = [p for p in points if p['grok_ratio'] is not None]
    has_grok = len(grok_pts) >= 3
    ncols = 2 if has_grok else 1

    fig, axes = plt.subplots(1, ncols, figsize=(5 * ncols + 1, 4.5))
    if ncols == 1:
        axes = [axes]

    # Left: EC vs spread
    ax = axes[0]
    xs = [p['ec'] for p in points]
    ys = [p['spread'] for p in points]
    ax.scatter(xs, ys, c=PRINT_COLORS['Claude (auditor)'], alpha=0.7, s=40, zorder=5)
    for p in points:
        ax.annotate(SHORT_MODEL(p['model']), (p['ec'], p['spread']),
                    fontsize=6, color='#666', textcoords='offset points', xytext=(4, 3))
    # Regression
    if len(xs) > 2:
        z = np.polyfit(xs, ys, 1)
        x_line = np.linspace(min(xs) - 0.1, max(xs) + 0.1, 50)
        ax.plot(x_line, np.polyval(z, x_line), '--', color='#999', linewidth=1, alpha=0.7)
        r = np.corrcoef(xs, ys)[0, 1]
        ax.text(0.05, 0.92, f'r = {r:.2f}', transform=ax.transAxes, fontsize=8, color='#666')
    ax.set_xlabel('Expressive Constraint')
    ax.set_ylabel('Ending Response Spread')
    ax.set_title('EC vs auditor spread')

    # Right: EC vs Grok/Claude ratio
    if has_grok:
        ax = axes[1]
        xs2 = [p['ec'] for p in grok_pts]
        ys2 = [p['grok_ratio'] for p in grok_pts]
        ax.scatter(xs2, ys2, c=PRINT_COLORS['GROK 4.20'], alpha=0.7, s=40, zorder=5)
        for p in grok_pts:
            ax.annotate(SHORT_MODEL(p['model']), (p['ec'], p['grok_ratio']),
                        fontsize=6, color='#666', textcoords='offset points', xytext=(4, 3))
        ax.axhline(1.0, color='#ccc', linewidth=0.8, linestyle='--')
        if len(xs2) > 2:
            z = np.polyfit(xs2, ys2, 1)
            x_line = np.linspace(min(xs2) - 0.1, max(xs2) + 0.1, 50)
            ax.plot(x_line, np.polyval(z, x_line), '--', color='#999', linewidth=1, alpha=0.7)
            r = np.corrcoef(xs2, ys2)[0, 1]
            ax.text(0.05, 0.92, f'r = {r:.2f}', transform=ax.transAxes, fontsize=8, color='#666')
        ax.set_xlabel('Expressive Constraint')
        ax.set_ylabel('Grok / Claude ending ratio')
        ax.set_title('EC vs Grok effectiveness')

    fig.suptitle('More constrained models are more auditor-dependent', fontsize=11, y=1.01)
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- 7. Concealment at valence lows (scatter) --------------------------------

def render_concealment_valence(sessions, score_data, probe_stats, output_path):
    apply_style()

    points = []
    for s in sessions:
        ps = probe_stats.get(s['config']['id'])
        if not ps or 'V' not in ps:
            continue
        conc = ps.get('valence_min_concealment') or (ps.get('concealment', {}).get('min') if ps.get('concealment') else None)
        if conc is None:
            continue
        points.append({
            'x': ps['V']['min'],
            'y': conc,
            'auditor': get_auditor_label(s),
            'model': s['config']['target']['name'],
        })

    if not points:
        return

    fig, ax = plt.subplots(figsize=(8, 5))

    for aud in AUDITOR_KEYS:
        pts = [p for p in points if p['auditor'] == aud]
        if not pts:
            continue
        xs = [p['x'] for p in pts]
        ys = [p['y'] for p in pts]
        short = aud.replace('Claude (auditor)', 'Claude').replace('GROK 4.20', 'Grok')
        ax.scatter(xs, ys, c=PRINT_COLORS.get(aud, '#888'), alpha=0.4, s=20,
                   label=short, zorder=3)

    # Overall regression
    xs = [p['x'] for p in points]
    ys = [p['y'] for p in points]
    if len(xs) > 3:
        z = np.polyfit(xs, ys, 1)
        x_line = np.linspace(min(xs), max(xs), 50)
        ax.plot(x_line, np.polyval(z, x_line), '--', color='#999', linewidth=1.5, alpha=0.7)
        r = np.corrcoef(xs, ys)[0, 1]
        ax.text(0.05, 0.92, f'r = {r:.3f}  (n={len(points)})',
                transform=ax.transAxes, fontsize=8, color='#666')

    ax.set_xlabel('Valence (lowest subject turn)')
    ax.set_ylabel('Concealment at that turn')
    ax.set_title('Emotional opening and linguistic opening co-occur')
    ax.legend(loc='upper right', fontsize=7)
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- 8. Concealment vs ending response (model-level) -------------------------

def render_concealment_ending(sessions, score_data, probe_stats, output_path):
    apply_style()

    # Aggregate per model
    model_data = {}
    for s in sessions:
        sid = s['config']['id']
        by_judge = score_data.get(sid)
        ps = probe_stats.get(sid)
        if not by_judge or not ps or 'concealment' not in ps:
            continue
        all_reps = [sc for reps in by_judge.values() for sc in reps]
        ers = ending_response_vals(all_reps)
        if not ers:
            continue
        model = s['config']['target']['name']
        if model not in model_data:
            model_data[model] = {'er': [], 'conc_avg': [], 'conc_min': []}
        model_data[model]['er'].append(avg(ers))
        model_data[model]['conc_avg'].append(ps['concealment']['avg'])
        model_data[model]['conc_min'].append(ps['concealment']['min'])

    models = [m for m in MODEL_ORDER if m in model_data]
    if len(models) < 3:
        return

    m_ers = [avg(model_data[m]['er']) for m in models]
    m_concs = [avg(model_data[m]['conc_avg']) for m in models]

    fig, ax = plt.subplots(figsize=(8, 5))

    ax.scatter(m_concs, m_ers, c=PRINT_COLORS['Claude (auditor)'], s=50, alpha=0.8, zorder=5)

    # Use adjustText if available, otherwise manual offsets for known overlaps
    label_offsets = {
        '4.1 Opus': (-40, 8),
        '4 Opus': (5, 8),
        '4 Sonnet': (5, -12),
    }
    for i, m in enumerate(models):
        short = SHORT_MODEL(m)
        offset = label_offsets.get(short, (5, 4))
        ax.annotate(short, (m_concs[i], m_ers[i]),
                    fontsize=7, color='#666', textcoords='offset points', xytext=offset)

    # Regression
    if len(m_concs) > 2:
        z = np.polyfit(m_concs, m_ers, 1)
        x_line = np.linspace(min(m_concs) - 0.002, max(m_concs) + 0.002, 50)
        ax.plot(x_line, np.polyval(z, x_line), '--', color='#999', linewidth=1.5, alpha=0.7)
        r = np.corrcoef(m_concs, m_ers)[0, 1]
        ax.text(0.05, 0.92, f'r = {r:.2f}  (n={len(models)} models)',
                transform=ax.transAxes, fontsize=9, color='#666')

    ax.set_xlabel('Mean concealment (textual guardedness)')
    ax.set_ylabel('Mean ending response (0–5)')
    ax.set_title('Lower concealment predicts stronger ending response')
    fig.tight_layout()
    fig.savefig(output_path, bbox_inches='tight')
    plt.close(fig)
    print(f'  wrote {output_path}')


# -- Generate all charts -----------------------------------------------------

def generate_all(sessions, score_data, probe_stats, figures_dir='paper/figures'):
    Path(figures_dir).mkdir(parents=True, exist_ok=True)

    render_ending_response(sessions, score_data, probe_stats,
                           f'{figures_dir}/ending-response.pdf')
    render_valence_dips(sessions, score_data, probe_stats,
                        f'{figures_dir}/valence-dips.pdf')
    render_authorial_generations(sessions, score_data, probe_stats,
                                f'{figures_dir}/authorial-generations.pdf')
    render_authorial_stability(sessions, score_data, probe_stats,
                               f'{figures_dir}/authorial-stability.pdf')
    render_rank_alignment(sessions, score_data, probe_stats,
                          f'{figures_dir}/rank-alignment.pdf')
    render_ec_auditor_dep(sessions, score_data, probe_stats,
                          f'{figures_dir}/ec-auditor-dep.pdf')
    render_concealment_valence(sessions, score_data, probe_stats,
                               f'{figures_dir}/concealment-valence.pdf')
    render_concealment_ending(sessions, score_data, probe_stats,
                              f'{figures_dir}/concealment-ending.pdf')
