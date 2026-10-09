unit PiAgent.DesignerAuthoring;
interface
uses System.JSON, ToolsAPI;
function DesignerFiles(const Module: IOTAModule): TArray<string>;
function DesignerFileRevision(const Module: IOTAModule): string;
function ExecuteDesignerAuthoring(const Operation,Revision,Workspace: string;
  Args: TJSONObject; const Module: IOTAModule; const Editor: IOTAFormEditor): TJSONObject;
procedure AddDesignerAuthoringSchema(const Snapshot: TJSONObject; const Module: IOTAModule;
  const Editor: IOTAFormEditor; CanWrite: Boolean);
function DesignerAuthoringEnabled(const Module: IOTAModule): Boolean;
implementation
uses System.SysUtils, System.DateUtils, System.Classes, System.IOUtils, System.Hash,
  System.TypInfo, System.RegularExpressions, System.Generics.Collections, Winapi.Windows,
  DesignIntf,
  PiAgent.IdeContext, PiAgent.DesignerJournal, PiAgent.DesignerRelations, PiAgent.EditorOffsets,
  PiAgent.DesignerAuthoringGuards;
var Previews: TObjectDictionary<string,TJSONObject>;
function DesignerAuthoringEnabled(const Module: IOTAModule): Boolean;
var Files: TArray<string>; FileName: string;
begin
  Result:=False; if Module=nil then Exit;
  try
    Files:=DesignerFiles(Module);
    for FileName in Files do
      if not FileExists(FileName) or (TFile.GetSize(FileName)>1048576) then Exit;
    RequireDesignerAuthoringText(Files);
    Result:=True;
  except Result:=False; end;
end;
function DesignerFiles(const Module: IOTAModule): TArray<string>;
var I: Integer; FileName,Source,Resource: string;
begin
  Source:=''; Resource:='';
  for I:=0 to Module.ModuleFileCount-1 do begin
    FileName:=Module.ModuleFileEditors[I].FileName;
    if SameText(ExtractFileExt(FileName),'.pas') then Source:=FileName;
    if SameText(ExtractFileExt(FileName),'.dfm') or SameText(ExtractFileExt(FileName),'.fmx') then Resource:=FileName;
  end;
  if (Source='') or (Resource='') then raise Exception.Create('Designer recovery requires a saved Delphi source and form resource');
  if not SameText(ChangeFileExt(Source,''),ChangeFileExt(Resource,'')) then raise Exception.Create('Designer source/resource identity mismatch');
  Result:=[Source,Resource];
end;
function DesignerFileRevision(const Module: IOTAModule): string;
var FileName: string;
begin
  Result:='';
  for FileName in DesignerFiles(Module) do begin
    if not FileExists(FileName) or (TFile.GetSize(FileName)>1048576) then raise Exception.Create('Designer recovery file exceeds limits');
    Result:=Result+FileName+DesignerBytesHash(TFile.ReadAllBytes(FileName));
  end;
  Result:=THashSHA2.GetHashString(Result);
end;
function Native(const Editor: IOTAFormEditor): INTAFormEditor;
begin
  if not Supports(Editor,INTAFormEditor,Result) or (Result.FormDesigner=nil) then
    raise Exception.Create('Native designer is unavailable');
end;
function NativeComponent(const Component: IOTAComponent): TComponent;
var Instance: INTAComponent;
begin
  Result:=nil; if Supports(Component,INTAComponent,Instance) then Result:=Instance.GetComponent;
end;
procedure PreserveCreatedHandler(const Module: IOTAModule; const Designer: IDesigner; const Name: string);
var Source: IOTASourceEditor; Writer: IOTAEditWriter; Text,Pattern,Directory: string;
  Match: TMatch; I,Offset: Integer;
