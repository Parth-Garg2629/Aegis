---
Status: Final Draft
Project: SIH 2026 — PS 26171
Document: AI/ML Pipeline Specification
Version: 1.0
Last Updated: 2026-09-18
Source Documents:
  - docs/PRD.md (v1.1)
  - docs/SYSTEM_ARCHITECTURE.md (v1.0)
  - docs/TECHNICAL_SPEC.md (v1.0)
---

# AEGIS — AI/ML Pipeline Specification

## 1. Document Information

| Field | Value |
|-------|-------|
| Document | AI/ML Pipeline Specification |
| Project | AEGIS — Agentic Engine for Guarded Intelligent Surfing |
| Problem Statement | SIH 2026 — PS 26171: On-device Visual Perception for Light-weight Browser Agents |
| Version | 1.0 |
| Status | Final Draft |
| Last Updated | 2026-09-18 |
| Source Documents | [PRD.md](file:///d:/Aegis/docs/PRD.md) v1.1, [SYSTEM_ARCHITECTURE.md](file:///d:/Aegis/docs/SYSTEM_ARCHITECTURE.md) v1.0, [TECHNICAL_SPEC.md](file:///d:/Aegis/docs/TECHNICAL_SPEC.md) v1.0 |
| Intended Audience | Development team (ML engineer, browser engineer), technical reviewers, SIH evaluators |

---

## 2. AI/ML Scope and Responsibilities

### 2.1 What This Document Owns

This document specifies the implementation-level AI/ML details for the AEGIS on-device perception pipeline. It defines:

- The complete signal-processing pipeline from screenshot/DOM capture through multi-signal fusion to the sanitization interface.
- The role, input/output contracts, inference behavior, and failure modes of each ML and non-ML signal source.
- The model selection framework and benchmarking criteria for the lightweight visual ML model.
- The browser inference runtime (ONNX Runtime Web / WebGPU / WASM) specification.
- The MediaPipe face detection integration.
- The heuristic PII detection specification (pattern, normalization, validation, confidence).
- The multi-signal fusion algorithm.
- The sensitivity map data contract.
- Performance engineering targets and degraded operation modes.
- The benchmarking and test-data strategy.
- Open AI/ML decisions that are intentionally TBD.

### 2.2 What This Document Does NOT Own

| Concern | Owner Document |
|---------|---------------|
| Product requirements, user flows, scope | PRD.md |
| System-level component architecture, trust boundaries | SYSTEM_ARCHITECTURE.md |
| Implementation-level contracts, TypeScript interfaces, runtime lifecycle, WebSocket protocol | TECHNICAL_SPEC.md |
| Agent behavior, prompt engineering, VLM prompt format | BROWSER_AGENT_SPEC.md (planned) |
| Detailed privacy threat model, security controls | SECURITY_PRIVACY.md (planned) |
| Server-side VLM reasoning behavior | BROWSER_AGENT_SPEC.md (planned) |
| Wire-level WebSocket message schema | API_SPEC.md (planned) |
| Testing methodology, SIH metric evaluation | EVALUATION_PLAN.md (planned) |
| SIH demonstration script | DEMO_FLOW.md (planned) |

### 2.3 Relationship to Technical Spec

`TECHNICAL_SPEC.md` defines the **interfaces** (TypeScript-level contracts, data structures, module responsibilities, runtime lifecycle) for all perception components. This document defines the **AI/ML decisions** within those interfaces: which models are used, why, how they are configured, what their accuracy characteristics are, how they degrade, and what benchmarking is needed to finalize open decisions.

### 2.4 Relationship to Browser Agent Spec

The AI/ML pipeline is entirely on the client side. It produces a `SensitivityMap` that drives sanitization. The server-side VLM reasoning, prompt engineering, and action generation are **not** part of this document. `BROWSER_AGENT_SPEC.md` owns those decisions.

### 2.5 Relationship to Security and Privacy

The AI/ML pipeline is the primary privacy-enforcement mechanism. All privacy invariants (PI-01 through PI-08 in `TECHNICAL_SPEC.md`, PV-01 through PV-08 in `PRD.md`) depend on the pipeline's correctness. This document describes how the pipeline enforces privacy. `SECURITY_PRIVACY.md` owns the threat model and adversarial analysis.

---

## 3. End-to-End Perception Pipeline

### 3.1 Pipeline Overview

The pipeline runs entirely on the client device within the browser extension.

```
[1] Capture
      |
  Raw Screenshot (bitmap, data URL)
  Raw DOM Tree (structured JSON)

[2] Preprocessing
      |
  Screenshot: resize/normalize for visual ML input
  DOM Text: normalize/clean for heuristic PII

[3] Signal Generation (four signal sources, processed concurrently where possible)
      |
  A. DOM / Deterministic Analysis
     Input: Raw DOM Tree
     Output: DOMSignal[]
     Method: DETERMINISTIC

  B. Visual ML (UI Element Detection)
     Input: Raw Screenshot
     Output: VisualSignal[]
     Method: ML-BASED

  C. Face Detection (MediaPipe)
     Input: Raw Screenshot
     Output: FaceSignal[]
     Method: ML-BASED

  D. Heuristic PII Detection
     Input: Text extracted from DOM
     Output: PIISignal[]
     Method: HEURISTIC / RULE-BASED

[4] Signal Normalization
      |
  All signals normalized to common NormalizedSignal[] format
  Coordinate spaces unified to screenshot pixel space

[5] Multi-Signal Fusion
      |
  Deterministic merge algorithm
  Overlap detection (IoU), category priority, confidence combination
  Output: SensitivityMap (SensitivityRegion[])

[6] Sanitization Interface Handoff
      |
  SensitivityMap --> Screenshot Sanitizer (visual redaction)
  SensitivityMap --> Schema Sanitizer (text placeholder replacement)
```

### 3.2 Signal Source Classification

| Signal Source | Mechanism | ML Required | Latency Class | Failure Impact |
|--------------|-----------|-------------|---------------|---------------|
| DOM / Deterministic Analysis | DOM traversal + attribute inspection | No | < 50ms | Low — deterministic, rarely fails |
| Visual ML (UI elements) | On-device ML inference (WebGPU/WASM) | Yes | < 1000ms | Medium — degrades to DOM+heuristic |
| Face Detection (MediaPipe) | On-device ML inference (TFLite) | Yes | < 200ms | Low — only affects face redaction |
| Heuristic PII Detection | Regex + checksum validation | No | < 50ms | Low — deterministic, rarely fails |

### 3.3 Execution Model

Signals A, B, C, and D run **concurrently** where the runtime allows. DOM analysis (A) and heuristic PII (D) are synchronous and fast. Visual ML (B) and face detection (C) are asynchronous. The fusion step begins once all four signal sources have completed or timed out.

If any signal source fails, it returns an empty signal array. The pipeline continues with the remaining signals. This is the graceful degradation model.

---

## 4. DOM / Deterministic Analysis

### 4.1 Purpose

DOM analysis is the highest-confidence signal source. It extracts structural, semantic, and interactive information from the page that the browser's DOM API exposes reliably. DOM analysis deterministically identifies explicitly typed sensitive fields such as password, email, and telephone inputs, while OTP detection may rely on heuristic field metadata.

### 4.2 Input

Raw DOM tree — the structured JSON representation produced by the DOM Extractor content script (per `TECHNICAL_SPEC.md` Section 7).

### 4.3 Output

`DOMSignal[]` — one signal per extracted DOM element.

```
DOMSignal:
  elementId:        string          // Content-script-assigned element identifier
  tagName:          string          // e.g., "input", "button", "a"
  type:             string | null   // e.g., "password", "email", "tel", "text"
  role:             string | null   // ARIA role
  label:            string | null   // Associated label text
  boundingBox:      {x, y, w, h}   // Viewport-relative coordinates
  isInteractive:    boolean
  isVisible:        boolean
  isSensitiveField: boolean         // True if this field is flagged as sensitive
  sensitivityReason: string | null  // "password", "otp", "email_field", "tel_field"
  confidence:       1.0             // Always 1.0 for deterministic detections
```

### 4.4 Sensitive Field Detection Logic

DOM analysis uses the following deterministic rules:

| Detection Target | Rule | Confidence |
|-----------------|------|-----------|
| **Password field** | `element.type === "password"` | 1.0 — FINAL |
| **OTP field** | `element.type === "number"` AND (name/id/placeholder/label contains "otp", "verification", "code", "pin" — case-insensitive) | 0.9 (PROPOSED) — label matching is heuristic |
| **Email field** | `element.type === "email"` | 1.0 — FINAL |
| **Phone field** | `element.type === "tel"` | 1.0 — FINAL |
| **Sensitive text area** | Textarea with label containing "aadhaar", "pan", "card number", "passport", "account number" (case-insensitive) | 0.9 (PROPOSED — label matching is heuristic) |

> **Note:** The OTP label-matching pattern list is a proposed starting point. The exact pattern set is **TBD** and should be extended during development.

### 4.5 Bounding Box Semantics

All bounding boxes are in viewport-relative pixel coordinates as returned by `element.getBoundingClientRect()`. They must be transformed to the same coordinate space as the screenshot before fusion.

### 4.6 Confidence Semantics

DOM-derived signals for explicitly typed sensitive fields (`type="password"`, `type="email"`, `type="tel"`) have confidence `1.0`. These are DETERMINISTIC detections — no ML uncertainty.

OTP pattern matching on label text has confidence `0.9` (PROPOSED) because label text matching is a heuristic.

### 4.7 Limitations

- Cannot perceive canvas-rendered content.
- Cannot access the DOM of cross-origin iframes (browser same-origin policy).
- Cannot detect PII in visible text on the page — that is the heuristic PII detector's role.
- Cannot detect faces.

---

## 5. Visual ML Perception

### 5.1 Purpose

The visual ML model perceives the page as rendered. It detects UI elements, layout regions, and visual content that DOM analysis cannot reach: canvas-rendered UIs, cross-origin iframe content visible in the screenshot, and visual relationships between elements. It supplements DOM signals with spatial and visual information.

The visual ML model does **not** replace DOM analysis for structured fields. It provides complementary coverage.

### 5.2 Input Representation

| Property | Value |
|----------|-------|
| **Raw input** | Screenshot data URL (PNG) from `chrome.tabs.captureVisibleTab` |
| **Preprocessing — resize** | Resize to model input dimensions (TBD — depends on final model; YOLO-class typical: 640×640; ViT-class typical: 224×224 or 384×384) |
| **Preprocessing — normalization** | Pixel values normalized to [0, 1] or model-specific mean/std (TBD — depends on model) |
| **Preprocessing — format** | `Float32Array` tensor in `[batch, height, width, channels]` or `[batch, channels, height, width]` layout (depends on runtime and model) |
| **Aspect ratio handling** | Letterboxing (pad to square with constant fill) to preserve aspect ratio during resize |

> **Open Decision (OAD-01):** Input preprocessing parameters (resize dimensions, normalization constants, tensor layout) are TBD until the visual model is selected.

### 5.3 Output

`VisualSignal[]` — one signal per detected visual region.

```
VisualSignal:
  boundingBox:   {x, y, w, h}    // Pixel coordinates in original screenshot space
  label:         UIElementClass
  confidence:    number (0.0-1.0)
  sourceModel:   string          // Model identifier (for debugging)

UIElementClass:
  "button" | "input_field" | "text_region" | "link" | "image" |
  "icon" | "dropdown" | "checkbox" | "radio" | "other_interactive"
```

### 5.4 Post-Processing

```
Raw model output (bounding boxes in model input space, class logits, confidence scores)
  -> Apply confidence threshold filter (discard detections below threshold)
  -> Apply Non-Maximum Suppression (NMS) to remove duplicate detections
  -> Map bounding box coordinates from model input space to original screenshot space
  -> Output: VisualSignal[]
```

| Post-processing parameter | Proposed value | Status |
|--------------------------|---------------|--------|
| Confidence threshold | 0.4 | PROPOSED — to be validated during benchmarking |
| NMS IoU threshold | 0.45 | PROPOSED — standard YOLO-class default |
| Max detections per image | 100 | PROPOSED — practical limit |

> **Open Decision (OAD-01):** NMS parameters and confidence thresholds are TBD until the model is selected and benchmarked.

### 5.5 Coordinate System

Model outputs are in the model input image space (e.g., 640×640). They must be mapped back to original screenshot pixel coordinates before fusion. The mapping depends on how the screenshot was resized (scale factor + any padding from letterboxing).

**Required inverse transform:**
```
x_original = (x_model - pad_left) / scale_x
y_original = (y_model - pad_top)  / scale_y
w_original =  w_model             / scale_x
h_original =  h_model             / scale_y
```

### 5.6 Model/Runtime Interface

The visual ML model is loaded and run via one of the following browser-compatible runtimes:

| Runtime | Format | Primary Use |
|---------|--------|-------------|
| **ONNX Runtime Web** | `.onnx` model | Preferred for YOLO-class models |
| **Transformers.js** | ONNX-based HuggingFace models | Preferred for ViT-class models |
| **TensorFlow.js** | TFLite/TF SavedModel via TFJS | Alternative fallback |

> **Open Decision (OAD-ML-01):** The final runtime is TBD and depends on the selected model. See Section 6 (Model Selection Framework) and Section 7 (ONNX Runtime Web Specification).

### 5.7 Failure Behavior

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Model weights fail to load | Promise rejection / timeout | Inform user. Operate in DOM + heuristic mode (degraded). |
| WebGPU initialization fails | Runtime exception | Fall back to WASM. If WASM also fails, DOM-only mode. |
| Inference throws | Exception | Return empty `VisualSignal[]`. Log error (no raw image data in log). Cycle continues with remaining signals. |
| Inference exceeds timeout | Timer expiry | Same as inference throws. Proposed timeout: 3 seconds (TBD — depends on model and device). |

### 5.8 Candidate Model Families

The following model families are candidates for the visual ML model. A final selection has NOT been made. Selection requires benchmarking per Section 6.

| Model Family | Archetype | Size Range | Notes |
|-------------|-----------|-----------|-------|
| **YOLOv8-nano** | YOLO-class object detector | ~3–6MB | Fast inference, ONNX-compatible. Needs UI element detection fine-tuning or a pre-existing UI-detection model. |
| **RT-DETR-tiny** | Transformer-based detector | ~20–30MB | Good accuracy. May be borderline for browser inference. |
| **MobileNet-based SSD** | Lightweight CNN detector | ~5–20MB | Well-established. ONNX-compatible. May lack UI-class vocabulary. |
| **Small ViT variants** | Vision Transformer | Varies | Good for classification; detection head needed. Transformers.js compatible. |
| **ScreenAI / Screen2Words variants** | UI-specific models | Varies | Pre-trained on UI screenshots — potentially high accuracy for this use case. Browser compatibility TBD. |

> **Open Decision (OAD-01):** Final model selection is TBD. See Section 6 for evaluation criteria and benchmarking approach.

---

## 6. Model Selection Framework

### 6.1 Purpose

The visual ML model must be selected based on objective criteria measured through benchmarking. This section defines the evaluation criteria and benchmarking methodology. **No model has been selected or benchmarked yet. This section documents how the selection will be made.**

### 6.2 Selection Criteria

| Criterion | Metric | Priority | Notes |
|-----------|--------|----------|-------|
| **UI element detection accuracy** | mAP@0.5 on a representative web screenshot dataset | Critical | Must reliably detect buttons, inputs, links, text regions |
| **Inference latency (WebGPU)** | Median and P95 inference time (ms) on target hardware | Critical | Target: < 1000ms (PF-01 contribution) |
| **Inference latency (WASM)** | Median and P95 inference time (ms) | High | WASM path must remain usable |
| **Model size** | MB (weights file) | High | Affects load time, extension bundle size, memory |
| **Cold-start load time** | Time from load() call to first inference ready | High | Target: < 10 seconds (PF-09) |
| **Active memory consumption** | Peak RAM during inference | High | Total ML memory target: < 500MB (PF-04) |
| **WebGPU compatibility** | Whether model runs on ONNX Runtime Web WebGPU backend without issues | Critical | Chrome 116+ baseline |
| **WASM fallback compatibility** | Whether model runs on ONNX Runtime Web WASM backend | Critical | Required fallback path |
| **CPU utilization during inference** | Does browser UI remain responsive during inference? | High | NFR-06: no UI freeze |
| **False positive rate** | Rate of detecting non-existent UI elements | Medium | Too many false positives bloat the sensitivity map |
| **False negative rate** | Rate of missing real UI elements | Medium | Missed elements reduce agent effectiveness |
| **Robustness across website styles** | Performance on diverse sites (SPA, server-rendered, complex CSS, iframe-heavy) | High | Must generalize |
| **Privacy implications of weights** | Were the model weights trained on private/proprietary data? | Medium | Prefer openly licensed models |
| **Ease of browser deployment** | Can the model be exported to ONNX/ONNX-compatible format? Does it require custom ops? | High | Custom ONNX ops are unsupported in standard browser runtimes |

### 6.3 Minimum Acceptance Thresholds

The following thresholds are **proposed** and must be validated during benchmarking. A model that fails any threshold should be disqualified regardless of other metrics.

| Threshold | Proposed Value | Status |
|-----------|---------------|--------|
| WebGPU inference latency (median) | < 700ms | PROPOSED |
| WASM inference latency (median) | < 3000ms | PROPOSED |
| Model file size | < 30MB | PROPOSED |
| Cold-start time | < 10 seconds | PROPOSED (from PF-09) |
| Active memory usage | < 200MB model-only | PROPOSED |
| Runs on ONNX Runtime Web (WebGPU) without errors | Required | FINAL |
| Runs on ONNX Runtime Web (WASM) without errors | Required | FINAL |

### 6.4 Benchmarking Methodology

> **Open Decision (OAD-01):** The benchmarking process has not been executed. This section defines the planned methodology.

**Step 1 — Candidate identification:** Identify candidate models from the families in Section 5.8. Prioritize models available in ONNX format or convertible with standard tools (`torch.onnx.export`, `optimum`).

**Step 2 — ONNX export and verification:** Export candidate models to ONNX. Verify the model runs in ONNX Runtime Web without custom ops errors (use `ort.InferenceSession.create()` with WebGPU and WASM backends).

**Step 3 — Performance measurement:** For each candidate, measure:
- Model file size.
- Load time (cold start) in Chrome 116+ / Edge 116+.
- Inference latency on the test hardware (median and P95 over N >= 20 inference runs per image).
- Peak memory usage during inference (via Chrome DevTools Memory panel or `performance.measureUserAgentSpecificMemory()`).
- CPU utilization profile during inference.

**Step 4 — Accuracy evaluation:** For each candidate, evaluate on the test screenshot dataset (see Section 18):
- Annotate a set of diverse web screenshots with ground-truth UI element bounding boxes.
- Compute mAP@0.5 per class.
- Compute false positive and false negative rates.

**Step 5 — Comparative analysis:** Apply the defined minimum acceptance thresholds to each candidate, then compare the resulting accuracy, latency, size, memory, compatibility, and deployment trade-offs. Document the final selection and benchmark results in an ADR.

### 6.5 Decision Status

> **Open Decision (OAD-01):** Visual model selection is **TBD**. Must be completed before implementation of the Visual ML Engine begins.

---

## 7. ONNX Runtime Web / Browser Inference Specification

### 7.1 Overview

ONNX Runtime Web (ORT-Web) is the **proposed** primary inference runtime for the ONNX-format visual ML model. It supports both WebGPU and WASM execution backends within the browser environment.

> **Open Decision (OAD-ML-01):** Final runtime selection is TBD. If the selected model is from HuggingFace / Transformers.js ecosystem, Transformers.js may be the primary runtime. The specification below applies to ORT-Web as the primary candidate.

### 7.2 Compute Backend Selection

| Backend | Trigger Condition | Relative Performance |
|---------|------------------|---------------------|
| **WebGPU** | `navigator.gpu` is available AND GPU adapter is accessible | Faster for supported workloads; performance must be benchmarked on target hardware. |
| **WASM (multithreaded)** | WebGPU unavailable; browser supports `SharedArrayBuffer` | Moderate |
| **WASM (single-threaded)** | WebGPU unavailable; `SharedArrayBuffer` not available | Slowest — fallback of last resort |

Backend selection logic:
```
async function selectBackend(): string {
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {}
  }
  return "wasm";
}
```

### 7.3 Initialization

```
Step 1: Select backend (see Section 7.2)
Step 2: Configure ort.env settings (backend path, wasm files location, thread count)
Step 3: Call ort.InferenceSession.create(modelPath, { executionProviders: [backend] })
Step 4: Warm-up inference (run model on a zero-valued dummy input to trigger shader compilation)
Step 5: Signal model-ready to the Loop Controller
```

> **Proposed:** Warm-up inference (Step 4) is strongly recommended for WebGPU. The first real inference is significantly slower than subsequent ones due to GPU shader compilation. The warm-up cost should be absorbed at initialization.

### 7.4 Model Loading Strategy

> **Open Decision (OAD-06):** Pre-load on install vs. lazy-load on first activation vs. progressive loading is TBD. Options and tradeoffs:

| Strategy | Cold-Start UX | Extension Install Size | Memory While Idle |
|----------|--------------|----------------------|-------------------|
| **Pre-load on install** | First activation is fast | Large install (model bundled) | Model cached, memory load on activation |
| **Lazy-load on first activation** | First activation is slow (download) | Small install | No memory until used |
| **Bundle with extension** | Fast activation | Larger extension package | Loaded on activation |

**Recommended approach (proposed):** For the MVP, model weights should be bundled with the extension and loaded locally. Remote/CDN loading may be considered as a future deployment option, but it must never transmit screenshots, DOM content, PII, or agent context. Final decision depends on model file size.

### 7.5 Inference Lifecycle

```
Per-cycle inference:
  1. Read raw screenshot (data URL or ImageBitmap from captureVisibleTab)
  2. Decode to ImageData / HTMLCanvasElement
  3. Preprocess: resize -> normalize -> convert to Float32 tensor
  4. const results = await session.run({ [inputName]: tensor })
  5. Postprocess: decode bounding boxes -> NMS -> coordinate remapping
  6. Return VisualSignal[]
  7. Dereference tensor objects (allow GC)
```

### 7.6 Tensor Lifecycle

- Tensors are allocated per-cycle.
- After `session.run()` returns, the input tensor is dereferenced immediately.
- Output tensors are consumed (postprocessed) and then dereferenced.
- No tensor objects are retained across inference cycles.
- This minimizes accumulated memory over multiple agent cycles.

### 7.7 Memory Cleanup

- Between cycles: ensure no tensor references remain.
- On model unload: call `session.release()` (if ORT-Web exposes this — TBD per ORT-Web API).
- On browser memory pressure: unload the model and pause the agent. Reload on next activation.

### 7.8 MV3 Service Worker Constraints

MV3 service workers may be suspended by Chrome when inactive. Consequences:
- The loaded model (in-memory) is lost on suspension.
- On re-activation, the model must be re-loaded.
- **Mitigation:** Use an appropriate MV3-compatible lifecycle strategy. An active WebSocket connection must not be treated as a guaranteed service-worker keepalive. The exact keepalive/offscreen strategy is TBD (refer to TECHNICAL_SPEC.md Section 12.1).

### 7.9 Browser Compatibility

| Feature | Requirement | Status |
|---------|------------|--------|
| WebGPU | Chrome 113+, Edge 113+ | Available in target browsers (Chrome 116+) |
| ONNX Runtime Web (WASM) | Supported in all modern browsers | Broadly available |
| SharedArrayBuffer (for multithreaded WASM) | Requires COOP/COEP headers; Chrome 92+ | Must confirm server headers for extension context |
| Offscreen document for inference | Proposed MV3 workaround for heavy computation | **TBD — see OAD-09** |

> **Open Decision (OAD-09):** Whether to run ML inference in an Offscreen Document (to avoid blocking the service worker event loop) is TBD. This may be necessary for models with inference times > 500ms.

---

## 8. MediaPipe Face Detection

### 8.1 Role in the Pipeline

MediaPipe Face Detection is a dedicated, independently-running ML component that detects face regions in the raw screenshot. It is classified as part of the Visual ML signal source but uses its own runtime (TFLite-based, separate from ORT-Web).

Faces are categorized as biometric-adjacent sensitive content. Any detected face region must be visually redacted (blurred/masked) in the screenshot before transmission, regardless of whether the user "intends" the face to be sensitive.

### 8.2 Input

| Property | Detail |
|----------|--------|
| **Raw input** | Raw screenshot as `ImageData`, `HTMLCanvasElement`, or `HTMLImageElement` |
| **Preprocessing** | MediaPipe handles internally |
| **Input size** | MediaPipe Full-Range model: 128x128. MediaPipe Short-Range model: 128x128. (Model determines this internally.) |

### 8.3 Output

`FaceSignal[]`:

```
FaceSignal:
  boundingBox:   {x, y, w, h}   // Relative to input image dimensions (0.0-1.0 normalized)
  confidence:    number (0.0-1.0)
```

> **Important:** MediaPipe returns normalized coordinates (0.0–1.0 relative to image dimensions). These must be converted to pixel coordinates before fusion.

**Coordinate denormalization:**
```
x_px = relativeBox.x      * screenshot.width
y_px = relativeBox.y      * screenshot.height
w_px = relativeBox.width  * screenshot.width
h_px = relativeBox.height * screenshot.height
```

### 8.4 Confidence Handling and Thresholds

| Confidence Range | Proposed Action | Status |
|----------------|----------------|--------|
| >= 0.7 | Strong detection — mark for redaction | PROPOSED |
| 0.5–0.7 | Medium confidence — include in sensitivity map with fail-safe flag | PROPOSED |
| 0.3–0.5 | Low confidence — include with fail-safe redaction (prefer over-redaction) | PROPOSED |
| < 0.3 | Too low — discard | PROPOSED |

> **Open Decision (OAD-ML-02):** MediaPipe confidence thresholds are TBD. The values above are proposed starting points for benchmarking.

### 8.5 Model Choice

| Model | Range | Recommended Use |
|-------|-------|----------------|
| **MediaPipe Face Detection Short Range** | < 2 meters from camera | Standard web screenshots |
| **MediaPipe Face Detection Full Range** | Up to 5 meters | If profile photos or small faces are common |

> **Proposed:** Start with Short Range model. Validate against test screenshots containing profile photos and small faces.

### 8.6 Local-Only Execution

MediaPipe runs entirely within the browser. No network calls are made. The MediaPipe WASM binary and model weights must follow the same loading strategy as the Visual ML model.
For the MVP, model weights should be bundled with the extension and loaded locally. Remote/CDN loading may be considered as a future deployment option, but it must never transmit screenshots, DOM content, PII, or agent context.

### 8.7 Failure and Degraded Behavior

| Failure | Detection | Recovery |
|---------|-----------|----------|
| MediaPipe fails to load | Promise rejection | Log error. Operate without face detection. Visual ML signal may still detect face-like regions if model classes include faces. |
| Inference fails on a specific image | Exception | Return empty `FaceSignal[]`. Log error. Cycle continues with DOM, visual ML, and heuristic signals. |
| Initialization succeeds but no faces detected | Normal outcome | Return empty `FaceSignal[]`. Not an error. |

**Risk of MediaPipe failure:** Face regions may not be detected in that cycle. Mitigated by:
- This is one of four signal sources. Other signals continue.
- Visual ML may detect face-like regions independently if its class vocabulary includes them.
- The fail-safe principle applies to detected low-confidence sensitive regions; it does not guarantee detection when a signal source completely fails.

---

## 9. Heuristic PII Detection

### 9.1 Purpose and Classification

Heuristic PII detection is a **deterministic, rule-based** component. It is not ML. It scans text content extracted from the DOM for structured PII patterns using regular expressions and, where applicable, checksum validation.

It does not operate on visual content. It cannot detect PII in images or canvas elements. Its role is to catch structured textual PII that may be displayed as visible text on the page.

### 9.2 Text Input Sources

The heuristic detector operates on text extracted by the DOM Extractor:

| Source | Field | Sensitivity |
|--------|-------|-------------|
| Visible text content | `element.innerText` / `element.textContent` | May contain displayed PII |
| Form field values | `element.value` | High sensitivity — must be handled per TECHNICAL_SPEC.md Section 7.6 |
| Placeholder text | `element.placeholder` | Usually non-sensitive — scanned for completeness |
| ARIA labels / titles | `aria-label`, `title`, `alt` | Usually non-sensitive — scanned |

> **Lifecycle constraint:** Raw field values that are extracted for scanning MUST be discarded after detection is complete, per TECHNICAL_SPEC.md Section 7.6. They must never appear in logs, error messages, or any diagnostic data.

### 9.3 Supported PII Categories and Patterns

#### 9.3.1 Aadhaar Number

| Property | Specification |
|----------|--------------|
| **Format** | 12-digit numeric, optionally with spaces (`XXXX XXXX XXXX`) or hyphens |
| **Normalization** | Strip spaces, hyphens, non-numeric characters before matching |
| **Pattern** | `^\d{12}$` after normalization |
| **Validation** | **Verhoeff checksum** (the official Aadhaar validation algorithm). If Verhoeff implementation is impractical for MVP, validate by format only and mark status as PROPOSED enhancement. |
| **Confidence (full match + Verhoeff valid)** | 1.0 |
| **Confidence (format match, Verhoeff failed)** | 0.7 (PROPOSED) — may still be Aadhaar; include as potential PII with fail-safe flag |
| **False positive risk** | 12-digit reference numbers (invoices, order IDs). Verhoeff reduces false positives substantially. |
| **Status** | Pattern: FINAL. Verhoeff validation: PROPOSED for MVP. |

#### 9.3.2 PAN Number

| Property | Specification |
|----------|--------------|
| **Format** | 10-character alphanumeric: `[A-Z]{5}[0-9]{4}[A-Z]{1}` |
| **Normalization** | Trim whitespace. Convert to uppercase. |
| **Pattern** | `^[A-Z]{5}[0-9]{4}[A-Z]{1}$` |
| **Validation** | Format validation only (character class compliance). No checksum defined. |
| **Confidence** | 0.9 (PROPOSED) — format match with no independent verification |
| **False positive risk** | Other 10-character alphanumeric strings (license keys, reference codes). Acceptable; over-redaction preferred. |
| **Status** | FINAL |

#### 9.3.3 Credit/Debit Card Number

| Property | Specification |
|----------|--------------|
| **Format** | 13–19 digits, optionally formatted with spaces or hyphens (groups of 4) |
| **Normalization** | Strip spaces, hyphens. |
| **Pattern** | `^\d{13,19}$` after normalization |
| **Validation** | **Luhn algorithm** checksum |
| **Confidence (Luhn valid)** | 1.0 |
| **Confidence (format match, Luhn failed)** | 0.5 (PROPOSED) — include with fail-safe flag |
| **False positive risk** | 16-digit Aadhaar-adjacent numbers, large order IDs. Luhn significantly reduces false positives. |
| **Status** | FINAL |

#### 9.3.4 Email Address

| Property | Specification |
|----------|--------------|
| **Format** | Standard email format |
| **Pattern** | `^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$` (simplified RFC-compliant) |
| **Normalization** | Trim whitespace. Lowercase. |
| **Validation** | Format validation. |
| **Confidence** | 0.95 (PROPOSED) — well-defined format, low ambiguity |
| **False positive risk** | Low — email pattern is fairly distinctive. |
| **Status** | FINAL |

#### 9.3.5 Phone Number

| Property | Specification |
|----------|--------------|
| **Indian mobile (primary)** | 10 digits starting with 6–9, optionally with `+91` or `0` prefix |
| **International (secondary)** | `+<country_code> <number>` — common formats only |
| **Normalization** | Strip spaces, hyphens, parentheses. Normalize `+91` prefix. |
| **Patterns** | Indian: `^[6-9]\d{9}$` or `^(\+91|0)[6-9]\d{9}$` after normalization. International: `^\+[1-9]\d{7,14}$` |
| **Validation** | Format and length validation. |
| **Confidence** | 0.85 (PROPOSED) for Indian format; 0.7 (PROPOSED) for international (higher ambiguity) |
| **False positive risk** | Medium — 10-digit numeric strings are common. Indian prefix requirement (6–9) reduces ambiguity. |
| **Status** | Indian pattern: FINAL. International pattern: PROPOSED. |

### 9.4 Pattern Application and Normalization Algorithm

```
For each DOM text source (element.innerText, element.value, etc.):

  1. Trim leading/trailing whitespace
  2. Normalize Unicode digits to ASCII digits (e.g., Arabic-Indic numerals to ASCII)
  3. For numeric pattern matching: strip common separators (space, dash, dot)
  4. For each supported PII category:
      a. Apply normalization
      b. Match pattern against normalized text
      c. If match found: optionally validate checksum
      d. Compute confidence based on match quality
      e. Emit PIISignal if confidence >= minimum_threshold (proposed: 0.5)
```

### 9.5 Output

`PIISignal[]`:

```
PIISignal:
  elementId:     string           // DOM element ID where the PII was found
  patternType:   PIIPatternType   // AADHAAR | PAN | CARD_NUMBER | EMAIL | PHONE
  matchedRegion: {start, end}     // Character range within the text where match was found
  confidence:    number (0.0-1.0)
  checksumValid: boolean | null   // null if no checksum available
```

For MVP, `matchedRegion` identifies the detected substring, while sanitization uses the associated DOM element's bounding box and `elementId`; substring-level replacement is not required.

### 9.6 Confidence and Decision Policy

| Match Condition | Confidence | Sensitivity Map Action |
|----------------|-----------|----------------------|
| Pattern match + checksum valid | 1.0 | Include in sensitivity map — redact |
| Pattern match + no checksum available | 0.9 (proposed) | Include in sensitivity map — redact |
| Pattern match + checksum failed | 0.5–0.7 (proposed) | Include with fail-safe flag — still redact |
| No match | N/A | Not included |

### 9.7 False Positive Policy

The system **accepts false positives** (over-redaction) as preferable to false negatives (PII leakage). Per PRD PV-08 and the architectural fail-safe principle: LOW CONFIDENCE -> PREFER REDACTION.

Consequences of over-redaction: reduced VLM context. This is acceptable — the VLM receives typed placeholders that indicate what kind of data was redacted, enabling continued reasoning.

### 9.8 False Negative Risks

The heuristic detector will miss:
- PII in non-standard formats, OCR artifacts, or custom separators beyond those normalized.
- PII in images or canvas elements (visual ML responsibility).
- PII in locales or scripts not covered by the defined patterns.
- PII categories not explicitly listed.
- PII that appears across multiple DOM elements (e.g., Aadhaar split across three separate input boxes).

**Mitigation:** Heuristic PII is one of four signal sources. Visual ML and DOM analysis provide complementary coverage.

### 9.9 Future / Proposed PII Extensions (NOT in MVP Scope)

| Category | Pattern |
|----------|---------|
| Vehicle registration numbers | India format: `[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}` |
| Passport numbers | India format: `[A-Z][0-9]{7}` |
| GST numbers | Format: `[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9][Z][0-9A-Z]` |
| IFSC codes | Format: `[A-Z]{4}0[A-Z0-9]{6}` |

---

## 10. Signal Normalization

### 10.1 Purpose

Each signal source produces signals in a different format and coordinate space. Before fusion, all signals are normalized to a common representation. This allows the fusion algorithm to process all signals uniformly.

### 10.2 Common Representation: NormalizedSignal

```
NormalizedSignal:
  signalId:    string           // Unique identifier for this signal instance
  source:      SignalSource     // DOM_ANALYSIS | VISUAL_ML | FACE_DETECTION | HEURISTIC_PII
  elementId:   string | null    // DOM element ID, if this signal is associated with an element
  boundingBox: {x, y, w, h}    // Pixel coordinates in ORIGINAL SCREENSHOT space
  category:    SensitivityCategory  // See Section 12.1 for enum values
  confidence:  number (0.0-1.0)
  evidence:    string           // Brief human-readable description for debugging (no raw values)
```

### 10.3 Coordinate Space Normalization

All bounding boxes must be in the same coordinate space before fusion — **original screenshot pixel space** (width x height of the raw screenshot from `captureVisibleTab`).

| Source | Input Coordinate Space | Normalization Required |
|--------|----------------------|----------------------|
| DOM signals | Viewport pixel coordinates (`getBoundingClientRect()`) | Verify they match screenshot space. If device pixel ratio > 1, multiply by DPR. |
| Visual ML signals | Model input space (e.g., 640x640) | Reverse the letterboxing/scaling transform (Section 5.5). |
| Face detection signals | Normalized [0.0–1.0] relative to input image | Multiply by screenshot dimensions (Section 8.3). |
| Heuristic PII signals | Element bounding box (from DOM — viewport space) | Same as DOM signals. |

### 10.4 Category Mapping

Each source emits signals in its own vocabulary. The normalization step maps to the unified `SensitivityCategory`:

| Source Signal | Mapped SensitivityCategory |
|--------------|---------------------------|
| DOM: `type="password"` | `PASSWORD` |
| DOM: OTP label match | `OTP` |
| DOM: `type="email"` | `EMAIL` |
| DOM: `type="tel"` | `PHONE` |
| Visual ML: `button`, `input_field`, `link`, etc. | `UI_ELEMENT` (not sensitive by itself) |
| Visual ML: face-class detection (if model supports) | `FACE` |
| Face detection: face bounding box | `FACE` |
| Heuristic: AADHAAR match | `AADHAAR` |
| Heuristic: PAN match | `PAN` |
| Heuristic: CARD_NUMBER match | `CARD_NUMBER` |
| Heuristic: EMAIL match | `EMAIL` |
| Heuristic: PHONE match | `PHONE` |

> **Note:** `UI_ELEMENT` signals from the visual ML model are used for agent context (element localization for the sanitized schema) but do not independently trigger sanitization unless they overlap with a sensitive signal.

---

## 11. Multi-Signal Fusion

### 11.1 Overview

The fusion layer is a **deterministic, rule-based** algorithm. It does not use machine learning. It combines all normalized signals from the four sources into a unified `SensitivityMap`.

Given the same input signals, the fusion algorithm always produces the same sensitivity map. This is intentional for the MVP — it makes debugging, testing, and explaining the pipeline's behavior straightforward.

### 11.2 Input

```
Input:
  domSignals:    NormalizedSignal[]   // From DOM Analysis
  visualSignals: NormalizedSignal[]   // From Visual ML
  faceSignals:   NormalizedSignal[]   // From Face Detection
  piiSignals:    NormalizedSignal[]   // From Heuristic PII

All signals are in original screenshot pixel space.
All signals have a confidence in [0.0, 1.0].
```

### 11.3 Output

```
SensitivityMap:
  regions: SensitivityRegion[]
  (see Section 12 for full data contract)
```

### 11.4 Fusion Algorithm (Step-by-Step)

```
STEP 1: Collect all signals
  allSignals = domSignals + visualSignals + faceSignals + piiSignals
  // UI_ELEMENT signals are routed separately for agent context, not sanitization

STEP 2: Partition by confidence
  candidates       = allSignals with confidence >= MINIMUM_CONFIDENCE_THRESHOLD
                     AND category != UI_ELEMENT
  failSafeCandidates = allSignals with confidence < MINIMUM_CONFIDENCE_THRESHOLD
                       AND category != UI_ELEMENT

STEP 3: Merge overlapping regions
  combined = candidates + failSafeCandidates
  For each pair of signals in combined:
    Compute IoU (Intersection over Union) of their bounding boxes
    If IoU > MERGE_THRESHOLD:
      Merge into one signal:
        - boundingBox = union of both bounding boxes
        - category = higher-priority category (per Section 11.5)
        - confidence = max(confidence_A, confidence_B)
        - sources = union of sources
        - failSafe = either signal was failSafe

STEP 4: Associate DOM elements
  For each signal without an elementId:
    Find DOM elements whose bounding box overlaps (IoU > DOM_ASSOCIATION_THRESHOLD)
    Assign the closest-match elementId

STEP 5: Assign sanitization actions
  For each merged signal:
    sanitizationAction = mapCategoryToSanitizationAction(category) // See Section 11.6

STEP 6: Output SensitivityRegion[]
```

**Algorithm constants:**

| Constant | Proposed Value | Status |
|----------|---------------|--------|
| `MINIMUM_CONFIDENCE_THRESHOLD` | 0.5 | PROPOSED (from TECHNICAL_SPEC.md Section 9.4) |
| `MERGE_THRESHOLD` (IoU) | 0.5 | PROPOSED (from TECHNICAL_SPEC.md Section 15.2) |
| `DOM_ASSOCIATION_THRESHOLD` (IoU) | 0.3 | PROPOSED |

> **Open Decision (OAD-ML-03):** These thresholds are proposed values. Calibration is required during benchmarking.

### 11.5 Sensitivity Category Priority (Highest to Lowest)

When merging two overlapping signals with different categories, the higher-priority category wins:

| Priority | Category |
|----------|---------|
| 1 (Highest) | `PASSWORD`, `OTP` |
| 2 | `AADHAAR`, `PAN`, `CARD_NUMBER` |
| 3 | `FACE` |
| 4 | `EMAIL`, `PHONE` |
| 5 | `GENERIC_PII` |
| 6 (Not in sensitivity map) | `UI_ELEMENT` |

### 11.6 Category to Sanitization Action Mapping

| Category | Sanitization Action | Rationale |
|----------|--------------------|-----------| 
| `PASSWORD`, `OTP` | `BLUR_AND_REPLACE` | Both visual region (if visible) and text value must be sanitized |
| `AADHAAR`, `PAN`, `CARD_NUMBER` | `BLUR_AND_REPLACE` | High-sensitivity identity data |
| `EMAIL`, `PHONE` | `BLUR_AND_REPLACE` | Contact data — both visual and schema |
| `FACE` | `BLUR_VISUAL` | Face is a visual-only signal; no text replacement needed |
| `GENERIC_PII` | `BLUR_AND_REPLACE` | Conservative default |

### 11.7 Fail-Safe Invariant

> **ARCHITECTURAL INVARIANT — FINAL:** Low confidence does NOT prevent redaction. If a signal exists with `confidence < MINIMUM_CONFIDENCE_THRESHOLD` and the signal category is potentially sensitive (not `UI_ELEMENT`), the signal is still included in the sensitivity map with `failSafe = true`.

This operationalizes PRD PV-08: "If the on-device perception layer's confidence in PII detection is below a configurable threshold for a given region, the system SHOULD err on the side of redacting that region."

A false positive (over-redaction) reduces VLM context but does not compromise privacy. A false negative (under-redaction) leaks PII. The system is asymmetric by design.

### 11.8 DOM-to-Visual Region Association

The fusion step associates each visual region (from visual ML or face detection) with the nearest DOM element. This association is required for schema sanitization — without an `elementId`, the Schema Sanitizer cannot replace the corresponding text field value.

If no DOM element overlaps sufficiently: `elementId = null`. Schema sanitization is skipped for this region (only screenshot sanitization applies).

---

## 12. Sensitivity Map

### 12.1 Data Contract

The sensitivity map is the formal output of the fusion layer and the formal input to the sanitization pipeline.

```
SensitivityMap:
  captureTimestamp:  number          // ms since epoch
  screenshotDims:    {w, h}          // Original screenshot dimensions
  regions:           SensitivityRegion[]

SensitivityRegion:
  regionId:           string
  boundingBox:        {x, y, w, h}   // Pixel coordinates in screenshot space
  elementId:          string | null
  category:           SensitivityCategory
  confidence:         number (0.0-1.0)
  sources:            SignalSource[]
  sanitizationAction: SanitizationAction
  failSafe:           boolean

SensitivityCategory:
  FACE | PASSWORD | OTP | AADHAAR | PAN | CARD_NUMBER | EMAIL | PHONE | GENERIC_PII

SignalSource:
  DOM_ANALYSIS | VISUAL_ML | FACE_DETECTION | HEURISTIC_PII

SanitizationAction:
  BLUR_VISUAL       // Blur bounding box in screenshot only
  MASK_VISUAL       // Black-box fill in screenshot only
  REPLACE_TEXT      // Replace text in schema only
  BLUR_AND_REPLACE  // Both screenshot and schema
```

### 12.2 Example Sensitivity Map

```
SensitivityMap:
  captureTimestamp: 1726657000000
  screenshotDims: {w: 1280, h: 720}
  regions: [
    {
      regionId: "r-001", boundingBox: {x: 120, y: 340, w: 200, h: 30},
      elementId: "el-17", category: AADHAAR, confidence: 1.0,
      sources: [HEURISTIC_PII, DOM_ANALYSIS],
      sanitizationAction: BLUR_AND_REPLACE, failSafe: false
    },
    {
      regionId: "r-002", boundingBox: {x: 50, y: 80, w: 100, h: 120},
      elementId: null, category: FACE, confidence: 0.92,
      sources: [FACE_DETECTION],
      sanitizationAction: BLUR_VISUAL, failSafe: false
    },
    {
      regionId: "r-003", boundingBox: {x: 300, y: 400, w: 180, h: 25},
      elementId: "el-22", category: PASSWORD, confidence: 1.0,
      sources: [DOM_ANALYSIS],
      sanitizationAction: BLUR_AND_REPLACE, failSafe: false
    },
    {
      regionId: "r-004", boundingBox: {x: 400, y: 200, w: 90, h: 20},
      elementId: "el-31", category: GENERIC_PII, confidence: 0.45,
      sources: [VISUAL_ML],
      sanitizationAction: BLUR_AND_REPLACE, failSafe: true
    }
  ]
```

---

## 13. Local Sanitization Interface

### 13.1 ML Pipeline Responsibility

The ML pipeline's responsibility ends at producing the `SensitivityMap`. Sanitization is the sanitization pipeline's responsibility (defined in TECHNICAL_SPEC.md Section 10). This section describes the contract between the ML pipeline and the sanitization layer.

### 13.2 Screenshot Sanitization Contract

The Screenshot Sanitizer receives:
- The **raw screenshot** (original, unmodified bitmap from `captureVisibleTab`).
- The `SensitivityMap`.

It produces:
- A **sanitized screenshot** — a copy of the raw screenshot with sensitive `boundingBox` regions visually destroyed.
- **The raw screenshot is never modified.** Sanitization operates on a copy.

The ML pipeline guarantees:
- All bounding boxes in the sensitivity map are in the same coordinate space as the raw screenshot (original pixel space).
- Bounding boxes are within the image dimensions (no out-of-bounds coordinates).

### 13.3 Schema Sanitization Contract

The Schema Sanitizer receives the raw DOM representation and the `SensitivityMap`. It produces a sanitized schema with sensitive element values replaced by typed placeholders.

The ML pipeline guarantees:
- All `elementId` references in the sensitivity map correspond to valid element IDs in the raw DOM representation.
- Where `elementId = null`, schema sanitization is skipped for that region.

### 13.4 Spatial Consistency Requirement

The sanitized screenshot and sanitized schema must be spatially and semantically consistent:
- A region marked `BLUR_AND_REPLACE` must be blurred in the screenshot **and** have its corresponding text replaced in the schema.
- The VLM should see: a blurred region in the image AND a typed placeholder in the schema at the corresponding element position.
- Inconsistency is a privacy failure. The post-sanitization verification step (TECHNICAL_SPEC.md Section 10.4) defends against this.

### 13.5 Raw Data Handling Invariants

The ML pipeline handles raw data during processing. These invariants are non-negotiable:

- **Raw screenshots** are passed to visual ML and face detection runtimes for inference only. They are not persisted, logged, or retained after inference.
- **Raw field values** (from `element.value`) are read by the heuristic PII detector for pattern matching only. They are discarded immediately after detection per TECHNICAL_SPEC.md Section 7.6. They must never appear in logs, error messages, or diagnostic output at any log level.
- All raw data exists only in working memory for the duration of the current perception cycle.

---

## 14. Confidence and Threshold Policy

### 14.1 Confidence Semantics by Source

| Source | Confidence Semantics |
|--------|---------------------|
| DOM Analysis (typed fields: `password`, `email`, `tel`) | Always `1.0` — deterministic. No uncertainty. |
| DOM Analysis (label heuristics for OTP) | `0.9` (proposed) — label matching is heuristic. |
| Visual ML | `0.0–1.0` from model's softmax/sigmoid. Model uncertainty about class label. |
| Face Detection | `0.0–1.0` from MediaPipe. Detection confidence. |
| Heuristic PII (full match + checksum valid) | `1.0` — deterministic. |
| Heuristic PII (partial/no checksum) | `0.5–0.9` (proposed) — depends on match quality. |

### 14.2 Fail-Safe Threshold

| Parameter | Proposed Value | Status |
|-----------|---------------|--------|
| `MINIMUM_CONFIDENCE_THRESHOLD` | 0.5 | PROPOSED |
| Fail-safe inclusion below threshold | Yes — all non-UI signals still redacted | FINAL |

### 14.3 Configurable Thresholds

The following thresholds are configurable, not hardcoded:

| Parameter | Proposed Default | Configuration Key |
|-----------|----------------|------------------|
| PII detection minimum confidence | 0.5 | `pii_confidence_threshold` |
| Face detection minimum confidence | 0.5 | `face_confidence_threshold` |
| NMS IoU threshold | 0.45 | TBD |
| Merge IoU threshold | 0.5 | TBD |

> **Open Decision (OAD-ML-03):** Threshold calibration is TBD. Proposed values are starting points only.

### 14.4 Threshold Philosophy

The threshold policy is asymmetric by design:

- **False positive (over-redaction):** Acceptable. VLM context is reduced, but privacy is preserved.
- **False negative (under-redaction):** Not acceptable. PII leaks across the privacy boundary.

When calibrating: prioritize recall (minimize false negatives) over precision (tolerate false positives).

---

## 15. Performance Engineering

### 15.1 Proposed Latency Targets per Stage

All targets are **proposed engineering targets** from PRD Section 15 and TECHNICAL_SPEC.md Section 29. They must be validated during benchmarking.

| Stage | Proposed Target | Notes |
|-------|---------------|-------|
| Screenshot capture (`captureVisibleTab`) | < 100ms | Chrome API latency |
| DOM extraction (content script traversal) | < 200ms | Scales with page complexity |
| DOM analysis | < 50ms | Deterministic traversal |
| Heuristic PII detection | < 50ms | Regex matching |
| Visual ML preprocessing | < 50ms | Resize + normalize |
| Visual ML inference (WebGPU, warm) | < 700ms | PROPOSED — depends on model selection |
| Visual ML inference (WASM, warm) | < 2500ms | PROPOSED — slower fallback |
| Face detection (MediaPipe) | < 200ms | PROPOSED |
| Fusion algorithm | < 50ms | Deterministic algorithm |
| Sanitization (screenshot + schema) | < 200ms | Canvas API operations |
| **Total on-device perception** | **< 2000ms** | PRD PF-01 target |
| **Total end-to-end cycle** | **< 5000ms** | PRD PF-03 target |

### 15.2 Cold-Start vs. Warm Inference

| Condition | Expected Behavior |
|-----------|------------------|
| **Cold start (first inference)** | Model loading + GPU shader compilation. Expected: 2–10 seconds. Dominated by model load + WebGPU warm-up. |
| **Warm inference (subsequent cycles)** | Model is in memory. GPU shaders compiled. See stage targets above. |
| **Service worker re-activation** | If the service worker was suspended, model must be re-loaded. Cold-start cost recurs. |

**Proposed mitigation for cold-start:** Run a warm-up inference immediately after model load (dummy input). This pre-compiles GPU shaders and ensures the first real inference operates at warm speed.

### 15.3 Memory Budget

| Component | Proposed Memory | Status |
|-----------|----------------|--------|
| Visual ML model weights | < 30–50MB | PROPOSED — depends on model |
| Visual ML inference buffers (per cycle) | < 20MB | PROPOSED |
| MediaPipe model | < 20MB | PROPOSED — validate for selected model/runtime |
| DOM extraction data (per cycle) | < 5MB | PROPOSED |
| Raw screenshot (in-memory) | ~2–10MB at 1080p | Depends on resolution |
| Sanitized screenshot copy | ~2–10MB | Same as raw |
| **Total active usage budget** | **< 500MB** | PRD PF-04 |
| **Total idle usage budget** | **< 100MB** | PRD PF-05 (models unloaded when idle) |

### 15.4 Identified Optimization Opportunities (Not Required for MVP)

| Optimization | Expected Gain | Status |
|-------------|--------------|--------|
| Quantize visual ML model (INT8 or FP16) | Potential size and inference benefits; quantify during benchmarking | PROPOSED — validate accuracy impact |
| Downscale screenshot before inference | Reduce preprocessing time and input tensor size | PROPOSED |
| Skip visual ML if DOM-only sufficient (simple pages) | Reduce per-cycle latency | PROPOSED — requires page complexity heuristic |
| Cache DOM extraction if page unchanged between cycles | Avoid redundant traversal | PROPOSED |

---

## 16. ML Failure and Degraded Modes

### 16.1 Failure Categories

| Category | Examples |
|----------|---------|
| **Model loading failure** | ONNX file not found, format error, OOM during load |
| **Runtime initialization failure** | WebGPU unavailable, WASM threading blocked, ORT-Web init exception |
| **Inference failure** | Exception during `session.run()`, invalid input tensor, runtime crash |
| **Inference timeout** | Model exceeds per-cycle latency budget |
| **MediaPipe failure** | MediaPipe fails to load or throws during face detection |
| **Preprocessing failure** | Canvas API error when resizing screenshot |
| **Postprocessing failure** | NMS fails, bounding box out of range |

### 16.2 Degraded Operation Mode Table

| Scenario | Visual ML | Face Detection | DOM Analysis | Heuristic PII | Outcome |
|----------|-----------|---------------|-------------|--------------|---------|
| All sources operational | OK | OK | OK | OK | Full perception |
| Visual ML fails | FAIL | OK | OK | OK | Degraded — no visual UI detection; face and text PII still covered |
| Face detection fails | OK | FAIL | OK | OK | Degraded — faces not detected; visual ML may partially cover if model detects face regions |
| Visual ML + Face detection both fail | FAIL | FAIL | OK | OK | Significantly degraded — password/OTP/text PII covered; visual PII (faces) not covered |
| WebGPU fails, WASM available | WASM | OK | OK | OK | Slower; all signals available |
| All ML fails | FAIL | FAIL | OK | OK | DOM-only mode — meaningful but limited perception |

### 16.3 Degraded Mode Communication

When operating in degraded mode:
- The system does NOT silently proceed as if perception were complete.
- The VLM must be informed via the sanitized context that the perception layer is degraded.
- The user should be notified if degradation is severe (e.g., DOM-only mode).

The `context_update` message should include:
```
perception_status: {
  visual_ml_available:      boolean,
  face_detection_available: boolean,
  dom_analysis_available:   boolean,
  heuristic_pii_available:  boolean
}
```

### 16.4 Fail-Closed Invariant

> **INVARIANT — FINAL:** Under all failure conditions, the sanitization pipeline remains fail-closed.
>
> Degraded perception may continue only when a valid SensitivityMap can be produced and sanitization succeeds. If the system cannot establish a valid sanitized representation, transmission is blocked and the system fails closed. The system errs on the side of not transmitting rather than risking PII leakage.
>
> If the sanitization pipeline itself fails (e.g., Canvas API error), the context is not transmitted (per TECHNICAL_SPEC.md Section 10.5).

---

## 17. Benchmarking Plan

### 17.1 Purpose

This section defines the methodology for evaluating the ML pipeline's performance. **No benchmark results exist yet.** This plan must be executed during development before the pipeline is declared ready for MVP.

### 17.2 Representative Website and Task Categories

| Category | Why Important |
|----------|--------------|
| Government portal / e-governance forms | Target use case; likely to contain Aadhaar, PAN, address PII |
| Banking / financial portals | Card numbers, account details, OTPs |
| Healthcare portals | Sensitive personal data, prescription information |
| E-commerce checkout | Card numbers, address fields |
| Social media profiles | Face photos in profile pictures |
| News / content pages | Low PII — tests false positive rate |
| SPA with dynamic content | Tests pipeline on dynamically rendered pages |
| Pages with canvas elements | Tests visual ML advantage over DOM-only |
| Pages with cross-origin iframes | Tests visual ML coverage of iframe content |

### 17.3 UI Element Detection Metrics

| Metric | Description | Proposed Target |
|--------|-------------|----------|
| mAP@0.5 | Mean Average Precision at IoU threshold 0.5 | > 0.6 (PROPOSED) |
| mAP@0.5:0.95 | Mean Average Precision at multiple IoU thresholds | > 0.4 (PROPOSED) |
| Per-class recall (button, input_field, link) | Recall per UI element class | > 0.7 for primary classes (PROPOSED) |
| False positive rate | Rate of spurious detections per image | < 0.2 (PROPOSED) |

### 17.4 PII Detection Metrics

For heuristic PII detection:

| Metric | Description | Proposed Target |
|--------|-------------|----------|
| Recall per PII type | True positives / (TP + FN) | > 0.95 for Aadhaar, PAN, Card (PROPOSED) |
| Precision per PII type | True positives / (TP + FP) | > 0.8 for all types (PROPOSED) |

For face detection (MediaPipe):

| Metric | Description | Proposed Target |
|--------|-------------|----------|
| Face recall | Detected faces / total faces in test set | > 0.9 (PROPOSED) |
| False positive rate | Spurious face detections per image | < 0.05 (PROPOSED) |

### 17.5 End-to-End Sanitization Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| PII leakage rate | Rate at which known PII appears in sanitized output | 0% for high-confidence PII — REQUIRED |
| Over-redaction rate | Rate at which non-PII content is unnecessarily redacted | Minimize — acceptable up to 20% (PROPOSED) |
| Spatial consistency | % of BLUR_AND_REPLACE regions where both outputs are sanitized | 100% — REQUIRED |

### 17.6 Latency Benchmarks

Measure on target hardware (8GB RAM, integrated GPU):

| Measurement | Condition |
|-------------|-----------|
| Visual ML inference latency (WebGPU) | Cold start; median over 20+ runs; P95 |
| Visual ML inference latency (WASM) | Same |
| MediaPipe face detection latency | Median over 20+ runs |
| Total perception latency | Screenshot captured to SensitivityMap produced |

### 17.7 Memory Benchmarks

| Measurement | Tool |
|-------------|------|
| Model load memory impact | Chrome DevTools Memory panel before/after load |
| Per-cycle peak memory during inference | `performance.measureUserAgentSpecificMemory()` or DevTools heap snapshot |
| Memory after 20+ cycles (leak detection) | Check for monotonic increase |

### 17.8 Browser Compatibility Matrix

| Browser | Version | WebGPU | WASM | Required |
|---------|---------|--------|------|----------|
| Chrome | 116+ | Yes | Yes | REQUIRED |
| Edge | 116+ | Yes | Yes | REQUIRED |

### 17.9 WebGPU vs. WASM Comparison

Run identical benchmarks on both backends and document:
- Inference latency (WebGPU expected to be 5–20x faster for compute-heavy models)
- Memory usage difference
- Output correctness (results should be identical or near-identical)

---

## 18. Dataset / Test Data Strategy

### 18.1 Overview

**No external dataset has been selected or acquired.** The following describes what is needed.

### 18.2 Synthetic Test Pages

Pages constructed by the team for controlled testing:

| Page Type | Purpose |
|-----------|---------|
| Form page with known Aadhaar, PAN, card, email, phone | Validate heuristic PII detection recall |
| Form page with password and OTP fields | Validate DOM analysis sensitive field detection |
| Page with embedded profile photo (face) | Validate face detection |
| Page with no PII | Validate false positive rate |
| Page with mixed PII (multiple types on same page) | Validate fusion and overlap handling |
| Canvas-rendered UI (no accessible DOM) | Validate visual ML advantage |
| Complex CSS layout | Validate visual ML spatial understanding |
| SPA with dynamic content | Validate perception on JS-rendered pages |
| Page with cross-origin iframe containing visible content | Validate visual ML coverage |
| Modal/dialog overlay with form fields | Validate modal state perception |
| Responsive layout at multiple viewport widths | Validate coordinate space handling |

### 18.3 Representative Real-World Screenshots

Sanitized (manually redacted) screenshots from real government/banking/healthcare portal structures — for structure realism without actual PII. No real user data should be used for development testing.

### 18.4 Annotated Ground Truth

For UI element detection benchmarking, annotated screenshots are required:
- Bounding box annotations for each UI element class.
- PII annotations for each PII instance (location, type, confidence expected).
- Face annotations for each face region.

> **Open Decision (OAD-ML-06):** Whether to use an existing annotated UI detection dataset (e.g., RICO, WebUI, Screen2Words) or create custom annotations is TBD. The team should evaluate available datasets for coverage and license compatibility.

---

## 19. Explainability and Safe Debugging

### 19.1 Purpose

During development and testing, the team needs visibility into how the ML pipeline made its decisions — which signals were produced, which were fused, and what the final sensitivity map contains. This must be done without exposing raw sensitive data.

### 19.2 Permitted Debug Information (at DEBUG log level)

| Information | Example |
|-------------|---------|
| Signal source name | `DOM_ANALYSIS`, `VISUAL_ML`, `HEURISTIC_PII` |
| Signal count per source | `domSignals: 12, visualSignals: 7, faceSignals: 1, piiSignals: 2` |
| Bounding box coordinates | `{x: 120, y: 340, w: 200, h: 30}` |
| Sensitivity category | `AADHAAR`, `FACE`, `PASSWORD` |
| Confidence score | `0.92` |
| Signal source list for merged region | `[HEURISTIC_PII, DOM_ANALYSIS]` |
| Sanitization action applied | `BLUR_AND_REPLACE` |
| Element ID | `el-17` |
| Tag name | `input` |
| Fail-safe flag | `true` |
| Total regions in sensitivity map | `4` |
| Perception cycle duration | `1240ms` |

### 19.3 Prohibited Debug Information

> [!CAUTION]
> The following MUST NEVER appear in logs, debug output, error messages, console output, or diagnostic data at ANY log level (including DEBUG):
>
> - Raw screenshot pixel data
> - Raw field values (`element.value` content for sensitive fields)
> - Raw PII text (actual Aadhaar numbers, PAN numbers, card numbers, passwords, OTPs, emails, phone numbers)
> - The matched text substring from heuristic PII detection
> - Face pixel regions
>
> Error messages referencing sensitive elements must use element identifiers and sensitivity categories — never actual values.

### 19.4 Sanitization Verification Log (Safe Summary)

A safe summary may be emitted after each sanitization cycle:

```
SANITIZATION_COMPLETE:
  totalRegions: 4
  byCategory: { FACE: 1, PASSWORD: 1, AADHAAR: 1, GENERIC_PII: 1 }
  failSafeRegions: 1
  screenshotBlurredRegions: 3
  schemaReplacedElements: 3
  durationMs: 145
```

No raw values or pixel data in this log entry.

---

## 20. Traceability

### 20.1 ML Requirements to PRD Requirements

| ML Component | PRD Requirement(s) | PRD Goal |
|-------------|-------------------|----------|
| Visual ML — UI element detection | FR-04, FR-05, FR-09 | G1 (visual context), G4 (resource) |
| Face detection (MediaPipe) | FR-04, FR-06, FR-09 | G2 (PII detection) |
| DOM analysis — sensitive fields | FR-07, FR-09 | G2 (PII detection) |
| Heuristic PII detection | FR-08, FR-09 | G2 (PII detection) |
| Multi-signal fusion | FR-09, PV-08 | G2 (detection), G3 (redaction) |
| Sanitization interface | FR-10, FR-11, FR-12, PV-01–PV-08 | G3 (redaction precision) |
| WebGPU/WASM runtime | FR-04, NFR-06, NFR-10, PF-04, PF-09 | G4 (resource usage) |
| Perception latency | PF-01, PF-03, NFR-05 | G5 (latency) |
| Fail-safe redaction | PV-08, NFR-06 | G3 (redaction) |

### 20.2 ML Components to Architecture Components

| ML Component | SYSTEM_ARCHITECTURE.md Component |
|-------------|----------------------------------|
| DOM Analysis | Section 5.2 DOM / Deterministic Analyzer |
| Visual ML | Section 5.3 Visual ML Engine |
| Heuristic PII | Section 5.4 Heuristic PII Detector |
| Multi-signal fusion | Section 5.5 Local Fusion Layer |
| Sensitivity map | Section 5.5 output |
| Screenshot sanitization | Section 5.6.1 Screenshot Sanitizer |
| Schema sanitization | Section 5.6.2 Schema Sanitizer |

### 20.3 ML Components to Technical Spec Sections

| ML Topic | TECHNICAL_SPEC.md Section |
|----------|--------------------------|
| Signal interfaces (DOMSignal, VisualSignal, FaceSignal, PIISignal) | Section 8 Multi-Signal Perception Specification |
| Sensitivity map data contract | Section 9 Sensitivity Map Specification |
| Sanitization pipeline | Section 10 Local Sanitization Specification |
| Visual ML runtime | Section 12 Visual ML Runtime Specification |
| MediaPipe integration | Section 13 MediaPipe Integration |
| Heuristic PII patterns | Section 14 Heuristic PII Detection |
| Fusion algorithm | Section 15 Fusion Algorithm Specification |
| Raw sensitive value lifecycle | Section 7.6 Raw Sensitive Value Lifecycle |
| Logging constraints | Section 28.1 Safe Logging Policy |
| Privacy invariants | Section 31 Privacy Invariants |

### 20.4 SIH Evaluation Criteria Mapping

| SIH Metric | Weight | ML Responsibility |
|-----------|--------|------------------|
| Accuracy of visual context from screen | 25% | Visual ML UI element detection accuracy; DOM analysis completeness |
| Recall and precision for PII detection | 20% | All four signal sources; fusion recall rate |
| Precision of redaction | 20% | Sanitization correctness; spatial consistency |
| Client-side resource utilization | 20% | Visual ML model size, latency, memory |
| Overall end-to-end latency | 15% | Total perception pipeline target < 2 seconds |

---

## 21. Open AI/ML Decisions

The following decisions are **intentionally TBD**. They must be resolved before implementation begins. Premature resolution without benchmarking evidence is not permitted.

| ID | Decision | Impact | Status |
|----|----------|--------|--------|
| **OAD-01** | Which specific visual ML model will be used? (YOLOv8-nano, ViT variant, MobileNet-SSD, or other) | Model file size, inference latency, accuracy, memory, WebGPU/WASM compatibility | **TBD — requires benchmarking** |
| **OAD-ML-01** | Which browser inference runtime? (ONNX Runtime Web, Transformers.js, TF.js) | Depends on OAD-01; must support WebGPU and WASM | **TBD — depends on OAD-01** |
| **OAD-ML-02** | What are the final confidence thresholds for face detection and visual ML? | Affects redaction sensitivity vs. false positive rate | **TBD — requires benchmarking** |
| **OAD-ML-03** | What are the final fusion IoU thresholds and confidence minimum? | Affects sensitivity map completeness and false positive rate | **TBD — requires benchmarking** |
| **OAD-06** | How will the visual ML model be loaded? (pre-load on install, lazy-load, progressive) | Cold-start UX; extension bundle size | **TBD** |
| **OAD-09** | Should ML inference run in an Offscreen Document to avoid blocking the service worker? | Inference blocking; MV3 service worker constraints | **TBD** |
| **OAD-ML-04** | Should Verhoeff checksum be implemented for Aadhaar validation in MVP, or deferred? | Aadhaar false positive rate; implementation complexity | **TBD** |
| **OAD-ML-05** | Should the visual ML model class vocabulary include face-like regions, or rely solely on MediaPipe for face detection? | Face coverage if MediaPipe fails | **TBD — depends on OAD-01** |
| **OAD-ML-06** | What dataset or annotation strategy to use for visual UI element detection benchmarking? (RICO, WebUI, custom annotations) | Benchmark validity; license compatibility | **TBD** |
| **OAD-02** | Which server-side VLM will be used? (Ollama + Qwen-VL, Gemma, LLaVA, cloud API) | Server-side reasoning quality; demo reliability. (Owned by BROWSER_AGENT_SPEC but intersects with end-to-end latency benchmarking.) | **TBD** |

---

## 22. Implementation Readiness Checklist

The following checklist must be completed before any application code begins for the ML pipeline. Items marked **REQUIRED** block implementation.

### 22.1 Model Selection

- [ ] **REQUIRED — OAD-01 resolved:** Visual ML model selected, with benchmark results documented.
- [ ] Selected model available in ONNX or Transformers.js compatible format.
- [ ] Model verified to run in ONNX Runtime Web WebGPU backend without errors.
- [ ] Model verified to run in ONNX Runtime Web WASM backend without errors.
- [ ] Model size within accepted threshold (proposed: < 30MB).
- [ ] Inference latency meets proposed targets on test hardware.
- [ ] **REQUIRED — OAD-ML-01 resolved:** Inference runtime selected (ORT-Web, Transformers.js, or TF.js).

### 22.2 MediaPipe

- [ ] **REQUIRED:** MediaPipe Face Detection integration verified in browser extension context (MV3 service worker or offscreen document).
- [ ] MediaPipe assets (WASM + model) identified for bundling or CDN loading.
- [ ] **OAD-ML-02 (face detection thresholds):** Benchmarked and set.

### 22.3 Heuristic PII

- [ ] **REQUIRED:** All five PII patterns (Aadhaar, PAN, Card, Email, Phone) implemented and unit-tested.
- [ ] **REQUIRED:** Luhn checksum implemented and verified for card numbers.
- [ ] **OAD-ML-04 (Verhoeff for Aadhaar):** Decision made.
- [ ] Normalization logic unit-tested with edge cases (separators, Unicode digits, country codes, split-field Aadhaar).

### 22.4 Fusion

- [ ] **REQUIRED:** Fusion algorithm implemented and unit-tested with deterministic behavior verified.
- [ ] **OAD-ML-03 (thresholds):** Benchmarked and set.
- [ ] **REQUIRED:** Fail-safe behavior verified — low-confidence signals produce sensitivity map entries.
- [ ] Overlap merging tested with overlapping bounding boxes from different sources.

### 22.5 Runtime and Performance

- [ ] **REQUIRED:** WebGPU -> WASM fallback logic implemented and tested.
- [ ] Model load time measured on target hardware; within PF-09 target (< 10 seconds).
- [ ] Per-cycle inference latency measured; within PF-01 contribution target (< 2000ms total).
- [ ] Memory usage profiled; within PF-04 budget (< 500MB active).
- [ ] **OAD-06 (loading strategy):** Decided.
- [ ] **OAD-09 (Offscreen Document):** Decided.

### 22.6 Privacy Invariants

- [ ] **REQUIRED:** Verified that raw screenshots are not persisted, logged, or transmitted.
- [ ] **REQUIRED:** Verified that raw field values are not persisted, logged (including DEBUG), or included in error messages.
- [ ] **REQUIRED:** Verified that the sensitivity map is produced before any sanitized context is constructed.
- [ ] **REQUIRED:** Post-sanitization verification step (TECHNICAL_SPEC.md Section 10.4) implemented and tested.

### 22.7 Benchmarking

- [ ] **REQUIRED before declaring MVP:** UI element detection metrics measured on representative web screenshot dataset.
- [ ] PII detection recall and precision measured for all five PII types.
- [ ] Face detection recall measured on test images containing faces.
- [ ] Sanitized output verified to contain no recoverable PII in sensitive regions.
- [ ] End-to-end latency measured on target hardware meeting PRD PF-01, PF-03 targets.
- [ ] Memory profile within PRD PF-04, PF-05 targets.

### 22.8 Degraded Mode

- [ ] **REQUIRED:** Visual ML failure -> DOM+heuristic fallback mode implemented and tested.
- [ ] **REQUIRED:** Face detection failure -> agent continues without face signals (verified).
- [ ] **REQUIRED:** All ML failure -> DOM-only mode implemented; user informed of degraded operation.
- [ ] **REQUIRED:** Fail-closed: if SensitivityMap cannot be produced, context is not transmitted (verified).

---

*This document is authoritative for all AI/ML pipeline decisions within the AEGIS on-device perception layer. All open decisions (OAD-01, OAD-ML-01 through OAD-ML-06, OAD-06, OAD-09) must be resolved before implementation begins. Resolved decisions should be documented via an Architecture Decision Record (ADR) appended to or referenced from this document.*
