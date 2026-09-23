import argparse
import json
import time
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from model import AegisNano, GRID_SIZE, INPUT_SIZE, count_parameters
from dataset import AegisDetectionDataset
from class_names_py import CLASS_NAMES

HERE = Path(__file__).parent


def compute_loss(pred, target, obj_mask, num_classes, box_weight=5.0, obj_pos_weight=5.0):
    pred_obj = pred[..., 0]
    target_obj = target[..., 0]
    obj_loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(obj_pos_weight))
    obj_loss = obj_loss_fn(pred_obj, target_obj)

    if obj_mask.any():
        pred_cls = pred[..., 1:1 + num_classes][obj_mask]
        target_cls_idx = target[..., 1:1 + num_classes][obj_mask].argmax(dim=-1)
        class_loss = nn.functional.cross_entropy(pred_cls, target_cls_idx)

        pred_box = torch.sigmoid(pred[..., 1 + num_classes:5 + num_classes][obj_mask])
        target_box = target[..., 1 + num_classes:5 + num_classes][obj_mask]
        box_loss = nn.functional.mse_loss(pred_box, target_box)
    else:
        class_loss = torch.tensor(0.0)
        box_loss = torch.tensor(0.0)

    total = obj_loss + class_loss + box_weight * box_loss
    return total, {'obj': obj_loss.item(), 'class': class_loss.item(), 'box': box_loss.item()}


@torch.no_grad()
def evaluate(model, loader, num_classes, device):
    model.eval()
    total_loss = 0.0
    n_batches = 0
    correct_cls = 0
    total_pos = 0
    obj_tp = 0
    obj_fp = 0
    obj_fn = 0

    for images, targets, obj_mask in loader:
        images, targets, obj_mask = images.to(device), targets.to(device), obj_mask.to(device)
        pred = model(images)
        loss, _ = compute_loss(pred, targets, obj_mask, num_classes)
        total_loss += loss.item()
        n_batches += 1

        pred_obj_prob = torch.sigmoid(pred[..., 0])
        pred_positive = pred_obj_prob > 0.5
        obj_tp += (pred_positive & obj_mask).sum().item()
        obj_fp += (pred_positive & ~obj_mask).sum().item()
        obj_fn += ((~pred_positive) & obj_mask).sum().item()

        if obj_mask.any():
            pred_cls = pred[..., 1:1 + num_classes][obj_mask].argmax(dim=-1)
            target_cls = targets[..., 1:1 + num_classes][obj_mask].argmax(dim=-1)
            correct_cls += (pred_cls == target_cls).sum().item()
            total_pos += obj_mask.sum().item()

    precision = obj_tp / (obj_tp + obj_fp) if (obj_tp + obj_fp) > 0 else 0.0
    recall = obj_tp / (obj_tp + obj_fn) if (obj_tp + obj_fn) > 0 else 0.0
    class_acc = correct_cls / total_pos if total_pos > 0 else 0.0

    return {
        'loss': total_loss / max(n_batches, 1),
        'cell_objectness_precision': precision,
        'cell_objectness_recall': recall,
        'cell_class_accuracy_given_object': class_acc,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=60)
    parser.add_argument('--batch-size', type=int, default=16)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--data-root', type=str, default=str(HERE / 'dataset'))
    parser.add_argument('--output', type=str, default=str(HERE / 'checkpoints' / 'aegis-nano.pt'))
    args = parser.parse_args()

    device = torch.device('cpu')
    num_classes = len(CLASS_NAMES)

    train_set = AegisDetectionDataset(Path(args.data_root) / 'train', num_classes=num_classes)
    val_set = AegisDetectionDataset(Path(args.data_root) / 'val', num_classes=num_classes)
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0)

    model = AegisNano(num_classes=num_classes, input_size=INPUT_SIZE).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    print(f'AegisNano: {count_parameters(model):,} params | train={len(train_set)} val={len(val_set)} images')
    print(f'device={device} epochs={args.epochs} batch_size={args.batch_size}')

    history = []
    t_start = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        epoch_start = time.time()
        running_loss = 0.0
        n_batches = 0
        for images, targets, obj_mask in train_loader:
            images, targets, obj_mask = images.to(device), targets.to(device), obj_mask.to(device)
            optimizer.zero_grad()
            pred = model(images)
            loss, parts = compute_loss(pred, targets, obj_mask, num_classes)
            loss.backward()
            optimizer.step()
            running_loss += loss.item()
            n_batches += 1

        train_loss = running_loss / max(n_batches, 1)
        val_metrics = evaluate(model, val_loader, num_classes, device)
        epoch_time = time.time() - epoch_start

        print(
            f'epoch {epoch:3d}/{args.epochs}  train_loss={train_loss:.4f}  '
            f'val_loss={val_metrics["loss"]:.4f}  '
            f'val_obj_P={val_metrics["cell_objectness_precision"]:.3f}  '
            f'val_obj_R={val_metrics["cell_objectness_recall"]:.3f}  '
            f'val_cls_acc={val_metrics["cell_class_accuracy_given_object"]:.3f}  '
            f'({epoch_time:.1f}s)'
        )
        history.append({'epoch': epoch, 'train_loss': train_loss, **val_metrics, 'epoch_time_s': epoch_time})

    total_time = time.time() - t_start

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            'model_state_dict': model.state_dict(),
            'num_classes': num_classes,
            'class_names': CLASS_NAMES,
            'input_size': INPUT_SIZE,
            'grid_size': GRID_SIZE,
        },
        args.output,
    )

    report = {
        'trained_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'total_training_time_s': total_time,
        'epochs': args.epochs,
        'train_images': len(train_set),
        'val_images': len(val_set),
        'parameter_count': count_parameters(model),
        'final_metrics': history[-1] if history else None,
        'history': history,
        'notes': (
            'Interim from-scratch nano detector (OAD-01 remains open, see model.py). '
            'Trained on a small Playwright-generated synthetic dataset (ml/generate_dataset.mjs), '
            'not a large-scale annotated real-world benchmark — accuracy figures here are honest '
            'but not representative of production-grade UI detection performance.'
        ),
    }
    report_path = Path(args.output).parent / 'training_report.json'
    report_path.write_text(json.dumps(report, indent=2))

    print(f'\nSaved checkpoint to {args.output}')
    print(f'Saved training report to {report_path}')
    print(f'Total training time: {total_time:.1f}s')


if __name__ == '__main__':
    main()
