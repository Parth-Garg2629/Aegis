import math
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

from model import INPUT_SIZE, GRID_SIZE

LETTERBOX_PAD_VALUE = 114


@dataclass
class LetterboxParams:
    scale: float
    pad_left: int
    pad_top: int


def compute_letterbox_params(src_w: int, src_h: int, target_size: int) -> LetterboxParams:
    scale = min(target_size / src_w, target_size / src_h)
    scaled_w = round(src_w * scale)
    scaled_h = round(src_h * scale)
    pad_left = (target_size - scaled_w) // 2
    pad_top = (target_size - scaled_h) // 2
    return LetterboxParams(scale=scale, pad_left=pad_left, pad_top=pad_top)


def letterbox_image(img: Image.Image, target_size: int) -> tuple[np.ndarray, LetterboxParams]:
    w, h = img.size
    params = compute_letterbox_params(w, h, target_size)
    scaled_w = round(w * params.scale)
    scaled_h = round(h * params.scale)

    canvas = np.full((target_size, target_size, 3), LETTERBOX_PAD_VALUE, dtype=np.uint8)
    resized = img.convert('RGB').resize((max(1, scaled_w), max(1, scaled_h)), Image.BILINEAR)
    resized_arr = np.asarray(resized)
    canvas[params.pad_top:params.pad_top + scaled_h, params.pad_left:params.pad_left + scaled_w] = resized_arr
    return canvas, params


class AegisDetectionDataset(Dataset):

    def __init__(self, root: str, num_classes: int = 9, input_size: int = INPUT_SIZE):
        self.root = Path(root)
        self.image_dir = self.root / 'images'
        self.label_dir = self.root / 'labels'
        self.image_paths = sorted(self.image_dir.glob('*.png'))
        self.num_classes = num_classes
        self.input_size = input_size
        self.grid_size = input_size // 16
        self.stride = input_size / self.grid_size

    def __len__(self) -> int:
        return len(self.image_paths)

    def __getitem__(self, idx: int):
        img_path = self.image_paths[idx]
        label_path = self.label_dir / f'{img_path.stem}.txt'

        img = Image.open(img_path)
        src_w, src_h = img.size
        canvas, params = letterbox_image(img, self.input_size)

        image_tensor = torch.from_numpy(canvas.astype(np.float32) / 255.0).permute(2, 0, 1)

        target = torch.zeros(self.grid_size, self.grid_size, 5 + self.num_classes, dtype=torch.float32)
        obj_mask = torch.zeros(self.grid_size, self.grid_size, dtype=torch.bool)

        if label_path.exists():
            for line in label_path.read_text().strip().splitlines():
                if not line.strip():
                    continue
                cls_id, cx, cy, bw, bh = line.split()
                cls_id = int(cls_id)
                cx, cy, bw, bh = float(cx) * src_w, float(cy) * src_h, float(bw) * src_w, float(bh) * src_h

                cx_lb = cx * params.scale + params.pad_left
                cy_lb = cy * params.scale + params.pad_top
                w_lb = bw * params.scale
                h_lb = bh * params.scale

                gx = min(self.grid_size - 1, max(0, int(cx_lb // self.stride)))
                gy = min(self.grid_size - 1, max(0, int(cy_lb // self.stride)))

                tx = (cx_lb - gx * self.stride) / self.stride
                ty = (cy_lb - gy * self.stride) / self.stride
                tw = w_lb / self.input_size
                th = h_lb / self.input_size

                target[gy, gx, 0] = 1.0
                target[gy, gx, 1:1 + self.num_classes] = 0.0
                target[gy, gx, 1 + cls_id] = 1.0
                target[gy, gx, 1 + self.num_classes + 0] = min(max(tx, 0.0), 1.0)
                target[gy, gx, 1 + self.num_classes + 1] = min(max(ty, 0.0), 1.0)
                target[gy, gx, 1 + self.num_classes + 2] = min(max(tw, 0.0), 1.0)
                target[gy, gx, 1 + self.num_classes + 3] = min(max(th, 0.0), 1.0)
                obj_mask[gy, gx] = True

        return image_tensor, target, obj_mask
