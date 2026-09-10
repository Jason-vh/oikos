# Sprite fidelity investigation

## First implementation

Open `/pipeline/bench.html` on the local Vite server. This development-only page loads references directly from `reference/sprites`, never from a production asset pack.

Implemented:

- Horizontal camera fit, full calibrated re-render, and rejection of partial merges with incompatible projection parameters.
- Immutable render batches with atomic manifest publication; failed renders preserve the previous assets.
- Original references and the source ZIP excluded from Docker build inputs.
- Reference pitch correction, body/shadow comparison compositing, and explicit model footprints.
- Source-to-packed anchor scaling, including odd render dimensions.
- A rebuilt homestead and mirrored variant with explicit clay tiles, framed plaster, fences, paving, and native RGB555 finishing.
- A courtyard-extension study using the same components, atlas variant 14; no new simulation tier.
- A fixed native-resolution Pixi bench with integer enlargements, orientation switching, overlay, strict asset lookup, and no save/simulation effects.
- Python asset checks, Blender projection checks, and browser screenshot checks.

Visual status: the replacement remains distinguishable. Three prominent differences are the original's stronger warm/cool lighting contrast, its more irregular roof and wall contours, and its selective bright edge highlights. The extension demonstrates component reuse, not yet stylistic acceptance. Next work should stay on this pair rather than propagate the style across the inventory.

The investigation below records the pre-fix state.

## Conclusion

A confirmed Blender camera bug enlarges portrait-shaped renders and invalidates their anchors. Fix this before judging proportions. Beyond that defect, the current sprites are approximations of the original designs, not close matches awaiting a colour adjustment: geometry, surface detail, and plot composition differ substantially.

Literal pixel identity and independently authored replacement art are different goals. The README currently prohibits shipping, copying, or tracing original assets. Preserve that boundary unless the project explicitly changes direction; owning a copy is not redistribution permission.

## Evidence

Compared the shipped `public/assets/structures.png` against extracted originals, inspected the Blender and Canvas pipelines, and captured the running game at `?seed=7`. The browser loaded all 168 baked frames, so these differences are not explained by accidentally viewing the procedural building fallback.

Local comparison images, not committed or published:

- `/tmp/zeus-fidelity/homestead.png`: current, original, blend, difference.
- `/tmp/zeus-fidelity/houses.png`: all seven common housing tiers.
- `/tmp/zeus-fidelity/civic.png`: maintenance office, college, infirmary.
- `/tmp/zeus-fidelity/services.png`: granary and fountain.
- `/tmp/zeus-fidelity/live.png`: current game at camera scale 1.

Existing comparison images retain the scale and composition limitations below. They establish large visual differences, not trustworthy pixel-error scores.

### 1. A camera bug changes scale with frame aspect ratio

`pipeline/iso_render.py:frame_camera` derives orthographic scale from render width, but leaves Blender's `sensor_fit` at `AUTO`. Portrait frames use the other dimension, enlarging the model. There are 62 portrait frames among the 168 outputs.

Verified directly in Blender 5.2.1 using `world_to_camera_view`:

| Camera fit | Render frame | Projected one-tile step, supersampled pixels |
| --- | --- | --- |
| AUTO | 720×840 | 140 across, 70 down |
| AUTO | 720×600 | 120 across, 60 down |
| HORIZONTAL | 720×840 | 120 across, 60 down |

The townhouse body is enlarged by 420/360 = 1.167. Its packed south-vertex offset is about 22 final pixels short, placing the body too low. Its shadow frame is 984×1044, so the shadow is enlarged by a different factor, 1.061. Symmetric padding preserves portrait orientation, not aspect ratio or magnification.

Set `camera.data.sensor_fit = 'HORIZONTAL'` to match the width-based scale calculation, then regenerate affected bodies and shadows. The camera basis and analytical anchor formula otherwise agree. Protect this with a rendered calibration diamond/cube in landscape, square, and portrait frames; assert identical projected tile steps and pivots. Arbitrary building alpha bounds are not a safe substitute because buildings can intentionally overhang or underfill their footprints.

### 2. The models describe different buildings

`pipeline/iso_render.py`:

- `build_house_3`: large, clean roof ranges and masonry yard walls, versus a lower, irregular timber-and-plaster homestead with a different roof arrangement.
- `build_house_4`: tall two-storey mass, versus the much lower reference tenement.
- `build_maintenance_office`: different lookout proportions, smooth planar roof, simplified facade and barrels.
- `build_college`: generic temple mass and block-like annex, versus distinct sculpted roof rows, decorated columns, pediments, and patterned paving.
- `build_fountain`: footprint 1, versus archive image 830 with explicit sprite footprint size 2 and dimensions 118×94. `src/sim/buildings.ts` also uses size 1. Verify the original building's complete composition before changing simulation dimensions: archive footprint metadata describes a sprite, not necessarily the whole building.
- Elite housing references map single 118-pixel sprites to our 4×4 models. These may be pieces of multipart buildings. The current comparison cannot establish their full footprint or appearance.

Colour, contrast, noise, and outlining cannot repair these differences.

### 3. Surface detail is not represented at the right scale

Original roofs have prominent tile rows, irregular edges, and alternating highlights and dark joints. Current roofs often read as flat sheets or fine regular grids. The same mismatch affects stone courses, timber framing, paving, and vegetation.

