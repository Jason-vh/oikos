# Unreleased shared client adapter

`src/ui/shared-session.ts` is not connected to the playable game. Main, HUD,
local saves and server clocks are unchanged.

Supply `connect()` for an authenticated same-origin WebSocket and tab-scoped
storage implementing `getItem`, `setItem`, `removeItem`. Never supply localStorage
or share the pending key with local game saves or art tools. Use one live adapter
per journal. The adapter does not
write World: `snapshot` delivers a validated authoritative replacement. Ownership
and cursor getters/events are defensive copies.

## Bootstrap contract

- `currentStatus` and `status(status, reason)` distinguish connecting/open (waiting
  for handshake), ready, pending, reconciling, exhausted, offline, closed,
  protocol-error, storage-error and indeterminate. `statusReason` explains
  blocked storage, protocol failures and unresolved recovery. Only `canSend()` grants readiness; OPEN alone never does.
- A snapshot must belong to the current connection. Realm/stream changes are
  accepted only on its first snapshot; same-stream serials strictly increase.
  Cursors never regress within a realm/login binding. `realmChanged` observes
  the new state, not stale ownership. The caller may clear realm-specific
  presentation there; changing login alone does not trigger this event.
- `send(operation)` permits one durable request at a time. Commands additionally
  require owned city IDs present in the authoritative snapshot. It never queues
  fresh intent while offline or rewrites a rejected request with a fresh nonce.
- `processed`/`replayed` outcomes are authoritative receipts. Reject statuses are
  non-consuming decisions. Both wait for a reconciling World snapshot before
  enabling further writes; a reject's newer ownership alone grants no writes.
- `unsent` means this attempted intent was not persisted or transmitted.
  `indeterminate` means it may still apply or already have applied. Disconnect,
  timeout, disposal and uncertain persistence settle callers as indeterminate,
  retaining exact durable bytes. Do not present indeterminate as failure-to-apply
  or offer an automatic fresh retry. `outcome({requestId, seq, outcome})` also
  reports eventual recovered receipts/rejects after the original promise settled
  indeterminate, or when the journal was loaded without an original caller.

## Recovery

Protocol 2 requests contain exactly `type`, `binding`, `requestId`, `seq`, and
`operation`. The opaque server-issued binding is not a credential. Realm IDs
never go on the wire. The journal key is `oikos.shared.pending.v1`; its wrapper
binds the exact wire bytes to both realm and login binding. Old protocol journals
fail closed rather than being migrated into new intent. Recovery replays only
when the new connection's validated realm/binding snapshot proves the sequence
already consumed. That replay can retrieve a receipt or rejection, never newly
apply intent. Unconsumed/future pending stays blocked indeterminate: even a lost
non-consuming reject followed by failed cleanup cannot turn into an automatic
mutation after reload. Missing, corrupt and unreadable storage are distinct. Writes and removals require readback;
uncertain records block overwrites. Protocol errors fail closed without erasing
pending intent. A known decision whose journal removal fails remains decided for
its caller, but storage stays blocked. Resolving corrupt/unavailable storage is
an explicit caller flow, not a silent reset. After user confirmation,
`discardPending()` returns true only when removal is verified. It abandons
recovery, not any mutation already committed, and fences the old socket before
requiring a new snapshot. Fresh user intent then gets a new nonce; the adapter
never rewrites the discarded request. Failed removal leaves writes blocked.

Reconnect delays grow from one to eight seconds. A fifteen-second handshake or
receipt/reconciliation deadline replaces stuck sockets; non-reconciling snapshots
do not extend a pending deadline. Closing cancels timers/listeners and preserves pending
recovery data. Realm/login replacement never sends the old session's intent.

## Verification

`npm ci` installs Bun 1.4.2. Run `npm test`, `npm run build`, and the browser smoke
walkthrough. Adapter tests cover valid baselines, strict frames, reconnect fences,
storage faults, bounded retries, lifecycle uncertainty and real SQLite/WebSocket
receipt loss and conflict/gap recovery.
