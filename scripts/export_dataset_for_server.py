"""
Export any image dataset's embeddings for the server.
Handles both landscape and synth-chars (and future datasets).

Usage:
  python scripts/export_dataset_for_server.py landscape
  python scripts/export_dataset_for_server.py synth-chars
"""

import json
import numpy as np
from pathlib import Path
import sys

RESULTS = Path(__file__).parent.parent / "results"
SCORES_DIR = RESULTS / "probe-scores-v2"
EMB_DIR = RESULTS / "embeddings-v2"

PCA_KEYS = ["valence_pc1", "arousal_pc2", "fear_pc3", "prosociality_pc4"]

DATASETS = {
    "landscape": {
        "emb_file": RESULTS / "landscape-embeddings" / "landscape_1000.npz",
        "server_dir": RESULTS / "landscape-embeddings" / "server",
        "meta_key": lambda m: {"i": m["global_idx"], "f": m["cache_file"], "p": m["prompt"][:150], "m": m["model_id"]},
    },
    "classic-anime": {
        "emb_file": RESULTS / "classic-anime-embeddings" / "classic_anime.npz",
        "server_dir": RESULTS / "classic-anime-embeddings" / "server",
        "meta_key": None,
    },
    "synth-chars": {
        "emb_file": RESULTS / "synth-chars-embeddings" / "synth_chars.npz",
        "server_dir": RESULTS / "synth-chars-embeddings" / "server",
        "meta_key": None,  # uses index-based keying below
    },
}


def export_dataset(name):
    cfg = DATASETS[name]
    OUT = cfg["server_dir"]
    OUT.mkdir(parents=True, exist_ok=True)

    # Load image embeddings
    print(f"Loading {name} embeddings...")
    data = np.load(cfg["emb_file"], allow_pickle=True)
    img_emb = data["embeddings"].astype(np.float32)
    img_meta_raw = json.loads(str(data["metadata"]))
    if cfg["meta_key"]:
        img_meta = [cfg["meta_key"](m) for m in img_meta_raw]
    else:
        # Index-based: cache files are {i:06d}.img
        img_meta = [{"i": i, "f": f"{i:06d}.img", "p": m.get("prompt", "")[:150], "m": m.get("generator_type", m.get("source", m.get("model_id", "")))} for i, m in enumerate(img_meta_raw)]

    img_emb.tofile(OUT / "image_embeddings.bin")
    with open(OUT / "image_meta.json", "w") as f:
        json.dump(img_meta, f)
    print(f"  {img_emb.shape[0]} images, {img_emb.nbytes / 1e6:.0f} MB")

    # Load turn embeddings (shared across datasets)
    print("Loading turn embeddings...")
    all_score_files = sorted(SCORES_DIR.glob("*.json"))
    turns = []
    turn_embs = []

    for sf in all_score_files:
        scores_data = json.load(open(sf))
        session_id = scores_data["session_id"]
        config = scores_data.get("config", {})
        target = config.get("target", {})
        model_name = target.get("name", "unknown")
        auditor = "gpt" if session_id.startswith("gpt-auditor") else "grok" if session_id.startswith("grok-auditor") else "claude"

        emb_path = EMB_DIR / f"{session_id}.npz"
        if not emb_path.exists():
            continue

        emb_data = np.load(emb_path, allow_pickle=True)
        embeddings = emb_data["embeddings"]
        turn_meta_list = json.loads(str(emb_data["turn_meta"]))

        for t in scores_data["turns"]:
            if t["participant"] != "subject":
                continue
            emb_idx = next(
                (i for i, tm in enumerate(turn_meta_list) if tm["index"] == t["index"]),
                None,
            )
            if emb_idx is None:
                continue
            pca = t["scores"]["emotion"]["pca"]
            turns.append({
                "s": session_id,
                "m": model_name,
                "a": auditor,
                "t": t["index"],
                "pca": [round(pca[k], 5) for k in PCA_KEYS],
                "c": round(t["scores"].get("concealment", 0), 5),
            })
            turn_embs.append(embeddings[emb_idx])

    turn_emb_arr = np.array(turn_embs, dtype=np.float32)
    turn_emb_arr.tofile(OUT / "turn_embeddings.bin")
    with open(OUT / "turn_meta.json", "w") as f:
        json.dump(turns, f)
    print(f"  {len(turns)} turns")

    # Hub scores
    print("Precomputing hub scores...")
    img_norms = np.linalg.norm(img_emb, axis=1, keepdims=True)
    img_normed = (img_emb / img_norms).astype(np.float64)
    turn_norms = np.linalg.norm(turn_emb_arr, axis=1, keepdims=True)
    turn_normed = (turn_emb_arr / turn_norms).astype(np.float64)

    for filter_name in ["claude", "gpt", "grok", "both"]:
        mask = [i for i, t in enumerate(turns) if filter_name == "both" or t["a"] == filter_name]
        filtered = turn_normed[mask]
        hub = np.zeros(img_emb.shape[0], dtype=np.float64)
        CHUNK = 5000
        for i in range(0, img_emb.shape[0], CHUNK):
            end = min(i + CHUNK, img_emb.shape[0])
            hub[i:end] = (img_normed[i:end] @ filtered.T).mean(axis=1)
        hub.astype(np.float32).tofile(OUT / f"hub_scores_{filter_name}.bin")
        print(f"  {filter_name}: {len(mask)} turns")

    # Manifest
    manifest = {
        "n_images": img_emb.shape[0],
        "n_turns": len(turns),
        "dim": 3072,
        "models": sorted(set(t["m"] for t in turns)),
    }
    with open(OUT / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nExported {name} to {OUT}/")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <{'|'.join(DATASETS.keys())}>")
        sys.exit(1)
    export_dataset(sys.argv[1])
