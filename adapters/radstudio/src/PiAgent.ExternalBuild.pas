unit PiAgent.ExternalBuild;
interface
uses System.JSON, PiAgent.OwnedProcess;
type
  TPiExternalBuild = class
  private
    FRun: TPiOwnedProcess;
    FId,FWorkspace,FProject,FNativeProject,FPersonality,FConfiguration,FPlatform,FLog: string;
    FSuppressed: Boolean;
    FLastDiagnostics: TJSONObject;
  public
    destructor Destroy; override;
    procedure Start(const Id,Workspace: string; Args: TJSONObject);
    function Poll: TJSONObject;
    procedure Cancel(const Id: string);
    function Busy: Boolean;
    function Diagnostics(const Workspace: string): TJSONObject;
    function Available(const Workspace: string; out Reason: string): Boolean;
  end;
implementation
uses System.SysUtils, System.IOUtils, System.DateUtils, System.RegularExpressions, Winapi.Windows,
  ToolsAPI, PiAgent.IdeContext, PiAgent.BuildCommand, PiAgent.BuildDiagnostics, PiAgent.ProjectIdentity;
function TPiExternalBuild.Busy: Boolean;
begin Result:=FRun<>nil; end;
destructor TPiExternalBuild.Destroy;
begin FLastDiagnostics.Free; FRun.Free; inherited; end;
function TPiExternalBuild.Available(const Workspace: string; out Reason: string): Boolean;
var Project: IOTAProject; Dproj: string;
begin
  RequireIdeThread; Result:=False; Reason:='Open a saved Delphi .dproj/.dpr project for the external backend';
  try
    Project:=GetActiveProject; if Project=nil then Exit;
    Dproj:=RequireExternalDelphiProject(ResolveIdeFile(Workspace,Project.FileName),Project.Personality);
    ResolveIdeFile(Workspace,Dproj);
    if not FileExists(Dproj) then begin Reason:='Active Delphi .dproj is unavailable'; Exit; end;
    Result:=True; Reason:='';
  except on E:Exception do Reason:=E.Message; end;
end;
function TPiExternalBuild.Diagnostics(const Workspace: string): TJSONObject;
var Project: IOTAProject; NativeProject,Dproj,Reason: string;
begin
  RequireIdeThread;
  if not Available(Workspace,Reason) then
    Exit(TJSONObject.Create.AddPair('available',TJSONBool.Create(False)).AddPair('reason',Reason));
  Project:=GetActiveProject; NativeProject:=ResolveIdeFile(Workspace,Project.FileName);
  Dproj:=RequireExternalDelphiProject(NativeProject,Project.Personality);
  if (FLastDiagnostics=nil) or (Project=nil) or
    (FLastDiagnostics.GetValue<string>('workspaceUri','')<>Workspace) or
    not SameText(FLastDiagnostics.GetValue<string>('project',''),Dproj) or
    not SameText(FLastDiagnostics.GetValue<string>('nativeProject',''),NativeProject) or
    not SameText(FLastDiagnostics.GetValue<string>('personality',''),Project.Personality) or
    (FLastDiagnostics.GetValue<string>('configuration','')<>Project.CurrentConfiguration) or
    (FLastDiagnostics.GetValue<string>('platform','')<>Project.CurrentPlatform) then
    Exit(TJSONObject.Create.AddPair('available',TJSONBool.Create(False)).AddPair('reason','No completed external build diagnostics for the current project/configuration/platform'));
  Result:=TJSONObject(FLastDiagnostics.Clone);
end;
procedure TPiExternalBuild.Cancel(const Id: string);
begin if (FRun<>nil) and ((Id='') or (Id=FId)) then begin FSuppressed:=True; FRun.Cancel; end; end;
procedure TPiExternalBuild.Start(const Id,Workspace: string; Args: TJSONObject);
var Project: IOTAProject; Services: IOTACompileServices; BdsRoot,Target: string;
  Executable: array[0..32767] of Char; Guid: TGUID;
