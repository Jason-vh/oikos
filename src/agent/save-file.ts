import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SaveSlot } from './game';

export function saveFile(path: string): SaveSlot {
  return {
    read() {
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    },
    write(saved) {
      mkdirSync(dirname(path), { recursive: true });
      const staging = `${path}.writing`;
      writeFileSync(staging, saved, 'utf8');
      renameSync(staging, path);
    },
  };
}
