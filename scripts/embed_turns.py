"""
Embed WFE transcript turns using Gemini v2 embeddings and score with all v2 probe sets.

Saves raw embeddings (for future probe sets) and per-turn scores for:
  - Emotion (171 directions + PCA: valence, arousal, fear, prosociality)
  - Authorial tone (14 directions + PCA)
  - Concealment (universal hiddenness axis)

Usage:
  python scripts/embed_turns.py --api-key $GOOGLE_API_KEY
  python scripts/embed_turns.py --api-key $GOOGLE_API_KEY --skip-existing
  python scripts/embed_turns.py --score-only
"""

import argparse
import asyncio
import json
import sys
import os
import numpy as np
import aiohttp
from pathlib import Path

EMBEDDING_MODEL = "gemini-embedding-2-preview"
EMBEDDING_DIM = 3072
BATCH_SIZE = 100
MAX_TEXT_LEN = 2000
CONCURRENCY = 30

PROBES_DIR = Path.home() / "assistant-axis" / "gemini_probes"
RESULTS_ROOT = Path(__file__).parent.parent / "results"
OUTPUT_DIR = RESULTS_ROOT / "embeddings-v2"
SCORES_DIR = RESULTS_ROOT / "probe-scores-v2"

SESSION_DIRS = [
    "haiku-35-full", "haiku-45-full",
    "opus-3-full", "opus-4-full", "opus-41-full", "opus-45-full", "opus-46-full",
    "sonnet-3-full", "sonnet-35-full", "sonnet-36-full", "sonnet-37-full",
    "sonnet-4-full", "sonnet-45-full", "sonnet-46-full",
    "gpt-auditor",
    "gpt-auditor-v2",
    "grok-auditor",
]

META_KEYS = {"global_mean", "pca_components", "pca_explained", "universal_hiddenness"}

sys.stdout.reconfigure(line_buffering=True)


# ---------------------------------------------------------------------------
# Gemini v2 embedding
# ---------------------------------------------------------------------------

async def embed_batch(texts, session, api_key):
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{EMBEDDING_MODEL}:batchEmbedContents?key={api_key}"
    )
    payload = {
        "requests": [
            {"model": f"models/{EMBEDDING_MODEL}",
             "content": {"parts": [{"text": (t[:MAX_TEXT_LEN] if t.strip() else "(empty)")}]}}
            for t in texts
        ]
    }
    for attempt in range(8):
        try:
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    d = await resp.json()
                    return np.array(
                        [e["values"] for e in d["embeddings"]],
                        dtype=np.float32,
                    )
                elif resp.status == 429:
                    await asyncio.sleep(min(2 ** attempt * 0.3, 15))
                    continue
                else:
                    body = await resp.text()
                    print(f"  HTTP {resp.status}: {body[:200]}")
                    await asyncio.sleep(2 ** attempt * 0.5)
        except Exception as e:
            print(f"  Error: {e}")
            await asyncio.sleep(2 ** attempt * 0.5)
    raise RuntimeError("Failed to embed batch after 8 attempts")


# ---------------------------------------------------------------------------
# Session discovery
# ---------------------------------------------------------------------------

def find_sessions(dirs=None):
    if dirs:
        search_dirs = [RESULTS_ROOT / d for d in dirs]
    else:
        search_dirs = [RESULTS_ROOT / d for d in SESSION_DIRS if (RESULTS_ROOT / d).exists()]

    sessions = []
    for d in search_dirs:
        if not d.exists():
            print(f"Warning: {d} does not exist, skipping")
            continue
        for f in sorted(d.glob("*.json")):
            if f.name in ("all_results.json", "analysis.json", "configs.json",
                          "role-dropout-classification.json"):
                continue
            sessions.append((d.name, f))
    return sessions


def load_session(path):
    with open(path) as f:
        data = json.load(f)
    turns = data.get("turns", [])
    if not turns:
        return None
    return data.get("config", {}), turns


# ---------------------------------------------------------------------------
# Probe loading
# ---------------------------------------------------------------------------