begin
  RequireIdeThread;
  if Busy then raise Exception.Create('An external build is already running');
  if Supports(BorlandIDEServices,IOTACompileServices,Services) and Services.IsBackgroundCompileActive then
    raise Exception.Create('Another native IDE compile is running');
  RequireSavedIdeBuffers; Project:=GetActiveProject;
  if Project=nil then raise Exception.Create('Open a saved project first');
  FNativeProject:=ResolveIdeFile(Workspace,Project.FileName); FPersonality:=Project.Personality;
  FProject:=RequireExternalDelphiProject(FNativeProject,FPersonality);
  if not FileExists(FProject) then raise Exception.Create('External build requires the active Delphi .dproj');
  ResolveIdeFile(Workspace,FProject);
  if (Args.GetValue<string>('project','')<>'') and not SameText(
    RequireExternalDelphiProject(ResolveIdeFile(Workspace,Args.GetValue<string>('project','')),FPersonality),FProject) then
    raise Exception.Create('Only the active project can be built');
  FConfiguration:=Project.CurrentConfiguration; FPlatform:=Project.CurrentPlatform;
  if ((Args.GetValue<string>('configuration','')<>'') and (Args.GetValue<string>('configuration','')<>FConfiguration)) or
    ((Args.GetValue<string>('platform','')<>'') and (Args.GetValue<string>('platform','')<>FPlatform)) then
    raise Exception.Create('Select the requested configuration/platform in the IDE first');
  GetModuleFileName(0,Executable,Length(Executable));
  if not SameText(ExtractFileName(string(Executable)),'bds.exe') then raise Exception.Create('External build requires a RAD Studio host');
  BdsRoot:=TPath.GetFullPath(TPath.Combine(ExtractFileDir(string(Executable)),'..'));
  if not FileExists(TPath.Combine(BdsRoot,'bin\CodeGear.Delphi.Targets')) then raise Exception.Create('RAD build targets unavailable');
  Target:='Make'; if (Args.GetValue<string>('operation','build')='rebuild') or Args.GetValue<Boolean>('rebuild',False) then Target:='Build';
  if Args.GetValue<string>('operation','build')='clean' then raise Exception.Create('External clean is not supported');
  CreateGUID(Guid); FLog:=TPath.Combine(GetEnvironmentVariable('LOCALAPPDATA'),
    'PiAgent\diagnostics\'+GUIDToString(Guid)+'\build.log'); ForceDirectories(ExtractFileDir(FLog));
  FRun:=TPiOwnedProcess.Create(FindMsBuild,RadBuildArguments(FProject,FConfiguration,FPlatform,BdsRoot,FLog,Target),ExtractFileDir(FProject),120000,['BDS='+BdsRoot]);
  FId:=Id; FWorkspace:=Workspace; FSuppressed:=False; FRun.Start;
end;
function TPiExternalBuild.Poll: TJSONObject;
var Project: IOTAProject; Payload: TJSONObject; Rows: TJSONArray; Log,State,NativeProject,Dproj: string; LogAvailable,Matches: Boolean;
begin
  RequireIdeThread; Result:=nil; if FRun=nil then Exit;
  Project:=GetActiveProject;
  Matches:=False;
  try
    if Project<>nil then begin
      NativeProject:=ResolveIdeFile(FWorkspace,Project.FileName);
      Dproj:=RequireExternalDelphiProject(NativeProject,Project.Personality);
      Matches:=SameText(NativeProject,FNativeProject) and SameText(Project.Personality,FPersonality) and
        SameText(Dproj,FProject) and (Project.CurrentConfiguration=FConfiguration) and (Project.CurrentPlatform=FPlatform);
    end;
  except Matches:=False; end;
  if not Matches then Cancel(FId);
  if not FRun.Finished then Exit;
  FRun.WaitFor;
  try
    if FSuppressed then Exit;
    Log:=''; LogAvailable:=FileExists(FLog) and (TFile.GetSize(FLog)<=1048576);
    if LogAvailable then Log:=TFile.ReadAllText(FLog,TEncoding.UTF8);
    Rows:=ParseBuildDiagnostics(Log,function(const FileName: string): string
      begin Result:=ResolveIdeFile(FWorkspace,TPath.Combine(ExtractFileDir(FProject),FileName)); end);
    State:='failed'; if FRun.Code=0 then State:='completed'; if FRun.Cancelled then State:='cancelled'; if FRun.TimedOut then State:='unknown';
    Payload:=TJSONObject.Create.AddPair('executed',TJSONBool.Create(FRun.Error=''))
      .AddPair('success',TJSONBool.Create((FRun.Code=0) and (FRun.Error='') and not FRun.TimedOut and not FRun.Cancelled))
      .AddPair('state',State).AddPair('source','external').AddPair('backend','MSBuild / Delphi targets')
      .AddPair('project',FProject).AddPair('configuration',FConfiguration).AddPair('platform',FPlatform)
      .AddPair('nativeProject',FNativeProject).AddPair('personality',FPersonality)
      .AddPair('exitCode',TJSONNumber.Create(Int64(FRun.Code))).AddPair('logFile',FLog)
      .AddPair('output',FRun.Output).AddPair('truncated',TJSONBool.Create(FRun.Truncated))
      .AddPair('diagnosticLogAvailable',TJSONBool.Create(LogAvailable)).AddPair('error',FRun.Error).AddPair('diagnostics',Rows);
    FreeAndNil(FLastDiagnostics);
    FLastDiagnostics:=TJSONObject.Create.AddPair('available',TJSONBool.Create(LogAvailable)).AddPair('source','external')
      .AddPair('workspaceUri',FWorkspace).AddPair('project',FProject).AddPair('configuration',FConfiguration).AddPair('platform',FPlatform)
      .AddPair('nativeProject',FNativeProject).AddPair('personality',FPersonality)
      .AddPair('capturedAt',DateToISO8601(Now,False)).AddPair('mayBeStale',TJSONBool.Create(True))
      .AddPair('reason','Latest completed external build log; IDE and file changes may make these diagnostics stale')
      .AddPair('diagnostics',TJSONValue(Rows.Clone));
    try
      Result:=TJSONObject.Create.AddPair('action','ideReply').AddPair('requestId',FId).AddPair('result',Payload);
    except Payload.Free; raise; end;
  finally FreeAndNil(FRun); end;
end;
end.
