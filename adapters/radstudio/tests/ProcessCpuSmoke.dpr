program ProcessCpuSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.JSON, Winapi.Windows,
  PiAgent.ProcessCpu in '..\src\PiAgent.ProcessCpu.pas';
var Run: TPiProcessCpu; Result: TJSONObject; Started: UInt64; Rejected: Boolean;
begin
  try
    Rejected:=False;
    try Run:=TPiProcessCpu.Create(GetCurrentProcessId,'C:\unrelated.exe',1); Run.Free;
    except Rejected:=True; end;
    if not Rejected then raise Exception.Create('Unbound CPU target accepted');
    Run:=TPiProcessCpu.Create(GetCurrentProcessId,ParamStr(0),1);
    try
      Result:=Run.Poll; if Result<>nil then begin Result.Free; raise Exception.Create('CPU result completed early'); end;
      Started:=GetTickCount64; while GetTickCount64-Started<1200 do GetCurrentProcessId;
      Result:=Run.Poll;
      if Result=nil then raise Exception.Create('CPU result did not complete');
      try if (Result.GetValue<Double>('cpuMilliseconds',0)<=0) or (Result.GetValue<Int64>('wallMilliseconds',0)<1000) or
        Result.GetValue<Boolean>('callStacksAvailable',True) then raise Exception.Create('CPU counters are not actual/bounded');
      finally Result.Free; end;
    finally Run.Free; end;
    Writeln('PASS: actual bounded process CPU counters, project executable guard, no fabricated call stacks');
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
