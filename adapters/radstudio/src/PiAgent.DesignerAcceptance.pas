unit PiAgent.DesignerAcceptance;
interface
procedure RunDesignerFixtureAcceptance;
function DesignerFixtureReady: Boolean;
implementation
uses System.SysUtils, System.DateUtils, System.JSON, System.IOUtils, System.NetEncoding, System.RegularExpressions,
  Vcl.Dialogs, ToolsAPI, PiAgent.Designer, PiAgent.DesignerAuthoring;

function DesignerFixtureReady: Boolean;
var Module: IOTAModule; Editor: IOTAFormEditor; Project: IOTAProject; Root: string; I: Integer;
begin
  Result:=False;
  Root:=GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH'); Project:=GetActiveProject;
  if (Root='') or (Project=nil) or not SameText(ExtractFileDir(Project.FileName),Root) then Exit;
  if not FileExists(TPath.Combine(Root,'.piagent-rad-fixture')) or
    (TFile.GetSize(TPath.Combine(Root,'.piagent-rad-fixture'))>128) or
    (Trim(TFile.ReadAllText(TPath.Combine(Root,'.piagent-rad-fixture'),TEncoding.UTF8))<>'piagent-rad-fixture-v1') then Exit;
  Module:=(BorlandIDEServices as IOTAModuleServices).CurrentModule;
  if (Module=nil) or not SameText(Module.FileName,TPath.Combine(Root,'Main.pas')) then
    Module:=(BorlandIDEServices as IOTAModuleServices).OpenModule(TPath.Combine(Root,'Main.pas'));
  if (Module=nil) or not DesignerAuthoringEnabled(Module) then Exit;
  for I:=0 to Module.ModuleFileCount-1 do begin
    if Module.ModuleFileEditors[I].Modified then Exit;
    if Supports(Module.ModuleFileEditors[I],IOTAFormEditor,Editor) then begin
      Editor.Show; Result:=Editor.GetRootComponent<>nil;
    end;
  end;
end;

