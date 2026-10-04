unit PiAgent.PipeClient;

interface

uses System.SysUtils, System.Classes, System.JSON, Winapi.Windows;

type
  TPiNotification = reference to procedure(const Json: string);
  TPiPipeClient = class
  private
    FPipe, FCancel: THandle;
    FSequence: Integer;
    FDeadline: UInt64;
    FReady: Boolean;
    FName: string;
    FOnNotification: TPiNotification;
    function ReadFrame: TJSONObject;
    function Notify(Reply: TJSONObject): Boolean;
    procedure Authenticate;
    procedure Transfer(Writing: Boolean; var Buffer; Count: Cardinal);
    function Call(const Method: string; Params: TJSONObject): TJSONObject;
  public
    constructor Create(const Name: string; CancelHandle: THandle = 0);
    destructor Destroy; override;
    function Hello(const IdeVersion, InstanceId: string; Chat: Boolean = False): string;
    function Ping(const Nonce: string): string;
    function Request(const Method: string; Params: TJSONObject): TJSONObject;
    function PollNotification: Boolean;
    property OnNotification: TPiNotification read FOnNotification write FOnNotification;
  end;

implementation

uses System.RegularExpressions, System.IOUtils, System.Hash, System.StrUtils;

const MaxFrameBytes = 1048576;

function BCryptGenRandom(Algorithm: THandle; Buffer: PByte; Length, Flags: Cardinal): LongInt; stdcall; external 'bcrypt.dll';

constructor TPiPipeClient.Create(const Name: string; CancelHandle: THandle);
var Path: string; Started: UInt64; ErrorCode: Cardinal;
begin
  inherited Create;
  FPipe := INVALID_HANDLE_VALUE;
  FCancel := CancelHandle;
  FName := Name;
  if not TRegEx.IsMatch(Name, '^[a-zA-Z0-9_-]{1,128}$') then
    raise Exception.Create('Invalid pipe name');
  Path := '\\.\pipe\' + Name;
  Started := GetTickCount64;
  repeat
    if (FCancel <> 0) and (WaitForSingleObject(FCancel, 0) = WAIT_OBJECT_0) then
      raise Exception.Create('Connection cancelled');
    FPipe := CreateFile(PChar(Path), GENERIC_READ or GENERIC_WRITE, 0, nil,
      OPEN_EXISTING, FILE_FLAG_OVERLAPPED, 0);
    if FPipe <> INVALID_HANDLE_VALUE then Exit;
    ErrorCode := GetLastError;
    if (ErrorCode <> ERROR_FILE_NOT_FOUND) and (ErrorCode <> ERROR_PIPE_BUSY) then
      RaiseLastOSError(ErrorCode);
    if FCancel <> 0 then WaitForSingleObject(FCancel, 20) else Sleep(20);
  until GetTickCount64 - Started >= 5000;
  raise Exception.Create('Core connection timeout');
end;

