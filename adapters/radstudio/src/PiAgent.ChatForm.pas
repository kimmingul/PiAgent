unit PiAgent.ChatForm;
interface
uses System.Classes, System.JSON, Vcl.Forms, Vcl.Edge, Vcl.ExtCtrls, PiAgent.ChatWorker, PiAgent.IdeHost;
type
  TPiChatForm = class(TForm)
  private
    FBrowser: TEdgeBrowser;
    FTimer: TTimer;
    FWorker: TPiChatWorker;
    FIdeHost: TPiIdeHost;
    FIdeCatalogAt: UInt64;
    FIdeRevision: string;
    FDispatching: Boolean;
    FReady: Boolean;
    FWorkspace: string;
    FWorkspacePending: Boolean;
    FWorkspaceCheckAt: UInt64;
    FApproval, FRestore, FSelection, FMessageRestore: TJSONObject;
    FLoader: NativeUInt;
    procedure Created(Sender: TCustomEdgeBrowser; AResult: HRESULT);
    procedure MessageReceived(Sender: TCustomEdgeBrowser; Args: TWebMessageReceivedEventArgs);
    procedure Navigating(Sender: TCustomEdgeBrowser; Args: TNavigationStartingEventArgs);
    procedure NewWindow(Sender: TCustomEdgeBrowser; Args: TNewWindowRequestedEventArgs);
    procedure Permission(Sender: TCustomEdgeBrowser; Args: TPermissionRequestedEventArgs);
    procedure Download(Sender: TCustomEdgeBrowser; Args: TDownloadStartingEventArgs);
    procedure Poll(Sender: TObject);
    procedure Post(const Json: string);
    procedure EnsureSaved(View: TJSONObject);
    procedure RefreshRestored(View: TJSONObject);
    function CurrentWorkspace: string;
    procedure SyncWorkspace;
  public
    constructor Create(AOwner: TComponent); override;
    destructor Destroy; override;
  end;
procedure ShowPiAgentChat;
implementation
uses System.SysUtils, System.StrUtils, System.IOUtils, System.NetEncoding, System.Win.ComObj, Winapi.Windows, Winapi.ActiveX,
  Winapi.WebView2, Winapi.ShellAPI, Vcl.Controls, Vcl.StdCtrls, Vcl.Dialogs, Vcl.FileCtrl, Vcl.Clipbrd, ToolsAPI, PiAgent.Designer;
const Page = 'https://piagent.local/chat.html';
  // Windows SDK flags, absent from older Delphi Winapi.Windows declarations.
  LoadFromDllDirectory = $00000100;
  LoadFromDefaultDirectories = $00001000;
