unit PiAgent.IdeProfile;
interface
uses System.JSON, PiAgent.ProcessCpu;
type TPiIdeProfile=class
private
  FRun: TPiProcessCpu;
  FId,FWorkspace,FProject,FConfiguration,FPlatform,FBaseline: string;
public
  destructor Destroy; override;
  procedure Start(const Id,Workspace: string; Args: TJSONObject);
  function Poll: TJSONObject;
  procedure Cancel(const Id: string);
  function Busy: Boolean;
end;
implementation
uses System.SysUtils, System.Generics.Collections, ToolsAPI, PiAgent.IdeContext, PiAgent.IdeDebug;
var Traces: TObjectDictionary<string,TJSONObject>;
function TPiIdeProfile.Busy: Boolean;
begin Result:=FRun<>nil; end;
destructor TPiIdeProfile.Destroy;
begin FRun.Free; inherited; end;
procedure TPiIdeProfile.Cancel(const Id: string);
begin if (Id='') or (Id=FId) then FreeAndNil(FRun); end;
procedure TPiIdeProfile.Start(const Id,Workspace: string; Args: TJSONObject);
var Project: IOTAProject; Baseline: TJSONObject; Operation: string;
begin
  RequireIdeThread; if Busy then raise Exception.Create('CPU measurement is already running');
  Operation:=Args.GetValue<string>('operation','cpu');
  if not ((Operation='cpu') or (Operation='compare')) then raise Exception.Create('Only Windows process CPU counter measurement is supported');
  Project:=GetActiveProject; if Project=nil then raise Exception.Create('Select the target project first');
  FProject:=ResolveIdeFile(Workspace,Project.FileName); FConfiguration:=Project.CurrentConfiguration; FPlatform:=Project.CurrentPlatform;
  FBaseline:=Args.GetValue<string>('baselineTrace','');
  if Operation='compare' then begin
    if not Traces.TryGetValue(FBaseline,Baseline) or (Baseline.GetValue<string>('workspaceUri','')<>Workspace) or
      not SameText(Baseline.GetValue<string>('project',''),FProject) or
      (Baseline.GetValue<string>('configuration','')<>FConfiguration) or (Baseline.GetValue<string>('platform','')<>FPlatform) then
      raise Exception.Create('CPU baseline is unavailable or belongs to a different project/configuration');
  end else if FBaseline<>'' then raise Exception.Create('A baseline is accepted only for compare');
  FRun:=TPiProcessCpu.Create(Args.GetValue<Integer>('processId',0),DebugOutputFile(Workspace),Args.GetValue<Integer>('durationSeconds',5));
  FId:=Id; FWorkspace:=Workspace;
end;
function TPiIdeProfile.Poll: TJSONObject;
var Project: IOTAProject; Payload,Baseline: TJSONObject; Guid: TGUID; TraceId: string;
begin
  RequireIdeThread; Result:=nil; if FRun=nil then Exit;
  Project:=GetActiveProject;
  if (Project=nil) or not SameText(Project.FileName,FProject) or (Project.CurrentConfiguration<>FConfiguration) or (Project.CurrentPlatform<>FPlatform) then begin Cancel(FId); Exit; end;
  try
    Payload:=FRun.Poll; if Payload=nil then Exit;
    try
      CreateGUID(Guid); TraceId:=GUIDToString(Guid);
      Payload.AddPair('traceId',TraceId).AddPair('workspaceUri',FWorkspace).AddPair('project',FProject)
        .AddPair('configuration',FConfiguration).AddPair('platform',FPlatform);
      if (FBaseline<>'') and Traces.TryGetValue(FBaseline,Baseline) then
        Payload.AddPair('baselineTrace',FBaseline).AddPair('baselineSingleCorePercent',TJSONNumber.Create(Baseline.GetValue<Double>('singleCorePercent',0)))
          .AddPair('singleCorePercentDelta',TJSONNumber.Create(Payload.GetValue<Double>('singleCorePercent',0)-Baseline.GetValue<Double>('singleCorePercent',0)));
      if Traces.Count>=16 then Traces.Clear;
      Traces.Add(TraceId,TJSONObject(Payload.Clone));
      Result:=TJSONObject.Create.AddPair('action','ideReply').AddPair('requestId',FId).AddPair('result',Payload);
    except Payload.Free; raise; end;
    FreeAndNil(FRun);
  except on E:Exception do begin FreeAndNil(FRun); Result:=TJSONObject.Create.AddPair('action','ideReply').AddPair('requestId',FId).AddPair('error',E.Message); end; end;
end;
initialization
  Traces:=TObjectDictionary<string,TJSONObject>.Create([doOwnsValues]);
finalization
  Traces.Free;
end.