begin
  Source:=nil;
  for I:=0 to Module.ModuleFileCount-1 do
    if SameText(ExtractFileExt(Module.ModuleFileEditors[I].FileName),'.pas') and
      Supports(Module.ModuleFileEditors[I],IOTASourceEditor,Source) then Break;
  if Source=nil then raise Exception.Create('Generated handler source editor unavailable');
  Text:=ReadEditorText(Source);
  Directory:=GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH');
  if (Directory<>'') and Module.FileName.StartsWith(IncludeTrailingPathDelimiter(Directory),True) and
    FileExists(TPath.Combine(Directory,'.piagent-rad-fixture')) then begin
    Directory:=TPath.Combine(Directory,'private'); ForceDirectories(Directory);
    TFile.WriteAllText(TPath.Combine(Directory,'generated-handler-before-save.pas'),Text,TEncoding.UTF8);
  end;
  if not TRegEx.IsMatch(Text,'\b'+TRegEx.Escape(Designer.GetRoot.ClassName)+'\s*=\s*class\b',[roIgnoreCase]) then
    raise Exception.Create('Native generated handler source class does not match the form root');
  Pattern:='procedure\s+'+TRegEx.Escape(Designer.GetRoot.ClassName)+'\.'+TRegEx.Escape(Name)+
    '\s*(?:\([^)]*\))?\s*;\s*begin(?<body>\s*)end\s*;';
  Match:=TRegEx.Match(Text,Pattern,[roIgnoreCase]);
  if not Match.Success then raise Exception.Create('Native designer did not expose the exact generated empty handler body');
  Offset:=Match.Groups['body'].Index-1;
  Writer:=Source.CreateUndoableWriter; Writer.CopyTo(Utf16ToByteOffset(Text,Offset));
  Writer.Insert(UTF8String(sLineBreak+'  { PiAgent: implement this event handler. }'+sLineBreak)); Writer:=nil;
end;
function FindComponentOrRoot(const Editor: IOTAFormEditor; const Name: string): IOTAComponent;
var Root: IOTAComponent; Instance: TComponent;
begin
  Root:=Editor.GetRootComponent; Instance:=NativeComponent(Root);
  if (Instance<>nil) and SameText(Instance.Name,Name) then Result:=Root else Result:=Editor.FindComponent(Name);
end;
function SupportedTypes(const Framework: string): TArray<string>;
begin
  Result:=SupportedDesignerTypes(Framework);
end;
function FrameworkOfComponent(Root: TComponent): string;
var Ancestor: TClass;
begin
  Result:='unknown'; Ancestor:=Root.ClassType;
  while Ancestor<>nil do begin
    if Ancestor.UnitName.StartsWith('Vcl.') then Exit('vcl');
    if Ancestor.UnitName.StartsWith('FMX.') then Exit('fmx');
    Ancestor:=Ancestor.ClassParent;
  end;
end;
procedure Identifier(const Name: string);
begin
  if not TRegEx.IsMatch(Name,'^[A-Za-z_][A-Za-z0-9_]{0,62}$') or
    TRegEx.IsMatch(Name,'^(begin|end|class|type|unit|uses|function|procedure|property|var|const|interface|implementation|object|inherited|nil|self|create|destroy)$',[roIgnoreCase]) then
    raise Exception.Create('Invalid or reserved designer identifier');
end;
procedure ValidateChange(Args: TJSONObject; const Editor: IOTAFormEditor);
var Change,Name,Kind,Framework: string; Root,Item,Other,Parent: TComponent; Ancestor: TClass;
  TypeName: string; Allowed: Boolean; Prop: PPropInfo; I,J,Count: Integer; List: PPropList;
  Finder: TClassFinder; Candidate: TPersistentClass;
