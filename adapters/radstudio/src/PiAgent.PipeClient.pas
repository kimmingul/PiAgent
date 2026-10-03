unit PiAgent.PipeClient;

interface

uses System.SysUtils, System.Classes, System.JSON, Winapi.Windows;

type
  TPiPipeClient = class
  private
    FPipe, FCancel: THandle;
    FSequence: Integer;
    FDeadline: UInt64;
    FReady: Boolean;
    procedure Transfer(Writing: Boolean; var Buffer; Count: Cardinal);
    function Call(const Method: string; Params: TJSONObject): TJSONObject;
  public
    constructor Create(const Name: string; CancelHandle: THandle = 0);
    destructor Destroy; override;
    function Hello(const IdeVersion, InstanceId: string): string;
    function Ping(const Nonce: string): string;
  end;

implementation

uses System.RegularExpressions;

const MaxFrameBytes = 1048576;

constructor TPiPipeClient.Create(const Name: string; CancelHandle: THandle);
var Path: string; Started: UInt64; ErrorCode: Cardinal;
begin
  inherited Create;
  FPipe := INVALID_HANDLE_VALUE;
  FCancel := CancelHandle;
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
var Request, Reply: TJSONObject; Bytes, Encoded: TBytes; Header: array[0..3] of Byte;
  Id, Text: string; Length: Cardinal;
begin
  FDeadline := GetTickCount64 + 5000;
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
  Transfer(False, Header, 4);
  Length := Cardinal(Header[0]) or (Cardinal(Header[1]) shl 8)
    or (Cardinal(Header[2]) shl 16) or (Cardinal(Header[3]) shl 24);
  if (Length = 0) or (Length > MaxFrameBytes) then raise Exception.Create('Invalid frame length');
  SetLength(Bytes, Length); Transfer(False, Bytes[0], Length);
  Text := TEncoding.UTF8.GetString(Bytes);
  Encoded := TEncoding.UTF8.GetBytes(Text);
  if (System.Length(Encoded) <> System.Length(Bytes)) or not CompareMem(Pointer(Bytes), Pointer(Encoded), Length) then
    raise Exception.Create('Invalid UTF-8 response');
  Reply := TJSONObject.ParseJSONValue(Text) as TJSONObject;
  if Reply = nil then raise Exception.Create('Invalid RPC response');
  try
    if (Reply.GetValue<string>('jsonrpc', '') <> '2.0') or (Reply.GetValue<string>('id', '') <> Id)
      or ((Reply.GetValue('result') = nil) = (Reply.GetValue('error') = nil)) then
      raise Exception.Create('Invalid RPC response');
    if Reply.GetValue('error') <> nil then raise Exception.Create('RPC failed: ' + Reply.GetValue('error').ToJSON);
    if not (Reply.GetValue('result') is TJSONObject) then raise Exception.Create('Expected object result');
    Result := TJSONObject(Reply.GetValue('result').Clone);
  finally Reply.Free; end;
end;

function TPiPipeClient.Hello(const IdeVersion, InstanceId: string): string;
var Params, Adapter, Reply: TJSONObject; Caps: TJSONArray;
begin
  if FReady then raise Exception.Create('Already initialized');
  Params := TJSONObject.Create;
  Params.AddPair('protocolVersions', TJSONArray.Create.Add(1));
  Params.AddPair('capabilities', TJSONArray.Create.Add('core.ping'));
  Params.AddPair('requiredCapabilities', TJSONArray.Create.Add('core.ping'));
  Adapter := TJSONObject.Create;
  Adapter.AddPair('kind', 'rad-studio'); Adapter.AddPair('version', '0.1.0');
  Adapter.AddPair('ideVersion', IdeVersion); Adapter.AddPair('instanceId', InstanceId);
  Adapter.AddPair('capabilities', TJSONArray.Create);
  Params.AddPair('adapter', Adapter);
  Reply := Call('adapter.hello', Params);
  try
    Caps := Reply.GetValue('capabilities') as TJSONArray;
    if (Reply.GetValue<Integer>('protocolVersion', 0) <> 1) or (Caps = nil)
      or (Caps.Count <> 1) or (Caps.Items[0].Value <> 'core.ping') then
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