`roof_material` uses procedural brick colour/bump, followed by denoising and downsampling. More render samples cannot create missing silhouette geometry or intentionally placed pixel detail. Author detail for its final projected size, not merely for how a material looks enlarged in Blender.

`add_yard` deliberately hides the yard from the camera. The reference images include textured plot ground and local contact shading. A body-only comparison therefore includes unmatched ground; in-game generic terrain is not a replacement for each plot's paving or yard treatment.

### 4. Reference scale confuses painted width with tile pitch

`pipeline/sg_extract.py` places 58-pixel-wide diamonds at 60-pixel horizontal pitch. A 2×2 base is 118×60; its logical footprint spans 120×60.

`pipeline/compare.py` scales by `120 / 58`. At the current game metric, the corresponding pitch ratio is `120 / 60 = 2`. The current ratio makes originals about 3.45% too large. `pipeline/overlay.py` makes the reciprocal mistake when shrinking ours.

`compare.py` also draws the reference-inferred footprint beneath ours, hiding mismatches such as the fountain. Original placement is assumed to be bottom-centred. Non-square, animated, or multipart assets need verified offsets and composition metadata rather than this universal assumption.

### 5. Packing is not a neutral operation

`pipeline/pack.py` applies coarse resampling, contrast 1.26, saturation 1.22, and a morphological dark outline. These are baked post-processing even though the README says there is no colour grade.

The outline is computed after nearest-neighbour enlargement, so it can introduce finer edge pixels than the intended two-pixel grain. Odd dimensions are rounded down during coarse resampling, while anchor projection uses the nominal camera scale. Preserve the exact source-to-output transform before judging subpixel alignment.

Separate baked shadows are multiplied by `SHADOW_ALPHA = 0.45` in `src/render/scene.ts`. Existing comparisons omit them entirely. Validate the final body/ground/shadow composite, not only the body PNG.

### 6. The runtime changes the sampling again

A live browser probe reported baked texture `scaleMode: linear`, texture resolution 1, and default camera scale 0.7. A two-pixel packed grain becomes 1.4 CSS pixels at that zoom on a DPR-1 display.

A pixel-accurate benchmark needs explicit nearest sampling, fixed device-pixel ratio, integer physical pixel scaling, and aligned camera placement. Smooth arbitrary zoom can remain a separate presentation mode; it is not a suitable pixel-equality baseline. Merely disabling canvas antialiasing does not set texture filtering.

### 7. There is no enforced visual acceptance boundary

The reference index includes tentative mappings, missing entries, grouped alternatives, and multipart structures. Assets can silently fall back to procedural sprites or variant zero. The renderer's clock and particles continue independently of the simulation tick, so fixing a seed and pausing simulation alone does not make screenshots deterministic.

The existing tools are useful inspection aids, but they do not verify reference identity, final composition, or visual regressions.

## Recommended foundation

### Stage 1: Establish ground truth

- Fix the camera fit and reference pitch conversion first. Re-render affected frames and rebuild comparisons before changing proportions.
- Verify a small reference set against original-game screenshots, not contact-sheet guesses alone.
- Record archive/image identity, logical footprint, base/body bounds, pivot and offsets, orientation, animation/state, and dependent ground or overlay pieces.
- Separate the original's painted dimensions from logical tile pitch.
- Add synthetic extraction fixtures for RGB555, transparency, alpha, mirroring, and multipart isometric bases. Validate representative real assets locally without committing copyrighted fixtures.
- Version the render recipe and record source/settings hashes so partial renders cannot silently mix incompatible generations.

### Stage 2: Build a deterministic visual bench

Use one small flat scene with road, ground, homestead, maintenance office, fountain, tree, and walker. No random map search, live simulation, particles, or wall-clock animation.

Render through the actual game renderer at native 60×30 logical pitch and integer enlargements. The game can retain 120×60 world coordinates if the bench maps them consistently to physical pixels.

Show original and replacement at matching scale, including ground and shadows, with blink/overlay views. Keep reference art local and outside production assets. Missing assets must fail visibly in this mode, not fall back silently.

Use separate checks for bounds/anchors, silhouette, roof and facade landmarks, colour distribution, and local detail. Pixel differences are useful only after identity, alignment, and compositing are correct; a ground-filled diamond can otherwise hide body errors in a silhouette score.

### Stage 3: Prove one replacement before expanding

Start with the homestead and one ground tile. Approve silhouette and major masses before materials. Then add intentional tile rows, timber, stone joints, wear, props, contact shadows, and selective edge highlights at native resolution.

Use Blender for projection, mass, and lighting where useful. Add authored textures and a 2D finishing stage for detail that procedural materials cannot express reliably. Evaluate the result at native size, not only enlarged.

Only after this slice reads convincingly beside the reference should its reusable roof, wall, ground, and palette rules spread to other buildings. Do not regenerate the entire inventory while the target is still moving.

## Direction decision

- **Literal original appearance:** a local, opt-in asset source using the user's original installation is the direct route. It still requires correct extraction, placement, layering, animation, and sampling. This changes the current reference-only policy and needs explicit agreement; it does not authorize distributing those assets.
- **Independently authored release:** use the original only as the private benchmark. Aim for perceptual fidelity through measured modelling and pixel-scale finishing. Do not promise byte-identical pixels from different geometry and procedural materials.

Recommendation: fix the camera and comparison scale, then establish the small visual bench. It separates renderer correctness from art quality and provides a stable foundation whichever direction is chosen.
