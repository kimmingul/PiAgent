import readline from 'node:readline';
const emit=frame=>process.stdout.write(JSON.stringify(frame)+'\n');
emit({type:'ready',protocolVersion:1});let login;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const command=JSON.parse(line);const reply=data=>emit({type:'response',id:command.id,command:command.type,success:true,data});
 if(command.type==='get_login_providers'){reply({providers:[{id:'fixture',available:true},{id:'failure',available:true}]});return;}
 if(command.type==='login'){
  if(command.providerId==='failure'){emit({type:'response',id:command.id,command:'login',success:false,error:'fixture failure'});return;}
  login=command;emit({type:'extension_ui_request',id:'url',method:'open_url',url:'https://example.com/oauth',instructions:'Fixture device code: ABCD'});
  emit({type:'extension_ui_request',id:'code',method:'input',title:'Authorization code'});return;
 }
 if(command.type==='extension_ui_response'&&command.id==='code'&&command.value==='fixture-code'){emit({type:'response',id:login.id,command:'login',success:true,data:{providerId:'fixture'}});return;}
 reply({});
});
