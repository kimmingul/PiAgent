program PipeSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.Classes, Winapi.Windows, PiAgent.PipeClient in '..\src\PiAgent.PipeClient.pas';
var Client: TPiPipeClient; Name, Mode: string; Cancel: THandle; Canceller: TThread;
begin
  Cancel := 0; Canceller := nil; Mode := ParamStr(2);
  try
    if Mode = 'cancel' then
    begin
      Cancel := CreateEvent(nil, True, False, nil);
      if Cancel = 0 then RaiseLastOSError;
      Canceller := TThread.CreateAnonymousThread(procedure begin Sleep(100); SetEvent(Cancel); end);
      Canceller.FreeOnTerminate := False; Canceller.Start;
    end;
    Name := ParamStr(1); if Name = '' then Name := 'piagent-dev';
    Client := TPiPipeClient.Create(Name, Cancel);
    try
      try
        Client.Ping('before-hello');
        raise Exception.Create('Ping must require handshake');
      except on E: Exception do
        if E.Message <> 'Handshake required' then raise;
      end;
      Writeln(Client.Hello('13.2-smoke', 'delphi-smoke-' + IntToStr(GetCurrentProcessId)));
      if Mode <> '' then raise Exception.Create('Expected adapter failure');
      Writeln(Client.Ping('PiAgent ' + #$C548#$B155 + ' ' + #$D83D#$DE80));
    finally Client.Free; end;
  except on E: Exception do
    if ((Mode = 'cancel') and (Pos('cancelled', E.Message) > 0))
      or ((Mode = 'badframe') and (E.Message = 'Invalid frame length')) then
      Writeln('expected-failure: ' + Mode)
    else begin Writeln(E.Message); ExitCode := 1; end;
  end;
  if Canceller <> nil then begin Canceller.WaitFor; Canceller.Free; end;
  if Cancel <> 0 then CloseHandle(Cancel);
end.
