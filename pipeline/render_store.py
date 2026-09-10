import json
import os
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path


CALIBRATION_KEYS = ("tileWidth", "tileHeight", "supersample", "cameraFit", "cameraYaw", "cameraElevation", "projectionVersion")


def validate_calibration(existing, current):
    if any(existing.get(key) != current.get(key) for key in CALIBRATION_KEYS):
        raise ValueError("Camera calibration changed: render all models or use a fresh --out directory")


@contextmanager
def render_batch(directory, manifest):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".render-", dir=directory) as staging:
        yield staging
        generation = f"batch-{uuid.uuid4().hex}"
        files = {path.name for path in Path(staging).iterdir() if path.is_file()}
        for sprite in manifest["sprites"]:
            if sprite["file"] in files:
                sprite["file"] = f"{generation}/{sprite['file']}"
        manifest_file = Path(staging) / "manifest.json"
        manifest_file.write_text(json.dumps(manifest, indent=2))
        committed = directory / generation
        os.replace(staging, committed)
        os.replace(committed / "manifest.json", directory / "manifest.json")
