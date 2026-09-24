# AEGIS Perception ML — Track C

Implements the on-device perception ML pipeline: dataset generation (C3), the visual UI-element
detector (C4), and the benchmark harness (C7). `packages/core/src/visual` and `.../face`
(C5, C2) hold the pure, browser-portable post-processing logic this training pipeline's
output contract must match exactly — see their module docstrings for the geometry contract.

## Why a custom nano detector instead of fine-tuned YOLOv8

`docs/AI_ML_PIPELINE.md` §21 (OAD-01) explicitly marks visual-model selection as **TBD
pending real benchmarking on target hardware** — a GPU, WebGPU-capable browser, and the
§6.4 benchmarking methodology this sandbox doesn't have. Rather than fake that selection
process or skip the model entirely, this pass trains a small, from-scratch, anchor-free,
single-box-per-cell detector ("AegisNano", `model.py`) on a Playwright-generated synthetic
dataset. This is a genuinely trained, genuinely (if narrowly) evaluated interim model —
matching `IMPLEMENTATION_PLAN.md`'s own Risk R-02 mitigation ("ship interim model, report
honestly") — not a fine-tuned Ultralytics/YOLOv8 checkpoint, which also sidesteps the
AGPL-3.0 licensing flag ADR-06 raises for that model family. **OAD-01 remains formally
open**; this is not a claim that AegisNano is the final production model.

## Pipeline

```
generate_dataset.mjs (C3)     -- Playwright renders 8 randomized HTML templates,
  -> ml/dataset/{train,val}/     reads ground-truth boxes back from the DOM, splits
                                  BY TEMPLATE (val templates never appear in train)

train.py (C4)                 -- trains AegisNano on ml/dataset/train, CPU-only
  -> ml/checkpoints/aegis-nano.pt
  -> ml/checkpoints/training_report.json   (honest per-epoch metrics)

export_onnx.py (C4)           -- exports to ONNX, verifies PyTorch vs ONNX Runtime
  -> extension/assets/models/aegis-nano.onnx   agreement within 1e-3, reports file size

benchmark.py (C7)             -- model size, PyTorch CPU latency (p50/p95), per-class
  -> ml/checkpoints/benchmark_report.json      precision/recall @ IoU 0.5 on held-out val
```

## Output contract (must stay in lockstep across languages)

- `ml/class_names.mjs` (JS) and `ml/class_names_py.py` (Python) — the 9-class vocabulary,
  in the exact order baked into the model's output channels. Manually kept in sync; there
  is no shared module between the Node dataset-gen scripts and the Python training code.
- Model output: `[1, GRID_SIZE, GRID_SIZE, 5 + num_classes]`, NHWC (via `.permute(0,2,3,1)`
  in `model.py`) so the flat `Float32Array` ONNX Runtime Web hands back in the browser has
  the exact same `(gy, gx, channel)` row-major layout `packages/core/src/visual/decode.ts`
  expects. If you change one side of this contract, change the other.
- Letterbox geometry: `dataset.py`'s `compute_letterbox_params`/`letterbox_image` are a
  line-for-line mirror of `packages/core/src/visual/letterbox.ts`. Training-time
  preprocessing must match inference-time preprocessing exactly.

## Known limitations (reported honestly, not hidden)

- **Small dataset.** 270 train / 30 val images from 8 templates — enough to demonstrate a
  real, working, end-to-end trained pipeline, not enough for production-grade accuracy.
- **Val set can't measure every class.** Neither held-out template (`settings_form`,
  `gallery_page`) contains a `radio` element, so `radio` recall is unmeasurable on val.
- **Single box per grid cell.** If two labeled elements share a 16px cell, only one survives
  as a training target — a known simplification for a from-scratch nano model, not a
  full multi-anchor YOLO head.
- **No real-browser WebGPU/WASM benchmarking.** `benchmark.py` measures PyTorch CPU
  latency in this sandbox, not ONNX Runtime Web in an actual Chrome extension (§17.6,
  §17.8) — that requires hardware and a browser context this environment doesn't have.
- **Synthetic-only data.** No real-world website screenshots were used (§18.3 "representative
  real-world screenshots" is unfulfilled) — generalization to real sites is untested.

## Re-running

```powershell
node ml/generate_dataset.mjs --variations-train=45 --variations-val=15
# TORCHDYNAMO_DISABLE=1 works around a torch 2.14 / Python 3.13 dynamo import bug on this box
$env:TORCHDYNAMO_DISABLE=1
python ml/train.py --epochs 150 --batch-size 16 --output ml/checkpoints/aegis-nano.pt
python ml/export_onnx.py
python ml/benchmark.py
```
