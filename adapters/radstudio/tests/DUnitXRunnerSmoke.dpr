program DUnitXRunnerSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.IOUtils, System.JSON, Winapi.ActiveX,
  PiAgent.OwnedProcess in '..\src\PiAgent.OwnedProcess.pas',
  PiAgent.TestResults in '..\src\PiAgent.TestResults.pas',
  PiAgent.TestArguments in '..\src\PiAgent.TestArguments.pas';
var Run: TPiOwnedProcess; Report: TJSONObject; FileName: string; Raised: Boolean;
begin
  CoInitialize(nil);
  try
    try
      if not DUnitXFilterValid('') or not DUnitXFilterValid('DUnitXFixture.TAgentFixture.Passing') or
        DUnitXFilterValid('--run:other') or DUnitXFilterValid(StringOfChar('a',1025)) then
        raise Exception.Create('Production DUnitX filter scope failed');
      FileName:=TPath.Combine(ExtractFileDir(ParamStr(0)),'dunitx-smoke.xml');
      if FileExists(FileName) then TFile.Delete(FileName);
      Run:=TPiOwnedProcess.Create(ParamStr(1),['--xmlfile:'+FileName,'--exitbehavior:Continue','--consolemode:Quiet'],ExtractFileDir(ParamStr(1)),60000);
      try Run.Start; Run.WaitFor;
        if (Run.Code<>1) or (Run.Error<>'') then raise Exception.Create('DUnitX actual failing runner not observed: '+Run.Error);
        Report:=ParseNUnitResults(TFile.ReadAllText(FileName,TEncoding.UTF8));
        try if (Report.GetValue<Integer>('total',0)<>2) or (Report.GetValue<Integer>('failures',0)<>1) then raise Exception.Create('NUnit actual report counts mismatch');
        finally Report.Free; end;
      finally Run.Free; end;
      TFile.Delete(FileName);
      Run:=TPiOwnedProcess.Create(ParamStr(1),['--xmlfile:'+FileName,'--exitbehavior:Continue','--consolemode:Quiet','--run:DUnitXFixture.TAgentFixture.Passing'],ExtractFileDir(ParamStr(1)),60000);
      try Run.Start; Run.WaitFor;
        if (Run.Code<>0) or (Run.Error<>'') then raise Exception.Create('DUnitX actual passing filter not observed: '+Run.Error);
        Report:=ParseNUnitResults(TFile.ReadAllText(FileName,TEncoding.UTF8));
        try if (Report.GetValue<Integer>('total',0)<>1) or (Report.GetValue<Integer>('failures',0)<>0) then raise Exception.Create('NUnit actual filtered counts mismatch');
        finally Report.Free; end;
      finally Run.Free; end;
      Raised:=False;
      try Report:=ParseNUnitResults('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///C:/Windows/win.ini">]><test-results>&e;</test-results>'); Report.Free;
      except Raised:=True; end;
      if not Raised then raise Exception.Create('External XML entity accepted');
      Writeln('PASS: actual DUnitX failure/pass/filter, actual NUnit counts, XML external entity refusal');
    except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
  finally CoUninitialize; end;
end.
