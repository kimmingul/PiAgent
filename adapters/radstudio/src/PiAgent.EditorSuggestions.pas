unit PiAgent.EditorSuggestions;
interface
uses System.JSON;
procedure SuggestPiAgentCode(const Mode: string);
function EditorFixtureAction(const Action: string): TJSONObject;
implementation
uses System.SysUtils, System.Classes, System.IOUtils, System.NetEncoding,
  System.Hash, Winapi.Windows, Winapi.Imm, Vcl.Forms, Vcl.StdCtrls, Vcl.Controls,
  Vcl.ExtCtrls, Vcl.Dialogs, ToolsAPI, PiAgent.IdeContext, PiAgent.EditorOffsets,
  PiAgent.PipeClient, PiAgent.CoreRuntime, PiAgent.DesignerAuthoring;
type
  TEditorInference = class(TThread)
  private
    FCancel: THandle;
    FInput,FOutput,FError: string;
  protected
    procedure Execute; override;
  public
    constructor Create(const Json: string);
    destructor Destroy; override;
  end;
  TEditorPreview = class(TComponent)
  private
    FTimer: TTimer;
    FWorker: TEditorInference;
    FForm: TForm;
    FWorkspace,FProject,FFile,FText,FMode,FRequestId: string;
    FErrorText: string;
    FCaret: Integer;
    FReply: TJSONObject;
    function View: IOTAEditView;
    function CurrentCaret(const EditView: IOTAEditView; const Text: string): Integer;
    procedure Poll(Sender: TObject);
    procedure Accept(Sender: TObject);
    procedure ApplySuggestion;
    procedure Dismiss(Sender: TObject);
    procedure Cancel;
    procedure CheckSnapshot;
  public
    constructor Create(AOwner: TComponent); override;
    destructor Destroy; override;
    procedure Request(const Mode: string);
  end;
var Preview: TEditorPreview;
function Composing: Boolean;
var Info: TGUIThreadInfo; Input: HIMC;
begin
  Result:=False; FillChar(Info,SizeOf(Info),0); Info.cbSize:=SizeOf(Info);
  if not GetGUIThreadInfo(GetCurrentThreadId,Info) then Exit;
  Input:=ImmGetContext(Info.hwndFocus); if Input=0 then Exit;
  try Result:=ImmGetCompositionStringW(Input,GCS_COMPSTR,nil,0)>0;
  finally ImmReleaseContext(Info.hwndFocus,Input); end;
end;
constructor TEditorInference.Create(const Json: string);
begin
  inherited Create(True); FInput:=Json; FCancel:=CreateEvent(nil,True,False,nil);
  if FCancel=0 then RaiseLastOSError;
end;
destructor TEditorInference.Destroy;
begin Terminate; SetEvent(FCancel); WaitFor; CloseHandle(FCancel); inherited; end;
procedure TEditorInference.Execute;
var Client: TPiPipeClient; Params,Reply: TJSONObject; Name: string;
begin
  Client:=nil;
  try
    Name:=GetEnvironmentVariable('PIAGENT_PIPE_NAME'); if Name='' then Name:='piagent-dev';
    EnsureInstalledCore(Name,FCancel);
    Client:=TPiPipeClient.Create(Name,FCancel); Client.Hello('37.0','rad-editor-'+IntToStr(GetTickCount64),False,True);
    Params:=TJSONObject.ParseJSONValue(FInput) as TJSONObject;
    if (Params.GetValue('context')<>nil) and not Client.HasCapability('editor.context.v1') then begin
      Params.Free; raise Exception.Create('Core does not support bounded editor context windows');
    end;
    Reply:=Client.Request('editor.suggest',Params);
    try FOutput:=Reply.ToJSON; finally Reply.Free; end;
  except on E:Exception do FError:=E.Message; end;
  Client.Free;
end;
constructor TEditorPreview.Create(AOwner: TComponent);
begin inherited; FTimer:=TTimer.Create(Self); FTimer.Interval:=100; FTimer.Enabled:=False; FTimer.OnTimer:=Poll; end;
destructor TEditorPreview.Destroy;
begin FTimer.Enabled:=False; FTimer.OnTimer:=nil; Cancel; inherited; end;
procedure TEditorPreview.Cancel;
begin FreeAndNil(FWorker); FreeAndNil(FForm); FreeAndNil(FReply); FTimer.Enabled:=False; end;
function TEditorPreview.View: IOTAEditView;
var Editors: IOTAEditorServices;
begin
  RequireIdeThread;
  if not Supports(BorlandIDEServices,IOTAEditorServices,Editors) or (Editors.TopView=nil) or
    (Editors.TopView.Buffer=nil) then raise Exception.Create('Open a source editor first');
  Result:=Editors.TopView;
