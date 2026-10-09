/** Original renderer action inventory. New actions must add a route and regression coverage. */
export const rendererActions=[
  'ready','submit','abort','newSession','sessions','settings','btw','btwList','btwStop','btwDelete',
  'export','setModel','setThinking','setApproval','approval','attachFiles','addFolder','listExtensions',
  'toggleMcpServer','togglePlugin','manageExtensions','compile','listFiles','openFile','openUrl','copy',
  'runCommand','usage','cancelQueued','abortRetry','subagentLog','proceedPlan','restore'
] as const;
export type RendererActionName=typeof rendererActions[number];
export type RendererAction={t:RendererActionName}&Record<string,unknown>;
export const internalActions=['connect','captureSelection','accountStatus','accountLogin','cancelLogin','modelRoles','executionControl','gitSetup','ideCapabilities'] as const;
const allowed=new Set<string>([...rendererActions,...internalActions]);
export function knownAction(value:unknown):value is RendererActionName|typeof internalActions[number]{return typeof value==='string'&&allowed.has(value);}
