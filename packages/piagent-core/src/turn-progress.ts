import {isObject} from '@piagent/protocol';

/** Observations, never a liveness verdict: quiet tools/providers may still be working. */
export class TurnProgress {
  private readonly started: number;
  private lastProgress: number;
  private readonly tools = new Set<string>();
  private readonly agents = new Set<string>();
  private retrying = false;
  constructor(private readonly now: () => number = Date.now) {
    this.started = this.lastProgress = now();
  }
  observe(frame: Record<string, unknown>): void {
    const type = frame['type'];
    if(type==='auto_retry_start')this.retrying=true;
    if(type==='auto_retry_end')this.retrying=false;
    if (['message_update','message_start','tool_execution_start','tool_execution_update','tool_execution_end',
      'subagent_progress','subagent_lifecycle','host_tool_call','command_output','auto_retry_start','auto_retry_end'].includes(String(type))) this.lastProgress = this.now();
    if (type === 'tool_execution_start' && typeof frame['toolCallId'] === 'string' && this.tools.size < 512) this.tools.add(frame['toolCallId']);
    if (type === 'tool_execution_end' && typeof frame['toolCallId'] === 'string') this.tools.delete(frame['toolCallId']);
    if (type === 'subagent_progress' || type === 'subagent_lifecycle') {
      const payload = isObject(frame['payload']) ? frame['payload'] : {};
      const progress = isObject(payload['progress']) ? payload['progress'] : payload;
      const id = progress['id'];
      if (typeof id === 'string') {
        if (['running','pending','queued'].includes(String(progress['status'])) && this.agents.size < 512) this.agents.add(id);
        else if (['completed','done','failed','cancelled','aborted','error'].includes(String(progress['status']))) this.agents.delete(id);
      }
    }
  }
  snapshot(waitingForInput = false, hostTools = 0, cancelling = false) {
    const elapsedMs = Math.max(0, this.now() - this.started);
    const quietMs = Math.max(0, this.now() - this.lastProgress);
    const activeTools = this.tools.size + hostTools, activeAgents = this.agents.size;
    const phase = cancelling ? 'cancelling' : waitingForInput ? 'awaiting_input' : activeAgents ? 'subagents'
      : activeTools ? 'tools' : this.retrying ? 'retrying' : quietMs >= 120_000 ? 'awaiting_progress' : 'running';
    return {phase, elapsedMs, quietMs, activeTools, activeAgents};
  }
}
