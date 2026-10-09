unit PiAgent.IdeAcceptance;
interface
procedure StartIdeFixtureAcceptance;
implementation
uses System.SysUtils, System.Classes, System.JSON, System.IOUtils, System.NetEncoding,
  System.DateUtils, Vcl.ExtCtrls, ToolsAPI, Winapi.Windows, PiAgent.IdeHost,
  PiAgent.IdeContext, PiAgent.IdeDebug, PiAgent.EditorSuggestions, PiAgent.DesignerAcceptance;
type TIdeFixture = class(TComponent)
private
  FTimer: TTimer;
  FHost: TPiIdeHost;
  FReport: TJSONObject;
  FSteps: TJSONArray;
  FRoot,FWorkspace,FBaseline,FMarker,FBreakpoint,FTrace: string;
  FPhase: Integer;
  FBreakpointLine: Integer;
  FAt: UInt64;
  FDebugPid: Cardinal;
  FPause: Boolean;
  FInTick: Boolean;
  function Request(const Tool: string; Args: TJSONObject; Action: Boolean): TJSONObject;
  procedure RecordStep(const Name: string; Data: TJSONObject);
  procedure Advance(Phase: Integer);
  procedure Tick(Sender: TObject);
  procedure Save;
public
  constructor Create(AOwner: TComponent); override;
  destructor Destroy; override;
end;
var Fixture: TIdeFixture;
function SelectFixtureProject(const FileName: string): Boolean;
var Modules: IOTAModuleServices; Group: IOTAProjectGroup; Project: IOTAProject; I: Integer;
begin
  Result:=False;
  if not Supports(BorlandIDEServices,IOTAModuleServices,Modules) then Exit;
  Group:=Modules.MainProjectGroup;
  if Group=nil then Exit;
  for I:=0 to Group.ProjectCount-1 do begin
    Project:=Group.Projects[I];
    if SameText(Project.FileName,FileName) then begin
      Group.ActiveProject:=Project;
      Project:=GetActiveProject;
      Result:=(Project<>nil) and SameText(Project.FileName,FileName); Exit;
    end;
  end;
