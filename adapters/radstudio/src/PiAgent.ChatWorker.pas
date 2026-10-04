unit PiAgent.ChatWorker;
interface
uses System.Classes, System.SysUtils, System.JSON, System.Generics.Collections, Winapi.Windows, PiAgent.PipeClient;
type
  // One owner thread handles requests and notifications; no SDK or WebView callbacks run here.
  TPiChatWorker = class(TThread)
  private
    FCancel: THandle;
    FInput, FOutput: TThreadList<string>;
    FClient: TPiPipeClient;
    FSession, FTurn: string;
    FApproval, FRestore: TJSONObject;
    procedure Handle(const Json: string);
    procedure Notification(const Json: string);
    procedure Post(Obj: TJSONObject);
    procedure OpenSession(const Saved: string = '');
    function Rpc(const Method: string; Params: TJSONObject): TJSONObject;
  protected
    procedure Execute; override;
  public
    constructor Create;
    destructor Destroy; override;
    procedure Enqueue(const Json: string);
    function Pop: string;
  end;
implementation
procedure TPiChatWorker.Post(Obj: TJSONObject);
var Items: TList<string>;
begin
  try
    Items := FOutput.LockList;
    try
      if Items.Count >= 256 then raise Exception.Create('UI event queue limit reached');
      Items.Add(Obj.ToJSON);
    finally FOutput.UnlockList; end;
  finally Obj.Free; end;
end;
constructor TPiChatWorker.Create;
begin
  inherited Create(True); FInput := TThreadList<string>.Create; FOutput := TThreadList<string>.Create;
  FCancel := CreateEvent(nil,True,False,nil); if FCancel = 0 then RaiseLastOSError;
end;
destructor TPiChatWorker.Destroy;
begin
  Terminate; if FCancel <> 0 then begin SetEvent(FCancel); WaitFor; CloseHandle(FCancel); end;
  FInput.Free; FOutput.Free; FApproval.Free; FRestore.Free; inherited;
end;
procedure TPiChatWorker.Enqueue(const Json: string);
var Items: TList<string>;
begin
  if Length(Json) > 400000 then raise Exception.Create('UI request limit reached');
  Items := FInput.LockList;
  try if Items.Count >= 32 then raise Exception.Create('UI request queue limit reached'); Items.Add(Json);
  finally FInput.UnlockList; end;
end;
function TPiChatWorker.Pop: string;
var Items: TList<string>;
begin
  Result := ''; Items := FOutput.LockList;
  try if Items.Count <> 0 then begin Result := Items[0]; Items.Delete(0); end;
  finally FOutput.UnlockList; end;
end;
function TPiChatWorker.Rpc(const Method: string; Params: TJSONObject): TJSONObject;
begin Result := FClient.Request(Method,Params); end;
procedure TPiChatWorker.OpenSession(const Saved: string);
var Params, Reply: TJSONObject;
begin
  Params := TJSONObject.Create; if Saved <> '' then Params.AddPair('savedSessionId',Saved);
  Reply := Rpc('chat.open',Params);
  try
    FSession := Reply.GetValue<string>('sessionId',''); FTurn := '';
    FreeAndNil(FApproval); FreeAndNil(FRestore);
    Reply.AddPair('type','session'); Reply.AddPair('selectionEnabled',TJSONBool.Create(False));
    Post(TJSONObject(Reply.Clone));
  finally Reply.Free; end;
end;
procedure TPiChatWorker.Notification(const Json: string);
var Frame, Data: TJSONObject; Kind: string;
begin
  Frame := TJSONObject.ParseJSONValue(Json) as TJSONObject;
  try
    Data := Frame.GetValue('params') as TJSONObject;
    if (Data = nil) or (Data.GetValue<string>('sessionId','') <> FSession) then Exit;
    Kind := Data.GetValue<string>('kind','');
    if Kind = 'started' then FTurn := Data.GetValue<string>('turnId','');
    if Kind = 'approval_requested' then begin FreeAndNil(FApproval); FApproval := TJSONObject(Data.GetValue('approval').Clone); end;
    if Kind = 'approval_resolved' then FreeAndNil(FApproval);
    if (Kind = 'completed') or (Kind = 'cancelled') or (Kind = 'error') then FTurn := '';
    if Kind = 'closed' then begin FSession := ''; FTurn := ''; end;
    Post(TJSONObject.Create.AddPair('type','event').AddPair('data',TJSONValue(Data.Clone)));
  finally Frame.Free; end;
