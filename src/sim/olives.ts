import type { Building, City } from './types';
import { BUILDINGS } from './catalog';
import { PRESS_BATCH_OIL, PRESS_BATCH_OLIVES, PRESS_CAP, PRESS_SECONDS } from './balance';
import { addStore, totalStock } from './world';

export function pressingRoom(press: Building): boolean {
  return totalStock(press) + PRESS_BATCH_OIL - PRESS_BATCH_OLIVES <= PRESS_CAP;
}

export function updatePress(city: City, press: Building, dt: number): void {
  if (!press.connected || press.workers <= 0) return;
  const staffing = press.workers / BUILDINGS.press.jobs;
  if (press.progress === 0) {
    if ((press.stores.olives ?? 0) < PRESS_BATCH_OLIVES || !pressingRoom(press)) return;
    addStore(press, 'olives', -PRESS_BATCH_OLIVES);
  }
  const next = press.progress + (dt / PRESS_SECONDS) * staffing;
  if (next < 1) {
    press.progress = next;
    return;
  }
  press.progress = 0;
  addStore(press, 'oil', PRESS_BATCH_OIL);
  city.produced += PRESS_BATCH_OIL;
}

export function pressStatus(press: Building): string[] {
  if (press.progress > 0) return [`Pressing oil, ${Math.round(press.progress * 100)}% of this batch.`];
  if ((press.stores.olives ?? 0) >= PRESS_BATCH_OLIVES && !pressingRoom(press)) return ['Full of oil; waiting for a buyer from an agora.'];
  if ((press.stores.oil ?? 0) > 0) return ['Oil in the jars; waiting for olives and a buyer.'];
  return ['Waiting for olives from an orchard.'];
}
