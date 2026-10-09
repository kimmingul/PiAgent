unit PiAgent.IdeTests;
interface
uses System.JSON, PiAgent.OwnedProcess;
type TPiIdeTests=class
private
  FRun: TPiOwnedProcess;
  FId,FWorkspace,FProject,FConfiguration,FPlatform,FReport: string;
  FSuppressed: Boolean;
public
  destructor Destroy; override;
  function Available(const Workspace: string; out Reason: string): Boolean;
  procedure Start(const Id,Workspace: string; Args: TJSONObject);
  function Poll: TJSONObject;
  function Busy: Boolean;
  procedure Cancel(const Id: string);
end;
implementation
uses System.SysUtils, System.IOUtils, System.RegularExpressions, ToolsAPI,
  PiAgent.IdeContext, PiAgent.IdeDebug, PiAgent.TestResults, PiAgent.TestArguments;
function TPiIdeTests.Busy: Boolean;
begin Result:=FRun<>nil; end;
destructor TPiIdeTests.Destroy;
begin FRun.Free; inherited; end;
function TPiIdeTests.Available(const Workspace: string; out Reason: string): Boolean;
var Project: IOTAProject; Source,Text,Output: string;
begin
  Result:=False; Reason:='Select a built DUnitX console project using command-line options and the NUnit XML logger';
  try
    Project:=GetActiveProject; if Project=nil then Exit;
    Source:=ResolveIdeFile(Workspace,ChangeFileExt(Project.FileName,'.dpr'));
    if not FileExists(Source) or (TFile.GetSize(Source)>65536) then Exit;
    Text:=LowerCase(TFile.ReadAllText(Source,TEncoding.UTF8));
    if not (Text.Contains('apptype console') and Text.Contains('dunitx.testframework') and
      Text.Contains('dunitx.loggers.xml.nunit') and Text.Contains('checkcommandline') and Text.Contains('tdunitx.options.xmloutputfile')) then Exit;
    Output:=DebugOutputFile(Workspace);
    Result:=(Output<>'') and FileExists(Output) and SameText(ExtractFileExt(Output),'.exe') and not Busy;
    if Result then Reason:='';
  except on E:Exception do Reason:=E.Message; end;
end;
procedure TPiIdeTests.Start(const Id,Workspace: string; Args: TJSONObject);
var Project: IOTAProject; Reason,Filter: string; Arguments: TArray<string>; Guid: TGUID; Timeout: Integer;
begin
  RequireIdeThread; RequireSavedIdeBuffers;
  if Args.GetValue<string>('operation','run')<>'run' then raise Exception.Create('DUnitX test discovery is not implemented');
  if not Available(Workspace,Reason) then raise Exception.Create(Reason);
  if (Args.GetValue<string>('framework','')<>'') and not SameText(Args.GetValue<string>('framework',''),'DUnitX') then raise Exception.Create('Only DUnitX is supported');
  if Args.GetValue<string>('settings','')<>'' then raise Exception.Create('DUnitX arbitrary settings files are unsupported');
  Project:=GetActiveProject; FProject:=Project.FileName; FConfiguration:=Project.CurrentConfiguration; FPlatform:=Project.CurrentPlatform;
  if (Args.GetValue<string>('project','')<>'') and not SameText(ResolveIdeFile(Workspace,Args.GetValue<string>('project','')),FProject) then raise Exception.Create('Select the requested test project first');
  if (Args.GetValue<string>('configuration','')<>'') and (Args.GetValue<string>('configuration','')<>FConfiguration) then raise Exception.Create('Select the requested test configuration first');
  Filter:=Args.GetValue<string>('filter','');
  if not DUnitXFilterValid(Filter) then raise Exception.Create('Unsupported DUnitX test-name filter');
  Timeout:=Args.GetValue<Integer>('timeoutSeconds',120); if (Timeout<60) or (Timeout>150) then raise Exception.Create('Test timeout must be 60..150 seconds');
  CreateGUID(Guid); FReport:=TPath.Combine(GetEnvironmentVariable('LOCALAPPDATA'),'PiAgent\tests\'+GUIDToString(Guid)+'\results.xml'); ForceDirectories(ExtractFileDir(FReport));
  Arguments:=TArray<string>.Create('--xmlfile:'+FReport,'--exitbehavior:Continue','--consolemode:Quiet');
  if Filter<>'' then Arguments:=Arguments+TArray<string>.Create('--run:'+Filter);
  FRun:=TPiOwnedProcess.Create(DebugOutputFile(Workspace),Arguments,ExtractFileDir(FProject),Timeout*1000);
  FId:=Id; FWorkspace:=Workspace; FSuppressed:=False; FRun.Start;
end;
procedure TPiIdeTests.Cancel(const Id: string);
begin if (FRun<>nil) and ((Id='') or (Id=FId)) then begin FSuppressed:=True; FRun.Cancel; end; end;
function TPiIdeTests.Poll: TJSONObject;
var Project: IOTAProject; Payload,Report: TJSONObject;
begin
  RequireIdeThread; Result:=nil; if FRun=nil then Exit;
  Project:=GetActiveProject;
  if (Project=nil) or not SameText(Project.FileName,FProject) or (Project.CurrentConfiguration<>FConfiguration) or (Project.CurrentPlatform<>FPlatform) then Cancel(FId);
  if not FRun.Finished then Exit; FRun.WaitFor;
  try
    if FSuppressed then Exit;
    Payload:=TJSONObject.Create.AddPair('executed',TJSONBool.Create(FRun.Error='')).AddPair('framework','DUnitX')
      .AddPair('exitCode',TJSONNumber.Create(Int64(FRun.Code))).AddPair('output',FRun.Output)
      .AddPair('truncated',TJSONBool.Create(FRun.Truncated)).AddPair('timedOut',TJSONBool.Create(FRun.TimedOut))
      .AddPair('project',FProject).AddPair('configuration',FConfiguration).AddPair('platform',FPlatform);
    try
      try
        if not FileExists(FReport) or (TFile.GetSize(FReport)>1048576) then raise Exception.Create('Actual NUnit report is unavailable/too large');
        Report:=ParseNUnitResults(TFile.ReadAllText(FReport,TEncoding.UTF8));
        Payload.AddPair('success',TJSONBool.Create((FRun.Code=0) and not FRun.TimedOut and (FRun.Error='') and
          (Report.GetValue<Integer>('errors',1)=0) and (Report.GetValue<Integer>('failures',1)=0))).AddPair('results',Report);
      except on E:Exception do Payload.AddPair('success',TJSONBool.Create(False)).AddPair('resultUnavailable',E.Message); end;
      Result:=TJSONObject.Create.AddPair('action','ideReply').AddPair('requestId',FId).AddPair('result',Payload);
    except Payload.Free; raise; end;
  finally FreeAndNil(FRun); end;
end;
end.