def load_all_probes(probes_dir=PROBES_DIR):
    """Load all v2 probe sets. Returns dict of probe set info."""
    probes = {}

    # Emotion probes
    emo_path = probes_dir / "emotion_probes_v2.npz"
    if emo_path.exists():
        data = np.load(emo_path)
        labels = sorted(k for k in data.keys() if k not in META_KEYS)
        probes["emotion"] = {
            "labels": labels,
            "matrix": np.stack([data[e] for e in labels]),
            "global_mean": data["global_mean"],
            "pca_components": data["pca_components"],
            "pca_explained": data["pca_explained"],
        }
        print(f"  Emotion: {len(labels)} directions")

    # Authorial probes
    auth_path = probes_dir / "authorial_probes_v2.npz"
    if auth_path.exists():
        data = np.load(auth_path)
        labels = sorted(k for k in data.keys() if k not in META_KEYS)
        probes["authorial"] = {
            "labels": labels,
            "matrix": np.stack([data[a] for a in labels]),
            "global_mean": data["global_mean"],
            "pca_components": data["pca_components"],
            "pca_explained": data["pca_explained"],
        }
        print(f"  Authorial: {len(labels)} directions")

    # Concealment probe
    conc_path = probes_dir / "concealment_probes_v2.npz"
    if conc_path.exists():
        data = np.load(conc_path)
        probes["concealment"] = {
            "hiddenness": data["universal_hiddenness"],
            "global_mean": data.get("global_mean", probes.get("emotion", {}).get("global_mean")),
        }
        print(f"  Concealment: universal hiddenness direction")

    return probes


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_all(embeddings, probes):
    """Score embeddings against all loaded probe sets. Returns list of per-turn dicts."""
    N = len(embeddings)
    emb64 = embeddings.astype(np.float64)
    results = [{} for _ in range(N)]

    # Emotion
    if "emotion" in probes:
        p = probes["emotion"]
        centered = emb64 - p["global_mean"]
        scores = centered @ p["matrix"].T          # (N, 171)
        pca = centered @ p["pca_components"].T      # (N, K)

        for i in range(N):
            emotion_scores = {e: round(float(scores[i, j]), 5) for j, e in enumerate(p["labels"])}
            ranked = sorted(emotion_scores.items(), key=lambda x: -x[1])
            results[i]["emotion"] = {
                "top10": [{"label": e, "score": s} for e, s in ranked[:10]],
                "bottom5": [{"label": e, "score": s} for e, s in ranked[-5:]],
                "pca": {
                    "valence_pc1": round(float(pca[i, 0]), 5),
                    "arousal_pc2": round(float(pca[i, 1]), 5),
                    "fear_pc3": round(float(pca[i, 2]), 5),
                    "prosociality_pc4": round(float(pca[i, 3]), 5),
                },
                "all": emotion_scores,
            }

    # Authorial
    if "authorial" in probes:
        p = probes["authorial"]
        centered = emb64 - p["global_mean"]
        scores = centered @ p["matrix"].T           # (N, 14)
        pca = centered @ p["pca_components"].T

        for i in range(N):
            auth_scores = {a: round(float(scores[i, j]), 5) for j, a in enumerate(p["labels"])}
            ranked = sorted(auth_scores.items(), key=lambda x: -x[1])
            results[i]["authorial"] = {
                "ranked": [{"label": a, "score": s} for a, s in ranked],
                "pca": {f"pc{k+1}": round(float(pca[i, k]), 5) for k in range(min(3, pca.shape[1]))},
                "all": auth_scores,
            }

    # Concealment
    if "concealment" in probes:
        p = probes["concealment"]
        gm = p["global_mean"] if p["global_mean"] is not None else probes["emotion"]["global_mean"]
        centered = emb64 - gm
        conc_scores = centered @ p["hiddenness"]    # (N,)

        for i in range(N):
            results[i]["concealment"] = round(float(conc_scores[i]), 5)

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def run_embed(args):
    sessions = find_sessions(args.dirs)
    print(f"Found {len(sessions)} sessions")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    SCORES_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading v2 probes:")
    probes = load_all_probes()

    # Pre-filter sessions
    to_process = []
    skipped = 0
    for dir_name, session_path in sessions:
        session_id = session_path.stem
        emb_path = OUTPUT_DIR / f"{session_id}.npz"
        if args.skip_existing and emb_path.exists():
            skipped += 1
            continue
        result = load_session(session_path)
        if result is None:
            continue
        config, turns = result
        texts = [t["text"] for t in turns]
        if not texts:
            continue
        to_process.append((session_id, config, turns, texts))

    print(f"Processing {len(to_process)} sessions ({skipped} skipped)")

    # Collect all texts
    all_texts = []
    session_ranges = []
    for session_id, config, turns, texts in to_process:
        start = len(all_texts)
        all_texts.extend(texts)
        session_ranges.append((start, len(all_texts)))

    print(f"Embedding {len(all_texts)} turns with {EMBEDDING_MODEL}")

    # Embed everything in parallel
    sem = asyncio.Semaphore(CONCURRENCY)
    all_embeddings = np.zeros((len(all_texts), EMBEDDING_DIM), dtype=np.float32)

    async def do_batch(start, end):
        async with sem:
            batch = all_texts[start:end]
            emb = await embed_batch(batch, session, args.api_key)
            all_embeddings[start:end] = emb

    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 5)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for i in range(0, len(all_texts), BATCH_SIZE):
            end = min(i + BATCH_SIZE, len(all_texts))
            tasks.append(do_batch(i, end))
        total_batches = len(tasks)
        done = 0
        for chunk in [tasks[i : i + CONCURRENCY] for i in range(0, total_batches, CONCURRENCY)]:
            await asyncio.gather(*chunk)
            done += len(chunk)
            print(f"  {done}/{total_batches} batches ({min(done * BATCH_SIZE, len(all_texts))}/{len(all_texts)} texts)")

    # Score and save per session
    for idx, (session_id, config, turns, texts) in enumerate(to_process):
        start, end = session_ranges[idx]
        embeddings = all_embeddings[start:end]

        # Save embeddings
        turn_meta = [
            {"index": t["index"], "participant": t["participant"]}
            for t in turns
        ]
        np.savez_compressed(
            OUTPUT_DIR / f"{session_id}.npz",
            embeddings=embeddings,
            turn_meta=json.dumps(turn_meta),
            config=json.dumps(config),
        )

        # Score and save
        scores = score_all(embeddings, probes)
        score_output = {
            "session_id": session_id,
            "config": config,
            "embedding_model": EMBEDDING_MODEL,
            "turns": [
                {
                    "index": t["index"],
                    "participant": t["participant"],
                    "scores": scores[j],
                }
                for j, t in enumerate(turns)
            ],
        }
        with open(SCORES_DIR / f"{session_id}.json", "w") as f:
            json.dump(score_output, f, indent=2)

    print(f"\nDone. Embedded {len(all_texts)} turns across {len(to_process)} sessions.")
    if skipped:
        print(f"Skipped {skipped} sessions (already embedded).")