procedure TPiPipeClient.Authenticate;
var FileName, Token, Nonce, Server, Actual, Expected: string; Key, Bytes: TBytes;
  Challenge, Reply: TJSONObject; I, Difference: Integer;
  function Hex(const Data: TBytes): string;
  var B: Byte;
  begin Result := ''; for B in Data do Result := Result + LowerCase(IntToHex(B, 2)); end;
  function Proof(const Role: string): string;
  begin Result := Hex(THashSHA2.GetHMACAsBytes('piagent.' + Role + '.v1' + #10 + FName + #10 + Nonce + #10 + Server, Key)); end;
begin
  FileName := GetEnvironmentVariable('PIAGENT_AUTH_FILE');
  if FileName = '' then
  begin
    FileName := TPath.Combine(GetEnvironmentVariable('USERPROFILE'), '.piagent\security\' + FName + '\token');
    if not TFile.Exists(FileName) and (GetEnvironmentVariable('PIAGENT_DEV_PIPE') = '1') then Exit;
  end;
  try Token := TFile.ReadAllText(FileName, TEncoding.UTF8);
  except raise Exception.Create('Cannot read authentication credential'); end;
  if not TRegEx.IsMatch(Token, '\A[0-9a-f]{64}\z') then raise Exception.Create('Invalid authentication credential');
  SetLength(Key, 32); for I := 0 to 31 do Key[I] := StrToInt('$' + Copy(Token, I * 2 + 1, 2));
  SetLength(Bytes, 32);
  if BCryptGenRandom(0, @Bytes[0], 32, 2) <> 0 then raise Exception.Create('Secure random generation failed');
  Nonce := Hex(Bytes);
  Challenge := Call('core.auth.challenge', TJSONObject.Create.AddPair('clientNonce', Nonce));
  try
    Server := Challenge.GetValue<string>('serverNonce', ''); Actual := Challenge.GetValue<string>('serverProof', '');
    if (Challenge.GetValue<string>('scheme', '') <> 'hmac-sha256.v1') or not TRegEx.IsMatch(Server, '\A[0-9a-f]{64}\z')
      or not TRegEx.IsMatch(Actual, '\A[0-9a-f]{64}\z') then raise Exception.Create('Core authentication failed');
    Expected := Proof('server'); Difference := 0;
    for I := 1 to 64 do Difference := Difference or (Ord(Actual[I]) xor Ord(Expected[I]));
    if Difference <> 0 then raise Exception.Create('Core authentication failed');
  finally Challenge.Free; end;
  Reply := Call('adapter.auth', TJSONObject.Create.AddPair('proof', Proof('client')));
  try if not Reply.GetValue<Boolean>('authenticated', False) then raise Exception.Create('Adapter authentication failed');
  finally Reply.Free; end;
end;

destructor TPiPipeClient.Destroy;
begin
  if FPipe <> INVALID_HANDLE_VALUE then CloseHandle(FPipe);
  inherited;
end;

procedure TPiPipeClient.Transfer(Writing: Boolean; var Buffer; Count: Cardinal);
var
  Overlapped: TOverlapped;
  Handles: array[0..1] of THandle;
  Done, Offset, ErrorCode, WaitResult, Remaining: Cardinal;
  Ok: Boolean;
begin
  Offset := 0;
  while Offset < Count do
  begin
    if GetTickCount64 >= FDeadline then raise Exception.Create('Pipe I/O timeout');
    if (FCancel <> 0) and (WaitForSingleObject(FCancel, 0) = WAIT_OBJECT_0) then
      raise Exception.Create('Pipe I/O cancelled');
    FillChar(Overlapped, SizeOf(Overlapped), 0);
    Overlapped.hEvent := CreateEvent(nil, True, False, nil);
    if Overlapped.hEvent = 0 then RaiseLastOSError;
    try
      if Writing then Ok := WriteFile(FPipe, PByte(@Buffer)[Offset], Count - Offset, Done, @Overlapped)
      else Ok := ReadFile(FPipe, PByte(@Buffer)[Offset], Count - Offset, Done, @Overlapped);
      if not Ok then
      begin
        ErrorCode := GetLastError;
        if ErrorCode <> ERROR_IO_PENDING then RaiseLastOSError(ErrorCode);
        Handles[0] := Overlapped.hEvent;
        Handles[1] := FCancel;
        if GetTickCount64 >= FDeadline then Remaining := 0
        else Remaining := Cardinal(FDeadline - GetTickCount64);
        if FCancel <> 0 then WaitResult := WaitForMultipleObjects(2, @Handles[0], False, Remaining)
        else WaitResult := WaitForSingleObject(Handles[0], Remaining);
        if WaitResult <> WAIT_OBJECT_0 then
        begin
          CancelIoEx(FPipe, @Overlapped);
          GetOverlappedResult(FPipe, Overlapped, Done, True); // Retire operation before freeing its buffers.
          raise Exception.Create('Pipe I/O cancelled or timed out');
        end;
        if not GetOverlappedResult(FPipe, Overlapped, Done, False) then RaiseLastOSError;
      end;
      if Ok and not GetOverlappedResult(FPipe, Overlapped, Done, False) then RaiseLastOSError;
      if Done = 0 then raise Exception.Create('Core disconnected during frame');
      Inc(Offset, Done);
    finally CloseHandle(Overlapped.hEvent); end;
  end;
end;

function TPiPipeClient.Call(const Method: string; Params: TJSONObject): TJSONObject;
var Request, Reply: TJSONObject; Bytes: TBytes; Header: array[0..3] of Byte;
  Id: string; Length: Cardinal;
begin
  FDeadline := GetTickCount64 + 5000;
  if MatchText(Method,['chat.open','chat.setApproval','chat.extensions','changes.decide','changes.restore','chat.usage','sessions.list','omp.control']) then FDeadline := GetTickCount64 + 60000;
  Inc(FSequence);
  Id := 'delphi-' + IntToStr(FSequence);
  Request := TJSONObject.Create;
  try
    Request.AddPair('jsonrpc', '2.0'); Request.AddPair('id', Id);
    Request.AddPair('method', Method); Request.AddPair('params', Params);
    Bytes := TEncoding.UTF8.GetBytes(Request.ToJSON);
  finally Request.Free; end;
  Length := System.Length(Bytes);
  if (Length = 0) or (Length > MaxFrameBytes) then raise Exception.Create('Invalid frame length');
  Header[0] := Byte(Length); Header[1] := Byte(Length shr 8);
  Header[2] := Byte(Length shr 16); Header[3] := Byte(Length shr 24);
  Transfer(True, Header, 4); Transfer(True, Bytes[0], Length);
  repeat
    Reply := ReadFrame;
    if Notify(Reply) then begin Reply.Free; Reply := nil; end;
  until Reply <> nil;
  try
    if (Reply.GetValue<string>('jsonrpc', '') <> '2.0') or (Reply.GetValue<string>('id', '') <> Id)
      or ((Reply.GetValue('result') = nil) = (Reply.GetValue('error') = nil)) then
      raise Exception.Create('Invalid RPC response');
    if Reply.GetValue('error') <> nil then raise Exception.Create('RPC failed: ' + Reply.GetValue('error').ToJSON);
    if not (Reply.GetValue('result') is TJSONObject) then raise Exception.Create('Expected object result');
    Result := TJSONObject(Reply.GetValue('result').Clone);
  finally Reply.Free; end;
end;

function TPiPipeClient.ReadFrame: TJSONObject;
var Bytes, Encoded: TBytes; Header: array[0..3] of Byte; Length: Cardinal; Text: string;
begin
  Transfer(False, Header, 4);
  Length := Cardinal(Header[0]) or (Cardinal(Header[1]) shl 8)
    or (Cardinal(Header[2]) shl 16) or (Cardinal(Header[3]) shl 24);
  if (Length = 0) or (Length > MaxFrameBytes) then raise Exception.Create('Invalid frame length');
  SetLength(Bytes, Length); Transfer(False, Bytes[0], Length);
  Text := TEncoding.UTF8.GetString(Bytes);
  Encoded := TEncoding.UTF8.GetBytes(Text);
  if (System.Length(Encoded) <> System.Length(Bytes)) or not CompareMem(Pointer(Bytes), Pointer(Encoded), Length) then
    raise Exception.Create('Invalid UTF-8 response');
  Result := TJSONObject.ParseJSONValue(Text) as TJSONObject;
  if Result = nil then raise Exception.Create('Invalid RPC response');
end;
function TPiPipeClient.Notify(Reply: TJSONObject): Boolean;
begin
  Result := (Reply.GetValue('id') = nil) and (Reply.GetValue<string>('jsonrpc','') = '2.0') and
    (Reply.GetValue<string>('method','') = 'chat.event') and (Reply.GetValue('params') is TJSONObject);
  if Result and Assigned(FOnNotification) then FOnNotification(Reply.ToJSON);
end;
function TPiPipeClient.PollNotification: Boolean;
var Available: Cardinal; Reply: TJSONObject;
begin
  Result := False;
  if not PeekNamedPipe(FPipe,nil,0,nil,@Available,nil) then RaiseLastOSError;
  if Available = 0 then Exit;
  FDeadline := GetTickCount64 + 30000;
  Reply := ReadFrame;
  try if not Notify(Reply) then raise Exception.Create('Unexpected uncorrelated frame');
  finally Reply.Free; end;
  Result := True;
end;
function TPiPipeClient.Request(const Method: string; Params: TJSONObject): TJSONObject;
begin
  if not FReady then begin Params.Free; raise Exception.Create('Handshake required'); end;
  if not MatchText(Method,['chat.open','chat.setApproval','chat.extensions','chat.prompt','chat.cancel','chat.close','changes.decide','changes.list',
    'changes.previewRestore','changes.restore','sessions.list','chat.usage','designer.reply','designer.decide','omp.respond','omp.control']) then
    begin Params.Free; raise Exception.Create('Method unavailable'); end;
  Result := Call(Method,Params);
end;

function TPiPipeClient.Hello(const IdeVersion, InstanceId: string; Chat: Boolean): string;
var Params, Adapter, Reply: TJSONObject; Caps, Required: TJSONArray;
begin
  if FReady then raise Exception.Create('Already initialized');
  Authenticate;
  Params := TJSONObject.Create;
  Params.AddPair('protocolVersions', TJSONArray.Create.Add(1));
  Caps := TJSONArray.Create.Add('core.ping');
  if Chat then begin Caps.Add('chat.v1'); Caps.Add('omp.controls.v1').Add('chat.approval.v1'); Caps.Add('ide.designer.v1'); Caps.Add('workspace.read.v1'); Caps.Add('workspace.edit.v1'); Caps.Add('workspace.edit.batch.v1'); Caps.Add('chat.sessions.v1'); Caps.Add('chat.usage.v1'); end;
  Params.AddPair('capabilities', Caps);
  Required := TJSONArray.Create.Add('core.ping'); if Chat then Required.Add('chat.v1');
  Params.AddPair('requiredCapabilities', Required);
  Adapter := TJSONObject.Create;
  Adapter.AddPair('kind', 'rad-studio'); Adapter.AddPair('version', '0.9.0');
  Adapter.AddPair('ideVersion', IdeVersion); Adapter.AddPair('instanceId', InstanceId);
  Adapter.AddPair('capabilities', TJSONArray.Create);
  Params.AddPair('adapter', Adapter);
  Reply := Call('adapter.hello', Params);
  try
    Caps := Reply.GetValue('capabilities') as TJSONArray;
    if (Reply.GetValue<Integer>('protocolVersion', 0) <> 1) or (Caps = nil)
      or (Caps.Count < 1) or (Caps.Items[0].Value <> 'core.ping') then
      raise Exception.Create('Required protocol/capability was not negotiated');
    FReady := True;
    Result := Reply.ToJSON;
  finally Reply.Free; end;
end;

function TPiPipeClient.Ping(const Nonce: string): string;
var Reply: TJSONObject;
begin
  if not FReady then raise Exception.Create('Handshake required');
  Reply := Call('core.ping', TJSONObject.Create.AddPair('nonce', Nonce));
  try
    if not Reply.GetValue<Boolean>('pong', False) or (Reply.GetValue<string>('nonce', '') <> Nonce) then
      raise Exception.Create('Unexpected pong/nonce');
    Result := Reply.ToJSON;
  finally Reply.Free; end;
end;

end.