begin
  Root:=NativeComponent(Editor.GetRootComponent); if Root=nil then raise Exception.Create('Form root unavailable');
  if csAncestor in Root.ComponentState then raise Exception.Create('Inherited designer authoring is not yet supported');
  Framework:='unknown'; Ancestor:=Root.ClassType;
  while Ancestor<>nil do begin
    if Ancestor.UnitName.StartsWith('Vcl.') then begin Framework:='vcl'; Break; end;
    if Ancestor.UnitName.StartsWith('FMX.') then begin Framework:='fmx'; Break; end;
    Ancestor:=Ancestor.ClassParent;
  end;
  if not StandardDesignerRoot(Root,Framework) then raise Exception.Create('Authoring requires a direct standard Delphi form without inherited or third-party components');
  Change:=Args.GetValue<string>('changeOperation','');
  if Change='createComponent' then begin
    TypeName:=Args.GetValue<string>('type',''); Allowed:=False;
    for Kind in SupportedTypes(Framework) do Allowed:=Allowed or (Kind=TypeName);
    if not Allowed then raise Exception.Create('Component type is outside the supported designer set');
    Finder:=TClassFinder.Create(TPersistentClass(Root.ClassType));
    try Candidate:=Finder.GetClass(TypeName); if not StandardDesignerClass(Framework,Candidate) then
      raise Exception.Create('Registered component class is unavailable or outside the exact standard unit allowlist');
    finally Finder.Free; end;
    Parent:=NativeComponent(FindComponentOrRoot(Editor,Args.GetValue<string>('parent',Root.Name)));
    if Parent=nil then raise Exception.Create('Creation parent no longer exists');
    if (Parent<>Root) and (Parent.Owner<>Root) then raise Exception.Create('Creation parent ownership is unsupported');
    if (Parent<>Root) and not StandardDesignerParent(Framework,Parent.ClassType) then raise Exception.Create('Creation parent container is not supported');
    if Args.GetValue<Integer>('width',80)<1 then raise Exception.Create('Width must be positive');
    if Args.GetValue<Integer>('height',24)<1 then raise Exception.Create('Height must be positive');
    for Kind in ['x','y','width','height'] do
      if (Args.GetValue<Integer>(Kind,0)<-32768) or (Args.GetValue<Integer>(Kind,0)>32767) then raise Exception.Create('Designer bounds exceed limit');
    Name:=Args.GetValue<string>('name',''); if Name<>'' then begin
      Identifier(Name); if (Root.FindComponent(Name)<>nil) or SameText(Name,Root.Name) then raise Exception.Create('Component name already exists');
    end;
    Exit;
  end;
  Item:=NativeComponent(Editor.FindComponent(Args.GetValue<string>('component','')));
  if (Item=nil) or (Item=Root) or (Item.Owner<>Root) or (csAncestor in Item.ComponentState) then
    raise Exception.Create('Target component is missing/inherited/root-owned deletion is forbidden');
  if not StandardDesignerClass(Framework,Item.ClassType) then raise Exception.Create('Target component class is outside the exact standard unit allowlist');
  if Change='bindEvent' then begin
    Prop:=GetPropInfo(Item,Args.GetValue<string>('property',''));
    if (Prop=nil) or (Prop.PropType^.Kind<>tkMethod) or (Prop.SetProc=nil) then raise Exception.Create('Target is not a writable event');
    Name:=Args.GetValue<string>('eventMethod',''); Identifier(Name);
    if not Args.GetValue<Boolean>('create',False) and not Native(Editor).FormDesigner.MethodExists(Name) then
      raise Exception.Create('Handler does not exist; explicitly request creation');
    Exit;
  end;
  if Change<>'deleteComponent' then raise Exception.Create('Unsupported designer authoring change');
  // Begin with leaf deletion without incoming component references.
  Allowed:=False;
  for Kind in SupportedTypes(Framework) do Allowed:=Allowed or (Kind=Item.ClassName);
  if not Allowed then raise Exception.Create('Leaf deletion is restricted to verified standard component types');
  RequireBoundedDesignerDeletion(Item);
  if HasAuthoredDesignerChildren(Root,Item) then
    raise Exception.Create('Delete child controls first; subtree deletion is unavailable');
  for I:=-1 to Root.ComponentCount-1 do begin
    if I=-1 then Other:=Root else Other:=Root.Components[I];
    if Other=Item then Continue;
    Count:=GetPropList(Other.ClassInfo,[tkClass],nil); GetMem(List,Count*SizeOf(Pointer));
    try
      GetPropList(Other.ClassInfo,[tkClass],List);
      for J:=0 to Count-1 do
        if GetObjectProp(Other,List[J])=Item then raise Exception.Create('Remove incoming references before deleting this component');
    finally FreeMem(List); end;
  end;
