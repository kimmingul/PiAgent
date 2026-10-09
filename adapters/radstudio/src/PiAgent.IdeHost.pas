unit PiAgent.IdeHost;
interface
uses System.JSON, PiAgent.IdeBuild, PiAgent.ExternalBuild, PiAgent.IdeTests, PiAgent.IdeProfile;
type
  TPiIdeHost = class
  private
    FBuild: TPiIdeBuild;
    FBuildLifetime: IInterface;
    FExternal: TPiExternalBuild;
    FTests: TPiIdeTests;
    FProfile: TPiIdeProfile;
  public
    constructor Create;
    destructor Destroy; override;
    function Catalog(const Workspace: string): TJSONObject;
    function Execute(const Frame: TJSONObject; const Workspace: string): TJSONObject;
    function Poll: TJSONObject;
    procedure Cancel(const RequestId: string);
  end;
implementation
uses System.SysUtils, System.DateUtils, System.Hash, ToolsAPI, PiAgent.IdeContext, PiAgent.IdeDebug, PiAgent.Designer, PiAgent.IdeRun;
constructor TPiIdeHost.Create;
begin inherited; FBuild:=TPiIdeBuild.Create; FBuildLifetime:=FBuild; FExternal:=TPiExternalBuild.Create; FTests:=TPiIdeTests.Create; FProfile:=TPiIdeProfile.Create; end;
destructor TPiIdeHost.Destroy;
begin FProfile.Free; FTests.Free; FExternal.Free; FBuild.Cancel(''); FBuild.Detach; FBuildLifetime:=nil; FBuild:=nil; inherited; end;
function TPiIdeHost.Catalog(const Workspace: string): TJSONObject;
var Context,Designer,Parameters: TJSONObject; Entries,DesignerOps: TJSONArray;
  Services: IOTACompileServices; Dirty,Compiling: Boolean; Revision,Operation,Reason: string;
  Documents: TJSONArray; I: Integer;
  procedure Add(const Tool,Operation,Availability,Reason,Backend: string);
  var Entry: TJSONObject;
  begin
    Entry:=TJSONObject.Create.AddPair('tool',Tool).AddPair('availability',Availability)
      .AddPair('backend',Backend);
    if Tool.StartsWith('ide_designer_') or (Tool='ide_tests') or (Tool='ide_diagnostics') then
      Entry.AddPair('languages',TJSONArray.Create.Add('Delphi'))
    else Entry.AddPair('languages',TJSONArray.Create.Add('Delphi').Add('C++Builder'));
    if Operation<>'' then Entry.AddPair('operation',Operation);
    if Reason<>'' then Entry.AddPair('reason',Reason).AddPair('reasonCode','rad_scope');
    Entries.AddElement(Entry);
  end;