procedure RunDesignerFixtureAcceptance;
var Project: IOTAProject; Module: IOTAModule; Workspace,Root,Original,CheckpointCreate,
  CheckpointBind,CheckpointDelete,CurrentStep,StageRoot: string; Report,Snapshot,Args,Preview,Applied: TJSONObject;
  Steps: TJSONArray; Guid: TGUID; Contract: TJSONObject;
  procedure SaveContract;
  begin
    TFile.WriteAllText(TPath.Combine(GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH'),'designer-contract.json'),Contract.ToJSON,TEncoding.UTF8);
  end;
  function Call(const Operation: string; Parameters: TJSONObject): TJSONObject;
  begin try Result:=ExecuteDesigner(Operation,Parameters,Workspace); finally Parameters.Free; end; end;
  procedure CaptureStage(const Operation: string);
  var Directory,FileName,Source,Resource: string; View,Component,Event: TJSONObject;
    Components,Events: TJSONArray; I,J: Integer; Found,Bound: Boolean;
  begin
    Directory:=TPath.Combine(StageRoot,Operation); ForceDirectories(Directory);
    Module:=(BorlandIDEServices as IOTAModuleServices).CurrentModule;
    Source:=''; Resource:='';
    for FileName in DesignerFiles(Module) do begin
      TFile.Copy(FileName,TPath.Combine(Directory,ExtractFileName(FileName)),True);
      if SameText(ExtractFileExt(FileName),'.pas') then Source:=TFile.ReadAllText(FileName,TEncoding.UTF8)
      else Resource:=TFile.ReadAllText(FileName,TEncoding.UTF8);
    end;
    TFile.Copy(Project.FileName,TPath.Combine(Directory,ExtractFileName(Project.FileName)),True);
    TFile.Copy(ChangeFileExt(Project.FileName,'.dpr'),TPath.Combine(Directory,ExtractFileName(ChangeFileExt(Project.FileName,'.dpr'))),True);
    View:=Call('inspect',TJSONObject.Create);
    try
      TFile.WriteAllText(TPath.Combine(Directory,'inspect.json'),View.ToJSON,TEncoding.UTF8);
      Components:=View.GetValue('components') as TJSONArray; Found:=False; Bound:=False;
      for I:=0 to Components.Count-1 do begin
        Component:=Components.Items[I] as TJSONObject;
        if Component.GetValue<string>('id','')<>'AgentFixtureButton' then Continue;
        Found:=True;
        if Component.GetValue<string>('type','')<>'TButton' then raise Exception.Create('Created fixture component has incorrect type');
        Events:=Component.GetValue('events') as TJSONArray;
        if Events<>nil then for J:=0 to Events.Count-1 do begin
          Event:=Events.Items[J] as TJSONObject;
          Bound:=Bound or ((Event.GetValue<string>('name','')='OnClick') and (Event.GetValue<string>('handler','')='AgentFixtureClick'));
        end;
      end;
      if (Operation='deleteComponent') and Found then raise Exception.Create('Deleted fixture component still exists');
      if (Operation<>'deleteComponent') and not Found then raise Exception.Create('Created fixture component is missing');
      if Operation='bindEvent' then begin
        if not Bound then raise Exception.Create('Native event handler binding is missing');
        if not TRegEx.IsMatch(Source,'procedure\s+TMainForm\.AgentFixtureClick\b',[roIgnoreCase]) then raise Exception.Create('Generated event implementation is missing');
        if not TRegEx.IsMatch(Resource,'OnClick\s*=\s*AgentFixtureClick\b') then raise Exception.Create('Saved form event binding is missing');
      end;
    finally View.Free; end;
  end;
  function Change(const Operation: string; Parameters: TJSONObject): string;
  begin
    CurrentStep:=Operation;
    Snapshot:=Call('inspect',TJSONObject.Create);
    try Parameters.AddPair('changeOperation',Operation).AddPair('document',Snapshot.GetValue<string>('document',''))
      .AddPair('revision',Snapshot.GetValue<string>('revision',''));
      if Contract.GetValue('changeInspect')=nil then Contract.AddPair('changeInspect',TJSONValue(Snapshot.Clone));
    finally Snapshot.Free; end;
    Preview:=Call('previewChange',Parameters);
    try
      if Contract.GetValue('change')=nil then begin
        Contract.AddPair('capturedAt',DateToISO8601(Now,False)).AddPair('changeCapturedAt',DateToISO8601(Now,False))
          .AddPair('change',TJSONValue(Preview.Clone)); SaveContract;
      end;
      Applied:=Call('applyChange',TJSONObject.Create.AddPair('document',Preview.GetValue<string>('document',''))
        .AddPair('revision',Preview.GetValue<string>('revision','')).AddPair('proposalId',Preview.GetValue<string>('proposalId','')));
      try Result:=Applied.GetValue<string>('checkpointId',''); finally Applied.Free; end;
      CaptureStage(Operation);
      Steps.AddElement(TJSONObject.Create.AddPair('operation',Operation).AddPair('checkpointId',Result).AddPair('passed',TJSONBool.Create(True)));
    finally Preview.Free; end;
  end;
  procedure Restore(const Id: string);
  begin
    CurrentStep:='restore '+Id;
    Snapshot:=Call('inspect',TJSONObject.Create);
    try
      Preview:=Call('previewRestoreChange',TJSONObject.Create.AddPair('checkpointId',Id)
        .AddPair('document',Snapshot.GetValue<string>('document','')).AddPair('revision',Snapshot.GetValue<string>('revision','')));
      if Contract.GetValue('restoreInspect')=nil then Contract.AddPair('restoreInspect',TJSONValue(Snapshot.Clone));
    finally Snapshot.Free; end;
    try
      if Contract.GetValue('restore')=nil then begin Contract.AddPair('restoreCapturedAt',DateToISO8601(Now,False))
        .AddPair('restore',TJSONValue(Preview.Clone)); SaveContract; end;
      Applied:=Call('restoreChange',TJSONObject.Create.AddPair('checkpointId',Id).AddPair('proposalId',Preview.GetValue<string>('proposalId',''))
        .AddPair('document',Preview.GetValue<string>('document','')).AddPair('revision',Preview.GetValue<string>('revision','')));
      Applied.Free;
      Steps.AddElement(TJSONObject.Create.AddPair('operation','restore').AddPair('checkpointId',Id).AddPair('passed',TJSONBool.Create(True)));
    finally Preview.Free; end;
  end;
begin
  Project:=GetActiveProject;
  if Project=nil then raise Exception.Create('Open the isolated fixture project and form first');
  Module:=(BorlandIDEServices as IOTAModuleServices).CurrentModule;
  if (Module=nil) or not DesignerAuthoringEnabled(Module) or not DesignerFixtureReady then raise Exception.Create('Select the explicitly enabled fixture form Design tab first');
  Root:=ExcludeTrailingPathDelimiter(ExtractFileDir(Project.FileName));
  Workspace:='file:///'+TNetEncoding.URL.Encode(Root.Replace('\','/')).Replace('%2F','/').Replace('%3A',':').Replace('+','%20');
  Original:=DesignerFileRevision(Module);
  Steps:=TJSONArray.Create; Report:=TJSONObject.Create.AddPair('schemaVersion',TJSONNumber.Create(1)).AddPair('steps',Steps);
  Contract:=TJSONObject.Create;
  CreateGUID(Guid); StageRoot:=TPath.Combine(GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH'),'stages\'+GUIDToString(Guid));
  Report.AddPair('stageRoot',StageRoot);
  try
    try
      CurrentStep:='initial inspect'; Snapshot:=Call('inspect',TJSONObject.Create);
      try Root:=((Snapshot.GetValue('components') as TJSONArray).Items[0] as TJSONObject).GetValue<string>('id','');
        Report.AddPair('framework',Snapshot.GetValue<string>('framework',''));
        if Snapshot.GetValue('authoringDiagnostic')<>nil then Report.AddPair('authoringDiagnostic',TJSONValue(Snapshot.GetValue('authoringDiagnostic').Clone));
      finally Snapshot.Free; end;
      Args:=TJSONObject.Create.AddPair('type','TButton').AddPair('name','AgentFixtureButton').AddPair('parent',Root)
        .AddPair('x',TJSONNumber.Create(24)).AddPair('y',TJSONNumber.Create(24)).AddPair('width',TJSONNumber.Create(120)).AddPair('height',TJSONNumber.Create(32));
      CheckpointCreate:=Change('createComponent',Args);
      CheckpointBind:=Change('bindEvent',TJSONObject.Create.AddPair('component','AgentFixtureButton')
        .AddPair('property','OnClick').AddPair('eventMethod','AgentFixtureClick').AddPair('create',TJSONBool.Create(True)));
      CheckpointDelete:=Change('deleteComponent',TJSONObject.Create.AddPair('component','AgentFixtureButton'));
      Restore(CheckpointDelete); Restore(CheckpointBind); Restore(CheckpointCreate);
      CurrentStep:='final byte identity'; Module:=(BorlandIDEServices as IOTAModuleServices).CurrentModule;
      if DesignerFileRevision(Module)<>Original then raise Exception.Create('Source/resource bytes differ after full recovery');
      Report.AddPair('passed',TJSONBool.Create(True));
    except on E:Exception do begin Report.AddPair('passed',TJSONBool.Create(False)).AddPair('failedStep',CurrentStep).AddPair('error',E.Message); end; end;
    TFile.WriteAllText(TPath.Combine(GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH'),'designer-acceptance.json'),Report.ToJSON,TEncoding.UTF8);
    if GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_AUTORUN')<>'1' then
      MessageDlg('PiAgent fixture results saved. Passed: '+BoolToStr(Report.GetValue<Boolean>('passed',False),True),mtInformation,[mbOK],0);
  finally Contract.Free; Report.Free; end;
end;
end.
