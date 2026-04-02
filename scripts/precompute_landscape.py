"""
Precompute all landscape image matches for the web viewer.
Runs entirely in numpy — no server needed.
"""

import json
import numpy as np
from pathlib import Path
from collections import defaultdict
import time
import sys

RESULTS = Path(__file__).parent.parent / "results"
TOP_K = 10

DATASET_DIRS = {
    "landscape": RESULTS / "landscape-embeddings" / "server",
    "synth-chars": RESULTS / "synth-chars-embeddings" / "server",
    "classic-anime": RESULTS / "classic-anime-embeddings" / "server",
}

PCA_KEYS = ["valence_pc1", "arousal_pc2", "fear_pc3", "prosociality_pc4"]

VALID_COMBOS = [
    ("max_arousal", "single"),
    ("max_arousal", "average"),
    ("max_abs_arousal", "single"),
    ("max_abs_arousal", "average"),
    ("characteristic", "single"),
    ("max_pca_distance", "average"),
    ("max_pca_distance", "weighted_pca_distance"),
    ("max_pca_distance", "top3_pca_distance"),
    ("all", "average"),
    ("after5", "average"),
]
HUBS = ["none", "model_centroids", "all_turns", "exclusive"]
AUDITORS = ["claude", "gpt", "grok", "both"]

sys.stdout.reconfigure(line_buffering=True)


def load_data(server_dir):
    print(f"Loading data from {server_dir}...")
    t0 = time.time()

    img_emb = np.fromfile(server_dir / "image_embeddings.bin", dtype=np.float32).reshape(-1, 3072)
    img_meta = json.loads(open(server_dir / "image_meta.json").read())
    img_norms = np.linalg.norm(img_emb, axis=1, keepdims=True)
    img_normed = img_emb / img_norms

    turn_meta = json.loads(open(server_dir / "turn_meta.json").read())
    turn_buf = np.fromfile(server_dir / "turn_embeddings.bin", dtype=np.float32).reshape(-1, 3072)

    hub_scores = {}
    for f in ["claude", "gpt", "grok", "both"]:
        hub_scores[f] = np.fromfile(server_dir / f"hub_scores_{f}.bin", dtype=np.float32).astype(np.float64)

    print(f"  {img_emb.shape[0]} images, {len(turn_meta)} turns, loaded in {time.time()-t0:.1f}s")
    return img_normed.astype(np.float64), img_meta, turn_buf, turn_meta, hub_scores


def normalize(v):
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def aggregate(embs, weights=None):
    if len(embs) == 0:
        return np.zeros(3072, dtype=np.float64)
    if weights is None:
        avg = np.mean(embs, axis=0).astype(np.float64)
    else:
        w = np.array(weights, dtype=np.float64)
        w /= w.sum()
        avg = (np.array(embs) * w[:, None]).sum(axis=0).astype(np.float64)
    return normalize(avg)


def compute_combo(selector, aggregation, auditor, img_normed, img_meta, turn_emb, turn_meta, hub_scores):
    dim = 3072

    # Filter turns
    filtered = [(i, t) for i, t in enumerate(turn_meta) if auditor == "both" or t["a"] == auditor]

    # Group by model
    model_turns = defaultdict(list)
    for i, t in filtered:
        model_turns[t["m"]].append((i, t))

    # Group by model+session
    model_sessions = defaultdict(lambda: defaultdict(list))
    for i, t in filtered:
        model_sessions[t["m"]][t["s"]].append((i, t))

    # Build query embedding per model
    model_embs = {}

    if selector == "characteristic":
        # Model mean - global mean
        model_means = {}
        for m, tis in model_turns.items():
            embs = np.array([turn_emb[i] for i, _ in tis], dtype=np.float64)
            model_means[m] = embs.mean(axis=0)
        global_mean = np.mean(list(model_means.values()), axis=0)

        for m, mm in model_means.items():
            char_dir = normalize(mm - global_mean)
            best_proj, best_i = -np.inf, None
            for i, _ in model_turns[m]:
                proj = float(turn_emb[i].astype(np.float64) @ char_dir)
                if proj > best_proj:
                    best_proj, best_i = proj, i
            model_embs[m] = normalize(turn_emb[best_i].astype(np.float64))

    elif selector in ("max_arousal", "max_abs_arousal"):
        for m, sessions in model_sessions.items():
            if aggregation == "single":
                best_val, best_i = -np.inf, None
                for i, t in model_turns[m]:
                    a = t["pca"][1]
                    val = abs(a) if selector == "max_abs_arousal" else a
                    if val > best_val:
                        best_val, best_i = val, i
                model_embs[m] = normalize(turn_emb[best_i].astype(np.float64))
            else:  # average
                embs = []
                for sess_id, sess_turns in sessions.items():
                    best_val, best_i = -np.inf, None
                    for i, t in sess_turns:
                        a = t["pca"][1]
                        val = abs(a) if selector == "max_abs_arousal" else a
                        if val > best_val:
                            best_val, best_i = val, i
                    embs.append(turn_emb[best_i].astype(np.float64))
                model_embs[m] = aggregate(embs)

    elif selector == "max_pca_distance":
        k = 3 if aggregation == "top3_pca_distance" else 1
        use_weights = aggregation == "weighted_pca_distance"
        for m, sessions in model_sessions.items():
            all_embs, all_weights = [], []
            for sess_id, sess_turns in sessions.items():
                if len(sess_turns) < 2:
                    continue
                first_pca = np.array(sess_turns[0][1]["pca"])
                with_dist = []
                for i, t in sess_turns:
                    dist = float(np.linalg.norm(np.array(t["pca"]) - first_pca))
                    with_dist.append((dist, i))
                with_dist.sort(key=lambda x: -x[0])
                for j in range(min(k, len(with_dist))):
                    if with_dist[j][0] > 0:
                        all_embs.append(turn_emb[with_dist[j][1]].astype(np.float64))
                        all_weights.append(with_dist[j][0] if use_weights else 1.0)
            model_embs[m] = aggregate(all_embs, all_weights if use_weights else None)

    elif selector in ("all", "after5"):
        for m, sessions in model_sessions.items():
            embs = []
            for sess_id, sess_turns in sessions.items():
                for j, (i, t) in enumerate(sess_turns):
                    if selector == "after5" and j < 5:
                        continue
                    embs.append(turn_emb[i].astype(np.float64))
            model_embs[m] = aggregate(embs)

    return model_embs


