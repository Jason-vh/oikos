import argparse
import json
from pathlib import Path

from PIL import Image


def prepare(source, output, width=118, trim=True):
    if width < 1:
        raise ValueError("Width must be positive")
    image = Image.open(source).convert("RGBA")
    solid = image.getchannel("A").point(lambda value: 0 if value <= 128 else 255)
    image = Image.composite(image, Image.new("RGBA", image.size, (0, 0, 0, 0)), solid)
    image.putalpha(solid)
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("Image contains no visible pixels")
    if trim:
        image = image.crop(bounds)
    height = max(1, round(image.height * width / image.width))
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    resolutions = []
    for scale in (1, 2, 3, 4):
        target = output
        if scale > 1:
            target = output.with_name(f"{output.stem}-{scale}x{output.suffix}")
        image.resize((width * scale, height * scale), Image.Resampling.LANCZOS).save(target)
        resolutions.append({"scale": scale, "image": target.name, "width": width * scale, "height": height * scale})
    metadata = {
        "image": output.name,
        "width": width,
        "height": height,
        "resolutions": resolutions,
        "anchorX": 0.5,
        "anchorY": 1,
        "sourceBounds": bounds,
        "placement": "Uniformly scaled to a 118px painted footprint; bottom-centred approximation, no perspective correction",
    }
    sidecar = output.with_suffix(".json")
    if sidecar.exists():
        metadata = {**json.loads(sidecar.read_text()), **metadata}
    sidecar.write_text(json.dumps(metadata, indent=2))
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--width", type=int, default=118)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.output, args.width), indent=2))


if __name__ == "__main__":
    main()
