import { WorkspaceChanges, proposalView } from './changes.js';
import type { Proposal } from './changes.js';

/** Approval authority is the owning adapter RPC; OMP receives only the proposal tool. */
export class Approvals {
  private pending: { proposal: Proposal; signal: AbortSignal; applying: boolean; settle: (result: Record<string, unknown>) => void } | undefined;
  constructor(private readonly changes: WorkspaceChanges, private readonly emit: (kind: 'approval_requested' | 'approval_resolved', data: Record<string, unknown>) => void) {}
  async propose(args: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (this.pending) throw new Error('Another approval is pending');
    const proposal = await this.changes.propose(args, signal);
    if (this.pending) throw new Error('Another approval is pending');
    signal.throwIfAborted();
    return new Promise(resolve => {
      const settle = (result: Record<string, unknown>): void => {
        if (this.pending?.proposal !== proposal) return;
        this.pending = undefined; clearTimeout(timer); signal.removeEventListener('abort', abort);
        this.emit('approval_resolved', { proposalId: proposal.id, ...result }); resolve(result);
      };
      const abort = (): void => { if (!this.pending?.applying) settle({ approved: false, reason: 'Cancelled' }); };
      const timer = setTimeout(() => { if (!this.pending?.applying) settle({ approved: false, reason: 'Approval expired' }); }, Math.max(0, proposal.expiresAt - Date.now()));
      this.pending = { proposal, signal, applying: false, settle };
      signal.addEventListener('abort', abort, { once: true });
      this.emit('approval_requested', proposalView(proposal));
    });
  }
  async decide(id: unknown, revision: unknown, decision: unknown): Promise<Record<string, unknown>> {
    const item = this.pending;
    if (!item || item.applying || item.proposal.id !== id || item.proposal.revision !== revision) throw new Error('Unknown, stale or already decided approval');
    if (decision !== 'approve' && decision !== 'reject') throw new Error('Invalid approval decision');
    if (Date.now() >= item.proposal.expiresAt || item.signal.aborted) { item.settle({ approved:false, reason:'Approval expired or cancelled' }); throw new Error('Approval expired or cancelled'); }
    if (decision === 'reject') { item.settle({ approved:false, reason:'Rejected by user' }); return { approved:false }; }
    item.applying = true;
    try { const result = await this.changes.apply(item.proposal, item.signal); item.settle({ approved:true, ...result }); return result; }
    catch (error) {
      const message = error instanceof Error && !('code' in error) ? error.message : 'Approved file operation failed';
      item.settle({ approved:false, reason:message }); throw new Error(message);
    }
  }
}