end;
constructor TIdeFixture.Create(AOwner: TComponent);
begin
  inherited; FRoot:=GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH');
  FWorkspace:='file:///'+TNetEncoding.URL.Encode(FRoot.Replace('\','/')).Replace('%2F','/').Replace('%3A',':').Replace('+','%20');
  FHost:=TPiIdeHost.Create; FSteps:=TJSONArray.Create;
  FReport:=TJSONObject.Create.AddPair('schemaVersion',TJSONNumber.Create(1)).AddPair('capturedAt',DateToISO8601(Now,False)).AddPair('steps',FSteps);
  FTimer:=TTimer.Create(Self); FTimer.Interval:=100; FTimer.OnTimer:=Tick; FAt:=GetTickCount64;
end;
destructor TIdeFixture.Destroy;
begin FTimer.Enabled:=False; FHost.Free; FReport.Free; inherited; end;
procedure TIdeFixture.Save;
begin TFile.WriteAllText(TPath.Combine(FRoot,'ide-acceptance.json'),FReport.ToJSON,TEncoding.UTF8); end;
procedure TIdeFixture.RecordStep(const Name: string; Data: TJSONObject);
begin
  FSteps.AddElement(TJSONObject.Create.AddPair('operation',Name).AddPair('passed',TJSONBool.Create(True)).AddPair('data',Data)); Save;
end;
procedure TIdeFixture.Advance(Phase: Integer);
begin
  FPhase:=Phase; FAt:=GetTickCount64;
  FReport.RemovePair('phase').Free;
  FReport.AddPair('phase',TJSONNumber.Create(Phase)); Save;
end;
function TIdeFixture.Request(const Tool: string; Args: TJSONObject; Action: Boolean): TJSONObject;
var Frame,Catalog: TJSONObject; Id: TGUID;
begin
  FReport.RemovePair('activeRequest').Free;
  FReport.AddPair('activeRequest',TJSONObject.Create.AddPair('tool',Tool).AddPair('args',TJSONValue(Args.Clone)));
  Save;
  CreateGUID(Id); Frame:=TJSONObject.Create.AddPair('id',GUIDToString(Id)).AddPair('operation',Tool).AddPair('args',Args);
  try
    if Action then begin
      Catalog:=FHost.Catalog(FWorkspace);
      try Frame.AddPair('expectedState',TJSONObject.Create.AddPair('workspaceUri',FWorkspace).AddPair('revision',Catalog.GetValue<string>('revision','')));
      finally Catalog.Free; end;
    end;
    Result:=FHost.Execute(Frame,FWorkspace);
  finally Frame.Free; end;
end;
procedure TIdeFixture.Tick(Sender: TObject);
var Reply,Payload,State,Data: TJSONObject; Services: IOTADebuggerServices; Process: IOTAProcess;
  Rows: TJSONArray; I: Integer; Module: IOTAModule; Expected: string; Lines: TStringList;
  Actions: IOTAActionServices;
begin
  if FInTick then Exit;
  FInTick:=True;
  try
  if (FPhase=0) and not DesignerFixtureReady then Exit;
  try
    if (GetTickCount64-FAt>180000) then raise Exception.Create('Native IDE acceptance phase timed out');
    case FPhase of
      0: begin
        if GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_AUTORUN')='1' then begin
          if not FileExists(TPath.Combine(FRoot,'designer-acceptance.json')) then Exit;
          State:=TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(FRoot,'designer-acceptance.json'),TEncoding.UTF8)) as TJSONObject;
          try if not State.GetValue<Boolean>('passed',False) then raise Exception.Create('Designer fixture acceptance failed; SDK sequence not started'); finally State.Free; end;
        end;
        RecordStep('ide_context',Request('ide_context',TJSONObject.Create,False));
        RecordStep('ide_catalog',FHost.Catalog(FWorkspace));
        Reply:=Request('ide_build',TJSONObject.Create.AddPair('operation','rebuild').AddPair('backend','native'),True);
        FReport.AddPair('nativeBuildReturnedPending',TJSONBool.Create(Reply=nil));
        if Reply<>nil then begin
          Payload:=Reply.GetValue('result') as TJSONObject;
          if (Payload=nil) or not Payload.GetValue<Boolean>('success',False) then begin Reply.Free; raise Exception.Create('Native synchronous build failed'); end;
          RecordStep('native_build_completion',Reply); Advance(2);
        end else Advance(1);
      end;
      1: begin
        Reply:=FHost.Poll; if Reply=nil then Exit;
        Payload:=Reply.GetValue('result') as TJSONObject;
        if (Payload=nil) or not Payload.GetValue<Boolean>('success',False) then begin RecordStep('native_build_failure',Reply); raise Exception.Create('Native asynchronous build did not succeed'); end;
        RecordStep('native_build_completion',Reply); Advance(2);
      end;
      2: begin
        Lines:=TStringList.Create;
        try
          Lines.LoadFromFile(TPath.Combine(FRoot,'Fixture.dpr'),TEncoding.UTF8);
          for I:=0 to Lines.Count-1 do if Lines[I].Contains('Application.Initialize;') then FBreakpointLine:=I+1;
          if FBreakpointLine<1 then raise Exception.Create('Fixture executable startup line unavailable');
        finally Lines.Free; end;
        RecordStep('debug_breakpoint',Request('ide_debug',TJSONObject.Create.AddPair('operation','breakpoint')
          .AddPair('file','Fixture.dpr').AddPair('line',TJSONNumber.Create(FBreakpointLine)),True));
        Reply:=Request('ide_debug',TJSONObject.Create.AddPair('operation','breakpoints'),False);
        try
          Rows:=(Reply.GetValue('result') as TJSONObject).GetValue('breakpoints') as TJSONArray;
          for I:=0 to Rows.Count-1 do if SameText((Rows.Items[I] as TJSONObject).GetValue<string>('file',''),TPath.Combine(FRoot,'Fixture.dpr')) and
            ((Rows.Items[I] as TJSONObject).GetValue<Integer>('line',0)=FBreakpointLine) then FBreakpoint:=(Rows.Items[I] as TJSONObject).GetValue<string>('id','');
          if FBreakpoint='' then raise Exception.Create('Actual fixture breakpoint was not enumerated');
        finally Reply.Free; end;
        RecordStep('debug_start',Request('ide_debug',TJSONObject.Create.AddPair('operation','start'),True)); Advance(3);
      end;
      3: begin
        if not Supports(BorlandIDEServices,IOTADebuggerServices,Services) then raise Exception.Create('Debugger SDK unavailable');
        Process:=Services.CurrentProcess; if Process=nil then Exit;
        Expected:=DebugOutputFile(FWorkspace);
        if not SameText(TPath.GetFullPath(Process.ExeName),Expected) then raise Exception.Create('Native debugger selected another executable');
        FDebugPid:=Process.OSProcessId;
        if Process.ProcessState=psRunning then begin
          if GetTickCount64-FAt<5000 then Exit;
          if not FPause then begin RecordStep('debug_pause',Request('ide_debug',TJSONObject.Create.AddPair('operation','pause'),True)); FPause:=True; end;
          Exit;
        end;
        if (Process.ProcessState<>psStopped) or (Process.CurrentThread=nil) or (Process.CurrentThread.State<>tsStopped) then Exit;
        RecordStep('debug_snapshot',Request('ide_debug',TJSONObject.Create.AddPair('operation','snapshot'),False));
        RecordStep('debug_threads',Request('ide_debug',TJSONObject.Create.AddPair('operation','threads'),False));
        Reply:=Request('ide_debug',TJSONObject.Create.AddPair('operation','evaluate').AddPair('expression','1 + 1'),True);
        Payload:=Reply.GetValue('result') as TJSONObject;
        if (Payload=nil) or not Payload.GetValue<Boolean>('valid',False) or (Trim(Payload.GetValue<string>('value',''))<>'2') then begin RecordStep('debug_evaluate_failure',Reply); raise Exception.Create('Actual debugger evaluation did not yield 2'); end;
        RecordStep('debug_evaluate',Reply);
        RecordStep('debug_continue',Request('ide_debug',TJSONObject.Create.AddPair('operation','continue'),True)); FPause:=False; Advance(4);
      end;
      4: begin
        Services:=BorlandIDEServices as IOTADebuggerServices; Process:=Services.CurrentProcess;
        if (Process=nil) or (Process.OSProcessId<>FDebugPid) then raise Exception.Create('Owned debugger process disappeared');
        if Process.ProcessState=psRunning then begin
          if GetTickCount64-FAt<1000 then Exit;
          Reply:=Request('ide_profile',TJSONObject.Create.AddPair('operation','cpu').AddPair('processId',TJSONNumber.Create(FDebugPid))
            .AddPair('durationSeconds',TJSONNumber.Create(1)),True);
          if Reply<>nil then begin Reply.Free; raise Exception.Create('Bounded native CPU measurement unexpectedly completed immediately'); end;
          Advance(41);
        end;
      end;
      41,42: begin
        Reply:=FHost.Poll; if Reply=nil then Exit;
        Payload:=Reply.GetValue('result') as TJSONObject;
        if (Payload=nil) or (Payload.GetValue<Int64>('wallMilliseconds',0)<1000) or Payload.GetValue<Boolean>('callStacksAvailable',True) then begin RecordStep('cpu_counter_failure',Reply); raise Exception.Create('Actual bounded CPU counter result unavailable'); end;
        if FPhase=41 then begin
          FTrace:=Payload.GetValue<string>('traceId',''); if FTrace='' then begin Reply.Free; raise Exception.Create('CPU trace identity missing'); end;
          RecordStep('profile_cpu_native_target',Reply);
          Reply:=Request('ide_profile',TJSONObject.Create.AddPair('operation','compare').AddPair('processId',TJSONNumber.Create(FDebugPid))
            .AddPair('durationSeconds',TJSONNumber.Create(1)).AddPair('baselineTrace',FTrace),True);
          if Reply<>nil then begin Reply.Free; raise Exception.Create('CPU comparison unexpectedly completed immediately'); end;
          Advance(42);
        end else begin
          if Payload.GetValue<string>('baselineTrace','')<>FTrace then begin Reply.Free; raise Exception.Create('CPU comparison used another baseline'); end;
          RecordStep('profile_cpu_compare_native_target',Reply);
          RecordStep('debug_pause_running',Request('ide_debug',TJSONObject.Create.AddPair('operation','pause'),True)); Advance(5);
        end;
      end;
      5: begin
        Services:=BorlandIDEServices as IOTADebuggerServices; Process:=Services.CurrentProcess;
        if (Process=nil) or (Process.OSProcessId<>FDebugPid) then raise Exception.Create('Owned debugger process disappeared');
        if Process.ProcessState<>psStopped then Exit;
        RecordStep('debug_stop',Request('ide_debug',TJSONObject.Create.AddPair('operation','stop'),True)); Advance(6);
      end;
      6: begin
        Services:=BorlandIDEServices as IOTADebuggerServices; Process:=Services.CurrentProcess;
        if (Process<>nil) and not (Process.ProcessState in [psNothing,psNoProcess,psTerminated]) then Exit;
        RecordStep('debug_remove_breakpoint',Request('ide_debug',TJSONObject.Create.AddPair('operation','removeBreakpoint').AddPair('breakpointId',FBreakpoint),True)); FBreakpoint:=''; FDebugPid:=0;
        State:=EditorFixtureAction('park'); try FBaseline:=State.GetValue<string>('revision',''); finally State.Free; end;
        RecordStep('editor_completion_request',EditorFixtureAction('completion')); Advance(7);
      end;
      7,9: begin
        State:=EditorFixtureAction('snapshot');
        try
          if State.GetValue<string>('error','')<>'' then raise Exception.Create(State.GetValue<string>('error',''));
          if not State.GetValue<Boolean>('ready',False) then Exit;
          RecordStep('editor_preview',TJSONObject(State.Clone));
        finally State.Free; end;
        Data:=EditorFixtureAction('accept');
        try
          if FPhase=7 then begin
            if not Data.GetValue<string>('text','').Contains('PiAgent RAD explicit preview fixture') then raise Exception.Create('Accepted actual completion missing');
          end else if not Data.GetValue<string>('text','').Contains('RAD_EDITOR_AFTER') then raise Exception.Create('Accepted actual next edit missing');
          RecordStep('editor_accept',TJSONObject(Data.Clone));
        finally Data.Free; end;
        Data:=EditorFixtureAction('undo');
        try
          Expected:=FBaseline; if FPhase=9 then Expected:=FMarker;
          if Data.GetValue<string>('revision','')<>Expected then begin
            RecordStep('editor_undo_failure',TJSONObject(Data.Clone));
            raise Exception.Create('Native Undo did not restore the exact buffer');
          end;
          RecordStep('editor_undo',TJSONObject(Data.Clone));
        finally Data.Free; end;
        if FPhase=7 then Advance(8) else begin
          Data:=EditorFixtureAction('undo'); try if Data.GetValue<string>('revision','')<>FBaseline then raise Exception.Create('Marker Undo changed original buffer'); finally Data.Free; end;
          State:=EditorFixtureAction('park'); State.Free;
          State:=EditorFixtureAction('completion'); State.Free;
          State:=EditorFixtureAction('moveStart'); State.Free; Advance(10);
        end;
      end;
      8: begin
        State:=EditorFixtureAction('marker'); try FMarker:=State.GetValue<string>('revision',''); finally State.Free; end;
        State:=EditorFixtureAction('park'); State.Free;
        RecordStep('editor_next_edit_request',EditorFixtureAction('next-edit')); Advance(9);
      end;
      10: begin
        if GetTickCount64-FAt<500 then Exit;
        State:=EditorFixtureAction('snapshot');
        try
          if State.GetValue<Boolean>('ready',False) or State.GetValue<Boolean>('pending',False) then raise Exception.Create('Stale editor request was not retired');
          if State.GetValue<string>('revision','')<>FBaseline then raise Exception.Create('Stale suggestion changed buffer');
          RecordStep('editor_stale_caret_guard',TJSONObject(State.Clone));
        finally State.Free; end;
        Module:=(BorlandIDEServices as IOTAModuleServices).CurrentModule;
        if (Module=nil) or not Module.Save(False,True) then raise Exception.Create('Fixture buffer save failed');
        Advance(11);
      end;
      11: begin
        FReport.RemovePair('activeRequest').Free;
        FReport.AddPair('activeRequest',TJSONObject.Create.AddPair('tool','fixture_open_project')
          .AddPair('file',TPath.Combine(FRoot,'dunitx\DUnitXFixture.dproj'))); Save;
        if not Supports(BorlandIDEServices,IOTAActionServices,Actions) or
          not Actions.OpenProject(TPath.Combine(FRoot,'dunitx\DUnitXFixture.dproj'),False) then raise Exception.Create('Native DUnitX fixture project open failed');
        Reply:=Request('ide_build',TJSONObject.Create.AddPair('operation','rebuild').AddPair('backend','native'),True);
        if Reply<>nil then begin
          Payload:=Reply.GetValue('result') as TJSONObject;
          if (Payload=nil) or not Payload.GetValue<Boolean>('success',False) then begin Reply.Free; raise Exception.Create('Native DUnitX fixture build failed'); end;
          RecordStep('dunitx_native_build',Reply); Advance(13);
        end else Advance(12);
      end;
      12: begin
        Reply:=FHost.Poll; if Reply=nil then Exit;
        Payload:=Reply.GetValue('result') as TJSONObject;
        if (Payload=nil) or not Payload.GetValue<Boolean>('success',False) then begin Reply.Free; raise Exception.Create('Asynchronous native DUnitX fixture build failed'); end;
        RecordStep('dunitx_native_build',Reply); Advance(13);
      end;
      13,15: begin
        Data:=TJSONObject.Create.AddPair('operation','run').AddPair('framework','DUnitX');
        if FPhase=15 then Data.AddPair('filter','DUnitXFixture.TAgentFixture.Passing');
        Reply:=Request('ide_tests',Data,True);
        if Reply<>nil then begin Reply.Free; raise Exception.Create('Native DUnitX runner did not execute asynchronously'); end;
        Advance(FPhase+1);
      end;
      14,16: begin
        Reply:=FHost.Poll; if Reply=nil then Exit;
        Payload:=Reply.GetValue('result') as TJSONObject;
        if (Payload=nil) or not Payload.GetValue<Boolean>('executed',False) then begin RecordStep('dunitx_failure',Reply); raise Exception.Create('Native DUnitX runner failed to execute'); end;
        Data:=Payload.GetValue('results') as TJSONObject;
        if Data=nil then begin Reply.Free; raise Exception.Create('Actual DUnitX NUnit result missing'); end;
        if FPhase=14 then begin
          if (Data.GetValue<Integer>('total',0)<>2) or (Data.GetValue<Integer>('failures',0)<>1) or Payload.GetValue<Boolean>('success',True) then begin Reply.Free; raise Exception.Create('Actual intentional failing DUnitX test did not match'); end;
          RecordStep('dunitx_native_failure_counts',Reply); Advance(15);
        end else begin
          if (Data.GetValue<Integer>('total',0)<>1) or (Data.GetValue<Integer>('failures',1)<>0) or not Payload.GetValue<Boolean>('success',False) then begin Reply.Free; raise Exception.Create('Actual DUnitX passing filter did not match'); end;
          RecordStep('dunitx_native_passing_filter',Reply);
          FReport.RemovePair('activeRequest').Free;
          FReport.AddPair('activeRequest',TJSONObject.Create.AddPair('tool','fixture_reopen_original_project')
            .AddPair('file',TPath.Combine(FRoot,'Fixture.dproj'))); Save;
          if not Supports(BorlandIDEServices,IOTAActionServices,Actions) or not Actions.OpenProject(TPath.Combine(FRoot,'Fixture.dproj'),False) then raise Exception.Create('Original fixture project reopen failed');
          Advance(17);
        end;
      end;
      17: begin
        if not SelectFixtureProject(TPath.Combine(FRoot,'Fixture.dproj')) or not DesignerFixtureReady then Exit;
        Reply:=Request('ide_build',TJSONObject.Create.AddPair('operation','build').AddPair('backend','external')
          .AddPair('project','Fixture.dpr'),True);
        if Reply<>nil then begin Reply.Free; raise Exception.Create('External Delphi build did not execute asynchronously'); end;
        Advance(18);
      end;
      18: begin
        Reply:=FHost.Poll; if Reply=nil then Exit;
        Payload:=Reply.GetValue('result') as TJSONObject;
        if (Payload=nil) or not Payload.GetValue<Boolean>('success',False) or (Payload.GetValue<string>('source','')<>'external') or
          not SameText(Payload.GetValue<string>('nativeProject',''),TPath.Combine(FRoot,'Fixture.dproj')) or
          not SameText(Payload.GetValue<string>('personality',''),'Delphi.Personality') then begin
          Reply.Free; raise Exception.Create('External Delphi .dpr alias build or original project identity failed');
        end;
        FReport.AddPair('externalDprAliasBuild',Reply);
        Reply:=Request('ide_diagnostics',TJSONObject.Create,False); Payload:=Reply.GetValue('result') as TJSONObject;
        if (Payload=nil) or not Payload.GetValue<Boolean>('available',False) or
          not SameText(Payload.GetValue<string>('nativeProject',''),TPath.Combine(FRoot,'Fixture.dproj')) or
          (Payload.GetValue<string>('source','')<>'external') then begin Reply.Free; raise Exception.Create('External diagnostics lost exact original Delphi identity'); end;
        FReport.AddPair('externalDelphiDiagnostics',Reply);
        FReport.AddPair('passed',TJSONBool.Create(True)); Save; FTimer.Enabled:=False;
      end;
    end;
  except on E:Exception do begin
    FTimer.Enabled:=False; FHost.Cancel('');
    try
      if (FDebugPid<>0) and Supports(BorlandIDEServices,IOTADebuggerServices,Services) then begin
        Process:=Services.CurrentProcess; if (Process<>nil) and (Process.OSProcessId=FDebugPid) then Process.Terminate;
      end;
    except on CleanupError:Exception do FReport.AddPair('cleanupError',CleanupError.Message); end;
    FReport.AddPair('passed',TJSONBool.Create(False)).AddPair('failedPhase',TJSONNumber.Create(FPhase)).AddPair('error',E.Message); Save;
  end; end;
  finally FInTick:=False; end;
end;
procedure StartIdeFixtureAcceptance;
begin
  if (Fixture=nil) and (GetEnvironmentVariable('PIAGENT_RAD_SDK_AUTORUN')='1') and
    (GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH')<>'') then Fixture:=TIdeFixture.Create(nil);
end;
initialization
  Fixture:=nil;
finalization
  Fixture.Free;
end.
