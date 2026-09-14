import type { AuthorityRequest } from '../server/authority';
import type { SendOutcome, SharedRequestOutcome, SharedSession } from './shared-session';

interface Intent {
  realm: string;
  binding: string;
  seq: number;
  requestId: string | null;
  kind: AuthorityRequest['kind'];
  phase: 'waiting' | 'uncertain' | 'decided';
}

export class SharedIntent {
  private current: Intent | null = null;

  constructor(
    private readonly session: Pick<SharedSession, 'canSend' | 'currentSession' | 'send'>,
    private readonly realm: () => string,
    private readonly present: (outcome: SendOutcome, kind?: AuthorityRequest['kind']) => void,
  ) {}

  get busy(): boolean { return this.current?.phase === 'waiting'; }

  reset(): void { this.current = null; }

  send(operation: AuthorityRequest): boolean {
    const cursor = this.session.currentSession;
    if (this.busy || !this.session.canSend() || !cursor || cursor.nextSeq === null) return false;
    const intent: Intent = {
      realm: this.realm(), binding: cursor.binding, seq: cursor.nextSeq,
      requestId: null, kind: operation.kind, phase: 'waiting',
    };
    this.current = intent;
    void this.session.send(operation).then((outcome) => this.settle(intent, outcome));
    return true;
  }

  outcome(result: SharedRequestOutcome): void {
    const intent = this.current;
    if (intent && this.matchesScope(intent) && intent.seq === result.seq
      && (intent.requestId === null || intent.requestId === result.requestId)) {
      intent.requestId = result.requestId;
      this.settle(intent, result.outcome);
      return;
    }
    this.present(result.outcome);
  }

  private matchesScope(intent: Intent): boolean {
    return intent.realm === this.realm() && intent.binding === this.session.currentSession?.binding;
  }

  private settle(intent: Intent, outcome: SendOutcome): void {
    if (intent !== this.current || !this.matchesScope(intent) || intent.phase === 'decided') return;
    if (outcome.status === 'indeterminate') {
      if (intent.phase === 'uncertain') return;
      intent.phase = 'uncertain';
    } else intent.phase = 'decided';
    this.present(outcome, intent.kind);
  }
}
