import { Authority } from '../src/server/authority';
import { initStore } from '../src/server/store';

const [command, path, name] = process.argv.slice(2);

if (command === 'init' && path) {
  initStore(path);
  console.log(`Initialized authority store at ${path}.`);
} else if (command === 'agent' && path && name) {
  const authority = Authority.open(path);
  try {
    const admission = authority.admit(name);
    if (!admission.ok) {
      console.error(admission.reason);
      process.exit(1);
    }
    console.log(admission.credential);
  } finally {
    authority.close();
  }
} else {
  console.error('Usage: bun scripts/authority-admin.ts init <path>\n       bun scripts/authority-admin.ts agent <path> <name>');
  process.exit(1);
}
