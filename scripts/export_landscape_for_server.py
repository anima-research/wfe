"""
Export landscape embeddings and turn data to binary formats for the Node.js server.

Outputs:
  results/landscape-embeddings/server/
    image_embeddings.bin    — float32, (N_images, 3072) row-major
    image_meta.json         — trimmed metadata per image
    turn_embeddings.bin     — float32, (N_turns, 3072) row-major
    turn_meta.json          — per-turn metadata with session/model/scores
    manifest.json           — dimensions and counts
"""

import json
import numpy as np
from pathlib import Path

RESULTS = Path(__file__).parent.parent / "results"
LAND_DIR = RESULTS / "landscape-embeddings"
EMB_DIR = RESULTS / "embeddings-v2"
SCORES_DIR = RESULTS / "probe-scores-v2"
OUT = LAND_DIR / "server"
OUT.mkdir(exist_ok=True)

PCA_KEYS = ["valence_pc1", "arousal_pc2", "fear_pc3", "prosociality_pc4"]

# --- Image embeddings ---
print("Loading image embeddings...")
land = np.load(LAND_DIR / "landscape_1000.npz", allow_pickle=True)
img_emb = land["embeddings"]  # (N, 3072) float32
img_meta_raw = json.loads(str(land["metadata"]))

# Trim metadata to essentials
img_meta = []
for m in img_meta_raw:
    img_meta.append({
        "i": m["global_idx"],
        "f": m["cache_file"],
        "p": m["prompt"][:150],
        "m": m["model_id"],
    })

img_emb.tofile(OUT / "image_embeddings.bin")
with open(OUT / "image_meta.json", "w") as f:
    json.dump(img_meta, f)
print(f"  {img_emb.shape[0]} images, {img_emb.nbytes / 1e6:.0f} MB")

# --- Turn embeddings + metadata ---
print("Loading turn embeddings and scores...")
all_score_files = sorted(SCORES_DIR.glob("*.json"))

turns = []  # list of metadata dicts
turn_embs = []  # list of numpy arrays

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

print(f"  {len(turns)} turns, {turn_emb_arr.nbytes / 1e6:.0f} MB")

# --- Precompute hub scores ---
print("Precomputing hub scores...")
# Normalize everything
img_norms = np.linalg.norm(img_emb, axis=1, keepdims=True)
img_normed = (img_emb / img_norms).astype(np.float64)
turn_norms = np.linalg.norm(turn_emb_arr, axis=1, keepdims=True)
turn_normed = (turn_emb_arr / turn_norms).astype(np.float64)

for filter_name in ["claude", "gpt", "grok", "both"]:
    mask = [i for i, t in enumerate(turns) if filter_name == "both" or t["a"] == filter_name]
    filtered = turn_normed[mask]  # (N_filtered, 3072)
    # Chunked matmul to avoid OOM
    hub = np.zeros(img_emb.shape[0], dtype=np.float64)
    CHUNK = 5000
    for i in range(0, img_emb.shape[0], CHUNK):
        end = min(i + CHUNK, img_emb.shape[0])
        hub[i:end] = (img_normed[i:end] @ filtered.T).mean(axis=1)
    hub.astype(np.float32).tofile(OUT / f"hub_scores_{filter_name}.bin")
    print(f"  {filter_name}: {len(mask)} turns, range [{hub.min():.4f}, {hub.max():.4f}]")

# --- Manifest ---
manifest = {
    "n_images": img_emb.shape[0],
    "n_turns": len(turns),
    "dim": 3072,
    "dtype": "float32",
    "models": sorted(set(t["m"] for t in turns)),
}
with open(OUT / "manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print(f"\nExported to {OUT}/")
print(f"  image_embeddings.bin: {(OUT / 'image_embeddings.bin').stat().st_size / 1e6:.0f} MB")
print(f"  turn_embeddings.bin: {(OUT / 'turn_embeddings.bin').stat().st_size / 1e6:.0f} MB")
print(f"  image_meta.json: {(OUT / 'image_meta.json').stat().st_size / 1e6:.1f} MB")
print(f"  turn_meta.json: {(OUT / 'turn_meta.json').stat().st_size / 1e6:.1f} MB")
