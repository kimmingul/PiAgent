unit PiAgent.IdeSoak;
interface
procedure StartIdeFixtureSoak;
implementation
uses System.SysUtils, System.Classes, System.IOUtils, System.JSON, System.DateUtils,
  System.Hash, System.NetEncoding, Winapi.Windows, Winapi.PsAPI, Winapi.TlHelp32,
  Vcl.ExtCtrls, ToolsAPI, PiAgent.IdeHost, PiAgent.IdeContext, PiAgent.DesignerAcceptance, PiAgent.DesignerJournal;
type TIdeSoak = class(TComponent)
private
  FTimer: TTimer;
  FHost: TPiIdeHost;
  FReport: TJSONObject;
  FErrors: TJSONArray;
  FRoot,FWorkspace: string;
  FStarted,FNextSample,FNextBuild: UInt64;
  FStartedUtc: TDateTime;
  FMinutes,FSamples,FBuilds: Integer;
  FInTick,FBuilding,FRunning: Boolean;
  FPeakPrivate: UInt64;
  FPeakHandles: Cardinal;
  procedure Tick(Sender: TObject);
  procedure SetValue(const Name: string; Value: TJSONValue);
  procedure Resources;
  procedure Save;
  procedure Finish(Passed: Boolean; const Reason: string);
  procedure CompleteBuild(Reply: TJSONObject);
public
  constructor Create(AOwner: TComponent); override;
  destructor Destroy; override;
