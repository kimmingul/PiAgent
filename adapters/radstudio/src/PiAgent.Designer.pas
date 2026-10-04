unit PiAgent.Designer;
interface
uses System.JSON;
function ExecuteDesigner(const Operation: string; Args: TJSONObject; const WorkspaceUri: string): TJSONObject;
implementation
uses System.SysUtils, System.Classes, System.TypInfo, System.Variants, System.Hash,
  System.IOUtils, System.NetEncoding, Winapi.Windows, ToolsAPI, DesignIntf, PiAgent.DesignerRelations;

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

function Snapshot(const Module: IOTAModule; const Editor: IOTAFormEditor): TJSONObject;
var Root,Item: TComponent; Components,Properties: TJSONArray; I,J,Count: Integer;
  List: PPropList; Prop: PPropInfo; Obj: TJSONObject; Value,Framework: string; Dirty,Writable: Boolean;
begin
  Root := NativeOf(Editor.GetRootComponent);
  if Root = nil then raise Exception.Create('Native form designer unavailable');
  Framework := FrameworkOf(Root); Dirty := False;
  if Root.ComponentCount > 255 then raise Exception.Create('Designer component limit exceeded');
  for I := 0 to Module.ModuleFileCount-1 do Dirty := Dirty or Module.ModuleFileEditors[I].Modified;
  Components := TJSONArray.Create;
  Result := TJSONObject.Create.AddPair('document',Module.FileName).AddPair('framework',Framework)
    .AddPair('canSetProperty',TJSONBool.Create((not Dirty) and (Framework <> 'unknown'))).AddPair('components',Components);
  Result.AddPair('schemaVersion',TJSONNumber.Create(2)).AddPair('hierarchyKind','streamed-component-parentage');
  if (not Dirty) and (Framework <> 'unknown') then
    Result.AddPair('supportedOperations',TJSONArray.Create.Add('setProperty').Add('setReference').Add('reparent'))
  else Result.AddPair('supportedOperations',TJSONArray.Create);
  try
    for I := -1 to Root.ComponentCount-1 do begin
      if I >= 255 then Break;
      if I = -1 then Item := Root else Item := Root.Components[I];
      Properties := TJSONArray.Create;
      Obj := TJSONObject.Create.AddPair('id',Item.Name).AddPair('type',Item.ClassName).AddPair('properties',Properties);
      Components.AddElement(Obj);
      AddRelations(Root,Item,Obj,(not Dirty) and (Framework <> 'unknown'));
      Count := GetPropList(Item.ClassInfo,ScalarKinds,nil);
      GetMem(List,Count*SizeOf(Pointer));
      try
        GetPropList(Item.ClassInfo,ScalarKinds,List);
        for J := 0 to Count-1 do begin
          if Properties.Count >= 128 then Break;
          Prop := List^[J]; if SameText(string(Prop.Name),'Name') then Continue;
          try
            Value := VarToStr(GetPropValue(Item,string(Prop.Name),True));
            Writable := (Prop.SetProc <> nil) and (Length(Value) <= 4096);
            if Length(Value) > 4096 then Value := Copy(Value,1,4096);
            Properties.AddElement(TJSONObject.Create.AddPair('name',string(Prop.Name)).AddPair('value',Value)
              .AddPair('writable',TJSONBool.Create(Writable)));
          except
            // A property that cannot be read is not offered for editing.
          end;
        end;
      finally FreeMem(List); end;
    end;
    Result.AddPair('revision',THashSHA2.GetHashString(Components.ToJSON));
    if TEncoding.UTF8.GetByteCount(Result.ToJSON) > 220*1024 then raise Exception.Create('Designer snapshot exceeds limit');
  except Result.Free; raise; end;
end;

function ExecuteDesigner(const Operation: string; Args: TJSONObject; const WorkspaceUri: string): TJSONObject;
var Services: IOTAModuleServices; Module: IOTAModule; Editor: IOTAFormEditor; NativeEditor: INTAFormEditor;
  I: Integer; Root,Item,NewTarget,OldTarget: TComponent; View: TJSONObject; Prop: PPropInfo; OldValue: Variant;
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
  if (Operation <> 'setProperty') and (Operation <> 'setReference') and (Operation <> 'reparent') then raise Exception.Create('Unsupported designer operation');
  View := Snapshot(Module,Editor);
  try
    if not View.GetValue<Boolean>('canSetProperty',False) or
      not SameText(Target,Args.GetValue<string>('document','')) or
      (View.GetValue<string>('revision','') <> Args.GetValue<string>('revision','')) then
      raise Exception.Create('Designer changed or has unsaved edits; inspect and approve again');
  finally View.Free; end;
  Root := NativeOf(Editor.GetRootComponent);
  ComponentName := Args.GetValue<string>('component',''); PropertyName := Args.GetValue<string>('property','');
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
  Prop := GetPropInfo(Item,PropertyName);
  if (Prop = nil) or (Prop.SetProc = nil) or not (Prop.PropType^.Kind in ScalarKinds) then raise Exception.Create('Property is not writable');
  if not Supports(Editor,INTAFormEditor,NativeEditor) or (NativeEditor.FormDesigner = nil) then raise Exception.Create('Designer modification service unavailable');
  OldValue := GetPropValue(Item,PropertyName,True);
  try
    SetPropValue(Item,PropertyName,Value); NativeEditor.FormDesigner.Modified;
    if not Module.Save(False,True) then raise Exception.Create('Designer save failed');
  except
    SetPropValue(Item,PropertyName,OldValue); NativeEditor.FormDesigner.Modified;
    raise;
  end;
  Result := TJSONObject.Create.AddPair('applied',TJSONBool.Create(True)).AddPair('document',Target)
    .AddPair('validation','saved through ToolsAPI; build and visual verification still required');
end;
end.

