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
    FSession, FTurn, FWorkspace, FRequestSession, FSavedSession, FMode: string;
    FApproval, FRestore, FMessageRestore: TJSONObject;
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
uses PiAgent.CoreRuntime;
procedure TPiChatWorker.Post(Obj: TJSONObject);
var Items: TList<string>;
begin
  try
    if (FRequestSession<>'') and (Obj.GetValue<string>('type','')<>'event') and (Obj.GetValue<string>('type','')<>'session') and (Obj.GetValue<string>('type','')<>'disconnected') then Obj.AddPair('ownerSessionId',FRequestSession);
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
  FInput.Free; FOutput.Free; FApproval.Free; FRestore.Free; FMessageRestore.Free; inherited;
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
  if FWorkspace <> '' then Params.AddPair('workspaceUri',FWorkspace);
  if (Saved <> '') and (FMode <> '') then Params.AddPair('approvalMode',FMode);
  Reply := Rpc('chat.open',Params);
  try
    FSession := Reply.GetValue<string>('sessionId',''); FSavedSession := Reply.GetValue<string>('savedSessionId',''); FMode := Reply.GetValue<string>('approvalMode','always-ask'); FTurn := '';
    FreeAndNil(FApproval); FreeAndNil(FRestore);FreeAndNil(FMessageRestore);
    Reply.AddPair('type','session'); Reply.AddPair('selectionEnabled',TJSONBool.Create(True));
    Reply.AddPair('attachmentsEnabled',TJSONBool.Create(True));
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
var Msg, Params, Reply: TJSONObject; Action, Name, Method, ReplyType: string;
begin
  Msg := TJSONObject.ParseJSONValue(Json) as TJSONObject;
  if Msg = nil then raise Exception.Create('Invalid UI request');
  try
    Action := Msg.GetValue<string>('action','');
    FRequestSession := FSession;
    // Selection is captured on the IDE thread; clearSelection is acknowledged here for smoke clients.
    if Action = 'clearSelection' then Exit;
    if Action = 'connect' then begin
      if FTurn <> '' then raise Exception.Create('Finish or cancel the current turn before changing project');
      if FClient <> nil then begin
        if SameText(FWorkspace,Msg.GetValue<string>('workspaceUri','')) then Exit;
        if FSession <> '' then begin Reply := Rpc('chat.close',TJSONObject.Create.AddPair('sessionId',FSession));Reply.Free;end;
        FWorkspace := Msg.GetValue<string>('workspaceUri','');if FWorkspace = '' then raise Exception.Create('Workspace unavailable');OpenSession;Exit;
      end;
      FWorkspace := Msg.GetValue<string>('workspaceUri','');
      if FWorkspace = '' then raise Exception.Create('Open a RAD Studio project before connecting');
      Name := GetEnvironmentVariable('PIAGENT_PIPE_NAME'); if Name = '' then Name := 'piagent-dev';
      EnsureInstalledCore(Name,FCancel);
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
    if Action = 'addWorkspaceFolder' then begin Params.AddPair('path',Msg.GetValue<string>('path',''));Reply := Rpc('chat.addFolder',Params);try Reply.AddPair('type','folderAdded');Post(TJSONObject(Reply.Clone));finally Reply.Free;end;Exit;end;
    if (Action = 'preferences') or (Action = 'listFiles') or (Action = 'export') or
      (Action = 'btw') or (Action = 'btwList') or (Action = 'btwStop') or (Action = 'btwDelete') or (Action = 'queuePrompt') then begin
      Method := ''; ReplyType := '';
      if Action = 'preferences' then begin Method := 'chat.preferences'; ReplyType := 'preferences'; if Msg.GetValue('values') <> nil then Params.AddPair('values',TJSONValue(Msg.GetValue('values').Clone)); end;
      if Action = 'listFiles' then begin Method := 'workspace.files'; ReplyType := 'files'; end;
      if Action = 'export' then begin Method := 'chat.export'; ReplyType := 'exportReady'; end;
      if Action = 'btw' then begin Method := 'btw.ask'; ReplyType := 'btwAccepted'; Params.AddPair('text',Msg.GetValue<string>('text','')); if Msg.GetValue('topicId') is TJSONString then Params.AddPair('topicId',Msg.GetValue<string>('topicId','')); end;
      if Action = 'btwList' then begin Method := 'btw.list'; ReplyType := 'btwList';if Msg.GetValue('offset')<>nil then Params.AddPair('offset',TJSONValue(Msg.GetValue('offset').Clone));end;
      if Action = 'btwStop' then begin Method := 'btw.cancel'; ReplyType := 'btwStopped'; Params.AddPair('topicId',Msg.GetValue<string>('topicId','')); end;
      if Action = 'btwDelete' then begin Method := 'btw.delete'; ReplyType := 'btwList'; Params.AddPair('topicId',Msg.GetValue<string>('topicId','')); end;
      if Action = 'queuePrompt' then begin Method := 'omp.control'; ReplyType := 'queueAccepted'; Params.AddPair('command',Msg.GetValue<string>('command','')); Params.AddPair('fields',TJSONObject.Create.AddPair('message',Msg.GetValue<string>('message',''))); end;
      Reply := Rpc(Method,Params);
      try Reply.AddPair('type',ReplyType); if Msg.GetValue('id') <> nil then Reply.AddPair('id',TJSONValue(Msg.GetValue('id').Clone)); Post(TJSONObject(Reply.Clone)); finally Reply.Free; end; Exit;
    end;
    if (Action = 'listExtensions') or (Action = 'manageExtensions') or (Action = 'toggleMcpServer') or (Action = 'togglePlugin') then begin
      Params.AddPair('action',Action);
      if Msg.GetValue('id') <> nil then Params.AddPair('id',TJSONValue(Msg.GetValue('id').Clone));
      if Msg.GetValue('enabled') <> nil then Params.AddPair('enabled',TJSONValue(Msg.GetValue('enabled').Clone));
      Reply := Rpc('chat.extensions',Params);
      try Reply.AddPair('type','extensions');Post(TJSONObject(Reply.Clone));finally Reply.Free;end;
      if Action = 'togglePlugin' then begin Reply := Rpc('chat.close',TJSONObject.Create.AddPair('sessionId',FSession));Reply.Free;OpenSession(FSavedSession);end;Exit;
    end;
    if (Action = 'setApproval') or (Action = 'proceedPlan') then begin
      if Action = 'setApproval' then begin Params.AddPair('mode',Msg.GetValue<string>('mode',''));Method := 'chat.setApproval';end
      else begin Params.AddPair('path',Msg.GetValue<string>('path',''));Method := 'chat.proceedPlan';end;
      Reply := Rpc(Method,Params);
      try FSession := Reply.GetValue<string>('sessionId',''); FSavedSession := Reply.GetValue<string>('savedSessionId','');FMode := Reply.GetValue<string>('approvalMode','always-ask'); FTurn := '';Reply.AddPair('type','session');Reply.AddPair('attachmentsEnabled',TJSONBool.Create(True));Reply.AddPair('selectionEnabled',TJSONBool.Create(True));Post(TJSONObject(Reply.Clone)); finally Reply.Free; end; Exit;
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
      if Msg.GetValue('fields')=nil then Msg.AddPair('fields',TJSONObject.Create);
      Params.AddPair('command',Msg.GetValue<string>('command',''));
      if Msg.GetValue('fields') is TJSONObject then Params.AddPair('fields',TJSONValue(Msg.GetValue('fields').Clone))
      else Params.AddPair('fields',TJSONObject.Create);
      Reply := Rpc('omp.control',Params);
      try Post(TJSONObject.Create.AddPair('type','ompControl').AddPair('command',Msg.GetValue<string>('command','')).AddPair('fields',TJSONValue(Msg.GetValue('fields').Clone)).AddPair('data',TJSONValue(Reply.Clone))); finally Reply.Free; end; Exit;
    end;
    if Action = 'reset' then begin
      Reply := Rpc('chat.close',Params); Reply.Free; OpenSession; Exit;
    end;
    if Action = 'prompt' then begin Params.AddPair('message',Msg.GetValue<string>('message','')); if Msg.GetValue('context') is TJSONObject then Params.AddPair('context',TJSONValue(Msg.GetValue('context').Clone)); if Msg.GetValue('attachments') is TJSONArray then Params.AddPair('attachments',TJSONValue(Msg.GetValue('attachments').Clone)); Reply := Rpc('chat.prompt',Params); Reply.Free; Exit; end;
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
    if Action = 'previewMessageRestore' then begin
      Params.AddPair('seq',TJSONNumber.Create(Msg.GetValue<Integer>('seq',0)));Params.AddPair('branch',TJSONBool.Create(Msg.GetValue<Boolean>('branch',False)));
      FreeAndNil(FMessageRestore);FMessageRestore := Rpc('chat.previewMessageRestore',Params);Post(TJSONObject.Create.AddPair('type','messageRestorePreview').AddPair('data',TJSONValue(FMessageRestore.Clone)));Exit;
    end;
    if Action = 'restoreMessage' then begin
      if (FMessageRestore=nil) or (Msg.GetValue<string>('messageRestoreId','')<>FMessageRestore.GetValue<string>('messageRestoreId','')) then begin Params.Free;raise Exception.Create('Message preview unavailable');end;
      Params.AddPair('messageRestoreId',FMessageRestore.GetValue<string>('messageRestoreId',''));Params.AddPair('revision',FMessageRestore.GetValue<string>('revision',''));Reply := Rpc('chat.restoreMessage',Params);
      try FSession := Reply.GetValue<string>('sessionId','');FSavedSession := Reply.GetValue<string>('savedSessionId','');FTurn := '';Reply.AddPair('type','session');Reply.AddPair('attachmentsEnabled',TJSONBool.Create(True));Reply.AddPair('selectionEnabled',TJSONBool.Create(True));Post(TJSONObject(Reply.Clone));finally Reply.Free;end;FreeAndNil(FMessageRestore);Exit;
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
var Items: TList<string>; Json: string; PingAt: UInt64; Failed, ErrorFrame: TJSONObject;
begin
  PingAt := GetTickCount64;
  try
    while not Terminated do begin
      Json := ''; Items := FInput.LockList;
      try if Items.Count > 0 then begin Json := Items[0]; Items.Delete(0); end; finally FInput.UnlockList; end;
      if Json <> '' then try Handle(Json); except on E: Exception do begin
        Failed := TJSONObject.ParseJSONValue(Json) as TJSONObject;
        ErrorFrame := TJSONObject.Create.AddPair('type','operationError').AddPair('message',E.Message);
        try if Failed <> nil then begin ErrorFrame.AddPair('action',Failed.GetValue<string>('action',''));ErrorFrame.AddPair('command',Failed.GetValue<string>('command',''));if Failed.GetValue('fields')<>nil then ErrorFrame.AddPair('fields',TJSONValue(Failed.GetValue('fields').Clone));if Failed.GetValue('id')<>nil then ErrorFrame.AddPair('id',TJSONValue(Failed.GetValue('id').Clone));end;finally Failed.Free;end;
        Post(ErrorFrame);
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