begin
  RequireIdeThread;
  Designer:=nil; Parameters:=TJSONObject.Create;
  try try Designer:=ExecuteDesigner('inspect',Parameters,Workspace); except end; finally Parameters.Free; end;
  try Context:=IdeContext(Workspace); except Designer.Free; raise; end;
  try
    Context.RemovePair('observedAt').Free;
    Dirty:=Context.GetValue<Boolean>('hasUnsavedBuffers',True); Documents:=Context.GetValue('documents') as TJSONArray;
    for I:=0 to Documents.Count-1 do Dirty:=Dirty or (Documents.Items[I] as TJSONObject).GetValue<Boolean>('modified',False);
    Compiling:=FBuild.Busy or FExternal.Busy or (Supports(BorlandIDEServices,IOTACompileServices,Services) and Services.IsBackgroundCompileActive);
    Context.AddPair('compiling',TJSONBool.Create(Compiling));
    Context.AddPair('testing',TJSONBool.Create(FTests.Busy)).AddPair('profiling',TJSONBool.Create(FProfile.Busy));
    Context.AddPair('debugState',DebugStateRevision(Workspace));
    if Designer<>nil then Context.AddPair('designerRevision',Designer.GetValue<string>('revision',''));
    Revision:=THashSHA2.GetHashString(Context.ToJSON);
  finally Context.Free; end;
  Entries:=TJSONArray.Create;
  Result:=TJSONObject.Create.AddPair('schemaVersion',TJSONNumber.Create(1))
    .AddPair('implementationVersion','0.11.0')
    .AddPair('workspaceUri',Workspace).AddPair('revision',Revision)
    .AddPair('capturedAt',DateToISO8601(Now,False)).AddPair('entries',Entries);
  Add('ide_context','','supported','','ToolsAPI');
  for Revision in ['snapshot','configurations','projects','documents'] do Add('ide_context',Revision,'supported','','ToolsAPI');
  Add('ide_context','dependencies','partial','Native project-group dependency graph and project items; semantic unit/import dependencies unavailable','ToolsAPI');
  if not Supports(BorlandIDEServices,IOTACompileServices,Services) then
    Revision:='IDE compile services unavailable'
  else if Compiling then Revision:='An IDE compile is already running'
  else if FTests.Busy then Revision:='An adapter test run is already running'
  else if Dirty then Revision:='Save unsaved IDE buffers before execution'
  else Revision:='';
  if Revision='' then begin
    Add('ide_build','build','supported','','ToolsAPI CompileProjects');
    Add('ide_build','rebuild','supported','','ToolsAPI CompileProjects');
  end else begin
    Add('ide_build','build','blocked',Revision,'ToolsAPI CompileProjects');
    Add('ide_build','rebuild','blocked',Revision,'ToolsAPI CompileProjects');
  end;
  Add('ide_build','clean','unavailable','Public native clean operation is not implemented','ToolsAPI');
  if FExternal.Available(Workspace,Reason) then
    Add('ide_diagnostics','','partial','Latest completed active Delphi external MSBuild diagnostics only; native compiler message enumeration unavailable','external UTF8 build log')
  else Add('ide_diagnostics','','blocked',Reason,'external UTF8 build log');
  Add('ide_symbols','','unavailable','No verified public semantic query/refactor service','ToolsAPI');
  Add('ide_tests','discover','unavailable','Public DUnitX discovery-only command is not implemented','DUnitX');
  if FTests.Available(Workspace,Reason) and not Dirty and not Compiling and not FTests.Busy then
    Add('ide_tests','run','partial','Existing built DUnitX NUnit XML console runner; no implicit build or Test Explorer state','DUnitX')
  else begin
    if Reason='' then
      if Dirty then Reason:='Save unsaved IDE buffers before execution'
      else if Compiling then Reason:='An IDE compile is already running'
      else if FTests.Busy then Reason:='An adapter test run is already running';
    Add('ide_tests','run','blocked',Reason,'DUnitX');
  end;
  for Operation in ['snapshot','breakpoints','threads','breakpoint','removeBreakpoint','enableBreakpoint','pause','selectThread','start','continue','stepOver','stepInto','stepOut','stop','evaluate'] do
    if DebugAvailability(Workspace,Operation,Reason) then
      Add('ide_debug',Operation,'partial','Bounded stack and explicit side-effect-free evaluation; locals and run parameters unavailable','ToolsAPI')
    else Add('ide_debug',Operation,'blocked',Reason,'ToolsAPI');
  Add('ide_profile','cpu','partial','Bound project executable only; bounded Windows process CPU counters without function stacks','Windows GetProcessTimes');
  Add('ide_profile','compare','partial','Compare normalized process CPU counters with a same-project/configuration in-memory trace','Windows GetProcessTimes');
  Add('ide_profile','gc','unavailable','Delphi GC/event allocation profiling is unavailable','Windows GetProcessTimes');
  Add('ide_run','inspect','partial','Read selected configuration/output/deployment metadata; no remote execution or publish','DeploymentAPI');
  Add('ide_run','publish-preview','unavailable','No verified isolated RAD publish backend','DeploymentAPI');
  Add('ide_run','publish','unavailable','Native deployment completion/cancellation is unverified','DeploymentAPI');
  try
    if Designer<>nil then begin
      DesignerOps:=Designer.GetValue('supportedOperations') as TJSONArray;
      for I:=0 to DesignerOps.Count-1 do if DesignerOps.Items[I].Value='previewChange' then begin
        for Operation in ['ide_designer_preview_change','ide_designer_apply_change','ide_designer_preview_restore','ide_designer_restore_change'] do
          Add(Operation,'','partial','Saved direct Delphi VCL/FMX forms, exact standard classes and leaf changes; reviewed source/form checkpoint recovery','ToolsAPI + durable source/form checkpoint');
        Break;
      end;
    end;
  finally Designer.Free; end;
