import json
import time
from collections import defaultdict
from pathlib import Path

import torch

from model import AegisNano, INPUT_SIZE
from dataset import AegisDetectionDataset, letterbox_image
from class_names_py import CLASS_NAMES
from PIL import Image

HERE = Path(__file__).parent

CONFIDENCE_THRESHOLD = 0.4
IOU_MATCH_THRESHOLD = 0.5


def sigmoid(x):
    return 1 / (1 + torch.exp(-x))


def decode_predictions(pred, grid_size, num_classes, input_size, confidence_threshold=CONFIDENCE_THRESHOLD):
    stride = input_size / grid_size
    detections = []
    obj = torch.sigmoid(pred[..., 0])
    cls_logits = pred[..., 1:1 + num_classes]
    cls_probs = torch.softmax(cls_logits, dim=-1)
    best_prob, best_class = cls_probs.max(dim=-1)
    confidence = obj * best_prob

    box_raw = torch.sigmoid(pred[..., 1 + num_classes:5 + num_classes])

    for gy in range(grid_size):
        for gx in range(grid_size):
            conf = confidence[gy, gx].item()
            if conf < confidence_threshold:
                continue
            tx, ty, tw, th = box_raw[gy, gx].tolist()
            w = tw * input_size
            h = th * input_size
            cx = (gx + tx) * stride
            cy = (gy + ty) * stride
            detections.append({
                'box': [cx - w / 2, cy - h / 2, w, h],
                'confidence': conf,
                'class_id': int(best_class[gy, gx].item()),
            })
    return detections


def iou(a, b):
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def evaluate_detection_quality(model, val_root, num_classes, grid_size, input_size):
    image_paths = sorted((Path(val_root) / 'images').glob('*.png'))
    label_dir = Path(val_root) / 'labels'

    tp = defaultdict(int)
    fp = defaultdict(int)
    fn = defaultdict(int)

    model.eval()
    with torch.no_grad():
        for img_path in image_paths:
            img = Image.open(img_path)
            src_w, src_h = img.size
            canvas, params = letterbox_image(img, input_size)
            tensor = torch.from_numpy(canvas.astype('float32') / 255.0).permute(2, 0, 1).unsqueeze(0)
            pred = model(tensor)[0]
            detections = decode_predictions(pred, grid_size, num_classes, input_size)

            label_path = label_dir / f'{img_path.stem}.txt'
            gt_boxes = []
            if label_path.exists():
                for line in label_path.read_text().strip().splitlines():
                    if not line.strip():
                        continue
                    cls_id, cx, cy, bw, bh = line.split()
                    cls_id = int(cls_id)
                    cx, cy = float(cx) * src_w, float(cy) * src_h
                    bw, bh = float(bw) * src_w, float(bh) * src_h
                    cx_lb = cx * params.scale + params.pad_left
                    cy_lb = cy * params.scale + params.pad_top
                    w_lb, h_lb = bw * params.scale, bh * params.scale
                    gt_boxes.append({'box': [cx_lb - w_lb / 2, cy_lb - h_lb / 2, w_lb, h_lb], 'class_id': cls_id, 'matched': False})

            for det in sorted(detections, key=lambda d: -d['confidence']):
                best_iou, best_gt = 0.0, None
                for gt in gt_boxes:
                    if gt['matched'] or gt['class_id'] != det['class_id']:
                        continue
                    i = iou(det['box'], gt['box'])
                    if i > best_iou:
                        best_iou, best_gt = i, gt
                if best_gt is not None and best_iou >= IOU_MATCH_THRESHOLD:
                    best_gt['matched'] = True
                    tp[det['class_id']] += 1
                else:
                    fp[det['class_id']] += 1

            for gt in gt_boxes:
                if not gt['matched']:
                    fn[gt['class_id']] += 1

    per_class = {}
    for cid, name in enumerate(CLASS_NAMES):
        t, f, n = tp[cid], fp[cid], fn[cid]
        precision = t / (t + f) if (t + f) > 0 else None
        recall = t / (t + n) if (t + n) > 0 else None
        per_class[name] = {'tp': t, 'fp': f, 'fn': n, 'precision': precision, 'recall': recall}
    return per_class


def main():
    checkpoint_path = HERE / 'checkpoints' / 'aegis-nano.pt'
    ckpt = torch.load(checkpoint_path, map_location='cpu', weights_only=False)
    model = AegisNano(num_classes=ckpt['num_classes'], input_size=ckpt['input_size'])
    model.load_state_dict(ckpt['model_state_dict'])
    model.eval()

    onnx_path = HERE.parent / 'extension' / 'assets' / 'models' / 'aegis-nano.onnx'
    model_size_mb = onnx_path.stat().st_size / (1024 * 1024) if onnx_path.exists() else None

    dummy = torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE)
    with torch.no_grad():
        for _ in range(10):
            model(dummy)
        latencies = []
        for _ in range(30):
            t0 = time.perf_counter()
            model(dummy)
            latencies.append((time.perf_counter() - t0) * 1000)
    latencies.sort()
    p50 = latencies[len(latencies) // 2]
    p95 = latencies[int(len(latencies) * 0.95)]

    quality = evaluate_detection_quality(
        model, HERE / 'dataset' / 'val', ckpt['num_classes'], ckpt['grid_size'], ckpt['input_size']
    )

    report = {
        'measured_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'environment': 'PyTorch CPU inference in this sandbox — NOT ONNX Runtime Web in an actual browser (§17.6/§17.8 require a real Chrome extension context this environment cannot provide)',
        'model_size_mb': model_size_mb,
        'pytorch_cpu_latency_ms': {'p50': p50, 'p95': p95, 'n_runs': len(latencies)},
        'detection_quality_iou_0.5': quality,
        'thresholds_from_spec': {
            'model_size_mb_target': '< 30 (§6.3)',
            'wasm_latency_ms_target': '< 3000 median (§6.3, note: measured here is PyTorch CPU, not WASM)',
        },
        'honest_caveats': [
            'Val set is only 30 images across 2 held-out templates — precision/recall figures have wide uncertainty.',
            'radio class has zero val examples (neither held-out template uses it) — recall is not measurable for that class.',
            'This is a CPU-trained, from-scratch nano model on synthetic data, not a benchmarked production detector (OAD-01 remains open).',
        ],
    }

    report_path = HERE / 'checkpoints' / 'benchmark_report.json'
    report_path.write_text(json.dumps(report, indent=2))

    print(f'Model size: {model_size_mb:.2f} MB' if model_size_mb else 'Model size: (ONNX not exported yet)')
    print(f'PyTorch CPU inference: p50={p50:.1f}ms p95={p95:.1f}ms')
    print('\nPer-class detection quality (val, IoU>=0.5):')
    for name, m in quality.items():
        p = f'{m["precision"]:.2f}' if m['precision'] is not None else 'n/a'
        r = f'{m["recall"]:.2f}' if m['recall'] is not None else 'n/a'
        print(f'  {name:14s} precision={p:>5s} recall={r:>5s}  (tp={m["tp"]} fp={m["fp"]} fn={m["fn"]})')
    print(f'\nFull report: {report_path}')


if __name__ == '__main__':
    main()