end;
procedure TPiChatWorker.Handle(const Json: string);
var Msg, Params, Reply: TJSONObject; Action, Name: string;
begin
  Msg := TJSONObject.ParseJSONValue(Json) as TJSONObject;
  if Msg = nil then raise Exception.Create('Invalid UI request');
  try
    Action := Msg.GetValue<string>('action','');
    // This adapter has no selection capture. The shared composer clears an
    // optional selection before every prompt; acknowledge that harmless action.
    if Action = 'clearSelection' then Exit;
    if Action = 'connect' then begin
      if FClient <> nil then Exit;
      Name := GetEnvironmentVariable('PIAGENT_PIPE_NAME'); if Name = '' then Name := 'piagent-dev';
      FClient := TPiPipeClient.Create(Name,FCancel); FClient.OnNotification := Notification;
      FClient.Hello('RAD-Chat','rad-chat-' + IntToStr(GetCurrentProcessId),True); OpenSession; Exit;
    end;
    if FClient = nil then raise Exception.Create('Session unavailable');
    if Action = 'listSessions' then begin
      Reply := Rpc('sessions.list',TJSONObject.Create);
      try Reply.AddPair('type','sessions'); Post(TJSONObject(Reply.Clone)); finally Reply.Free; end; Exit;
    end;
    if Action = 'resumeSession' then begin
      if FTurn <> '' then raise Exception.Create('Turn is busy');
      if FSession <> '' then begin Reply := Rpc('chat.close',TJSONObject.Create.AddPair('sessionId',FSession)); Reply.Free; end;
      OpenSession(Msg.GetValue<string>('savedSessionId','')); Exit;
    end;
    if FSession = '' then raise Exception.Create('Session unavailable');
    Params := TJSONObject.Create.AddPair('sessionId',FSession);
    if Action = 'setApproval' then begin
      Params.AddPair('mode',Msg.GetValue<string>('mode',''));Reply := Rpc('chat.setApproval',Params);
      try FSession := Reply.GetValue<string>('sessionId',''); FTurn := '';Reply.AddPair('type','session');Post(TJSONObject(Reply.Clone)); finally Reply.Free; end; Exit;
    end;
    if Action = 'designerReply' then begin
      Params.AddPair('requestId',Msg.GetValue<string>('requestId',''));
      if Msg.GetValue('result') is TJSONObject then Params.AddPair('result',TJSONValue(Msg.GetValue('result').Clone));
      if Msg.GetValue('error') <> nil then Params.AddPair('error',Msg.GetValue<string>('error',''));
      Reply := Rpc('designer.reply',Params); Reply.Free; Exit;
    end;
    if Action = 'designerDecide' then begin
      Params.AddPair('proposalId',Msg.GetValue<string>('proposalId',''));
      Params.AddPair('approved',TJSONBool.Create(Msg.GetValue<Boolean>('approved',False)));
      Reply := Rpc('designer.decide',Params); Reply.Free; Exit;
    end;
    if Action = 'ompRespond' then begin
      Params.AddPair('requestId',Msg.GetValue<string>('requestId',''));
      if Msg.GetValue('answer') is TJSONObject then Params.AddPair('answer',TJSONValue(Msg.GetValue('answer').Clone));
      Reply := Rpc('omp.respond',Params); Reply.Free; Exit;
    end;
    if Action = 'ompControl' then begin
      Params.AddPair('command',Msg.GetValue<string>('command',''));
      if Msg.GetValue('fields') is TJSONObject then Params.AddPair('fields',TJSONValue(Msg.GetValue('fields').Clone))
      else Params.AddPair('fields',TJSONObject.Create);
      Reply := Rpc('omp.control',Params);
      try Post(TJSONObject.Create.AddPair('type','ompControl').AddPair('command',Msg.GetValue<string>('command','')).AddPair('data',TJSONValue(Reply.Clone))); finally Reply.Free; end; Exit;
    end;
    if Action = 'reset' then begin
      Reply := Rpc('chat.close',Params); Reply.Free; OpenSession; Exit;
    end;
    if Action = 'prompt' then begin Params.AddPair('message',Msg.GetValue<string>('message','')); Reply := Rpc('chat.prompt',Params); Reply.Free; Exit; end;
    if Action = 'cancel' then begin Params.AddPair('turnId',FTurn); Reply := Rpc('chat.cancel',Params); Reply.Free; Exit; end;
    if Action = 'decideChange' then begin
      if (FApproval = nil) or (Msg.GetValue<string>('proposalId','') <> FApproval.GetValue<string>('proposalId','')) then begin Params.Free; raise Exception.Create('Approval unavailable'); end;
      Params.AddPair('proposalId',FApproval.GetValue<string>('proposalId','')); Params.AddPair('revision',FApproval.GetValue<string>('revision',''));
      Params.AddPair('decision',Msg.GetValue<string>('decision','')); Reply := Rpc('changes.decide',Params); Reply.Free; Exit;
    end;
    if Action = 'listCheckpoints' then begin
      Reply := Rpc('changes.list',Params);
      try Post(TJSONObject.Create.AddPair('type','checkpoints').AddPair('items',TJSONValue(Reply.GetValue('checkpoints').Clone))); finally Reply.Free; end; Exit;
    end;
    if Action = 'previewRestore' then begin
      Params.AddPair('checkpointId',Msg.GetValue<string>('checkpointId',''));
      FreeAndNil(FRestore); FRestore := Rpc('changes.previewRestore',Params);
      Post(TJSONObject.Create.AddPair('type','restorePreview').AddPair('data',TJSONValue(FRestore.Clone))); Exit;
    end;
    if Action = 'restoreChange' then begin
      if (FRestore = nil) or (Msg.GetValue<string>('checkpointId','') <> FRestore.GetValue<string>('checkpointId','')) then begin Params.Free; raise Exception.Create('Restore unavailable'); end;
      Params.AddPair('checkpointId',FRestore.GetValue<string>('checkpointId','')); Params.AddPair('revision',FRestore.GetValue<string>('revision',''));
      Reply := Rpc('changes.restore',Params);
      try Reply.AddPair('type','restored'); Post(TJSONObject(Reply.Clone)); finally Reply.Free; end; FreeAndNil(FRestore); Exit;
    end;
    if Action = 'usage' then begin
      Reply := Rpc('chat.usage',Params);
      try Post(TJSONObject.Create.AddPair('type','usage').AddPair('data',TJSONValue(Reply.Clone))); finally Reply.Free; end; Exit;
    end;
    Params.Free; raise Exception.Create('UI action unavailable');
  finally Msg.Free; end;
end;
procedure TPiChatWorker.Execute;
var Items: TList<string>; Json: string; PingAt: UInt64;
begin
  PingAt := GetTickCount64;
  try
    while not Terminated do begin
      Json := ''; Items := FInput.LockList;
      try if Items.Count > 0 then begin Json := Items[0]; Items.Delete(0); end; finally FInput.UnlockList; end;
      if Json <> '' then try Handle(Json); except on E: Exception do begin
        Post(TJSONObject.Create.AddPair('type','operationError').AddPair('message',E.Message));
        if FSession = '' then FreeAndNil(FClient);
      end; end;
      if FClient <> nil then begin
        FClient.PollNotification;
        if GetTickCount64 - PingAt > 20000 then begin FClient.Ping('heartbeat'); PingAt := GetTickCount64; end;
      end;
      WaitForSingleObject(FCancel,20);
    end;
  except on E: Exception do if not Terminated then Post(TJSONObject.Create.AddPair('type','disconnected').AddPair('message',E.Message)); end;
  FreeAndNil(FClient);
end;
end.
