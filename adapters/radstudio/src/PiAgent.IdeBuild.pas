unit PiAgent.IdeBuild;
interface
uses System.SysUtils, System.Classes, System.JSON, ToolsAPI;
type
  TPiIdeBuild = class(TInterfacedObject, IOTACompileNotifier)
  private
    FLock: TObject;
    FServices: IOTACompileServices;
    FProject: IOTAProject;
    FNotifier: Integer;
    FRequestId,FProjectFile,FWorkspace,FConfiguration,FPlatform: string;
    FStarted: UInt64;
    FDone,FCancelled,FReplySuppressed: Boolean;
    FResult: TOTACompileResult;
    procedure ProjectCompileStarted(const Project: IOTAProject; Mode: TOTACompileMode);
    procedure ProjectCompileFinished(const Project: IOTAProject; Result: TOTACompileResult);
    procedure ProjectGroupCompileStarted(Mode: TOTACompileMode);
    procedure ProjectGroupCompileFinished(Result: TOTACompileResult);
  public
    constructor Create;
    destructor Destroy; override;
    function Start(const RequestId,Workspace: string; Args: TJSONObject): TJSONObject;
    function Poll: TJSONObject;
    procedure Cancel(const RequestId: string);
    procedure Detach;
    function Busy: Boolean;
  end;
implementation
uses Winapi.Windows, PiAgent.IdeContext;
constructor TPiIdeBuild.Create;
begin inherited; FLock := TObject.Create; FNotifier := -1; end;
destructor TPiIdeBuild.Destroy;
begin Detach; FLock.Free; inherited; end;
function TPiIdeBuild.Busy: Boolean;
begin TMonitor.Enter(FLock); try Result := FRequestId<>''; finally TMonitor.Exit(FLock); end; end;
procedure TPiIdeBuild.ProjectCompileStarted(const Project: IOTAProject; Mode: TOTACompileMode);
begin end;
procedure TPiIdeBuild.ProjectCompileFinished(const Project: IOTAProject; Result: TOTACompileResult);
begin
  // Background callbacks record scalar state only; the timer performs SDK work and replies.
  TMonitor.Enter(FLock);
  try if (FRequestId<>'') and (Project=FProject) then begin FResult:=Result; FDone:=True; end;
  finally TMonitor.Exit(FLock); end;
end;
procedure TPiIdeBuild.ProjectGroupCompileStarted(Mode: TOTACompileMode);
begin end;
procedure TPiIdeBuild.ProjectGroupCompileFinished(Result: TOTACompileResult);
begin end;
function TPiIdeBuild.Start(const RequestId,Workspace: string; Args: TJSONObject): TJSONObject;
var Mode: TOTACompileMode; Outcome: TOTACompileResult; Operation: string;
begin
  RequireIdeThread;
  if Busy then raise Exception.Create('PiAgent already owns a build');
  if not Supports(BorlandIDEServices,IOTACompileServices,FServices) then
    raise Exception.Create('IDE compile services unavailable');
  if FServices.IsBackgroundCompileActive then raise Exception.Create('Another IDE compile is running');
  RequireSavedIdeBuffers;
  FProject := GetActiveProject;
  if FProject=nil then raise Exception.Create('Open a project first');
  ResolveIdeFile(Workspace,FProject.FileName);
  if (Args.GetValue<string>('project','')<>'') and
    not SameText(ResolveIdeFile(Workspace,Args.GetValue<string>('project','')),FProject.FileName) then
    raise Exception.Create('Only the active project can be built');
  if ((Args.GetValue<string>('configuration','')<>'') and
    (Args.GetValue<string>('configuration','')<>FProject.CurrentConfiguration)) or
    ((Args.GetValue<string>('platform','')<>'') and
    (Args.GetValue<string>('platform','')<>FProject.CurrentPlatform)) then
    raise Exception.Create('Select the requested configuration/platform in the IDE before building');
  Operation := Args.GetValue<string>('operation','build');
  if (Operation='rebuild') or Args.GetValue<Boolean>('rebuild',False) then Mode:=cmOTABuild
  else if Operation='build' then Mode:=cmOTAMake
  else raise Exception.Create('RAD build supports build/rebuild; clean is unavailable');
  FNotifier:=FServices.AddNotifier(Self);
  if FNotifier<0 then raise Exception.Create('Cannot register compile notifier');
  TMonitor.Enter(FLock);
  try
    FRequestId:=RequestId; FWorkspace:=Workspace; FProjectFile:=FProject.FileName;
    FConfiguration:=FProject.CurrentConfiguration; FPlatform:=FProject.CurrentPlatform;
    FStarted:=GetTickCount64; FDone:=False; FCancelled:=False; FReplySuppressed:=False;
  finally TMonitor.Exit(FLock); end;
  try
    Outcome:=FServices.CompileProjects([FProject],Mode,False,False);
    if Outcome<>crOTABackground then begin
      TMonitor.Enter(FLock); try FResult:=Outcome; FDone:=True; finally TMonitor.Exit(FLock); end;
    end;
    Result:=Poll; // nil means a real notifier completion is pending.
  except Detach; raise; end;
