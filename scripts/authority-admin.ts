import { initStore } from '../src/server/store';

const [command, path] = process.argv.slice(2);

if (command === 'init' && path) {
  initStore(path);
  console.log(`Initialized authority store at ${path}.`);
} else {
  console.error('Usage: bun scripts/authority-admin.ts init <path>');
  process.exit(1);
}
