import readline from 'node:readline';
const scenario = process.argv[2];
if (!process.argv.includes('--mode') || !process.argv.includes('rpc-ui')) process.exit(2);
const emit = frame => process.stdout.write(`${JSON.stringify(frame)}\n`);
if (scenario === 'early-exit') process.exit(7);
if (scenario === 'no-ready') setInterval(() => {}, 1_000);
else if (scenario === 'oversized') process.stdout.write(Buffer.alloc(1_048_577, 120));
else {
  setTimeout(() => {
    if (scenario === 'malformed') process.stdout.write('{bad JSON}\n');
    emit({ type: 'ready', protocolVersion: scenario === 'v2-only' ? 2 : 1, supportedProtocolVersions: scenario === 'v2-only' ? [2] : [1, 2] });
    const event = Buffer.from(JSON.stringify({ type: 'session_event', text: '한글 🚀' }) + '\r\n');
    const offset = event.indexOf(Buffer.from('한')) + 1;
    process.stdout.write(event.subarray(0, offset));
    process.stdout.write(event.subarray(offset));
    process.stderr.write('fixture diagnostic\n');
  }, scenario === 'delayed' ? 80 : 5);
}
if (scenario === 'stubborn') setInterval(() => {}, 1_000);
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const command = JSON.parse(line);
  if(scenario==='v2-coalesced'&&command.type==='negotiate_protocol') {
    const payload=Buffer.from(JSON.stringify({type:'session_event',text:'v2 한글'}));
    process.stdout.write(JSON.stringify({type:'response',id:command.id,command:command.type,success:true,data:{protocolVersion:2}})+'\n'+JSON.stringify({type:'rpc_chunk',chunkId:'same-read',index:0,count:1,byteLength:payload.length,data:payload.toString('base64')})+'\n');
    return;
  }
  if (command.exit) process.exit(9);
  if (command.hang) return;
  if(scenario==='compact-errors'&&command.type==='compact'){
    emit({type:'response',id:command.id,command:command.type,success:false,error:command.nonce});return;
  }
  setTimeout(() => emit({ type: 'response', id: command.id,
    command: command.mismatch ? 'wrong' : command.type, success: !command.fail,
    data: { cwd: process.cwd(), argv: process.argv.slice(3), nonce: command.nonce ?? null } }), command.type === 'get_state' ? 20 : 1);
});
lines.on('close', () => { if (scenario !== 'stubborn') process.exit(0); });