end;
function TEditorPreview.CurrentCaret(const EditView: IOTAEditView; const Text: string): Integer;
var EditPos: TOTAEditPos; CharPos: TOTACharPos;
begin
  EditPos:=EditView.CursorPos; FillChar(CharPos,SizeOf(CharPos),0);
  EditView.ConvertPos(True,EditPos,CharPos);
  Result:=ByteToUtf16Offset(Text,EditView.CharPosToPos(CharPos));
end;
procedure TEditorPreview.CheckSnapshot;
var EditView: IOTAEditView; Project: IOTAProject; Current: string;
begin
  if Composing then raise Exception.Create('Finish IME composition before accepting a suggestion');
  Project:=GetActiveProject;
  if (Project=nil) or not SameText(Project.FileName,FProject) then
    raise Exception.Create('Suggestion project changed');
  EditView:=View;
  if not SameText(ResolveIdeFile(FWorkspace,EditView.Buffer.FileName),FFile) then
    raise Exception.Create('Suggestion document changed');
  Current:=ReadEditorText(EditView.Buffer,1048576);
  if (Current<>FText) or (CurrentCaret(EditView,Current)<>FCaret) then
    raise Exception.Create('Suggestion revision or caret changed');
end;
procedure TEditorPreview.Request(const Mode: string);
var Project: IOTAProject; EditView: IOTAEditView; Params: TJSONObject; Root,Window: string; Id: TGUID;
  WindowStart,WindowEnd: Integer;
