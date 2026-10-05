program ChatSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.JSON, Winapi.Windows, PiAgent.ChatWorker in '../src/PiAgent.ChatWorker.pas',
  PiAgent.CoreRuntime in '../src/PiAgent.CoreRuntime.pas',
  PiAgent.PipeClient in '../src/PiAgent.PipeClient.pas';
var Worker: TPiChatWorker; Id,Rebind: string; Frame,Data,Review,Decision: TJSONObject; Started: UInt64;
function WaitType(const Expected: string): TJSONObject;
var Text,Kind: string;
begin
  Started := GetTickCount64;
  repeat
    Text := Worker.Pop;
    if Text <> '' then begin
      Result := TJSONObject.ParseJSONValue(Text) as TJSONObject; Kind := Result.GetValue<string>('type','');
      if (Kind = 'operationError') or (Kind = 'disconnected') then begin Text := Result.ToJSON; Result.Free; raise Exception.Create(Text); end;
      if Kind = Expected then Exit;
      if Kind = 'event' then begin
        Data := Result.GetValue('data') as TJSONObject;
        if Data.GetValue<string>('kind','') = Expected then Exit;
      end;
      Result.Free;
    end;
    Sleep(10);
  until GetTickCount64 - Started > 15000;
  raise Exception.Create('Event timeout: ' + Expected);
end;
begin
  Worker := nil;
  try
    Worker := TPiChatWorker.Create; Worker.Start; Decision := TJSONObject.Create.AddPair('action','connect').AddPair('workspaceUri',GetEnvironmentVariable('PIAGENT_WORKSPACE_URI'));try Worker.Enqueue(Decision.ToJSON);finally Decision.Free;end;
    Frame := WaitType('session'); Id := Frame.GetValue<string>('savedSessionId',''); Frame.Free;
    Worker.Enqueue('{"action":"prompt","message":"propose-batch"}');
    Frame := WaitType('approval_requested');
    try Review := (Frame.GetValue('data') as TJSONObject).GetValue('approval') as TJSONObject;
      Decision := TJSONObject.Create.AddPair('action','decideChange').AddPair('proposalId',Review.GetValue<string>('proposalId','')).AddPair('decision','approve');
      try Worker.Enqueue(Decision.ToJSON); finally Decision.Free; end;
    finally Frame.Free; end;
    Frame := WaitType('completed'); Frame.Free;
    Worker.Enqueue('{"action":"listCheckpoints"}'); Frame := WaitType('checkpoints');
    try Review := (Frame.GetValue('items') as TJSONArray).Items[0] as TJSONObject;
      Worker.Enqueue('{"action":"previewRestore","checkpointId":"'+Review.GetValue<string>('checkpointId','')+'"}');
    finally Frame.Free; end;
    Frame := WaitType('restorePreview');
    try Review := Frame.GetValue('data') as TJSONObject;
      Worker.Enqueue('{"action":"restoreChange","checkpointId":"'+Review.GetValue<string>('checkpointId','')+'"}');
    finally Frame.Free; end;
    Frame := WaitType('restored'); Frame.Free;
    Worker.Enqueue('{"action":"reset"}'); Frame := WaitType('session'); Frame.Free;
    Worker.Enqueue('{"action":"resumeSession","savedSessionId":"'+Id+'"}'); Frame := WaitType('session'); Frame.Free;
    Worker.Enqueue('{"action":"preferences"}');Frame := WaitType('preferences');if Frame.GetValue('values')=nil then raise Exception.Create('Preferences missing');Frame.Free;
    Worker.Enqueue('{"action":"listFiles"}');Frame := WaitType('files');if Frame.GetValue('items')=nil then raise Exception.Create('Files missing');Frame.Free;
    Worker.Enqueue('{"action":"export"}');Frame := WaitType('exportReady');if not FileExists(Frame.GetValue<string>('path','')) then raise Exception.Create('Export missing');Frame.Free;
    Worker.Enqueue('{"action":"btw","id":"side","text":"question"}');Frame := WaitType('btwAccepted');Frame.Free;
    Worker.Enqueue('{"action":"btwList"}');Frame := WaitType('btwList');if Frame.GetValue('items')=nil then raise Exception.Create('BTW list missing');Frame.Free;
    Worker.Enqueue('{"action":"usage"}'); Frame := WaitType('usage'); Frame.Free;
    Rebind := GetEnvironmentVariable('PIAGENT_REBIND_WORKSPACE_URI');
    if Rebind <> '' then begin
      // Switch with an old-project approval pending: it must cancel rather than retain stale work.
      Worker.Enqueue('{"action":"prompt","message":"propose-batch"}');Frame := WaitType('approval_requested');Frame.Free;
      Decision := TJSONObject.Create.AddPair('action','connect').AddPair('workspaceUri',Rebind);try Worker.Enqueue(Decision.ToJSON);finally Decision.Free;end;
      Frame := WaitType('session');try if not SameText(Frame.GetValue<string>('workspaceUri',''),Rebind) then raise Exception.Create('Rebind workspace mismatch');finally Frame.Free;end;
      Worker.Enqueue('{"action":"reset"}');Frame := WaitType('session');try if not SameText(Frame.GetValue<string>('workspaceUri',''),Rebind) then raise Exception.Create('New session used stale workspace');finally Frame.Free;end;
      Worker.Enqueue('{"action":"disconnectWorkspace"}');Frame := WaitType('workspaceDisconnected');Frame.Free;
      Decision := TJSONObject.Create.AddPair('action','connect').AddPair('workspaceUri',GetEnvironmentVariable('PIAGENT_WORKSPACE_URI'));try Worker.Enqueue(Decision.ToJSON);finally Decision.Free;end;
      Frame := WaitType('session');Frame.Free;
    end;
    WriteLn('{"applied":true,"restored":true,"resumed":true,"usage":true}');
  except on E: Exception do begin WriteLn(E.Message); ExitCode := 1; end; end;
  Worker.Free;
end.
