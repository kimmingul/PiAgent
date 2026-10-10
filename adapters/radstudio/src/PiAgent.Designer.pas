unit PiAgent.Designer;
interface
uses System.JSON;
function ExecuteDesigner(const Operation: string; Args: TJSONObject; const WorkspaceUri: string): TJSONObject;
implementation
uses System.SysUtils, System.Classes, System.TypInfo, System.Variants, System.Hash,
  System.IOUtils, System.NetEncoding, Winapi.Windows, ToolsAPI, DesignIntf, PiAgent.DesignerRelations,
  PiAgent.DesignerAuthoring, PiAgent.DesignerProperties;

const ScalarKinds = [tkInteger,tkInt64,tkFloat,tkEnumeration,tkString,tkLString,tkWString,tkUString];

function NativeOf(const Component: IOTAComponent): TComponent;
var Native: INTAComponent;
begin Result := nil; if Supports(Component,INTAComponent,Native) then Result := Native.GetComponent; end;

function FrameworkOf(Root: TComponent): string;
var Kind: TClass;
begin
  Result := 'unknown'; Kind := Root.ClassType;
  while Kind <> nil do begin
    if Kind.UnitName.StartsWith('Vcl.') then Exit('vcl');
    if Kind.UnitName.StartsWith('FMX.') then Exit('fmx');
    Kind := Kind.ClassParent;
  end;
end;

function WritablePropertyInSnapshot(View: TJSONObject; const ComponentName,PropertyName: string): Boolean;
var Components,Properties: TJSONArray; Component,PropertyRow: TJSONObject; I,J: Integer;
begin
  Result:=False; Components:=View.GetValue<TJSONArray>('components');
  if Components=nil then Exit;
  for I:=0 to Components.Count-1 do begin
    Component:=Components.Items[I] as TJSONObject;
    if not SameText(Component.GetValue<string>('id',''),ComponentName) then Continue;
    Properties:=Component.GetValue<TJSONArray>('properties');
    if Properties=nil then Exit;
    for J:=0 to Properties.Count-1 do begin
      PropertyRow:=Properties.Items[J] as TJSONObject;
      if SameText(PropertyRow.GetValue<string>('name',''),PropertyName) then
        Exit(PropertyRow.GetValue<Boolean>('writable',False));
    end;
    Exit;
  end;
end;

function Snapshot(const Module: IOTAModule; const Editor: IOTAFormEditor): TJSONObject;
var Root,Item: TComponent; Components,Properties: TJSONArray; I: Integer;
  Obj: TJSONObject; Value,Framework,BlockCode,BlockReason: string;
  Dirty,CanWrite: Boolean; NativeEditor: INTAFormEditor;
begin
  Root := NativeOf(Editor.GetRootComponent);
  if Root = nil then raise Exception.Create('Native form designer unavailable');
  Framework := FrameworkOf(Root); Dirty := False;
  if Root.ComponentCount > 255 then raise Exception.Create('Designer component limit exceeded');
  for I := 0 to Module.ModuleFileCount-1 do Dirty := Dirty or Module.ModuleFileEditors[I].Modified;
  BlockCode := ''; BlockReason := '';
  if Framework = 'unknown' then begin
    BlockCode := 'unsupported_framework'; BlockReason := 'This form framework is unsupported; VCL or FMX is required.';
  end else if Dirty then begin
    BlockCode := 'unsaved_changes';
    BlockReason := 'The IDE form or source has unsaved changes. Save the target module in RAD Studio, then inspect and approve again. This is not a permission denial.';
  end else if not Supports(Editor,INTAFormEditor,NativeEditor) or (NativeEditor.FormDesigner = nil) then begin
    BlockCode := 'modification_service_unavailable';
    BlockReason := 'The native designer modification service is unavailable. Open the form Design tab and inspect again.';
  end else if NativeEditor.FormDesigner.IsSourceReadOnly then begin
    BlockCode := 'source_read_only';
    BlockReason := 'RAD Studio reports that the target source is read-only. Make the target module writable in the IDE and inspect again.';
  end;
  CanWrite := BlockCode = '';
  Components := TJSONArray.Create;
  Result := TJSONObject.Create.AddPair('document',Module.FileName).AddPair('framework',Framework)
    .AddPair('canSetProperty',TJSONBool.Create(CanWrite)).AddPair('components',Components);
  Result.AddPair('dirty',TJSONBool.Create(Dirty));
  if not CanWrite then Result.AddPair('writeBlockCode',BlockCode).AddPair('writeBlockReason',BlockReason);
  Result.AddPair('schemaVersion',TJSONNumber.Create(2)).AddPair('hierarchyKind','streamed-component-parentage');
  if CanWrite then
    Result.AddPair('supportedOperations',TJSONArray.Create.Add('setProperty').Add('setReference').Add('reparent'))
  else Result.AddPair('supportedOperations',TJSONArray.Create);
  try
    for I := -1 to Root.ComponentCount-1 do begin
      if I >= 255 then Break;
      if I = -1 then Item := Root else Item := Root.Components[I];
      Properties := TJSONArray.Create;
      Obj := TJSONObject.Create.AddPair('id',Item.Name).AddPair('type',Item.ClassName).AddPair('properties',Properties);
      Components.AddElement(Obj);
      AddRelations(Root,Item,Obj,CanWrite);
      DescribeDesignerProperties(Item,Properties,CanWrite);
    end;
    AddDesignerAuthoringSchema(Result,Module,Editor,CanWrite);
    try Value:=DesignerFileRevision(Module); except Value:=''; end;
    Result.AddPair('revision',THashSHA2.GetHashString(Components.ToJSON+Value));
    if TEncoding.UTF8.GetByteCount(Result.ToJSON) > 220*1024 then raise Exception.Create('Designer snapshot exceeds limit');
  except Result.Free; raise; end;
