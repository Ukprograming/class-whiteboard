"""Split the 4x3 reaction-stamp sheet into square, transparent PNG assets."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CANVAS_SIZE = 256
CONTENT_SIZE = 244
ALPHA_THRESHOLD = 24

# The source artwork is arranged as four columns by three rows. The row cuts
# differ slightly per column because some sticker outlines cross the nominal
# one-third boundaries.
STAMP_SPECS = (
    ("reaction-good.png", (0, 0, 380, 357)),
    ("reaction-thinking.png", (0, 357, 380, 669)),
    ("reaction-different.png", (0, 669, 380, 1024)),
    ("reaction-ok.png", (380, 0, 780, 360)),
    ("reaction-pause.png", (380, 360, 780, 680)),
    ("reaction-sigh.png", (380, 680, 780, 1024)),
    ("reaction-nice.png", (780, 0, 1125, 353)),
    ("reaction-understood.png", (780, 353, 1125, 674)),
    ("reaction-working.png", (780, 674, 1125, 1024)),
    ("reaction-impressive.png", (1125, 0, 1536, 353)),
    ("reaction-acknowledged.png", (1125, 353, 1536, 666)),
    ("reaction-thanks.png", (1125, 666, 1536, 1024)),
)


def content_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value >= ALPHA_THRESHOLD else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("The crop does not contain visible pixels.")
    return bbox


def split_sheet(source_path: Path, output_dir: Path) -> None:
    source = Image.open(source_path).convert("RGBA")
    if source.size != (1536, 1024):
        raise ValueError(f"Expected a 1536x1024 source image, got {source.size}.")

    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, crop_box in STAMP_SPECS:
        crop = source.crop(crop_box)
        crop = crop.crop(content_bbox(crop))
        crop.thumbnail((CONTENT_SIZE, CONTENT_SIZE), Image.Resampling.LANCZOS)

        output = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
        x = (CANVAS_SIZE - crop.width) // 2
        y = (CANVAS_SIZE - crop.height) // 2
        output.alpha_composite(crop, (x, y))
        output.save(output_dir / filename, optimize=True, compress_level=9)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    split_sheet(args.source, args.output_dir)


if __name__ == "__main__":
    main()