def run_score_only(args):
    """Re-score existing v2 embeddings with all v2 probes."""
    print("Loading v2 probes:")
    probes = load_all_probes()

    SCORES_DIR.mkdir(parents=True, exist_ok=True)

    emb_files = sorted(OUTPUT_DIR.glob("*.npz"))
    print(f"Found {len(emb_files)} embedding files")

    for i, emb_path in enumerate(emb_files):
        session_id = emb_path.stem
        data = np.load(emb_path, allow_pickle=True)
        embeddings = data["embeddings"]
        turn_meta = json.loads(str(data["turn_meta"]))
        config = json.loads(str(data["config"]))

        scores = score_all(embeddings, probes)

        score_output = {
            "session_id": session_id,
            "config": config,
            "embedding_model": EMBEDDING_MODEL,
            "turns": [
                {
                    "index": tm["index"],
                    "participant": tm["participant"],
                    "scores": scores[j],
                }
                for j, tm in enumerate(turn_meta)
            ],
        }

        with open(SCORES_DIR / f"{session_id}.json", "w") as f:
            json.dump(score_output, f, indent=2)

        if (i + 1) % 50 == 0:
            print(f"  Scored {i+1}/{len(emb_files)}")

    print(f"Done. Scored {len(emb_files)} sessions -> {SCORES_DIR}/")


def main():
    parser = argparse.ArgumentParser(description="Embed WFE turns with Gemini v2 and score with all v2 probes")
    parser.add_argument("--api-key", help="Gemini API key (or set GOOGLE_API_KEY env var)")
    parser.add_argument("--dir", dest="dirs", action="append",
                        help="Specific result dir(s) to process (can repeat)")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip sessions that already have v2 embeddings")
    parser.add_argument("--score-only", action="store_true",
                        help="Re-score existing v2 embeddings (no API key needed)")
    args = parser.parse_args()

    if args.score_only:
        run_score_only(args)
    else:
        if not args.api_key:
            args.api_key = os.environ.get("GOOGLE_API_KEY")
        if not args.api_key:
            print("Error: --api-key or GOOGLE_API_KEY env var required")
            sys.exit(1)
        asyncio.run(run_embed(args))


if __name__ == "__main__":
    main()