end;
function TPiIdeHost.Execute(const Frame: TJSONObject; const Workspace: string): TJSONObject;
var Operation,Id: string; Args,Expected,Current,Payload: TJSONObject;
begin
  RequireIdeThread; Result:=nil; Id:=Frame.GetValue<string>('id','');
  Operation:=Frame.GetValue<string>('operation','');
  Args:=Frame.GetValue('args') as TJSONObject;
  if Args=nil then raise Exception.Create('IDE arguments unavailable');
  if Operation='ide_catalog' then Payload:=Catalog(Workspace)
  else begin
    Expected:=Frame.GetValue('expectedState') as TJSONObject;
    if (Operation='ide_build') or (Operation='ide_tests') or (Operation='ide_profile') or ((Operation='ide_debug') and not
      ((Args.GetValue<string>('operation','')='snapshot') or (Args.GetValue<string>('operation','')='breakpoints') or (Args.GetValue<string>('operation','')='threads'))) then begin
      if Expected=nil then raise Exception.Create('IDE request state is missing');
      Current:=Catalog(Workspace);
      try
        if (Expected.GetValue<string>('workspaceUri','')<>Workspace) or
          (Expected.GetValue<string>('revision','')<>Current.GetValue<string>('revision','')) then
          raise Exception.Create('IDE state changed; refresh context and approve again');
      finally Current.Free; end;
    end;
    if Operation='ide_context' then begin
      Payload:=IdeContext(Workspace);
    end else if Operation='ide_build' then begin
      if FBuild.Busy or FExternal.Busy or FTests.Busy then raise Exception.Create('PiAgent already owns a build/test');
      if Args.GetValue<string>('backend','native')='external' then begin FExternal.Start(Id,Workspace,Args); Exit(nil); end;
      Exit(FBuild.Start(Id,Workspace,Args));
    end
    else if Operation='ide_tests' then begin
      if FBuild.Busy or FExternal.Busy or FTests.Busy then raise Exception.Create('PiAgent already owns a build/test');
      FTests.Start(Id,Workspace,Args); Exit(nil);
    end
    else if Operation='ide_profile' then begin FProfile.Start(Id,Workspace,Args); Exit(nil); end
    else if Operation='ide_diagnostics' then Payload:=FExternal.Diagnostics(Workspace)
    else if Operation='ide_run' then Payload:=InspectIdeRun(Workspace,Args)
    else if Operation='ide_debug' then Payload:=ExecuteIdeDebug(Workspace,Args)
    else raise Exception.Create('RAD IDE operation is unavailable: '+Operation);
  end;
  Result:=TJSONObject.Create.AddPair('action','ideReply').AddPair('requestId',Id).AddPair('result',Payload);
end;
function TPiIdeHost.Poll: TJSONObject;
begin Result:=FBuild.Poll; if Result=nil then Result:=FExternal.Poll; if Result=nil then Result:=FTests.Poll; if Result=nil then Result:=FProfile.Poll; end;
procedure TPiIdeHost.Cancel(const RequestId: string);
begin FBuild.Cancel(RequestId); FExternal.Cancel(RequestId); FTests.Cancel(RequestId); FProfile.Cancel(RequestId); end;
end.
