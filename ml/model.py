import torch
import torch.nn as nn

INPUT_SIZE = 320
GRID_SIZE = INPUT_SIZE // 16


class ConvBlock(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, stride: int = 2):
        super().__init__()
        self.conv = nn.Conv2d(in_ch, out_ch, kernel_size=3, stride=stride, padding=1, bias=False)
        self.bn = nn.BatchNorm2d(out_ch)
        self.act = nn.ReLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.bn(self.conv(x)))


class AegisNano(nn.Module):
    def __init__(self, num_classes: int = 9, input_size: int = INPUT_SIZE):
        super().__init__()
        self.num_classes = num_classes
        self.input_size = input_size
        self.grid_size = input_size // 16

        self.backbone = nn.Sequential(
            ConvBlock(3, 16, stride=2),
            ConvBlock(16, 32, stride=2),
            ConvBlock(32, 64, stride=2),
            ConvBlock(64, 96, stride=2),
            ConvBlock(96, 96, stride=1),
        )
        self.head = nn.Conv2d(96, 5 + num_classes, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.backbone(x)
        raw = self.head(features)
        return raw.permute(0, 2, 3, 1).contiguous()


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == '__main__':
    m = AegisNano()
    dummy = torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE)
    out = m(dummy)
    print(f'AegisNano: {count_parameters(m):,} parameters')
    print(f'input  {tuple(dummy.shape)}')
    print(f'output {tuple(out.shape)}  (expected (1, {GRID_SIZE}, {GRID_SIZE}, {5 + m.num_classes}))')
