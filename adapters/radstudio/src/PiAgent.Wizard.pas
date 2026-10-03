unit PiAgent.Wizard;
interface
procedure Register;
implementation
uses System.SysUtils, System.Classes, Winapi.Windows, Vcl.ExtCtrls,
  ToolsAPI, PiAgent.PipeClient;

type
  TProbeWorker = class(TThread)
  private
    FCancel: THandle;
    FName, FVersion: string;
    FDone: Integer;
  protected
    procedure Execute; override;
  public
    ResultText: string;
    constructor Create(const Name, Version: string);
    destructor Destroy; override;
    function Done: Boolean;
  end;
  TConnectionController = class(TComponent)
  private
    FWorker: TProbeWorker;
    FTimer: TTimer;
    procedure Poll(Sender: TObject);
  public
    constructor Create(AOwner: TComponent); override;
    destructor Destroy; override;
    procedure CheckConnection;
    function Busy: Boolean;
  end;
  // Let the IDE own the command menu and its startup/unload lifecycle.
  TConnectionWizard = class(TNotifierObject, IOTAWizard, IOTAMenuWizard)
  protected
    function GetIDString: string;
    function GetName: string;
    function GetMenuText: string;
    function GetState: TWizardState;
    procedure Execute;
  end;
var
  Controller: TConnectionController;
  Wizard: IOTAWizard;

constructor TProbeWorker.Create(const Name, Version: string);
begin
  inherited Create(True);
  FName := Name; FVersion := Version;
  FCancel := CreateEvent(nil, True, False, nil);
  if FCancel = 0 then RaiseLastOSError;
end;
destructor TProbeWorker.Destroy;
begin
  if FCancel <> 0 then
  begin SetEvent(FCancel); WaitFor; CloseHandle(FCancel); end;
  inherited;
end;
function TProbeWorker.Done: Boolean;
begin Result := InterlockedCompareExchange(FDone, 0, 0) <> 0; end;
procedure TProbeWorker.Execute;
var Client: TPiPipeClient;
begin
  if Terminated then Exit;
  try
    Client := TPiPipeClient.Create(FName, FCancel);
    try
      Client.Hello(FVersion, 'rad-' + IntToStr(GetCurrentProcessId));
      Client.Ping('PiAgent ' + #$C548#$B155 + ' ' + #$D83D#$DE80);
      ResultText := 'PiAgent: handshake/capability/ping OK';
    finally Client.Free; end;
  except on E: Exception do ResultText := 'PiAgent connection failed: ' + E.Message; end;
  InterlockedExchange(FDone, 1);
end;

constructor TConnectionController.Create(AOwner: TComponent);
begin
  inherited;
  FTimer := TTimer.Create(Self); FTimer.Enabled := False;
  FTimer.Interval := 100; FTimer.OnTimer := Poll;
end;
destructor TConnectionController.Destroy;
begin
  if FTimer <> nil then begin FTimer.Enabled := False; FTimer.OnTimer := nil; end;
  FreeAndNil(FWorker); // Cancel and join before unloading any package code.
  inherited;
end;
function TConnectionController.Busy: Boolean;
begin Result := FWorker <> nil; end;
procedure TConnectionController.CheckConnection;
var Name, Version: string;
begin
  if Busy then Exit;
  Name := GetEnvironmentVariable('PIAGENT_PIPE_NAME'); if Name = '' then Name := 'piagent-dev';
  Version := 'Delphi-' + FloatToStr(CompilerVersion);
  FWorker := TProbeWorker.Create(Name, Version);
  FWorker.Start; FTimer.Enabled := True;
end;
procedure TConnectionController.Poll(Sender: TObject);
var Messages: IOTAMessageServices; Text: string;
begin
  if (FWorker = nil) or not FWorker.Done then Exit;
  Text := FWorker.ResultText; FreeAndNil(FWorker); FTimer.Enabled := False;
  if Supports(BorlandIDEServices, IOTAMessageServices, Messages) then
  begin
    Messages.AddToolMessage('', Text, 'PiAgent', 0, 0);
    Messages.ShowMessageView(nil);
  end;
end;
function TConnectionWizard.GetIDString: string;
begin Result := 'PiAgent.ConnectionWizard'; end;
function TConnectionWizard.GetName: string;
begin Result := 'PiAgent Core Connection'; end;
function TConnectionWizard.GetMenuText: string;
begin Result := 'PiAgent: Check Core Connection'; end;
function TConnectionWizard.GetState: TWizardState;
begin
  Result := [];
  if (Controller <> nil) and not Controller.Busy then Result := [wsEnabled];
end;
procedure TConnectionWizard.Execute;
begin if Controller <> nil then Controller.CheckConnection; end;
procedure Register;
begin
  if Wizard <> nil then Exit;
  Controller := TConnectionController.Create(nil);
  Wizard := TConnectionWizard.Create;
  RegisterPackageWizard(Wizard);
end;
initialization
  Controller := nil;
finalization
  Wizard := nil;
  FreeAndNil(Controller);
end.