begin
  RequireIdeThread; Cancel; FErrorText:='';
  if not ((Mode='completion') or (Mode='next-edit')) then raise Exception.Create('Unknown suggestion mode');
  if Composing then raise Exception.Create('Finish IME composition before requesting suggestions');
  Project:=GetActiveProject; if Project=nil then raise Exception.Create('Open a saved project first');
  FProject:=Project.FileName;
  Root:=ExcludeTrailingPathDelimiter(ExtractFilePath(TPath.GetFullPath(Project.FileName))).Replace('\','/');
  FWorkspace:='file:///'+TNetEncoding.URL.Encode(Root).Replace('%2F','/').Replace('%3A',':').Replace('+','%20');
  EditView:=View; FFile:=ResolveIdeFile(FWorkspace,EditView.Buffer.FileName);
  if (EditView.Block<>nil) and EditView.Block.IsValid and (EditView.Block.Size<>0) then
    raise Exception.Create('Clear the editor selection before requesting a suggestion');
  if EditView.Buffer.IsReadOnly then raise Exception.Create('Editor is read-only');
  if not ((ExtractFileExt(FFile)='.pas') or (ExtractFileExt(FFile)='.cpp') or
    (ExtractFileExt(FFile)='.h') or (ExtractFileExt(FFile)='.hpp')) then
    raise Exception.Create('Suggestions support Delphi and C++ source editors');
  FText:=ReadEditorText(EditView.Buffer,1048576); FCaret:=CurrentCaret(EditView,FText); FMode:=Mode;
  Window:=FText; WindowStart:=0;
  if TEncoding.UTF8.GetByteCount(FText)>65536 then begin
    WindowStart:=FCaret-8192; if WindowStart<0 then WindowStart:=0;
    if (WindowStart>0) and (Ord(FText[WindowStart+1])>=$DC00) and (Ord(FText[WindowStart+1])<=$DFFF) then Dec(WindowStart);
    WindowEnd:=WindowStart+16384; if WindowEnd>Length(FText) then WindowEnd:=Length(FText);
    if (WindowEnd<Length(FText)) and (Ord(FText[WindowEnd])>=$D800) and (Ord(FText[WindowEnd])<=$DBFF) then Dec(WindowEnd);
    Window:=Copy(FText,WindowStart+1,WindowEnd-WindowStart);
  end;
  CreateGUID(Id); FRequestId:=GUIDToString(Id);
  Params:=TJSONObject.Create.AddPair('requestId',FRequestId).AddPair('workspaceUri',FWorkspace)
    .AddPair('file',Copy(FFile,Length(WorkspacePath(FWorkspace))+1,MaxInt).Replace('\','/'))
    .AddPair('text',Window).AddPair('position',TJSONNumber.Create(FCaret-WindowStart)).AddPair('mode',Mode);
  if Window<>FText then Params.AddPair('context',TJSONObject.Create.AddPair('start',TJSONNumber.Create(WindowStart))
    .AddPair('totalLength',TJSONNumber.Create(Length(FText))).AddPair('revision',THashSHA2.GetHashString(FText)));
  try FWorker:=TEditorInference.Create(Params.ToJSON); FWorker.Start;
  finally Params.Free; end;
  FTimer.Enabled:=True;
end;
procedure TEditorPreview.Poll(Sender: TObject);
var Memo: TMemo; AcceptButton,CancelButton: TButton; Start,Count: Integer;
begin
  try CheckSnapshot; except on E:Exception do begin FErrorText:=E.Message; Cancel; Exit; end; end;
  if (FWorker=nil) or not FWorker.Finished then Exit;
  FWorker.WaitFor;
  if FWorker.FError<>'' then begin
    FErrorText:=FWorker.FError;
    if GetEnvironmentVariable('PIAGENT_RAD_SDK_AUTORUN')<>'1' then MessageDlg('PiAgent: '+FErrorText,mtError,[mbOK],0);
    Cancel; Exit;
  end;
  FReply:=TJSONObject.ParseJSONValue(FWorker.FOutput) as TJSONObject; FreeAndNil(FWorker);
  try
    if (FReply=nil) or (FReply.GetValue<string>('requestId','')<>FRequestId) or
      not SameText(FReply.GetValue<string>('revision',''),THashSHA2.GetHashString(FText)) then
      raise Exception.Create('Stale editor suggestion');
    Start:=FReply.GetValue<Integer>('start',-1); Count:=FReply.GetValue<Integer>('length',-1);
    ValidateEditRange(FText,Start,Count);
    if TEncoding.UTF8.GetByteCount(FReply.GetValue<string>('text',''))>8192 then raise Exception.Create('Suggestion replacement exceeds limit');
    if (FMode='completion') and ((Start<>FCaret) or (Count<>0)) then raise Exception.Create('Invalid completion range');
    if FReply.GetValue<Boolean>('empty',False) then begin Cancel; Exit; end;
    FForm:=TForm.CreateNew(Self); FForm.Caption:='PiAgent: Review '+FMode;
    FForm.Width:=700; FForm.Height:=500; FForm.Position:=poScreenCenter;
    Memo:=TMemo.Create(FForm); Memo.Parent:=FForm; Memo.Align:=alClient; Memo.ReadOnly:=True;
    Memo.ScrollBars:=ssBoth; Memo.WordWrap:=False;
    Memo.Text:='Replace '+IntToStr(Count)+' UTF-16 characters at '+IntToStr(Start)+sLineBreak+
      'Before:'+sLineBreak+Copy(FText,Start+1,Count)+sLineBreak+'After:'+sLineBreak+FReply.GetValue<string>('text','');
    AcceptButton:=TButton.Create(FForm); AcceptButton.Parent:=FForm; AcceptButton.Align:=alBottom;
    AcceptButton.Caption:='Accept (editor Undo available)'; AcceptButton.OnClick:=Accept;
    CancelButton:=TButton.Create(FForm); CancelButton.Parent:=FForm; CancelButton.Align:=alBottom;
    CancelButton.Caption:='Dismiss'; CancelButton.Cancel:=True; CancelButton.OnClick:=Dismiss;
    FForm.Show;
  except on E: Exception do begin FErrorText:=E.Message;
    if GetEnvironmentVariable('PIAGENT_RAD_SDK_AUTORUN')<>'1' then MessageDlg('PiAgent: '+E.Message,mtError,[mbOK],0);
    Cancel; end; end;
end;
procedure TEditorPreview.ApplySuggestion;
var EditView: IOTAEditView; Writer: IOTAEditWriter; Start,Count: Integer; Replacement: UTF8String;
begin
    CheckSnapshot; EditView:=View;
    if EditView.Buffer.IsReadOnly then raise Exception.Create('Editor became read-only');
    Start:=FReply.GetValue<Integer>('start',-1); Count:=FReply.GetValue<Integer>('length',-1);
    ValidateEditRange(FText,Start,Count); Replacement:=UTF8String(FReply.GetValue<string>('text',''));
    Writer:=EditView.Buffer.CreateUndoableWriter;
    Writer.CopyTo(Utf16ToByteOffset(FText,Start));
    Writer.DeleteTo(Utf16ToByteOffset(FText,Start+Count)); Writer.Insert(Replacement); Writer:=nil;
    EditView.Buffer.Show;
    Cancel;
end;
procedure TEditorPreview.Accept(Sender: TObject);
begin
  try ApplySuggestion;
  except on E: Exception do MessageDlg('PiAgent: '+E.Message,mtError,[mbOK],0); end;
end;
procedure TEditorPreview.Dismiss(Sender: TObject);
begin Cancel; end;
procedure SuggestPiAgentCode(const Mode: string);
begin
  if Preview=nil then Preview:=TEditorPreview.Create(nil);
  try Preview.Request(Mode); except on E: Exception do MessageDlg('PiAgent: '+E.Message,mtError,[mbOK],0); end;
end;
function EditorFixtureAction(const Action: string): TJSONObject;
var Project: IOTAProject; Module: IOTAModule; Source: IOTASourceEditor; View: IOTAEditView;
  Root,Text: string; I,Offset: Integer; CharPos: TOTACharPos; EditPos: TOTAEditPos;
  UndoReturned: Boolean;
begin
  RequireIdeThread; UndoReturned:=False; Root:=GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH'); Project:=GetActiveProject;
  if (Root='') or (GetEnvironmentVariable('PIAGENT_RAD_SDK_AUTORUN')<>'1') or (Project=nil) or
    not SameText(ExtractFileDir(Project.FileName),Root) then raise Exception.Create('Explicit isolated SDK fixture required');
  Module:=(BorlandIDEServices as IOTAModuleServices).OpenModule(TPath.Combine(Root,'Main.pas'));
  if (Module=nil) or not DesignerAuthoringEnabled(Module) or
    not FileExists(TPath.Combine(Root,'.piagent-rad-fixture')) or
    (Trim(TFile.ReadAllText(TPath.Combine(Root,'.piagent-rad-fixture'),TEncoding.UTF8))<>'piagent-rad-fixture-v1') then raise Exception.Create('Fixture source unavailable');
  Source:=nil;
  for I:=0 to Module.ModuleFileCount-1 do if Supports(Module.ModuleFileEditors[I],IOTASourceEditor,Source) then Break;
  if Source=nil then raise Exception.Create('Fixture source editor unavailable');
  Source.Show;
  if Preview=nil then Preview:=TEditorPreview.Create(nil);
  View:=Preview.View;
  if not SameText(View.Buffer.FileName,TPath.Combine(Root,'Main.pas')) then raise Exception.Create('Fixture editor changed');
  Text:=ReadEditorText(View.Buffer);
  if (Action='park') or (Action='moveStart') then begin
    View.Block.Reset; Offset:=0;
    if Action='park' then Offset:=TEncoding.UTF8.GetByteCount(Text);
    CharPos:=View.PosToCharPos(Offset); FillChar(EditPos,SizeOf(EditPos),0);
    View.ConvertPos(False,EditPos,CharPos); View.CursorPos:=EditPos;
  end else if (Action='completion') or (Action='next-edit') then Preview.Request(Action)
  else if Action='accept' then begin
    if (Preview.FReply=nil) or (Preview.FForm=nil) then raise Exception.Create('Fixture suggestion is not ready');
    Preview.ApplySuggestion;
  end else if Action='undo' then begin
    UndoReturned:=View.Buffer.Undo;
  end else if Action='marker' then begin
    // Preceding user edit uses the native editor command, rather than a second
    // identical SDK writer which RAD groups into the same undo operation.
    View.Position.MoveEOF;
    View.Position.InsertText(sLineBreak+'{ '+#$D55C+#$AE00+#$D83D+#$DE42+' RAD_EDITOR_BEFORE }'+sLineBreak);
  end else if Action='dismiss' then Preview.Cancel
  else if Action<>'snapshot' then raise Exception.Create('Unknown fixture editor action');
  Text:=ReadEditorText(View.Buffer);
  Result:=TJSONObject.Create.AddPair('ready',TJSONBool.Create((Preview.FReply<>nil) and (Preview.FForm<>nil)))
    .AddPair('pending',TJSONBool.Create(Preview.FWorker<>nil)).AddPair('error',Preview.FErrorText)
    .AddPair('text',Text).AddPair('revision',THashSHA2.GetHashString(Text));
  if Action='undo' then Result.AddPair('nativeUndoReturn',TJSONBool.Create(UndoReturned));
end;
initialization
  Preview:=nil;
finalization
  FreeAndNil(Preview);
end.
