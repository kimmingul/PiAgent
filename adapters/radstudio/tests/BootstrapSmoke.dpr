program BootstrapSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils,Winapi.Windows,PiAgent.CoreRuntime in '../src/PiAgent.CoreRuntime.pas',PiAgent.PipeClient in '../src/PiAgent.PipeClient.pas';
var Client:TPiPipeClient;
begin
 try
  EnsureInstalledCore(ParamStr(1),0);Client := TPiPipeClient.Create(ParamStr(1));
  try Client.Hello('RAD13.2-64','bootstrap-smoke');Client.Ping('bootstrap');WriteLn('RAD bootstrap, authentication and ping passed');finally Client.Free;end;
 except on E:Exception do begin WriteLn(E.Message);ExitCode := 1;end;end;
end.
