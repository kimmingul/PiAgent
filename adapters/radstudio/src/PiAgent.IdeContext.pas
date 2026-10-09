unit PiAgent.IdeContext;
interface
uses System.JSON, ToolsAPI;
procedure RequireIdeThread;
function WorkspacePath(const Uri: string): string;
function ResolveIdeFile(const Uri, FileName: string; AllowBuildOutput: Boolean = False): string;
function ReadEditorText(const Editor: IOTASourceEditor; Limit: Integer = 1048576): string;
function IdeContext(const WorkspaceUri: string): TJSONObject;
procedure RequireSavedIdeBuffers;
function HasUnsavedIdeBuffers: Boolean;
implementation
uses System.SysUtils, System.StrUtils, System.DateUtils, System.Classes, System.IOUtils, System.NetEncoding,
  System.Hash, System.RegularExpressions, Winapi.Windows;
procedure RequireIdeThread;
begin
  if TThread.CurrentThread.ThreadID <> MainThreadID then
    raise Exception.Create('IDE services require the main thread');
end;
function WorkspacePath(const Uri: string): string;
begin
  if not Uri.StartsWith('file:///') then raise Exception.Create('Workspace unavailable');
  Result := IncludeTrailingPathDelimiter(TPath.GetFullPath(
    TNetEncoding.URL.Decode(Copy(Uri,9,MaxInt).Replace('+','%2B')).Replace('/','\')));
end;
function ResolveIdeFile(const Uri, FileName: string; AllowBuildOutput: Boolean): string;
var Root,Part,Current: string;
begin
  Root := WorkspacePath(Uri);
  if FileName = '' then raise Exception.Create('IDE file has no saved path');
  Result := TPath.GetFullPath(TPath.Combine(Root,FileName));
  if not Result.StartsWith(Root,True) then raise Exception.Create('IDE file is outside the workspace');
  Current := ExcludeTrailingPathDelimiter(Root);
  while Length(Current)>3 do begin
    if (GetFileAttributes(PChar(Current)) <> INVALID_FILE_ATTRIBUTES) and
      ((GetFileAttributes(PChar(Current)) and FILE_ATTRIBUTE_REPARSE_POINT)<>0) then
      raise Exception.Create('Linked workspace paths are unsupported');
    Current := ExtractFileDir(Current);
  end;
  Current := Root;
  for Part in Copy(Result,Length(Root)+1,MaxInt).Split(['\']) do begin
    if TRegEx.IsMatch(Part,'^(\.git|\.svn|\.hg|\.ssh|\.aws|\.azure|node_modules|\.tools)$|^(\.env($|\.)|credentials($|\.)|secrets($|\.))|\.(pem|key|pfx|p12|kdbx)$',[roIgnoreCase]) or
      (not AllowBuildOutput and TRegEx.IsMatch(Part,'^(artifacts|bin|obj)$',[roIgnoreCase])) then
      raise Exception.Create('IDE file is excluded from context');
    Current := TPath.Combine(Current,Part);
    if (GetFileAttributes(PChar(Current)) <> INVALID_FILE_ATTRIBUTES) and
      ((GetFileAttributes(PChar(Current)) and FILE_ATTRIBUTE_REPARSE_POINT)<>0) then
      raise Exception.Create('Linked IDE paths are unsupported');
  end;
end;
function ReadEditorText(const Editor: IOTASourceEditor; Limit: Integer): string;
var Reader: IOTAEditReader; Buffer: array[0..16383] of AnsiChar;
  Data,Encoded: TBytes; Count,Offset: Integer;
begin
  RequireIdeThread;
  Reader := Editor.CreateReader; Offset := 0;
  repeat
    Count := Reader.GetText(Offset,@Buffer[0],Length(Buffer));
    if Count < 0 then raise Exception.Create('Cannot read IDE buffer');
    if Offset+Count > Limit then raise Exception.Create('IDE buffer exceeds snapshot limit');
    SetLength(Data,Offset+Count);
    if Count > 0 then Move(Buffer[0],Data[Offset],Count);
    Inc(Offset,Count);
  until Count=0;
  Reader := nil; // Never overlap a ToolsAPI reader and writer.
  Result:=TEncoding.UTF8.GetString(Data); Encoded:=TEncoding.UTF8.GetBytes(Result);
  if (Length(Data)<>Length(Encoded)) or ((Length(Data)>0) and
    not CompareMem(Pointer(Data),Pointer(Encoded),Length(Data))) then
    raise Exception.Create('IDE buffer contains invalid UTF-8');
end;
procedure RequireSavedIdeBuffers;
begin
  if HasUnsavedIdeBuffers then raise Exception.Create('Save unsaved IDE buffers before build/test/debug execution');
end;
function HasUnsavedIdeBuffers: Boolean;
var Services: IOTAModuleServices; I,J: Integer;
begin
  RequireIdeThread;
  Result:=False;
  if not Supports(BorlandIDEServices,IOTAModuleServices,Services) then
    raise Exception.Create('IDE module services unavailable');
  for I:=0 to Services.ModuleCount-1 do
    for J:=0 to Services.Modules[I].ModuleFileCount-1 do
      if Services.Modules[I].ModuleFileEditors[J].Modified then
        Exit(True);
end;
function IdeContext(const WorkspaceUri: string): TJSONObject;
var Project: IOTAProject; Services: IOTAModuleServices; Editors: IOTAEditorServices;
  Group: IOTAProjectGroup; Module: IOTAModule; Source: IOTASourceEditor;
  Projects,Documents: TJSONArray; Entry: TJSONObject; I,J: Integer;
  FileName,Text,Language,Platform: string;
  Configurations: IOTAProjectOptionsConfigurations; ConfigRows: TJSONArray;
  GroupDependencies: IOTAProjectGroupProjectDependencies; Dependencies: IOTAProjectDependenciesList;
  DependencyRows,ItemRows: TJSONArray;
begin
  RequireIdeThread;
  Project := GetActiveProject;
  if Project=nil then raise Exception.Create('Open a saved project first');
  ResolveIdeFile(WorkspaceUri,Project.FileName);
  Projects := TJSONArray.Create; Documents := TJSONArray.Create;
  Result := TJSONObject.Create.AddPair('available',TJSONBool.Create(True))
    .AddPair('source','RAD Studio ToolsAPI').AddPair('workspaceUri',WorkspaceUri)
    .AddPair('project',Project.FileName).AddPair('configuration',Project.CurrentConfiguration)
    .AddPair('platform',Project.CurrentPlatform).AddPair('framework',Project.FrameworkType)
    .AddPair('language',Project.Personality).AddPair('projects',Projects)
    .AddPair('hasUnsavedBuffers',TJSONBool.Create(HasUnsavedIdeBuffers))
    .AddPair('documents',Documents).AddPair('observedAt',DateToISO8601(Now,False));
  try
    ItemRows:=TJSONArray.Create; Result.AddPair('projectItems',ItemRows);
    for I:=0 to Project.GetModuleCount-1 do begin
      if ItemRows.Count>=256 then Break;
      try FileName:=ResolveIdeFile(WorkspaceUri,Project.GetModule(I).FileName); ItemRows.Add(FileName); except end;
    end;
    DependencyRows:=TJSONArray.Create;
    Result.AddPair('dependencies',TJSONObject.Create.AddPair('kind','project-group build dependencies')
      .AddPair('semanticUnitDependenciesAvailable',TJSONBool.Create(False)).AddPair('projects',DependencyRows));
    if Supports(BorlandIDEServices,IOTAModuleServices,Services) then
      for I:=0 to Services.ModuleCount-1 do begin
        Module := Services.Modules[I];
        if Supports(Module,IOTAProjectGroup,Group) then begin
          Result.AddPair('projectGroup',Group.FileName);
          for J:=0 to Group.ProjectCount-1 do begin
            if Projects.Count>=64 then Break;
            try ResolveIdeFile(WorkspaceUri,Group.Projects[J].FileName);
              Projects.AddElement(TJSONObject.Create.AddPair('file',Group.Projects[J].FileName)
                .AddPair('configuration',Group.Projects[J].CurrentConfiguration)
                .AddPair('platform',Group.Projects[J].CurrentPlatform));
            except end;
          end;
          if Supports(Group,IOTAProjectGroupProjectDependencies,GroupDependencies) then begin
            Dependencies:=GroupDependencies.GetProjectDependencies(Project);
            if Dependencies<>nil then for J:=0 to Dependencies.ProjectCount-1 do begin
              if DependencyRows.Count>=64 then Break;
              try FileName:=ResolveIdeFile(WorkspaceUri,Dependencies.Projects[J].FileName); DependencyRows.Add(FileName); except end;
            end;
          end;
        end;
        for J:=0 to Module.ModuleFileCount-1 do begin
          if Documents.Count>=128 then Break;
          try FileName := ResolveIdeFile(WorkspaceUri,Module.ModuleFileEditors[J].FileName);
            Documents.AddElement(TJSONObject.Create.AddPair('file',FileName)
              .AddPair('modified',TJSONBool.Create(Module.ModuleFileEditors[J].Modified)));
          except end;
        end;
      end;
    if Supports(BorlandIDEServices,IOTAEditorServices,Editors) and
      (Editors.TopView<>nil) and (Editors.TopView.Buffer<>nil) then begin
      Source := Editors.TopView.Buffer;
      try
        FileName := ResolveIdeFile(WorkspaceUri,Source.FileName);
        Text := ReadEditorText(Source,65536); Language := 'Delphi';
        if MatchText(LowerCase(ExtractFileExt(FileName)),['.cpp','.c','.h','.hpp']) then Language := 'C++';
        Entry := TJSONObject.Create.AddPair('file',FileName).AddPair('text',Text)
          .AddPair('language',Language).AddPair('revision',THashSHA2.GetHashString(Text))
          .AddPair('modified',TJSONBool.Create(Source.Modified))
          .AddPair('line',TJSONNumber.Create(Editors.TopView.CursorPos.Line))
          .AddPair('column',TJSONNumber.Create(Editors.TopView.CursorPos.Col));
        Result.AddPair('activeDocument',Entry);
      except on E: Exception do Result.AddPair('activeDocumentUnavailable',E.Message); end;
    end;
    Entry := TJSONObject.Create; Result.AddPair('supportedPlatforms',Entry);
    for Platform in Project.SupportedPlatforms do Entry.AddPair(Platform,TJSONBool.Create(True));
    ConfigRows:=TJSONArray.Create; Result.AddPair('configurations',ConfigRows);
    if Supports(Project.ProjectOptions,IOTAProjectOptionsConfigurations,Configurations) then
      for I:=0 to Configurations.ConfigurationCount-1 do begin
        if ConfigRows.Count>=64 then Break;
        ConfigRows.AddElement(TJSONObject.Create.AddPair('name',Configurations.Configurations[I].Name)
          .AddPair('key',Configurations.Configurations[I].Key));
      end;
  except Result.Free; raise; end;
end;
end.
