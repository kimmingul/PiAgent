unit PiAgent.CoreAcceptance;
interface
procedure StartCoreFixtureAcceptance;
implementation
uses System.SysUtils, System.Classes, System.IOUtils, System.JSON, System.DateUtils,
  System.NetEncoding, Winapi.Windows, Vcl.ExtCtrls, ToolsAPI, PiAgent.ChatWorker, PiAgent.IdeHost,
  PiAgent.Designer, PiAgent.DesignerAcceptance, PiAgent.DesignerAuthoring;
type TCoreFixture = class(TComponent)
private
  FTimer: TTimer;
  FWorker: TPiChatWorker;
  FHost: TPiIdeHost;
  FReport: TJSONObject;
  FSteps: TJSONArray;
  FRoot,FWorkspace,FSession,FOriginal,FProposal,FRevision,FCheckpoint: string;
  FPhase,FAuditLines,FNativeActions,FApprovals: Integer;
  FAt: UInt64;
  FInTick,FConnected,FWaiting: Boolean;
  procedure Save;
  procedure Send(Parameters: TJSONObject);
  procedure Prompt(const Name: string; Args: TJSONObject);
  procedure Event(Data: TJSONObject);
  procedure Completed;
  procedure Tick(Sender: TObject);
  function ResultPayload: TJSONObject;
  function Module: IOTAModule;
public
  constructor Create(AOwner: TComponent); override;
  destructor Destroy; override;