var ChatForm: TPiChatForm;
constructor TPiChatForm.Create(AOwner: TComponent);
var ModuleName: array[0..32767] of Char; LoaderPath: string;
begin
  inherited CreateNew(AOwner); Caption := 'PiAgent Chat'; Width := 780; Height := 820;
  if FindResource(HInstance,'PIAGENT_ICON',RT_GROUP_ICON) <> 0 then
    Icon.LoadFromResourceName(HInstance,'PIAGENT_ICON');
  ShowInTaskbar := True;
  GetModuleFileName(HInstance,ModuleName,Length(ModuleName)); LoaderPath := TPath.Combine(ExtractFilePath(ModuleName),'WebView2Loader.dll');
  FLoader := LoadLibraryEx(PChar(LoaderPath),0,LoadFromDllDirectory or LoadFromDefaultDirectories);
  if FLoader = 0 then RaiseLastOSError;
  Position := poScreenCenter; FIdeHost:=TPiIdeHost.Create; FWorker := TPiChatWorker.Create; FWorker.Start;
  FTimer := TTimer.Create(Self); FTimer.Interval := 40; FTimer.OnTimer := Poll;
  FBrowser := TEdgeBrowser.Create(Self); FBrowser.Parent := Self; FBrowser.Align := alClient;
  FBrowser.UserDataFolder := TPath.Combine(GetEnvironmentVariable('LOCALAPPDATA'),'PiAgent\RADWebView2');
  if GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH')<>'' then
    FBrowser.UserDataFolder:=TPath.Combine(GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH'),'webview');
  FBrowser.OnCreateWebViewCompleted := Created; FBrowser.OnWebMessageReceived := MessageReceived;
  FBrowser.OnNavigationStarting := Navigating; FBrowser.OnNewWindowRequested := NewWindow;
  FBrowser.OnPermissionRequested := Permission; FBrowser.OnDownloadStarting := Download;
  FBrowser.CreateWebView;
end;
destructor TPiChatForm.Destroy;
begin
  FReady := False;
  if FTimer <> nil then begin FTimer.Enabled := False; FTimer.OnTimer := nil; end;
  FreeAndNil(FIdeHost);
  FreeAndNil(FWorker); FApproval.Free; FRestore.Free; FSelection.Free; FMessageRestore.Free;
  if FBrowser <> nil then begin
    FBrowser.OnCreateWebViewCompleted := nil; FBrowser.OnWebMessageReceived := nil;
    FBrowser.OnNavigationStarting := nil; FBrowser.OnNewWindowRequested := nil;
    FBrowser.OnPermissionRequested := nil; FBrowser.OnDownloadStarting := nil;
    FBrowser.CloseWebView; FreeAndNil(FBrowser);
  end;
  if FLoader <> 0 then FreeLibrary(FLoader); inherited;
end;
procedure TPiChatForm.Created(Sender: TCustomEdgeBrowser; AResult: HRESULT);
var Extended: ICoreWebView2_3; ModuleName: array[0..32767] of Char; Folder: string; LabelControl: TLabel;
begin
  try
    OleCheck(AResult); if not Supports(Sender.DefaultInterface,ICoreWebView2_3,Extended) then raise Exception.Create('Update WebView2 Runtime');
    GetModuleFileName(HInstance,ModuleName,Length(ModuleName)); Folder := TPath.Combine(ExtractFilePath(ModuleName),'ui');
    if not FileExists(TPath.Combine(Folder,'chat.html')) then raise Exception.Create('PiAgent UI assets are missing');
    OleCheck(Extended.SetVirtualHostNameToFolderMapping('piagent.local',PChar(Folder),COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS));
    OleCheck(Sender.SettingsInterface.Set_AreHostObjectsAllowed(0)); Sender.DefaultScriptDialogsEnabled := False;
    Sender.WebMessageEnabled := True; Sender.Navigate(Page);
  except on E: Exception do begin
    LabelControl := TLabel.Create(Self); LabelControl.Parent := Self; LabelControl.Align := alTop;
    LabelControl.Caption := 'PiAgent WebView2: ' + E.Message;
  end; end;
end;
procedure TPiChatForm.Navigating(Sender: TCustomEdgeBrowser; Args: TNavigationStartingEventArgs);
var Uri: PWideChar;
begin
  Uri := nil; OleCheck(Args.ArgsInterface.Get_uri(Uri));
  try if string(Uri) <> Page then Args.ArgsInterface.Set_Cancel(1); finally CoTaskMemFree(Uri); end;
end;
procedure TPiChatForm.NewWindow(Sender: TCustomEdgeBrowser; Args: TNewWindowRequestedEventArgs);
begin Args.ArgsInterface.Set_Handled(1); end;
procedure TPiChatForm.Permission(Sender: TCustomEdgeBrowser; Args: TPermissionRequestedEventArgs);
begin Args.ArgsInterface.Set_State(COREWEBVIEW2_PERMISSION_STATE_DENY); end;
procedure TPiChatForm.Download(Sender: TCustomEdgeBrowser; Args: TDownloadStartingEventArgs);
begin Args.ArgsInterface.Set_Cancel(1); end;
procedure TPiChatForm.Post(const Json: string);
begin if FReady and (FBrowser.DefaultInterface <> nil) then FBrowser.DefaultInterface.PostWebMessageAsJson(PChar(Json)); end;
function TPiChatForm.CurrentWorkspace: string;
var Project: IOTAProject; Root: string;
begin
  Project := GetActiveProject;
  if (Project = nil) or (Project.FileName = '') then raise Exception.Create('Open a RAD Studio project before connecting');
  Root := ExcludeTrailingPathDelimiter(ExtractFilePath(TPath.GetFullPath(Project.FileName))).Replace('\','/');
  Result := 'file:///' + TNetEncoding.URL.Encode(Root).Replace('%2F','/').Replace('%3A',':').Replace('+','%20');
end;
procedure TPiChatForm.SyncWorkspace;
var Workspace: string; Reply: TJSONObject;
begin
  if not FReady or FWorkspacePending or (GetTickCount64 < FWorkspaceCheckAt) then Exit;
  FWorkspaceCheckAt := GetTickCount64 + 500;
  try Workspace := CurrentWorkspace; except Workspace := ''; end;
  if SameText(Workspace,FWorkspace) then Exit;
  FWorkspacePending := True;
  FIdeHost.Cancel('');
  FreeAndNil(FApproval); FreeAndNil(FRestore); FreeAndNil(FSelection); FreeAndNil(FMessageRestore);
  Reply := TJSONObject.Create.AddPair('type','workspaceChanging').AddPair('workspaceUri',Workspace);
  try Post(Reply.ToJSON); finally Reply.Free; end;
  Reply := TJSONObject.Create;
  try
    if Workspace = '' then Reply.AddPair('action','disconnectWorkspace')
    else Reply.AddPair('action','connect').AddPair('workspaceUri',Workspace)
      .AddPair('ideCatalog',FIdeHost.Catalog(Workspace));
    FWorker.Enqueue(Reply.ToJSON);
  finally Reply.Free; end;
end;
procedure TPiChatForm.EnsureSaved(View: TJSONObject);
var Services: IOTAModuleServices; Files: TJSONArray; K: Integer;
  procedure CheckPath(const RelativePath: string);
  var I,J: Integer; Root,Target: string; Editor: IOTAEditor;
  begin
    if not FWorkspace.StartsWith('file:///') then raise Exception.Create('Workspace unavailable');
    Root := IncludeTrailingPathDelimiter(TPath.GetFullPath(TNetEncoding.URL.Decode(Copy(FWorkspace,9,MaxInt).Replace('+','%2B')).Replace('/','\')));
    Target := TPath.GetFullPath(TPath.Combine(Root,RelativePath));
    if not Target.StartsWith(Root,True) then raise Exception.Create('Invalid workspace path');
    for I := 0 to Services.ModuleCount-1 do
      for J := 0 to Services.Modules[I].ModuleFileCount-1 do begin
        Editor := Services.Modules[I].ModuleFileEditors[J];
        if SameText(Editor.FileName,Target) and Editor.Modified then raise Exception.Create('Save editor changes before approving or restoring this file');
      end;
  end;
begin
  if View = nil then raise Exception.Create('Review unavailable');
  if not Supports(BorlandIDEServices,IOTAModuleServices,Services) then raise Exception.Create('IDE document state unavailable');
  Files := View.GetValue('checkedPaths') as TJSONArray;
  if Files <> nil then for K := 0 to Files.Count-1 do CheckPath(Files.Items[K].Value);
  Files := View.GetValue('files') as TJSONArray;
  if Files <> nil then for K := 0 to Files.Count-1 do CheckPath((Files.Items[K] as TJSONObject).GetValue<string>('path',''))
  else CheckPath(View.GetValue<string>('path',''));
end;
procedure TPiChatForm.RefreshRestored(View: TJSONObject);
var Services: IOTAModuleServices; Files: TJSONArray; I,J,K: Integer;
  Root,Target: string; Module: IOTAModule; Match: Boolean;
begin
  // Disk restoration does not invalidate a loaded Delphi form automatically.
  // Recheck buffers on the IDE thread before refreshing any associated module.
  EnsureSaved(View);
  if not Supports(BorlandIDEServices,IOTAModuleServices,Services) then raise Exception.Create('IDE document state unavailable');
  Files := View.GetValue('files') as TJSONArray;if Files=nil then Exit;
  Root := IncludeTrailingPathDelimiter(TPath.GetFullPath(TNetEncoding.URL.Decode(Copy(FWorkspace,9,MaxInt).Replace('+','%2B')).Replace('/','\')));
  for I := 0 to Services.ModuleCount-1 do begin
    Module := Services.Modules[I];Match := False;
    for K := 0 to Files.Count-1 do begin
      Target := TPath.GetFullPath(TPath.Combine(Root,(Files.Items[K] as TJSONObject).GetValue<string>('path','')));
      if not Target.StartsWith(Root,True) then raise Exception.Create('Invalid workspace path');
      for J := 0 to Module.ModuleFileCount-1 do
        if SameText(Module.ModuleFileEditors[J].FileName,Target) then Match := True;
    end;
    if Match then Module.Refresh(True);
  end;
end;
procedure TPiChatForm.MessageReceived(Sender: TCustomEdgeBrowser; Args: TWebMessageReceivedEventArgs);
var Source, Json: PWideChar; Msg: TJSONObject; Action,Path,Root,Folder,Url,RequestId: string; Error,Reply: TJSONObject;
  Dialog: TOpenDialog; FolderDialog: TFileOpenDialog; Items: TJSONArray; I,Line: Integer; Module: IOTAModule; Editor: IOTAEditor; SourceEditor: IOTASourceEditor; Project: IOTAProject; EditPos: TOTAEditPos; EditorServices: IOTAEditorServices; View: IOTAEditView; Block: IOTAEditBlock; SelectionText: string;
begin
  Source := nil; Json := nil;
  try
   try
    OleCheck(Args.ArgsInterface.Get_Source(Source)); if string(Source) <> Page then Exit;
    OleCheck(Args.ArgsInterface.Get_webMessageAsJson(Json)); if Length(string(Json)) > 400000 then Exit;
    Msg := TJSONObject.ParseJSONValue(string(Json)) as TJSONObject; if Msg = nil then Exit;
    try
      Action := Msg.GetValue<string>('action','');RequestId := Msg.GetValue<string>('id','');
      if Action = 'ready' then begin
        FReady := True;
        if (GetUserDefaultUILanguage and $3FF) = LANG_KOREAN then
          Post('{"type":"hostLocale","systemLanguage":"ko"}')
        else Post('{"type":"hostLocale","systemLanguage":"en"}');
        Exit;
      end;
      if Action = 'notify' then begin if not Active then FlashWindow(Handle,True);Exit;end;
      if Action = 'connect' then begin
        if FWorkspacePending then Exit;
        Msg.AddPair('workspaceUri',CurrentWorkspace).AddPair('ideCatalog',FIdeHost.Catalog(CurrentWorkspace)); FWorkspacePending := True;
      end else if not MatchText(Action,['cancel','clearSelection']) then begin
        FWorkspaceCheckAt := 0; SyncWorkspace;
        if FWorkspacePending or not SameText(CurrentWorkspace,FWorkspace) then
          raise Exception.Create('프로젝트를 다시 연결하고 있습니다. 입력 초안은 보존됩니다. 연결이 끝난 뒤 다시 시도해 주세요.');
      end;
      if Action = 'clearSelection' then begin FreeAndNil(FSelection);Exit;end;
      if Action = 'captureSelection' then begin
        if not Supports(BorlandIDEServices,IOTAEditorServices,EditorServices) then raise Exception.Create('Editor unavailable');
        View := EditorServices.TopView;if (View=nil) or (View.Buffer=nil) or (View.Buffer.FileName='') then raise Exception.Create('Open a source editor and select text');
        Block := View.Block;if (Block=nil) or not Block.IsValid or (Block.Size=0) then raise Exception.Create('Select text in the source editor');
        SelectionText := Block.Text;if TEncoding.UTF8.GetByteCount(SelectionText)>32768 then raise Exception.Create('Selection exceeds 32 KiB');
        Path := TPath.GetFullPath(View.Buffer.FileName).Replace('\','/');
        FreeAndNil(FSelection);FSelection := TJSONObject.Create.AddPair('documentUri','file:///'+TNetEncoding.URL.Encode(Path).Replace('%2F','/').Replace('%3A',':').Replace('+','%20')).AddPair('workspaceUri',CurrentWorkspace).AddPair('language','Delphi');
        FSelection.AddPair('selection',TJSONObject.Create.AddPair('text',SelectionText).AddPair('startLine',TJSONNumber.Create(Block.StartingRow)).AddPair('startColumn',TJSONNumber.Create(Block.StartingColumn)).AddPair('endLine',TJSONNumber.Create(Block.EndingRow)).AddPair('endColumn',TJSONNumber.Create(Block.EndingColumn)));
        Reply := TJSONObject.Create.AddPair('type','selection').AddPair('context',TJSONValue(FSelection.Clone));try Post(Reply.ToJSON);finally Reply.Free;end;Exit;
      end;
      if (Action='prompt') and (FSelection<>nil) then Msg.AddPair('context',TJSONValue(FSelection.Clone));
      if Action = 'copy' then begin
        Path := Msg.GetValue<string>('text','');if Length(Path)>1000000 then raise Exception.Create('Clipboard text exceeds limit');Clipboard.AsText := Path;
        Reply := TJSONObject.Create.AddPair('type','copied');if Msg.GetValue('id')<>nil then Reply.AddPair('id',TJSONValue(Msg.GetValue('id').Clone));try Post(Reply.ToJSON);finally Reply.Free;end;Exit;
      end;
      if Action = 'openUrl' then begin
        Url := Msg.GetValue<string>('url','');if not Url.StartsWith('https://',True) and not Url.StartsWith('http://',True) then raise Exception.Create('Only HTTP(S) URLs can be opened');
        if ShellExecute(Handle,'open',PChar(Url),nil,nil,SW_SHOWNORMAL)<=32 then RaiseLastOSError;Exit;
      end;
      if Action = 'openFile' then begin
        Root := TPath.GetFullPath(TNetEncoding.URL.Decode(Copy(CurrentWorkspace,9,MaxInt)).Replace('/','\'));
        Path := Msg.GetValue<string>('path','');if Path.StartsWith('file:///') then Path := TNetEncoding.URL.Decode(Copy(Path,9,MaxInt)).Replace('/','\');
        if not TPath.IsPathRooted(Path) then Path := TPath.Combine(Root,Path);Path := TPath.GetFullPath(Path);
        if not Path.StartsWith(IncludeTrailingPathDelimiter(Root),True) or not FileExists(Path) then raise Exception.Create('File must exist inside the active project workspace');
        Module := (BorlandIDEServices as IOTAModuleServices).OpenModule(Path);
        Line := Msg.GetValue<Integer>('line',0);
        if Module<>nil then for I := 0 to Module.ModuleFileCount-1 do begin Editor := Module.ModuleFileEditors[I];if Supports(Editor,IOTASourceEditor,SourceEditor) then begin SourceEditor.Show;if (Line>0) and (SourceEditor.EditViewCount>0) then begin EditPos.Line := Line;EditPos.Col := 1;SourceEditor.EditViews[0].CursorPos := EditPos;end;Break;end;end;Exit;
      end;
      if (Action = 'attachFiles') or (Action = 'addFolder') then begin
        Items := TJSONArray.Create;
        try
          if Action = 'addFolder' then begin
            FolderDialog := TFileOpenDialog.Create(Self);
            try
              FolderDialog.Title := 'Add folder';
              FolderDialog.Options := [fdoPickFolders,fdoPathMustExist,fdoForceFileSystem];
              FolderDialog.DefaultFolder := TNetEncoding.URL.Decode(Copy(CurrentWorkspace,9,MaxInt)).Replace('/','\');
              if FolderDialog.Execute(Handle) then begin
                Folder := FolderDialog.FileName;
                Reply := TJSONObject.Create.AddPair('action','addWorkspaceFolder').AddPair('path',Folder);
                try FWorker.Enqueue(Reply.ToJSON);finally Reply.Free;end;
              end;
            finally FolderDialog.Free;end;
            Exit;
          end
          else begin Dialog := TOpenDialog.Create(Self);try Dialog.Options := [ofFileMustExist,ofAllowMultiSelect,ofEnableSizing];if Dialog.Execute then for I := 0 to Dialog.Files.Count-1 do Items.AddElement(TJSONObject.Create.AddPair('path',Dialog.Files[I]).AddPair('name',ExtractFileName(Dialog.Files[I])));finally Dialog.Free;end;end;
          Reply := TJSONObject.Create.AddPair('type','attachments').AddPair('items',TJSONValue(Items.Clone));try Post(Reply.ToJSON);finally Reply.Free;end;
        finally Items.Free;end;Exit;
      end;
      if Action = 'compile' then begin Project := GetActiveProject;if Project=nil then raise Exception.Create('Project unavailable');Reply := TJSONObject.Create.AddPair('type','buildResult').AddPair('success',TJSONBool.Create(Project.ProjectBuilder.BuildProject(cmOTABuild,True)));try Post(Reply.ToJSON);finally Reply.Free;end;Exit;end;
      if (Action = 'connect') and FWorker.Finished then begin FreeAndNil(FWorker); FWorker := TPiChatWorker.Create; FWorker.Start; end;
      if (Action = 'decideChange') and (Msg.GetValue<string>('decision','') = 'approve') then EnsureSaved(FApproval);
      if Action = 'restoreChange' then EnsureSaved(FRestore);if Action='restoreMessage' then EnsureSaved(FMessageRestore);
      FWorker.Enqueue(Msg.ToJSON);
    finally Msg.Free; end;
  except on E: Exception do begin
    Error := TJSONObject.Create.AddPair('type','operationError').AddPair('message',E.Message).AddPair('action',Action).AddPair('id',RequestId);
    try Post(Error.ToJSON); finally Error.Free; end;
  end; end;
  finally CoTaskMemFree(Source); CoTaskMemFree(Json); end;
end;
procedure TPiChatForm.Poll(Sender: TObject);
var Json: string; Msg, Data, Frame, Reply: TJSONObject; Kind,Path: string; I,K,J: Integer; Dialog: TSaveDialog; Files: TJSONArray;
  Module: IOTAModule; SourceEditor: IOTASourceEditor; Batch: TStringList;
begin
  if FDispatching then Exit;
  FDispatching:=True;
  try
  // Bound work on the IDE thread. All SDK and browser access remains on this thread.
  Batch:=TStringList.Create;
  try
  for I:=1 to 256 do begin Json:=FWorker.Pop; if Json='' then Break; Batch.Add(Json); end;
  // Retire cancellations before SDK mutation, even when the request was queued
  // first while the IDE thread was busy. IDs are bounded session tombstones.
  for Json in Batch do begin
    Msg:=TJSONObject.ParseJSONValue(Json) as TJSONObject;
    try
      if (Msg<>nil) and (Msg.GetValue<string>('type','')='event') then begin
        Data:=Msg.GetValue('data') as TJSONObject;
        if (Data<>nil) and (Data.GetValue('frame') is TJSONObject) then begin
          Frame:=Data.GetValue('frame') as TJSONObject; Kind:=Frame.GetValue<string>('type','');
          if (Kind='ide_cancel') or (Kind='designer_cancel') then begin
            Path:=Frame.GetValue<string>('id','');
            if Kind='ide_cancel' then FIdeHost.Cancel(Path);
          end;
        end;
      end;
    finally Msg.Free; end;
  end;
  for Json in Batch do begin
    Msg := TJSONObject.ParseJSONValue(Json) as TJSONObject;
    try
      Kind := Msg.GetValue<string>('type','');
      if Kind = 'exportReady' then begin Dialog := TSaveDialog.Create(Self);try Dialog.Filter := 'HTML|*.html';Dialog.FileName := 'PiAgent-conversation.html';Dialog.Options := [ofOverwritePrompt,ofEnableSizing];if Dialog.Execute then TFile.Copy(Msg.GetValue<string>('path',''),Dialog.FileName,True);finally Dialog.Free;end;Continue;end;
      if Kind = 'extensions' then begin
        Files := Msg.GetValue('configFiles') as TJSONArray;
        if Files<>nil then for K := 0 to Files.Count-1 do begin
          try
            Path := Files.Items[K].Value;Module := (BorlandIDEServices as IOTAModuleServices).OpenModule(Path);
            if Module=nil then raise Exception.Create('IDE could not open MCP configuration: '+Path);
            for J := 0 to Module.ModuleFileCount-1 do
              if Supports(Module.ModuleFileEditors[J],IOTASourceEditor,SourceEditor) then begin SourceEditor.Show;Break;end;
          except on E:Exception do begin
            Reply := TJSONObject.Create.AddPair('type','operationError').AddPair('action','manageExtensions').AddPair('message',E.Message);
            try Post(Reply.ToJSON);finally Reply.Free;end;
          end;end;
        end;
      end;
      if ((Kind='session') and (Msg.GetValue('restoredDraft')<>nil) and (Msg.GetValue('restoreError')=nil)) or (Kind='restored') then begin
        try
          if Kind='restored' then RefreshRestored(FRestore) else RefreshRestored(FMessageRestore);
        except on E:Exception do begin
          Reply := TJSONObject.Create.AddPair('type','operationError').AddPair('action','refreshRestored').AddPair('message','Files restored; IDE reload failed: '+E.Message);
          try Post(Reply.ToJSON);finally Reply.Free;end;
        end;end;
      end;
      if Kind = 'session' then begin FWorkspace := Msg.GetValue<string>('workspaceUri',''); FWorkspacePending := False; FreeAndNil(FApproval); FreeAndNil(FRestore); FreeAndNil(FSelection); FreeAndNil(FMessageRestore); end;
      if Kind = 'workspaceDisconnected' then begin FWorkspace := ''; FWorkspacePending := False; end;
      if (Kind = 'operationError') and MatchText(Msg.GetValue<string>('action',''),['connect','disconnectWorkspace']) then begin FWorkspacePending := False; FWorkspaceCheckAt := GetTickCount64 + 5000; end;
      if Kind = 'messageRestorePreview' then begin FreeAndNil(FMessageRestore);FMessageRestore := TJSONObject(Msg.GetValue('data').Clone);end;
      if Kind = 'restorePreview' then begin FreeAndNil(FRestore); FRestore := TJSONObject(Msg.GetValue('data').Clone); end;
      if Kind = 'event' then begin
        Data := Msg.GetValue('data') as TJSONObject; Kind := Data.GetValue<string>('kind','');
        if (Kind = 'omp_event') and (Data.GetValue('frame') is TJSONObject) then begin
          Frame := Data.GetValue('frame') as TJSONObject;
          if (Frame.GetValue<string>('type','')='ide_cancel') or (Frame.GetValue<string>('type','')='designer_cancel') then Continue;
          if Frame.GetValue<string>('type','')='ide_request' then begin
            if not FWorker.BeginSdkRequest(Data.GetValue<string>('sessionId',''),Frame.GetValue<string>('id','')) then Continue;
            Reply:=nil;
            try
              try
                if FWorkspacePending or not SameText(CurrentWorkspace,FWorkspace) then raise Exception.Create('IDE request project changed');
                Reply:=FIdeHost.Execute(Frame,FWorkspace);
              except on E: Exception do Reply:=TJSONObject.Create.AddPair('action','ideReply')
                .AddPair('requestId',Frame.GetValue<string>('id','')).AddPair('error',E.Message); end;
              if (Reply<>nil) and FWorker.MayReplySdk(Frame.GetValue<string>('id','')) then FWorker.Enqueue(Reply.ToJSON);
            finally Reply.Free; end;
            Continue;
          end;
          if Frame.GetValue<string>('type','') = 'designer_request' then begin
            if not FWorker.BeginSdkRequest(Data.GetValue<string>('sessionId',''),Frame.GetValue<string>('id','')) then Continue;
            Reply := TJSONObject.Create.AddPair('action','designerReply').AddPair('requestId',Frame.GetValue<string>('id',''));
            try
              try
                if FWorkspacePending or not SameText(CurrentWorkspace,FWorkspace) then raise Exception.Create('디자이너 요청의 프로젝트가 변경되었습니다.');
                Reply.AddPair('result',ExecuteDesigner(Frame.GetValue<string>('operation',''),Frame.GetValue('args') as TJSONObject,FWorkspace));
              except on E: Exception do Reply.AddPair('error',E.Message); end;
              if FWorker.MayReplySdk(Frame.GetValue<string>('id','')) then FWorker.Enqueue(Reply.ToJSON);
            finally Reply.Free; end;
            Continue;
          end;
        end;
        if Kind = 'approval_requested' then begin FreeAndNil(FApproval); FApproval := TJSONObject(Data.GetValue('approval').Clone); end;
        if (Kind = 'approval_resolved') or (Kind = 'closed') then FreeAndNil(FApproval);
      end;
      Post(Json);
    finally Msg.Free; end;
  end;
  finally Batch.Free; end;
  Reply:=FIdeHost.Poll;
  if Reply<>nil then try if FWorker.MayReplySdk(Reply.GetValue<string>('requestId','')) then FWorker.Enqueue(Reply.ToJSON); finally Reply.Free; end;
  if FReady and not FWorkspacePending and (FWorkspace<>'') and (GetTickCount64>=FIdeCatalogAt) then begin
    FIdeCatalogAt:=GetTickCount64+2000;
    try
      Reply:=FIdeHost.Catalog(FWorkspace);
      try
        if Reply.GetValue<string>('revision','')<>FIdeRevision then begin
          FIdeRevision:=Reply.GetValue<string>('revision','');
          Frame:=TJSONObject.Create.AddPair('action','ideCatalog').AddPair('catalog',TJSONValue(Reply.Clone));
          try FWorker.Enqueue(Frame.ToJSON); finally Frame.Free; end;
        end;
      finally Reply.Free; end;
    except on E: Exception do OutputDebugString(PChar('PiAgent catalog: '+E.Message)); end;
  end;
  SyncWorkspace;
  finally FDispatching:=False; end;
end;
procedure ShowPiAgentChat;
begin if ChatForm = nil then ChatForm := TPiChatForm.Create(nil); ChatForm.Show; ChatForm.BringToFront; end;
initialization
  ChatForm := nil;
finalization
  FreeAndNil(ChatForm);
end.
