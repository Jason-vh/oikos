import * as T from 'three';

export const SUN_OFFSET = new T.Vector3(-23, 42, 28);
export const GOLDEN_SUN_OFFSET = new T.Vector3(-23, 22, 28);

export function shadowLean(offset: T.Vector3): T.Vector2 {
  return new T.Vector2(-offset.x / offset.y, -offset.z / offset.y);
}
