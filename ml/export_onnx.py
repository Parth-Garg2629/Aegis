import argparse
import json
from pathlib import Path

import numpy as np
import torch

from model import AegisNano, INPUT_SIZE

HERE = Path(__file__).parent


def export(checkpoint_path: str, output_path: str) -> None:
    ckpt = torch.load(checkpoint_path, map_location='cpu', weights_only=False)
    model = AegisNano(num_classes=ckpt['num_classes'], input_size=ckpt['input_size'])
    model.load_state_dict(ckpt['model_state_dict'])
    model.eval()

    dummy = torch.zeros(1, 3, ckpt['input_size'], ckpt['input_size'], dtype=torch.float32)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (dummy,),
        output_path,
        input_names=['input'],
        output_names=['output'],
        opset_version=17,
        dynamo=False,
    )
    print(f'Exported ONNX model to {output_path}')

    import onnxruntime as ort

    session = ort.InferenceSession(output_path, providers=['CPUExecutionProvider'])
    rng = np.random.default_rng(42)
    test_input = rng.random((1, 3, ckpt['input_size'], ckpt['input_size']), dtype=np.float32)

    with torch.no_grad():
        torch_out = model(torch.from_numpy(test_input)).numpy()

    onnx_out = session.run(['output'], {'input': test_input})[0]

    max_diff = np.abs(torch_out - onnx_out).max()
    print(f'Max abs diff between PyTorch and ONNX Runtime output: {max_diff:.6f}')
    assert max_diff < 1e-3, 'ONNX export diverges from PyTorch model beyond tolerance'
    print('ONNX Runtime verification PASSED (CPU execution provider).')

    size_mb = Path(output_path).stat().st_size / (1024 * 1024)
    print(f'Model file size: {size_mb:.2f} MB')

    meta = {
        'input_shape': [1, 3, ckpt['input_size'], ckpt['input_size']],
        'output_shape': list(np.array(onnx_out).shape),
        'class_names': ckpt['class_names'],
        'grid_size': ckpt['grid_size'],
        'max_diff_torch_vs_ort': float(max_diff),
        'model_size_mb': size_mb,
        'opset_version': 17,
    }
    meta_path = Path(output_path).with_suffix('.export_meta.json')
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f'Wrote export metadata to {meta_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=str, default=str(HERE / 'checkpoints' / 'aegis-nano.pt'))
    parser.add_argument('--output', type=str, default=str(HERE.parent / 'extension' / 'assets' / 'models' / 'aegis-nano.onnx'))
    args = parser.parse_args()
    export(args.checkpoint, args.output)
