import json
import math
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from compare import atlas_layers, compose, reference_scale
from pack import apply_overlay, load_manifest, native_finish, south_vertex_offset
from render_store import CALIBRATION_KEYS, render_batch, validate_calibration
from prepare_study import prepare

CALIBRATION = {"tileWidth": 120, "tileHeight": 60, "supersample": 2, "cameraFit": "HORIZONTAL", "cameraYaw": math.pi / 4, "cameraElevation": math.pi / 6, "projectionVersion": 1}


class AssetTests(unittest.TestCase):
    def test_study_removes_faint_border_and_preserves_proportions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Image.new("RGBA", (400, 400), (0, 0, 0, 1))
            source.paste((180, 110, 60, 255), (40, 80, 340, 280))
            source.save(root / "source.png")
            metadata = prepare(root / "source.png", root / "study.png", 120)
            self.assertEqual(metadata["sourceBounds"], (40, 80, 340, 280))
            self.assertEqual(Image.open(root / "study.png").size, (120, 80))
            self.assertEqual((metadata["anchorX"], metadata["anchorY"]), (0.5, 1))
            self.assertEqual(json.loads((root / "study.json").read_text())["width"], 120)

    def test_study_resolutions_are_sampled_directly_from_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Image.new("RGBA", (400, 300))
            source.putdata([(255 * (x % 2), 255 * (y % 3 == 0), (x * 17 + y * 13) % 256, 255) for y in range(300) for x in range(400)])
            source.save(root / "source.png")
            metadata = prepare(root / "source.png", root / "study.png", 80)
            native = Image.open(root / "study.png")
            self.assertEqual(len(metadata["resolutions"]), 4)
            for entry in metadata["resolutions"]:
                scale = entry["scale"]
                size = (80 * scale, 60 * scale)
                actual = Image.open(root / entry["image"])
                self.assertEqual(actual.size, size)
                self.assertEqual(actual.tobytes(), source.resize(size, Image.Resampling.LANCZOS).tobytes())
                if scale > 1:
                    self.assertNotEqual(actual.tobytes(), native.resize(size, Image.Resampling.NEAREST).tobytes())

    def test_overlay_replaces_body_and_mirrors_odd_variant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            study = Image.new("RGBA", (236, 2), (0, 0, 0, 0))
            study.putpixel((0, 0), (255, 0, 0, 255))
            study.save(root / "hut-2x.png")
            Image.new("RGBA", (2, 1)).save(root / "hut.png")
            (root / "hut.json").write_text(json.dumps({
                "image": "hut.png", "anchorX": 0.4, "anchorY": 1,
                "resolutions": [{"scale": 1, "image": "hut.png"}, {"scale": 2, "image": "hut-2x.png"}],
            }))
            baked = lambda variant, layer: {"kind": "house", "variant": variant, "layer": layer, "footprint": 2, "image": Image.new("RGBA", (1, 1)), "anchorX": 0.5, "anchorY": 0.5}
            prepared = [baked(0, "body"), baked(0, "shadow"), baked(1, "body"), baked(2, "body")]
            apply_overlay(prepared, {"house:0": "hut"}, root)
            self.assertEqual(prepared[0]["image"].getpixel((0, 0)), (255, 0, 0, 255))
            self.assertEqual(prepared[0]["anchorX"], 0.4)
            self.assertEqual(prepared[2]["image"].getpixel((235, 0)), (255, 0, 0, 255))
            self.assertEqual(prepared[2]["anchorX"], 0.6)
            self.assertEqual(prepared[1]["image"].size, (1, 1))
            self.assertEqual(prepared[3]["image"].size, (1, 1))
            with self.assertRaisesRegex(ValueError, "expected one baked body"):
                apply_overlay(prepared, {"house:6": "hut"}, root)
            Image.new("RGBA", (118, 2)).save(root / "hut-2x.png")
            with self.assertRaisesRegex(ValueError, "atlas density"):
                apply_overlay(prepared, {"house:0": "hut"}, root)

    def test_study_rejects_empty_image(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new("RGBA", (10, 10)).save(root / "empty.png")
            with self.assertRaisesRegex(ValueError, "no visible pixels"):
                prepare(root / "empty.png", root / "study.png")

    def test_reference_scale_uses_pitch_not_painted_width(self):
        self.assertEqual(reference_scale({"width": 58, "pitchWidth": 60, "gameWidth": 120}), 2)

    def test_uncalibrated_render_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps({"sprites": []}))
            with self.assertRaisesRegex(ValueError, "calibration changed"):
                load_manifest(directory)
            path.write_text(json.dumps({**CALIBRATION, "sprites": []}))
            self.assertEqual(load_manifest(directory)["sprites"], [])

    def test_every_projection_parameter_is_checked(self):
        for key in CALIBRATION_KEYS:
            with self.subTest(key=key):
                changed = {**CALIBRATION, key: None}
                with self.assertRaises(ValueError):
                    validate_calibration(changed, CALIBRATION)

    def test_failed_batch_preserves_existing_manifest_and_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = {"sprites": [{"file": "house.png"}]}
            (root / "manifest.json").write_text(json.dumps(manifest))
            (root / "house.png").write_bytes(b"old")
            before = (root / "manifest.json").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "render failed"):
                with render_batch(root, manifest) as staging:
                    (Path(staging) / "house.png").write_bytes(b"new")
                    raise RuntimeError("render failed")
            self.assertEqual((root / "manifest.json").read_bytes(), before)
            self.assertEqual((root / "house.png").read_bytes(), b"old")
            self.assertEqual(len(list(root.iterdir())), 2)

    def test_completed_batch_switches_manifest_to_immutable_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "old.png").write_bytes(b"old")
            manifest = {"sprites": [{"file": "old.png"}, {"file": "house.png"}]}
            with render_batch(root, manifest) as staging:
                (Path(staging) / "house.png").write_bytes(b"new")
                self.assertFalse((root / "manifest.json").exists())
            published = json.loads((root / "manifest.json").read_text())
            self.assertEqual(published["sprites"][0]["file"], "old.png")
            path = published["sprites"][1]["file"]
            self.assertTrue(path.startswith("batch-"))
            self.assertEqual((root / path).read_bytes(), b"new")

    def test_rectangular_footprint_pivots(self):
        across, down = south_vertex_offset((6, 3), 2, 120 / math.sqrt(2))
        self.assertAlmostEqual(across, 90)
        self.assertAlmostEqual(down, 135 + math.sqrt(3) * 60 / math.sqrt(2))
        turned_across, turned_down = south_vertex_offset((3, 6), 2, 120 / math.sqrt(2))
        self.assertAlmostEqual(turned_across, -across)
        self.assertAlmostEqual(turned_down, down)

    def test_native_finish_preserves_two_pixel_clusters(self):
        source = Image.new("RGBA", (32, 32), (155, 110, 76, 255))
        source.paste((0, 0, 0, 0), (0, 0, 12, 32))
        image = native_finish(source, 16, 16)
        ramp = {round(value * 255 / 31) for value in range(32)}
        for y in range(0, image.height, 2):
            for x in range(0, image.width, 2):
                pixel = image.getpixel((x, y))
                self.assertTrue(all(channel in ramp for channel in pixel[:3]))
                self.assertIn(pixel[3], (0, 255))
                self.assertEqual(set(image.crop((x, y, x + 2, y + 2)).getdata()), {pixel})

    def test_atlas_comparison_aligns_body_and_shadow_at_their_own_pivots(self):
        with tempfile.TemporaryDirectory() as directory:
            stem = Path(directory) / "structures"
            image = Image.new("RGBA", (6, 2), (0, 0, 0, 255))
            image.paste((255, 255, 255, 255), (0, 0, 2, 2))
            image.save(stem.with_suffix(".png"))
            frames = [
                {"kind": "house", "variant": 6, "layer": "body", "x": 0, "y": 0, "width": 2, "height": 2, "anchorX": 0.5, "anchorY": 1, "footprint": 2},
                {"kind": "house", "variant": 6, "layer": "shadow", "x": 2, "y": 0, "width": 4, "height": 2, "anchorX": 0.5, "anchorY": 1, "footprint": 2},
            ]
            stem.with_suffix(".json").write_text(json.dumps({"frames": frames}))
            layers = atlas_layers(stem)["house:6"]
            self.assertEqual([layer["layer"] for layer in layers], ["shadow", "body"])
            result = compose(layers, (-2, -2, 2, 0), 1)
            self.assertEqual(result.getpixel((0, 0)), (0, 0, 0, 115))
            self.assertEqual(result.getpixel((1, 0)), (255, 255, 255, 255))


if __name__ == "__main__":
    unittest.main()