end;
var Fixture: TCoreFixture;
constructor TCoreFixture.Create(AOwner: TComponent);
begin
  inherited; FRoot:=GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH');
  FWorkspace:='file:///'+TNetEncoding.URL.Encode(FRoot.Replace('\','/')).Replace('%2F','/').Replace('%3A',':').Replace('+','%20');
  FHost:=TPiIdeHost.Create; FSteps:=TJSONArray.Create;
  FReport:=TJSONObject.Create.AddPair('schemaVersion',TJSONNumber.Create(1)).AddPair('kind','authenticated actual Core and native adapter acceptance')
    .AddPair('capturedAt',DateToISO8601(Now,False)).AddPair('steps',FSteps);
  FTimer:=TTimer.Create(Self); FTimer.Interval:=100; FTimer.OnTimer:=Tick;
end;
destructor TCoreFixture.Destroy;
begin FTimer.Enabled:=False; FHost.Cancel(''); FWorker.Free; FHost.Free; FReport.Free; inherited; end;
function TCoreFixture.Module: IOTAModule;
begin
  Result:=(BorlandIDEServices as IOTAModuleServices).CurrentModule;
  if (Result=nil) or not SameText(Result.FileName,TPath.Combine(FRoot,'Main.pas')) then raise Exception.Create('Core fixture designer module changed');
end;
procedure TCoreFixture.Save;
begin TFile.WriteAllText(TPath.Combine(FRoot,'core-acceptance.json'),FReport.ToJSON,TEncoding.UTF8); end;
procedure TCoreFixture.Send(Parameters: TJSONObject);
begin try FWorker.Enqueue(Parameters.ToJSON); finally Parameters.Free; end; end;
procedure TCoreFixture.Prompt(const Name: string; Args: TJSONObject);
var Request: TJSONObject; Audit: string;
begin
  Audit:=TPath.Combine(FRoot,'private\audit.jsonl'); FAuditLines:=0;
  if FileExists(Audit) then FAuditLines:=Length(TFile.ReadAllLines(Audit,TEncoding.UTF8));
  Request:=TJSONObject.Create.AddPair('name',Name).AddPair('args',Args);
  try Send(TJSONObject.Create.AddPair('action','prompt').AddPair('message','RAD_CHECK:'+Request.ToJSON)); finally Request.Free; end;
  FWaiting:=True; FAt:=GetTickCount64; FNativeActions:=0; FApprovals:=0;
end;
function TCoreFixture.ResultPayload: TJSONObject;
var Lines: TArray<string>; I: Integer; Item,Content: TJSONObject; Rows: TJSONArray; Text: string;
begin
  Result:=nil; Lines:=TFile.ReadAllLines(TPath.Combine(FRoot,'private\audit.jsonl'),TEncoding.UTF8);
  for I:=FAuditLines to Length(Lines)-1 do begin
    Item:=TJSONObject.ParseJSONValue(Lines[I]) as TJSONObject;
    try
      if (Item=nil) or (Item.GetValue<string>('type','')<>'host_tool_result') then Continue;
      if Item.GetValue<Boolean>('isError',False) then
        Exit(TJSONObject.Create.AddPair('fixtureToolError',TJSONBool.Create(True)).AddPair('raw',TJSONValue(Item.Clone)));
      Content:=Item.GetValue('result') as TJSONObject; if Content=nil then raise Exception.Create('Actual Core result content unavailable');
      Rows:=Content.GetValue('content') as TJSONArray; if (Rows=nil) or (Rows.Count<>1) then raise Exception.Create('Actual Core result text unavailable');
      Text:=(Rows.Items[0] as TJSONObject).GetValue<string>('text','');
      Result:=TJSONObject.ParseJSONValue(Text) as TJSONObject;
      if Result=nil then raise Exception.Create('Actual Core result is not a JSON object');
      Exit;
    finally Item.Free; end;
  end;
  raise Exception.Create('Provider did not receive actual Core host tool result');
end;
procedure TCoreFixture.Completed;
var Payload: TJSONObject; Name: string;
begin
  Payload:=ResultPayload;
  try
    case FPhase of
      0: begin Name:='context_live_route'; if not Payload.GetValue<Boolean>('available',False) then raise Exception.Create('Core context unavailable'); end;
      1: begin Name:='build_declined_before_execution'; if Payload.GetValue<string>('status','')<>'cancelled' then raise Exception.Create('Declined build did not cancel');
        if (FNativeActions<>0) or (FApprovals<>1) then raise Exception.Create('Declined build crossed SDK execution boundary'); end;
      2: begin Name:='build_approved_live_route'; if not Payload.GetValue<Boolean>('success',False) or (FNativeActions<>1) or (FApprovals<>1) then raise Exception.Create('Approved Core native build did not complete'); end;
      3: begin Name:='designer_preview_live_route'; FProposal:=Payload.GetValue<string>('proposalId',''); FRevision:=Payload.GetValue<string>('revision','');
        if (FProposal='') or (FRevision='') or (DesignerFileRevision(Module)<>FOriginal) then raise Exception.Create('Core preview mutated files or omitted proposal'); end;
      4: begin Name:='designer_approved_apply_live_route'; FCheckpoint:=Payload.GetValue<string>('checkpointId','');
        if not Payload.GetValue<Boolean>('applied',False) or (FCheckpoint='') or (FApprovals<>1) or (FNativeActions<>1) then raise Exception.Create('Core approved creation did not apply'); end;
      5: begin Name:='designer_restore_preview_live_route'; FProposal:=Payload.GetValue<string>('proposalId',''); FRevision:=Payload.GetValue<string>('revision','');
        if (FProposal='') or (FRevision='') or not Payload.GetValue<string>('diff','').Contains('restoreText') then raise Exception.Create('Core restore preview omitted concrete source/form review'); end;
      6: begin Name:='designer_approved_restore_live_route';
        if not Payload.GetValue<Boolean>('restored',False) or (FApprovals<>1) or (FNativeActions<>1) or
          (DesignerFileRevision(Module)<>FOriginal) then raise Exception.Create('Core restoration did not restore exact source/form bytes'); end;
      7: begin Name:='designer_single_use_replay_rejected';
        if not Payload.GetValue<Boolean>('fixtureToolError',False) or (FNativeActions<>0) or (FApprovals<>0) then raise Exception.Create('Consumed restore proposal was accepted twice'); end;
    else raise Exception.Create('Unexpected Core fixture phase'); end;
    FSteps.AddElement(TJSONObject.Create.AddPair('operation',Name).AddPair('passed',TJSONBool.Create(True))
      .AddPair('nativeActions',TJSONNumber.Create(FNativeActions)).AddPair('approvals',TJSONNumber.Create(FApprovals)).AddPair('actualCoreResult',TJSONValue(Payload.Clone)));
    Inc(FPhase); FWaiting:=False; Save;
    if FPhase=8 then begin FReport.AddPair('passed',TJSONBool.Create(True)).AddPair('completedAt',DateToISO8601(Now,False)); Save; FTimer.Enabled:=False; Send(TJSONObject.Create.AddPair('action','disconnectWorkspace')); end;
  finally Payload.Free; end;
end;
procedure TCoreFixture.Event(Data: TJSONObject);
var Frame,Reply,Args: TJSONObject; Kind,Operation,Diff: string; Approved: Boolean;
begin
  if Data.GetValue<string>('sessionId','')<>FSession then raise Exception.Create('Core fixture event session changed');
  Kind:=Data.GetValue<string>('kind','');
  if Kind='error' then raise Exception.Create('Actual Core turn failed: '+Data.ToJSON);
  if Kind='completed' then begin Completed; Exit; end;
  if (Kind<>'omp_event') or not (Data.GetValue('frame') is TJSONObject) then Exit;
  Frame:=Data.GetValue('frame') as TJSONObject; Kind:=Frame.GetValue<string>('type','');
  if Kind='ide_cancel' then begin FHost.Cancel(Frame.GetValue<string>('id','')); Exit; end;
  if Kind='designer_cancel' then Exit;
  if Kind='designer_approval' then begin
    if not (FPhase in [1,2,4,6]) or not FWaiting then raise Exception.Create('Unexpected live Core approval');
    if FApprovals<>0 then raise Exception.Create('Repeated live Core approval');
    Diff:=Frame.GetValue<string>('diff','');
    if (Diff='') or (Length(Diff)>131072) then raise Exception.Create('Core approval review is missing');
    if (FPhase=4) and not Diff.Contains('CoreFixtureButton') then raise Exception.Create('Core approval does not describe the exact fixture change');
    if (FPhase=6) and not Diff.Contains('restoreText') then raise Exception.Create('Core recovery review is incomplete');
    FSteps.AddElement(TJSONObject.Create.AddPair('operation','actual_core_approval').AddPair('data',TJSONValue(Frame.Clone)));
    Inc(FApprovals); Approved:=FPhase<>1;
    Send(TJSONObject.Create.AddPair('action','designerDecide').AddPair('proposalId',Frame.GetValue<string>('proposalId','')).AddPair('approved',TJSONBool.Create(Approved)));
    Save; Exit;
  end;
  if (Kind<>'ide_request') and (Kind<>'designer_request') then Exit;
  if not FWorker.BeginSdkRequest(FSession,Frame.GetValue<string>('id','')) then Exit;
  Operation:=Frame.GetValue<string>('operation','');
  if (Operation='ide_build') or (Operation='applyChange') or (Operation='restoreChange') then Inc(FNativeActions);
  Reply:=nil;
  try
    if Kind='ide_request' then Reply:=FHost.Execute(Frame,FWorkspace)
    else begin
      Reply:=TJSONObject.Create.AddPair('action','designerReply').AddPair('requestId',Frame.GetValue<string>('id',''));
      Args:=Frame.GetValue('args') as TJSONObject;
      try Reply.AddPair('result',ExecuteDesigner(Operation,Args,FWorkspace));
      except on E:Exception do Reply.AddPair('error',E.Message); end;
    end;
    if (Reply<>nil) and FWorker.MayReplySdk(Frame.GetValue<string>('id','')) then Send(TJSONObject(Reply.Clone));
  finally Reply.Free; end;
end;
procedure TCoreFixture.Tick(Sender: TObject);
var Json: string; Msg,Data,State: TJSONObject; I: Integer;
begin
  if FInTick then Exit; FInTick:=True;
  try
    try
      if FWorker=nil then begin
        if not DesignerFixtureReady then Exit;
        if GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_AUTORUN')='1' then begin
          if not FileExists(TPath.Combine(FRoot,'designer-acceptance.json')) then Exit;
          State:=TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(FRoot,'designer-acceptance.json'),TEncoding.UTF8)) as TJSONObject;
          try if State.GetValue('passed')=nil then Exit; if not State.GetValue<Boolean>('passed',False) then raise Exception.Create('Designer acceptance failed; live Core route not started'); finally State.Free; end;
        end;
        if GetEnvironmentVariable('PIAGENT_RAD_SDK_AUTORUN')='1' then begin
          if not FileExists(TPath.Combine(FRoot,'ide-acceptance.json')) then Exit;
          State:=TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(FRoot,'ide-acceptance.json'),TEncoding.UTF8)) as TJSONObject;
          try if State.GetValue('passed')=nil then Exit; if not State.GetValue<Boolean>('passed',False) then raise Exception.Create('SDK acceptance failed; live Core route not started'); finally State.Free; end;
        end;
        FOriginal:=DesignerFileRevision(Module); FWorker:=TPiChatWorker.Create; FWorker.Start; FAt:=GetTickCount64;
        Send(TJSONObject.Create.AddPair('action','connect').AddPair('workspaceUri',FWorkspace).AddPair('ideCatalog',FHost.Catalog(FWorkspace))); Exit;
      end;
      if GetTickCount64-FAt>180000 then raise Exception.Create('Live Core fixture phase timed out');
      for I:=1 to 64 do begin
        Json:=FWorker.Pop; if Json='' then Break;
        Msg:=TJSONObject.ParseJSONValue(Json) as TJSONObject;
        try
          if Msg.GetValue<string>('type','')='session' then begin FSession:=Msg.GetValue<string>('sessionId',''); FConnected:=True; end
          else if (Msg.GetValue<string>('type','')='disconnected') or (Msg.GetValue<string>('type','')='operationError') then raise Exception.Create(Msg.ToJSON)
          else if Msg.GetValue<string>('type','')='event' then begin Data:=Msg.GetValue('data') as TJSONObject; Event(Data); end;
        finally Msg.Free; end;
      end;
      Msg:=FHost.Poll;
      if Msg<>nil then try if FWorker.MayReplySdk(Msg.GetValue<string>('requestId','')) then Send(TJSONObject(Msg.Clone)); finally Msg.Free; end;
      if not FConnected or FWaiting or (FPhase>=8) then Exit;
      Send(TJSONObject.Create.AddPair('action','ideCatalog').AddPair('catalog',FHost.Catalog(FWorkspace)));
      case FPhase of
        0: Prompt('ide_context',TJSONObject.Create);
        1,2: Prompt('ide_build',TJSONObject.Create.AddPair('operation','build').AddPair('backend','native'));
        3: Prompt('ide_designer_preview_change',TJSONObject.Create.AddPair('changeOperation','createComponent').AddPair('type','TButton')
          .AddPair('name','CoreFixtureButton').AddPair('parent','MainForm').AddPair('x',TJSONNumber.Create(16)).AddPair('y',TJSONNumber.Create(16))
          .AddPair('width',TJSONNumber.Create(100)).AddPair('height',TJSONNumber.Create(30)));
        4: Prompt('ide_designer_apply_change',TJSONObject.Create.AddPair('proposalId',FProposal).AddPair('revision',FRevision));
        5: Prompt('ide_designer_preview_restore',TJSONObject.Create.AddPair('checkpointId',FCheckpoint));
        6,7: Prompt('ide_designer_restore_change',TJSONObject.Create.AddPair('proposalId',FProposal).AddPair('revision',FRevision));
      end;
    except on E:Exception do begin
      FTimer.Enabled:=False; FHost.Cancel('');
      FReport.AddPair('passed',TJSONBool.Create(False)).AddPair('failedPhase',TJSONNumber.Create(FPhase)).AddPair('error',E.Message);
      Save;
    end; end;
  finally FInTick:=False; end;
end;
procedure StartCoreFixtureAcceptance;
begin
  if (Fixture=nil) and (GetEnvironmentVariable('PIAGENT_RAD_CORE_AUTORUN')='1') and
    (GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH')<>'') then Fixture:=TCoreFixture.Create(nil);
end;
initialization Fixture:=nil;
finalization Fixture.Free;
end.
