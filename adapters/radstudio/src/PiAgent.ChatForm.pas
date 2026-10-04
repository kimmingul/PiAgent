unit PiAgent.ChatForm;
interface
uses System.Classes, System.JSON, Vcl.Forms, Vcl.Edge, Vcl.ExtCtrls, PiAgent.ChatWorker;
type
  TPiChatForm = class(TForm)
  private
    FBrowser: TEdgeBrowser;
    FTimer: TTimer;
    FWorker: TPiChatWorker;
    FReady: Boolean;
    FWorkspace: string;
    FApproval, FRestore: TJSONObject;
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
  public
    constructor Create(AOwner: TComponent); override;
    destructor Destroy; override;
  end;
procedure ShowPiAgentChat;
implementation
uses System.SysUtils, System.IOUtils, System.NetEncoding, System.Win.ComObj, Winapi.Windows, Winapi.ActiveX,
  Winapi.WebView2, Vcl.Controls, Vcl.StdCtrls, ToolsAPI;
const Page = 'https://piagent.local/chat.html';
  // Windows SDK flags, absent from older Delphi Winapi.Windows declarations.
  LoadFromDllDirectory = $00000100;
  LoadFromDefaultDirectories = $00001000;
var ChatForm: TPiChatForm;
constructor TPiChatForm.Create(AOwner: TComponent);
var ModuleName: array[0..32767] of Char; LoaderPath: string;
begin
  inherited CreateNew(AOwner); Caption := 'PiAgent Chat'; Width := 780; Height := 820;
  ShowInTaskbar := True;
  GetModuleFileName(HInstance,ModuleName,Length(ModuleName)); LoaderPath := TPath.Combine(ExtractFilePath(ModuleName),'WebView2Loader.dll');
  FLoader := LoadLibraryEx(PChar(LoaderPath),0,LoadFromDllDirectory or LoadFromDefaultDirectories);
  if FLoader = 0 then RaiseLastOSError;
  Position := poScreenCenter; FWorker := TPiChatWorker.Create; FWorker.Start;
  FTimer := TTimer.Create(Self); FTimer.Interval := 40; FTimer.OnTimer := Poll;
  FBrowser := TEdgeBrowser.Create(Self); FBrowser.Parent := Self; FBrowser.Align := alClient;
  FBrowser.UserDataFolder := TPath.Combine(GetEnvironmentVariable('LOCALAPPDATA'),'PiAgent\RADWebView2');
  FBrowser.OnCreateWebViewCompleted := Created; FBrowser.OnWebMessageReceived := MessageReceived;
  FBrowser.OnNavigationStarting := Navigating; FBrowser.OnNewWindowRequested := NewWindow;
  FBrowser.OnPermissionRequested := Permission; FBrowser.OnDownloadStarting := Download;
  FBrowser.CreateWebView;
end;
destructor TPiChatForm.Destroy;
begin
  FReady := False;
  if FTimer <> nil then begin FTimer.Enabled := False; FTimer.OnTimer := nil; end;
  FreeAndNil(FWorker); FApproval.Free; FRestore.Free;
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
  Files := View.GetValue('files') as TJSONArray;
  if Files <> nil then for K := 0 to Files.Count-1 do CheckPath((Files.Items[K] as TJSONObject).GetValue<string>('path',''))
  else CheckPath(View.GetValue<string>('path',''));
end;
procedure TPiChatForm.MessageReceived(Sender: TCustomEdgeBrowser; Args: TWebMessageReceivedEventArgs);
var Source, Json: PWideChar; Msg: TJSONObject; Action: string; Error: TJSONObject;
begin
  Source := nil; Json := nil;
  try
   try
    OleCheck(Args.ArgsInterface.Get_Source(Source)); if string(Source) <> Page then Exit;
    OleCheck(Args.ArgsInterface.Get_webMessageAsJson(Json)); if Length(string(Json)) > 400000 then Exit;
    Msg := TJSONObject.ParseJSONValue(string(Json)) as TJSONObject; if Msg = nil then Exit;
    try
      Action := Msg.GetValue<string>('action','');
      if Action = 'ready' then begin FReady := True; Exit; end;
      if (Action = 'connect') and FWorker.Finished then begin FreeAndNil(FWorker); FWorker := TPiChatWorker.Create; FWorker.Start; end;
      if (Action = 'decideChange') and (Msg.GetValue<string>('decision','') = 'approve') then EnsureSaved(FApproval);
      if Action = 'restoreChange' then EnsureSaved(FRestore);
      FWorker.Enqueue(Msg.ToJSON);
    finally Msg.Free; end;
  except on E: Exception do begin
    Error := TJSONObject.Create.AddPair('type','operationError').AddPair('message',E.Message);
    try Post(Error.ToJSON); finally Error.Free; end;
  end; end;
  finally CoTaskMemFree(Source); CoTaskMemFree(Json); end;
end;
procedure TPiChatForm.Poll(Sender: TObject);
var Json: string; Msg, Data: TJSONObject; Kind: string; I: Integer;
begin
  // Bound work on the IDE thread. All SDK and browser access remains on this thread.
  for I := 1 to 32 do begin
    Json := FWorker.Pop; if Json = '' then Exit;
    Msg := TJSONObject.ParseJSONValue(Json) as TJSONObject;
    try
      Kind := Msg.GetValue<string>('type','');
      if Kind = 'session' then begin FWorkspace := Msg.GetValue<string>('workspaceUri',''); FreeAndNil(FApproval); FreeAndNil(FRestore); end;
      if Kind = 'restorePreview' then begin FreeAndNil(FRestore); FRestore := TJSONObject(Msg.GetValue('data').Clone); end;
      if Kind = 'event' then begin
        Data := Msg.GetValue('data') as TJSONObject; Kind := Data.GetValue<string>('kind','');
        if Kind = 'approval_requested' then begin FreeAndNil(FApproval); FApproval := TJSONObject(Data.GetValue('approval').Clone); end;
        if (Kind = 'approval_resolved') or (Kind = 'closed') then FreeAndNil(FApproval);
      end;
      Post(Json);
    finally Msg.Free; end;
  end;
end;
procedure ShowPiAgentChat;
begin if ChatForm = nil then ChatForm := TPiChatForm.Create(nil); ChatForm.Show; ChatForm.BringToFront; end;
initialization
  ChatForm := nil;
finalization
  FreeAndNil(ChatForm);
end.
