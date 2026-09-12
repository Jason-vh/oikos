import { initStore } from '../src/server/store';
import { Authority } from '../src/server/authority';

const [command, path, invite] = process.argv.slice(2);

function usage(): never {
  console.error('Usage: bun scripts/authority-admin.ts <init|invite|admit> <path> [inviteCode]');
  process.exit(1);
}

if (command === 'init' && path) {
  initStore(path);
  console.log(`Initialized authority store at ${path}.`);
} else if (command === 'invite' && path) {
  const authority = Authority.open(path);
  try {
    console.log(authority.issueInvite());
  } finally {
    authority.close();
  }
} else if (command === 'admit' && path && invite) {
  const authority = Authority.open(path);
  try {
    console.log(JSON.stringify(authority.admitInvite(invite)));
  } finally {
    authority.close();
  }
} else {
  usage();
}