end;
var Soak: TIdeSoak;
constructor TIdeSoak.Create(AOwner: TComponent);
begin
  inherited;
  FRoot:=GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH');
  FMinutes:=StrToInt(GetEnvironmentVariable('PIAGENT_RAD_SOAK_MINUTES'));
  if (FMinutes<1) or (FMinutes>240) then raise Exception.Create('RAD soakMinutes must be 1..240');
  FWorkspace:='file:///'+TNetEncoding.URL.Encode(FRoot.Replace('\','/')).Replace('%2F','/').Replace('%3A',':').Replace('+','%20');
  FHost:=TPiIdeHost.Create; FErrors:=TJSONArray.Create;
  FReport:=TJSONObject.Create.AddPair('schemaVersion',TJSONNumber.Create(1))
    .AddPair('requestedMinutes',TJSONNumber.Create(FMinutes)).AddPair('fixture',FRoot)
    .AddPair('kind','automated native context/catalog and build soak')
    .AddPair('limitations','No human usage or editor model inference measurement')
    .AddPair('implementationVersion','0.11.2').AddPair('errors',FErrors);
  FTimer:=TTimer.Create(Self); FTimer.Interval:=500; FTimer.OnTimer:=Tick;
end;
destructor TIdeSoak.Destroy;
begin FTimer.Enabled:=False; FHost.Cancel(''); FHost.Free; FReport.Free; inherited; end;
procedure TIdeSoak.SetValue(const Name: string; Value: TJSONValue);
begin FReport.RemovePair(Name).Free; FReport.AddPair(Name,Value); end;
procedure TIdeSoak.Resources;
var Memory: PROCESS_MEMORY_COUNTERS_EX; Handles,Threads: Cardinal;
  Snapshot: THandle; Entry: TThreadEntry32; Resource: TJSONObject;
begin
  FillChar(Memory,SizeOf(Memory),0); Memory.cb:=SizeOf(Memory);
  if not GetProcessMemoryInfo(GetCurrentProcess,PPROCESS_MEMORY_COUNTERS(@Memory),SizeOf(Memory)) then RaiseLastOSError;
  if not GetProcessHandleCount(GetCurrentProcess,Handles) then RaiseLastOSError;
  Threads:=0; Snapshot:=CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD,0);
  if Snapshot=INVALID_HANDLE_VALUE then RaiseLastOSError;
  try
    FillChar(Entry,SizeOf(Entry),0); Entry.dwSize:=SizeOf(Entry);
    if Thread32First(Snapshot,Entry) then repeat
      if Entry.th32OwnerProcessID=GetCurrentProcessId then Inc(Threads);
    until not Thread32Next(Snapshot,Entry);
  finally CloseHandle(Snapshot); end;
  Resource:=TJSONObject.Create.AddPair('privateBytes',TJSONNumber.Create(UInt64(Memory.PrivateUsage)))
    .AddPair('workingSetBytes',TJSONNumber.Create(UInt64(Memory.WorkingSetSize)))
    .AddPair('handles',TJSONNumber.Create(Handles)).AddPair('threads',TJSONNumber.Create(Threads));
  if FReport.GetValue('initialResources')=nil then FReport.AddPair('initialResources',TJSONValue(Resource.Clone));
  SetValue('currentResources',Resource);
  if Memory.PrivateUsage>FPeakPrivate then FPeakPrivate:=Memory.PrivateUsage;
  if Handles>FPeakHandles then FPeakHandles:=Handles;
  SetValue('peakPrivateBytes',TJSONNumber.Create(FPeakPrivate)); SetValue('peakHandles',TJSONNumber.Create(FPeakHandles));
end;
procedure TIdeSoak.Save;
begin
  if FRunning then SetValue('elapsedSeconds',TJSONNumber.Create((GetTickCount64-FStarted)/1000));
  SetValue('samples',TJSONNumber.Create(FSamples)); SetValue('builds',TJSONNumber.Create(FBuilds));
  TFile.WriteAllText(TPath.Combine(FRoot,'piagent-rad-soak.receipt.json'),FReport.ToJSON,TEncoding.UTF8);
end;
procedure TIdeSoak.Finish(Passed: Boolean; const Reason: string);
var FinishedUtc: TDateTime; TargetMilliseconds: UInt64;
begin
  FTimer.Enabled:=False; FHost.Cancel('');
  FinishedUtc:=TTimeZone.Local.ToUniversalTime(Now);
  TargetMilliseconds:=UInt64(FMinutes)*60000;
  if Passed and ((GetTickCount64-FStarted<TargetMilliseconds) or
    (FinishedUtc<FStartedUtc) or
    (MilliSecondsBetween(FinishedUtc,FStartedUtc)<Int64(TargetMilliseconds))) then
    raise Exception.Create('Soak completion requires both UTC and monotonic 240-minute coverage');
  SetValue('passed',TJSONBool.Create(Passed));
  if Passed then SetValue('completedAt',TJSONString.Create(DateToISO8601(FinishedUtc,True)))
  else begin SetValue('stoppedAt',TJSONString.Create(DateToISO8601(FinishedUtc,True))); SetValue('stopReason',TJSONString.Create(Reason)); end;
  Resources; Save;
end;
procedure TIdeSoak.CompleteBuild(Reply: TJSONObject);
var Payload: TJSONObject;
begin
  try
    Payload:=Reply.GetValue('result') as TJSONObject;
    if (Payload=nil) or not Payload.GetValue<Boolean>('success',False) then
      raise Exception.Create('Soak native build failed: '+Reply.ToJSON);
    Inc(FBuilds); FBuilding:=False; SetValue('lastBuild',TJSONValue(Payload.Clone));
  finally Reply.Free; end;
end;
procedure TIdeSoak.Tick(Sender: TObject);
var State,Catalog,Frame,Reply: TJSONObject; ModuleName: array[0..32767] of Char; Project: IOTAProject;
  Id: TGUID; Elapsed,TargetMilliseconds: UInt64; UtcNow: TDateTime;
begin
  if FInTick then Exit; FInTick:=True;
  try
    try
      if not FRunning then begin
        if not DesignerFixtureReady then Exit;
        if GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_AUTORUN')='1' then begin
          if not FileExists(TPath.Combine(FRoot,'designer-acceptance.json')) then Exit;
          State:=TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(FRoot,'designer-acceptance.json'),TEncoding.UTF8)) as TJSONObject;
          try if State.GetValue('passed')=nil then Exit; if not State.GetValue<Boolean>('passed',False) then raise Exception.Create('Designer acceptance failed; soak not started'); finally State.Free; end;
        end;
        if GetEnvironmentVariable('PIAGENT_RAD_SDK_AUTORUN')='1' then begin
          if not FileExists(TPath.Combine(FRoot,'ide-acceptance.json')) then Exit;
          State:=TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(FRoot,'ide-acceptance.json'),TEncoding.UTF8)) as TJSONObject;
          try
            if State.GetValue('passed')=nil then Exit;
            if not State.GetValue<Boolean>('passed',False) then raise Exception.Create('SDK acceptance failed; soak not started');
          finally State.Free; end;
        end;
        if GetEnvironmentVariable('PIAGENT_RAD_CORE_AUTORUN')='1' then begin
          if not FileExists(TPath.Combine(FRoot,'core-acceptance.json')) then Exit;
          State:=TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(FRoot,'core-acceptance.json'),TEncoding.UTF8)) as TJSONObject;
          try
            if State.GetValue('passed')=nil then Exit;
            if not State.GetValue<Boolean>('passed',False) then raise Exception.Create('Live Core acceptance failed; soak not started');
          finally State.Free; end;
        end;
        FStarted:=GetTickCount64; FStartedUtc:=TTimeZone.Local.ToUniversalTime(Now); FRunning:=True;
        SetValue('startedAt',TJSONString.Create(DateToISO8601(FStartedUtc,True)));
        GetModuleFileName(HInstance,ModuleName,Length(ModuleName));
        SetValue('adapterSha256',TJSONString.Create(DesignerBytesHash(TFile.ReadAllBytes(ModuleName))));
        Resources; Save;
      end;
      Project:=GetActiveProject;
      if (Project=nil) or not SameText(Project.FileName,TPath.Combine(FRoot,'Fixture.dproj')) or
        not FileExists(TPath.Combine(FRoot,'.piagent-rad-fixture')) then raise Exception.Create('Soak fixture project changed');
      RequireSavedIdeBuffers;
      if FileExists(TPath.Combine(FRoot,'piagent-soak.cancel')) then begin Finish(False,'Explicit fixture cancellation marker'); Exit; end;
      if FBuilding then begin Reply:=FHost.Poll; if Reply=nil then Exit; CompleteBuild(Reply); Resources; Save; end;
      Elapsed:=GetTickCount64-FStarted;
      TargetMilliseconds:=UInt64(FMinutes)*60000;
      UtcNow:=TTimeZone.Local.ToUniversalTime(Now);
      if (Elapsed>=TargetMilliseconds) and (UtcNow>=FStartedUtc) and
        (MilliSecondsBetween(UtcNow,FStartedUtc)>=Int64(TargetMilliseconds)) then begin
        Finish((FErrors.Count=0) and (FSamples>=FMinutes*12*9 div 10) and
          (FBuilds>=(FMinutes+9) div 10),'Insufficient sample/build coverage'); Exit;
      end;
      if GetTickCount64<FNextSample then Exit;
      FNextSample:=GetTickCount64+5000;
      State:=IdeContext(FWorkspace);
      try if not State.GetValue<Boolean>('available',False) then raise Exception.Create('Native soak context unavailable'); finally State.Free; end;
      Catalog:=FHost.Catalog(FWorkspace);
      try
        if Catalog.GetValue<string>('workspaceUri','')<>FWorkspace then raise Exception.Create('Native soak catalog workspace changed');
        Inc(FSamples);
        if GetTickCount64>=FNextBuild then begin
          FNextBuild:=GetTickCount64+600000; CreateGUID(Id);
          Frame:=TJSONObject.Create.AddPair('id',GUIDToString(Id)).AddPair('operation','ide_build')
            .AddPair('args',TJSONObject.Create.AddPair('operation','build').AddPair('backend','native'))
            .AddPair('expectedState',TJSONObject.Create.AddPair('workspaceUri',FWorkspace).AddPair('revision',Catalog.GetValue<string>('revision','')));
          try Reply:=FHost.Execute(Frame,FWorkspace); finally Frame.Free; end;
          if Reply=nil then FBuilding:=True else CompleteBuild(Reply);
        end;
      finally Catalog.Free; end;
      Resources; Save;
    except on E:Exception do begin
      if FErrors.Count<100 then FErrors.AddElement(TJSONObject.Create.AddPair('at',DateToISO8601(Now,False)).AddPair('error',E.Message));
      Finish(False,E.Message);
    end; end;
  finally FInTick:=False; end;
end;
procedure StartIdeFixtureSoak;
begin
  if (Soak=nil) and (GetEnvironmentVariable('PIAGENT_RAD_SOAK_MINUTES')<>'') and
    (GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH')<>'') then Soak:=TIdeSoak.Create(nil);
end;
initialization Soak:=nil;
finalization Soak.Free;
end.
