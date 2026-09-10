import * as T from 'three';
import { bake, box, colors, post } from './primitives';

const POST_RADIUS = .045;
const RAIL_THICKNESS = .07;
const PLANK_WIDTH = .24;
const PLANK_LIFT = .11;
const RUNG_SPACING = .3;

export function scaffolding(width: number, depth: number, height: number): T.Group {
  const frame = new T.Group();
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  for (const [x, z] of [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [-halfWidth, halfDepth], [halfWidth, halfDepth]]) {
    post(frame, colors.wood, x, height / 2, z, POST_RADIUS, height);
  }

  const railHeights = [height * .38, height * .84];
  for (const y of railHeights) {
    for (const side of [-1, 1]) {
      box(frame, colors.wood, 0, y, side * halfDepth, width, RAIL_THICKNESS, RAIL_THICKNESS, .02);
      box(frame, colors.wood, side * halfWidth, y, 0, RAIL_THICKNESS, RAIL_THICKNESS, depth, .02);
    }
  }
  for (const side of [-1, 1]) {
    box(frame, colors.linen, 0, railHeights[0] + PLANK_LIFT, side * (halfDepth - PLANK_WIDTH / 2), width * .82, .05, PLANK_WIDTH, .015);
  }

  const ladder = new T.Group();
  ladder.position.set(halfWidth * .55, 0, halfDepth - .06);
  ladder.rotation.x = -.1;
  for (const side of [-1, 1]) post(ladder, colors.wood, side * .14, height / 2, 0, .028, height);
  for (let rung = 1; rung * RUNG_SPACING < height; rung++) {
    box(ladder, colors.wood, 0, rung * RUNG_SPACING, 0, .3, .04, .04, .012);
  }
  frame.add(ladder);

  bake(frame);
  return frame;
}