end;
procedure TPiIdeBuild.Cancel(const RequestId: string);
begin
  RequireIdeThread;
  if (FRequestId='') or ((RequestId<>'') and (RequestId<>FRequestId)) then Exit;
  FReplySuppressed:=True;
  if (FServices<>nil) and FServices.IsBackgroundCompileActive then begin
    FCancelled:=FServices.CancelBackgroundCompile(False);
    if FCancelled then begin TMonitor.Enter(FLock);try FDone:=True; finally TMonitor.Exit(FLock);end;end;
  end;
end;
procedure TPiIdeBuild.Detach;
begin
  RequireIdeThread;
  TMonitor.Enter(FLock); try FRequestId:=''; finally TMonitor.Exit(FLock); end;
  if FNotifier>=0 then begin
    FServices.RemoveNotifier(FNotifier); FNotifier:=-1;
  end;
  TMonitor.Enter(FLock); try FProject:=nil; finally TMonitor.Exit(FLock); end;
  FServices:=nil;
end;
function TPiIdeBuild.Poll: TJSONObject;
var Done,Changed,Suppressed: Boolean; Outcome: TOTACompileResult; Active: IOTAProject;
  Payload: TJSONObject; State,Id: string;
begin
  RequireIdeThread; Result:=nil;
  if not Busy then Exit;
  Active:=GetActiveProject; Changed:=(Active=nil) or not SameText(Active.FileName,FProjectFile);
  if Active<>nil then Changed:=Changed or (Active.CurrentConfiguration<>FConfiguration) or (Active.CurrentPlatform<>FPlatform);
  if Changed or (GetTickCount64-FStarted>170000) then begin
    Suppressed:=FReplySuppressed;
    Cancel(FRequestId);
    // Even if cancellation cannot stop a synchronous/already completed compile, do not
    // associate its result with a different project or claim it was cancelled.
    Id:=FRequestId; Detach;
    if Suppressed then Exit;
    Exit(TJSONObject.Create.AddPair('action','ideReply').AddPair('requestId',Id)
      .AddPair('error','Build target changed or timed out; inspect IDE build state before retrying'));
  end;
  TMonitor.Enter(FLock); try Done:=FDone; Outcome:=FResult; finally TMonitor.Exit(FLock); end;
  if not Done then Exit;
  if FReplySuppressed then begin Detach; Exit; end;
  State:='failed'; if Outcome=crOTASucceeded then State:='completed';
  if FCancelled then State:='cancelled';
  Payload:=TJSONObject.Create.AddPair('executed',TJSONBool.Create(True))
    .AddPair('success',TJSONBool.Create((Outcome=crOTASucceeded) and not FCancelled))
    .AddPair('state',State).AddPair('source','RAD Studio ToolsAPI compile notifier')
    .AddPair('project',FProjectFile).AddPair('configuration',FConfiguration)
    .AddPair('platform',FPlatform).AddPair('workspaceUri',FWorkspace)
    .AddPair('diagnostics',TJSONObject.Create.AddPair('available',TJSONBool.Create(False))
      .AddPair('reason','Public ToolsAPI does not expose compiler message enumeration; inspect IDE build output'));
  Result:=TJSONObject.Create.AddPair('action','ideReply').AddPair('requestId',FRequestId)
    .AddPair('result',Payload);
  Detach;
end;
end.