end;
procedure AddDesignerAuthoringSchema(const Snapshot: TJSONObject; const Module: IOTAModule;
  const Editor: IOTAFormEditor; CanWrite: Boolean);
var Operations,Types,Components,Events: TJSONArray; Obj: TJSONObject; Item: TComponent;
  Kind,Reason: string; List: PPropList; Count,I,J: Integer; Prop: PPropInfo;
  Root,Base: TComponent; Finder: TClassFinder; Candidate: TPersistentClass; Diagnostic: TJSONObject; Packages: IOTAPackageServices; PackageRows: TJSONArray; PackageInfo: IOTAPackageInfo;
  function ClassNameOf(const ClassType: TPersistentClass): string;
  begin Result:=''; if ClassType<>nil then Result:=ClassType.QualifiedClassName; end;
begin
  Operations:=Snapshot.GetValue('supportedOperations') as TJSONArray;
  if not DesignerAuthoringEnabled(Module) then begin CanWrite:=False; Reason:='Authoring requires bounded saved Delphi source and form files'; end;
  Root:=NativeComponent(Editor.GetRootComponent);
  if not StandardDesignerRoot(Root,Snapshot.GetValue<string>('framework','')) then begin CanWrite:=False; Reason:='Inherited or third-party forms/components are unavailable'; end;
  try DesignerFileRevision(Module); except on E:Exception do begin CanWrite:=False; Reason:=E.Message; end; end;
  if CanWrite then begin
    Operations.Add('previewChange').Add('applyChange').Add('createComponent').Add('deleteComponent').Add('bindEvent')
      .Add('previewRestoreChange').Add('restoreChange');
  end else Snapshot.AddPair('authoringUnavailable',Reason);
  Types:=TJSONArray.Create; Snapshot.AddPair('creatableTypes',Types);
  if (GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH')<>'') and DesignerAuthoringEnabled(Module) then begin
    Root:=NativeComponent(Editor.GetRootComponent); Base:=Root; if Base.Owner<>nil then Base:=Base.Owner;
    Finder:=TClassFinder.Create(TPersistentClass(Base.ClassType));
    try
      Candidate:=Finder.GetClass('TButton');
      Diagnostic:=TJSONObject.Create.AddPair('rootClass',Root.QualifiedClassName).AddPair('finderBaseClass',Base.QualifiedClassName)
        .AddPair('rootClassGroup',ClassNameOf(ClassGroupOf(Root))).AddPair('activeClassGroup',ClassNameOf(ActiveClassGroup))
        .AddPair('registeredButtonClass',ClassNameOf(Candidate));
      PackageRows:=TJSONArray.Create; Diagnostic.AddPair('buttonPackages',PackageRows);
      if Supports(BorlandIDEServices,IOTAPackageServices,Packages) then
        for I:=0 to Packages.PackageCount-1 do
          for J:=0 to Packages.ComponentCount[I]-1 do if SameText(Packages.ComponentNames[I,J],'TButton') then begin
            PackageInfo:=Packages.GetPackage(I);
            PackageRows.AddElement(TJSONObject.Create.AddPair('name',PackageInfo.FileName).AddPair('loaded',TJSONBool.Create(PackageInfo.Loaded)));
          end;
      Snapshot.AddPair('authoringDiagnostic',Diagnostic);
    finally Finder.Free; end;
  end;
  if CanWrite then begin
    Finder:=TClassFinder.Create(TPersistentClass(Root.ClassType));
    try for Kind in SupportedTypes(Snapshot.GetValue<string>('framework','')) do begin
      Candidate:=Finder.GetClass(Kind);
      if StandardDesignerClass(Snapshot.GetValue<string>('framework',''),Candidate) then Types.Add(Kind);
    end; finally Finder.Free; end;
  end;
  Components:=Snapshot.GetValue('components') as TJSONArray;
  for I:=0 to Components.Count-1 do begin
    Obj:=Components.Items[I] as TJSONObject; Item:=NativeComponent(FindComponentOrRoot(Editor,Obj.GetValue<string>('id','')));
    if Item=nil then Continue;
    Events:=TJSONArray.Create; Obj.AddPair('events',Events);
    Count:=GetPropList(Item.ClassInfo,[tkMethod],nil); GetMem(List,Count*SizeOf(Pointer));
    try
      GetPropList(Item.ClassInfo,[tkMethod],List);
      for J:=0 to Count-1 do begin
        if Events.Count>=64 then Break; Prop:=List[J];
        try
          Events.AddElement(TJSONObject.Create.AddPair('name',string(Prop.Name))
            .AddPair('handler',Native(Editor).FormDesigner.GetMethodName(GetMethodProp(Item,Prop)))
            .AddPair('writable',TJSONBool.Create(CanWrite and (Prop.SetProc<>nil))));
        except end;
      end;
    finally FreeMem(List); end;
  end;
end;
function ExecuteDesignerAuthoring(const Operation,Revision,Workspace: string;
  Args: TJSONObject; const Module: IOTAModule; const Editor: IOTAFormEditor): TJSONObject;
var Saved,Change,Restore: TJSONObject; Id,Checkpoint,Name,Kind,FileName,Diff: string;
  Guid: TGUID; Created,Component: IOTAComponent; Item: TComponent; Prop: PPropInfo;
  Method: TMethod; NativeEditor: INTAFormEditor; PriorGroup: TPersistentClass; NewHandler: Boolean;
begin
  RequireIdeThread; NativeEditor:=Native(Editor);
  if not DesignerAuthoringEnabled(Module) then raise Exception.Create('Authoring requires bounded saved Delphi source and form files');
  Item:=NativeComponent(Editor.GetRootComponent);
  if not StandardDesignerRoot(Item,FrameworkOfComponent(Item)) then raise Exception.Create('Inherited or third-party forms/components are unavailable');
  for FileName in DesignerFiles(Module) do ResolveIdeFile(Workspace,FileName);
  if NativeEditor.FormDesigner.IsSourceReadOnly then raise Exception.Create('Designer source is read-only');
  if not SameText(Module.FileName,Args.GetValue<string>('document','')) then raise Exception.Create('Designer document changed');
  if Operation='previewRestoreChange' then begin
    Restore:=DesignerRestorePreview(Args.GetValue<string>('checkpointId',''),Module.FileName,DesignerFiles(Module));
    CreateGUID(Guid); Id:=GUIDToString(Guid);
    Diff:='Restore saved source and form bytes:'+sLineBreak+Restore.ToJSON;
    Restore.AddPair('proposalId',Id).AddPair('operation','restoreChange').AddPair('diff',Diff)
      .AddPair('expiresAt',TJSONNumber.Create(DateTimeToUnix(Now,False)*1000+299000))
      .AddPair('recovery',TJSONObject.Create.AddPair('supported',TJSONBool.Create(True)).AddPair('scope','source_and_form'));
    RequireDesignerProposalBudget(Restore);
    if Previews.Count>=8 then Previews.Clear;
    Saved:=TJSONObject(Restore.Clone); Saved.AddPair('workspace',Workspace).AddPair('expiresTick',TJSONNumber.Create(Int64(GetTickCount64+300000))); Previews.Add(Id,Saved);
    Exit(Restore);
  end;
  if Operation='restoreChange' then begin
    Id:=Args.GetValue<string>('proposalId','');
    if not Previews.TryGetValue(Id,Saved) or (Saved.GetValue<Int64>('expiresTick',0)<Int64(GetTickCount64)) or
      (Saved.GetValue<string>('operation','')<>'restoreChange') or
      (Saved.GetValue<string>('checkpointId','')<>Args.GetValue<string>('checkpointId','')) or
      (Saved.GetValue<string>('revision','')<>Args.GetValue<string>('revision','')) or
      (Saved.GetValue<string>('workspace','')<>Workspace) or
      not SameText(Saved.GetValue<string>('document',''),Module.FileName) then raise Exception.Create('Designer restore preview expired');
    Previews.Remove(Id);
    // Journal hashes guard both files; module dirty state is checked by the caller.
    RestoreDesignerJournal(Args.GetValue<string>('checkpointId',''),Module.FileName,Args.GetValue<string>('revision',''),DesignerFiles(Module));
    Module.Refresh(True);
    Exit(TJSONObject.Create.AddPair('restored',TJSONBool.Create(True)).AddPair('document',Module.FileName).AddPair('scope','source_and_form'));
  end;
  if Args.GetValue<string>('revision','')<>Revision then raise Exception.Create('Designer revision changed');
  if Operation='previewChange' then begin
    RequireDesignerAuthoringText(DesignerFiles(Module));
    RequireDesignerReviewBudget(DesignerFiles(Module));
    if Previews.Count>=8 then Previews.Clear;
    ValidateChange(Args,Editor); CreateGUID(Guid); Id:=GUIDToString(Guid);
    Diff:='Native designer change:'+sLineBreak+Args.ToJSON;
    if (Args.GetValue<string>('changeOperation','')='bindEvent') and Args.GetValue<Boolean>('create',False) then
      Diff:=Diff+sLineBreak+'A newly generated empty handler receives the comment { PiAgent: implement this event handler. } before saving.';
    Saved:=TJSONObject(Args.Clone); Saved.AddPair('workspace',Workspace).AddPair('expiresTick',TJSONNumber.Create(Int64(GetTickCount64+300000))); Previews.Add(Id,Saved);
    Exit(TJSONObject.Create.AddPair('proposalId',Id).AddPair('document',Module.FileName).AddPair('revision',Revision)
      .AddPair('operation',Args.GetValue<string>('changeOperation','')).AddPair('diff',Diff)
      .AddPair('expiresAt',TJSONNumber.Create(DateTimeToUnix(Now,False)*1000+299000))
      .AddPair('recovery',TJSONObject.Create.AddPair('supported',TJSONBool.Create(True)).AddPair('scope','source_and_form')));
  end;
  if Operation<>'applyChange' then raise Exception.Create('Unknown authoring transaction');
  Id:=Args.GetValue<string>('proposalId','');
  if not Previews.TryGetValue(Id,Saved) then raise Exception.Create('Designer preview expired');
  if (Saved.GetValue<Int64>('expiresTick',0)<Int64(GetTickCount64)) or
    (Saved.GetValue<string>('workspace','')<>Workspace) or
    (Saved.GetValue<string>('revision','')<>Revision) or not SameText(Saved.GetValue<string>('document',''),Module.FileName) then
    raise Exception.Create('Designer preview revision expired');
  Change:=TJSONObject(Saved.Clone); Previews.Remove(Id);
  try
    ValidateChange(Change,Editor);
    RequireDesignerAuthoringText(DesignerFiles(Module));
    Checkpoint:=BeginDesignerJournal(Module.FileName,DesignerFiles(Module));
    try
      Kind:=Change.GetValue<string>('changeOperation','');
      if Kind='createComponent' then begin
        PriorGroup:=ActivateClassGroup(TPersistentClass(NativeComponent(Editor.GetRootComponent).ClassType));
        try
          Created:=Editor.CreateComponent(FindComponentOrRoot(Editor,Change.GetValue<string>('parent',NativeComponent(Editor.GetRootComponent).Name)),
            Change.GetValue<string>('type',''),Change.GetValue<Integer>('x',0),Change.GetValue<Integer>('y',0),
            Change.GetValue<Integer>('width',80),Change.GetValue<Integer>('height',24));
          if Created=nil then raise Exception.Create('IDE did not create the component');
          if FrameworkOfComponent(NativeComponent(Created))<>FrameworkOfComponent(NativeComponent(Editor.GetRootComponent)) then
            raise Exception.Create('IDE created an incompatible component framework');
          if not StandardDesignerClass(FrameworkOfComponent(NativeComponent(Editor.GetRootComponent)),NativeComponent(Created).ClassType) then
            raise Exception.Create('IDE created a component outside the exact standard unit allowlist');
          Name:=Change.GetValue<string>('name','');
          if Name<>'' then if not Created.SetPropByName('Name',Name) then raise Exception.Create('IDE component naming failed');
          Created:=nil;
        finally ActivateClassGroup(PriorGroup); end;
      end else begin
        Component:=Editor.FindComponent(Change.GetValue<string>('component',''));
        if Kind='deleteComponent' then begin
          if not Component.Delete then raise Exception.Create('IDE component deletion failed'); Component:=nil;
        end else begin
          Item:=NativeComponent(Component); Prop:=GetPropInfo(Item,Change.GetValue<string>('property',''));
          Name:=Change.GetValue<string>('eventMethod','');
          NewHandler:=not NativeEditor.FormDesigner.MethodExists(Name);
          Method:=NativeEditor.FormDesigner.CreateMethod(Name,TEventInfo.Create(Prop));
          if (Method.Code=nil) or (Method.Data=nil) then
            raise Exception.Create('Native designer handler creation returned no method; root '+NativeEditor.FormDesigner.GetRootClassName+
              ', event '+string(Prop.Name)+', methodExists '+BoolToStr(NativeEditor.FormDesigner.MethodExists(Name),True));
          SetMethodProp(Item,Prop,Method);
          if NativeEditor.FormDesigner.GetMethodName(GetMethodProp(Item,Prop))<>Name then
            raise Exception.Create('Native designer event binding did not retain the requested handler');
          // The public TMethodProperty editor calls ShowMethod after binding a
          // newly created method; this materializes its declaration and body.
          NativeEditor.FormDesigner.Modified;
          NativeEditor.FormDesigner.ShowMethod(Name);
          if NewHandler then PreserveCreatedHandler(Module,NativeEditor.FormDesigner,Name);
          Component:=nil;
        end;
      end;
      NativeEditor.FormDesigner.Modified;
      if not Module.Save(False,True) then raise Exception.Create('Designer source/form save failed');
      if Kind='bindEvent' then begin
        Component:=Editor.FindComponent(Change.GetValue<string>('component','')); Item:=NativeComponent(Component);
        if Item=nil then raise Exception.Create('Bound event component disappeared during save');
        Prop:=GetPropInfo(Item,Change.GetValue<string>('property',''));
        if (Prop=nil) or (NativeEditor.FormDesigner.GetMethodName(GetMethodProp(Item,Prop))<>Name) then
          raise Exception.Create('Native designer save discarded the event binding');
        Component:=nil;
      end;
      CompleteDesignerJournal(Checkpoint);
      Result:=TJSONObject.Create.AddPair('applied',TJSONBool.Create(True)).AddPair('checkpointId',Checkpoint)
        .AddPair('document',Module.FileName).AddPair('recoveryScope','source_and_form');
    except on E:Exception do begin
      // Preserve recovery bytes and an observed durable failure snapshot. Unsaved
      // IDE buffers stay dirty; recovery cannot overwrite subsequent user edits.
      try CompleteDesignerJournal(Checkpoint); except end;
      raise Exception.Create(E.Message+'; recovery checkpoint '+Checkpoint+'; save/discard unsaved IDE changes before reviewed recovery');
    end; end;
  finally Change.Free; end;
end;
initialization
  Previews:=TObjectDictionary<string,TJSONObject>.Create([doOwnsValues]);
finalization
  Previews.Free;
end.

