program OwnedProcessSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.Classes, Winapi.Windows,
  PiAgent.OwnedProcess in '..\src\PiAgent.OwnedProcess.pas';
type TArgv = array[0..65535] of PWideChar; PArgv = ^TArgv;
function CommandLineToArgvW(Command: PWideChar; var Count: Integer): PArgv;
  stdcall; external 'shell32.dll';
var Run: TPiOwnedProcess; I,ArgCount: Integer; Command: string; Info: TStartupInfo;
  Arguments: PArgv;
  Process: TProcessInformation; Child: THandle; ChildId: Cardinal;
procedure Check(Value: Boolean; const Message: string);
begin if not Value then raise Exception.Create(Message); end;
begin
  try
    if ParamStr(1)='--sleep' then begin Sleep(30000); Exit; end;
    if ParamStr(1)='--echo' then begin
      Arguments:=CommandLineToArgvW(GetCommandLineW,ArgCount);
      try for I:=2 to ArgCount-1 do Writeln(string(Arguments[I])); finally LocalFree(HLOCAL(Arguments)); end;
      Exit;
    end;
    if ParamStr(1)='--spam' then begin for I:=1 to 20000 do Writeln('bounded stdout fixture'); Exit; end;
    if ParamStr(1)='--tree' then begin
      FillChar(Info,SizeOf(Info),0); Info.cb:=SizeOf(Info);
      Command:=QuoteProcessArgument(ParamStr(0))+' --sleep'; UniqueString(Command);
      if not CreateProcess(PChar(ParamStr(0)),PChar(Command),nil,nil,False,CREATE_NO_WINDOW,nil,nil,Info,Process) then RaiseLastOSError;
      Writeln(Process.dwProcessId); Flush(Output); CloseHandle(Process.hThread); CloseHandle(Process.hProcess); Exit;
    end;
    Run:=TPiOwnedProcess.Create(ParamStr(0),['--echo','space value','quote"value','trailing\','`$();&'],ExtractFileDir(ParamStr(0)),5000);
    try Run.Start; Run.WaitFor;
      Check(Run.Error='','echo launch: '+Run.Error); Check(Run.Code=0,'echo result');
      Check(Run.Output='space value'+sLineBreak+'quote"value'+sLineBreak+'trailing\'+sLineBreak+'`$();&'+sLineBreak,'Windows argument quoting: '+Run.Output);
    finally Run.Free; end;
    Run:=TPiOwnedProcess.Create(ParamStr(0),['--spam'],ExtractFileDir(ParamStr(0)),5000);
    try Run.Start; Run.WaitFor; Check(Run.Code=0,'spam exit'); Check(Run.Truncated,'bounded output'); Check(Length(Run.Output)<=131072,'output cap'); finally Run.Free; end;
    Run:=TPiOwnedProcess.Create(ParamStr(0),['--sleep'],ExtractFileDir(ParamStr(0)),80);
    try Run.Start; Run.WaitFor; Check(Run.TimedOut,'timeout'); finally Run.Free; end;
    Run:=TPiOwnedProcess.Create(ParamStr(0),['--sleep'],ExtractFileDir(ParamStr(0)),5000);
    try Run.Start; Sleep(80); Run.Cancel; Run.WaitFor; Check(Run.Cancelled,'cancel'); finally Run.Free; end;
    Run:=TPiOwnedProcess.Create(ParamStr(0),['--tree'],ExtractFileDir(ParamStr(0)),5000);
    try Run.Start; Run.WaitFor; Check(Run.Error='','tree launch: '+Run.Error);
      ChildId:=StrToInt(Trim(Run.Output)); Child:=OpenProcess(SYNCHRONIZE,False,ChildId);
      if Child<>0 then try Check(WaitForSingleObject(Child,2000)=WAIT_OBJECT_0,'descendant survived job closure'); finally CloseHandle(Child); end;
    finally Run.Free; end;
    Writeln('PASS: quoted arguments, output bounds, timeout, cancellation, descendant cleanup');
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