end;

function ExecuteDesigner(const Operation: string; Args: TJSONObject; const WorkspaceUri: string): TJSONObject;
var Services: IOTAModuleServices; Module: IOTAModule; Editor: IOTAFormEditor; NativeEditor: INTAFormEditor;
  I: Integer; Root,Item,NewTarget,OldTarget: TComponent; View: TJSONObject; Prop: PPropInfo; OldValue: Variant; PropertyTarget: TPersistent;
  RootPath,Target,ComponentName,PropertyName,Value,CheckPath: string;
begin
  if TThread.CurrentThread.ThreadID <> MainThreadID then raise Exception.Create('Designer requires IDE main thread');
  if not Supports(BorlandIDEServices,IOTAModuleServices,Services) then raise Exception.Create('IDE services unavailable');
  Module := Services.CurrentModule;
  if Module = nil then raise Exception.Create('Open the target form first');
  if not WorkspaceUri.StartsWith('file:///') then raise Exception.Create('Workspace unavailable');
  RootPath := IncludeTrailingPathDelimiter(TPath.GetFullPath(TNetEncoding.URL.Decode(Copy(WorkspaceUri,9,MaxInt).Replace('+','%2B')).Replace('/','\')));
  Target := TPath.GetFullPath(Module.FileName);
  if not Target.StartsWith(RootPath,True) then raise Exception.Create('Active form is outside the Core workspace; connect Core to this project first');
  CheckPath := Target;
  while Length(CheckPath) > 3 do begin
    if (GetFileAttributes(PChar(CheckPath)) and FILE_ATTRIBUTE_REPARSE_POINT) <> 0 then raise Exception.Create('Linked designer paths are unsupported');
    CheckPath := ExtractFileDir(CheckPath);
  end;
  Editor := nil;
  for I := 0 to Module.ModuleFileCount-1 do if Supports(Module.ModuleFileEditors[I],IOTAFormEditor,Editor) then Break;
  if Editor = nil then raise Exception.Create('The active module has no form designer');
  if Operation = 'inspect' then Exit(Snapshot(Module,Editor));
  if (Operation='previewChange') or (Operation='applyChange') or
    (Operation='previewRestoreChange') or (Operation='restoreChange') then begin
    View:=Snapshot(Module,Editor);
    try
      if View.GetValue<Boolean>('dirty',True) then raise Exception.Create('Save unsaved form/source changes before designer authoring or recovery');
      if not View.GetValue<Boolean>('canSetProperty',False) then raise Exception.Create('Designer source/form is unavailable or read-only');
      Exit(ExecuteDesignerAuthoring(Operation,View.GetValue<string>('revision',''),WorkspaceUri,Args,Module,Editor));
    finally View.Free; end;
  end;
  if (Operation <> 'setProperty') and (Operation <> 'setReference') and (Operation <> 'reparent') then raise Exception.Create('Unsupported designer operation');
  ComponentName := Args.GetValue<string>('component',''); PropertyName := Args.GetValue<string>('property','');
  View := Snapshot(Module,Editor);
  try
    if not View.GetValue<Boolean>('canSetProperty',False) then
      raise Exception.Create(View.GetValue<string>('writeBlockReason','Designer edits are unavailable'));
    if not SameText(Target,Args.GetValue<string>('document','')) or
      (View.GetValue<string>('revision','') <> Args.GetValue<string>('revision','')) then
      raise Exception.Create('Designer changed or has unsaved edits; inspect and approve again');
    if (Operation='setProperty') and not WritablePropertyInSnapshot(View,ComponentName,PropertyName) then
      raise Exception.Create('Property is outside the inspected writable designer schema');
  finally View.Free; end;
  Root := NativeOf(Editor.GetRootComponent);
  Value := Args.GetValue<string>('value','');
  if (Length(Value) > 4096) or SameText(PropertyName,'Name') then raise Exception.Create('Unsupported property');
  if SameText(ComponentName,Root.Name) then Item := Root else Item := Root.FindComponent(ComponentName);
  if Item = nil then raise Exception.Create('Component no longer exists');
  if not Supports(Editor,INTAFormEditor,NativeEditor) or (NativeEditor.FormDesigner = nil) then raise Exception.Create('Designer modification service unavailable');
  if Operation <> 'setProperty' then begin
    if Operation = 'reparent' then Value := Args.GetValue<string>('parent','')
    else Value := Args.GetValue<string>('target','');
    NewTarget := nil;
    if Value <> '' then begin
      if Value = Root.Name then NewTarget := Root else NewTarget := Root.FindComponent(Value);
      if NewTarget = nil then raise Exception.Create('Reference target no longer exists');
    end;
    Prop := nil;
    if Operation = 'reparent' then begin
      if not CanParent(Root,Item,NewTarget) then raise Exception.Create('Unsupported or cyclic designer parent');
      OldTarget := Item.GetParentComponent;
    end else begin
      Prop := GetPropInfo(Item,PropertyName);
      if not ReferenceWritable(Prop) then raise Exception.Create('Reference is not writable');
      if (NewTarget = Item) or ((NewTarget <> nil) and
        not NewTarget.InheritsFrom(GetTypeData(Prop.PropType^).ClassType)) then raise Exception.Create('Incompatible reference target');
      OldTarget := TComponent(GetObjectProp(Item,Prop));
    end;
    try
      if Operation = 'reparent' then MoveParent(Item,NewTarget) else SetObjectProp(Item,Prop,NewTarget);
      NativeEditor.FormDesigner.Modified;
      if not Module.Save(False,True) then raise Exception.Create('Designer save failed');
    except
      if Operation = 'reparent' then MoveParent(Item,OldTarget) else SetObjectProp(Item,Prop,OldTarget);
      NativeEditor.FormDesigner.Modified;
      // Leave the buffer dirty on failure; never claim durable rollback after a failed IDE save.
      raise;
    end;
    Exit(TJSONObject.Create.AddPair('applied',TJSONBool.Create(True)).AddPair('document',Target)
      .AddPair('validation','saved through ToolsAPI; inspect related properties, build and visually verify'));
  end;
  Prop := ResolveDesignerProperty(Item,PropertyName,PropertyTarget);
  if (Prop = nil) or (Prop.SetProc = nil) then raise Exception.Create('Property is not writable');
  if not Supports(Editor,INTAFormEditor,NativeEditor) or (NativeEditor.FormDesigner = nil) then raise Exception.Create('Designer modification service unavailable');
  OldValue := GetPropValue(PropertyTarget,string(Prop.Name),True);
  try
    SetPropValue(PropertyTarget,string(Prop.Name),Value); NativeEditor.FormDesigner.Modified;
    if not Module.Save(False,True) then raise Exception.Create('Designer save failed');
  except
    SetPropValue(PropertyTarget,string(Prop.Name),OldValue); NativeEditor.FormDesigner.Modified;
    raise;
  end;
  Result := TJSONObject.Create.AddPair('applied',TJSONBool.Create(True)).AddPair('document',Target)
    .AddPair('validation','saved through ToolsAPI; build and visual verification still required');
end;
end.