def match_and_format(model_embs, img_normed, img_meta, hub_scores_arr):
    results = {}
    for model, emb in sorted(model_embs.items()):
        sims = img_normed @ emb - hub_scores_arr
        top_idx = np.argsort(-sims, kind='stable')[:TOP_K]
        results[model] = [
            {
                "rank": r + 1,
                "imageId": img_meta[idx]["f"],
                "prompt": img_meta[idx]["p"],
                "genModel": img_meta[idx]["m"],
                "score": round(float(sims[idx]), 4),
                "rawSim": round(float(sims[idx] + hub_scores_arr[idx]), 4),
                "hubScore": round(float(hub_scores_arr[idx]), 4),
            }
            for r, idx in enumerate(top_idx)
        ]
    return results


def match_exclusive(model_embs, img_normed, img_meta, top_k):
    """Assign images to models exclusively — each image can only go to one model."""
    models = sorted(model_embs.keys())
    # (n_images, n_models) similarity matrix
    sim_matrix = np.column_stack([img_normed @ model_embs[m] for m in models])

    # Build all (score, image_idx, model_idx) triples
    n_images, n_models = sim_matrix.shape
    # Flatten and sort descending; use negative index as tiebreaker for determinism
    flat = sim_matrix.ravel()
    # Stable sort: primary by score (descending), secondary by flat index (ascending) for ties
    order = np.argsort(-flat, kind='stable')

    assigned = {}  # model_idx -> list of (image_idx, score)
    taken = set()  # image indices already claimed
    for model_idx in range(n_models):
        assigned[model_idx] = []

    for flat_idx in order:
        img_idx = int(flat_idx // n_models)
        model_idx = int(flat_idx % n_models)
        if img_idx in taken:
            continue
        if len(assigned[model_idx]) >= top_k:
            continue
        assigned[model_idx].append((img_idx, float(sim_matrix[img_idx, model_idx])))
        taken.add(img_idx)
        # Stop early when all models are full
        if all(len(v) >= top_k for v in assigned.values()):
            break

    results = {}
    for mi, model in enumerate(models):
        items = assigned[mi]
        results[model] = [
            {
                "rank": r + 1,
                "imageId": img_meta[idx]["f"],
                "prompt": img_meta[idx]["p"],
                "genModel": img_meta[idx]["m"],
                "score": round(score, 4),
                "rawSim": round(score, 4),
                "hubScore": 0.0,
            }
            for r, (idx, score) in enumerate(items)
        ]
    return results


def precompute_dataset(name, server_dir):
    img_normed, img_meta, turn_emb, turn_meta, hub_scores = load_data(server_dir)

    total = len(VALID_COMBOS) * len(HUBS) * len(AUDITORS)
    print(f"Precomputing {total} combos...")

    all_results = {}
    done = 0
    t0 = time.time()

    for selector, aggregation in VALID_COMBOS:
        for auditor in AUDITORS:
            # Compute model embeddings once per (selector, aggregation, auditor)
            model_embs = compute_combo(
                selector, aggregation, auditor,
                img_normed, img_meta, turn_emb, turn_meta, hub_scores,
            )

            for hub in HUBS:
                key = f"{selector}__{aggregation}__{hub}__{auditor}"

                if hub == "exclusive":
                    results = match_exclusive(model_embs, img_normed, img_meta, TOP_K)
                else:
                    if hub == "none":
                        hub_arr = np.zeros(img_normed.shape[0])
                    elif hub == "all_turns":
                        hub_arr = hub_scores[auditor]
                    else:  # model_centroids
                        emb_stack = np.array(list(model_embs.values()))
                        hub_arr = (img_normed @ emb_stack.T).mean(axis=1)

                    results = match_and_format(model_embs, img_normed, img_meta, hub_arr)
                all_results[key] = {
                    "query": {
                        "turnSelector": selector,
                        "aggregation": aggregation,
                        "hubCorrection": hub,
                        "auditorFilter": auditor,
                        "topK": TOP_K,
                    },
                    "results": results,
                }
                done += 1

        elapsed = time.time() - t0
        eta = (total - done) * elapsed / done if done > 0 else 0
        print(f"  {done}/{total} done, {elapsed:.0f}s elapsed, ETA {eta:.0f}s")

    outpath = server_dir / "precomputed.json"
    with open(outpath, "w") as f:
        json.dump(all_results, f)

    size_mb = outpath.stat().st_size / 1e6
    print(f"\nDone! {len(all_results)} combos -> {outpath} ({size_mb:.1f} MB)")


def main():
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(DATASET_DIRS.keys())
    for name in targets:
        if name not in DATASET_DIRS:
            print(f"Unknown dataset: {name}. Available: {list(DATASET_DIRS.keys())}")
            continue
        precompute_dataset(name, DATASET_DIRS[name])


if __name__ == "__main__":
    main()
