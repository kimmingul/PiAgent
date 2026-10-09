program ExternalBuildSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.IOUtils, System.JSON,
  PiAgent.OwnedProcess in '..\src\PiAgent.OwnedProcess.pas',
  PiAgent.BuildCommand in '..\src\PiAgent.BuildCommand.pas',
  PiAgent.BuildDiagnostics in '..\src\PiAgent.BuildDiagnostics.pas',
  PiAgent.ProjectIdentity in '..\src\PiAgent.ProjectIdentity.pas';
var Run: TPiOwnedProcess; Args: TArray<string>; Project,Log,Root,Dproj: string; Rows: TJSONArray; Rejected: Boolean;
begin
  try
    Project:=TPath.GetFullPath(ParamStr(1)); Root:=TPath.GetFullPath(ParamStr(2));
    // A real Delphi sidecar already exists here. Neither a C++ original
    // project nor a C++ personality may map to it by changing an extension.
    if not FileExists(Project) then raise Exception.Create('Sidecar collision fixture missing');
    if TryExternalDelphiProject(ChangeFileExt(Project,'.cbproj'),'CPlusPlusBuilder.Personality',Dproj) or (Dproj<>'') or
      TryExternalDelphiProject(ChangeFileExt(Project,'.cbproj'),'Delphi.Personality',Dproj) or
      TryExternalDelphiProject(Project,'CPlusPlusBuilder.Personality',Dproj) or
      TryExternalDelphiProject(Project,'',Dproj) then raise Exception.Create('C++/unknown original project accepted as Delphi sidecar');
    Rejected:=False;
    try Dproj:=RequireExternalDelphiProject(ChangeFileExt(Project,'.cbproj'),'CPlusPlusBuilder.Personality'); except Rejected:=True; end;
    if not Rejected then raise Exception.Create('Production external start guard accepted C++ sidecar');
    if RequireExternalDelphiProject(Project,'Delphi.Personality')<>Project then raise Exception.Create('Saved Delphi project identity lost');
    if RequireExternalDelphiProject(ChangeFileExt(Project,'.dpr'),'Delphi.Personality')<>Project then raise Exception.Create('Delphi source project mapping lost');
    Log:=TPath.Combine(ExtractFileDir(ParamStr(0)),'external-build-smoke.log');
    Args:=RadBuildArguments(Project,'Release','Win64',Root,Log,'Build');
    Run:=TPiOwnedProcess.Create(FindMsBuild,Args,ExtractFileDir(Project),30000,['BDS='+Root]);
    try Run.Start; Run.WaitFor;
      if (Run.Error<>'') or (Run.Code<>0) then raise Exception.Create('Build failed '+Run.Error+' '+Run.Output);
      if not FileExists(Log) then raise Exception.Create('External log missing');
    finally Run.Free; end;
    SetLength(Args,Length(Args)+1); Args[High(Args)]:='/p:DCC_Define=FAIL_FIXTURE';
    Run:=TPiOwnedProcess.Create(FindMsBuild,Args,ExtractFileDir(Project),30000,['BDS='+Root]);
    try Run.Start; Run.WaitFor;
      if Run.Code=0 then raise Exception.Create('Intentional compiler error passed');
      if not TFile.ReadAllText(Log,TEncoding.UTF8).Contains('E2003') then raise Exception.Create('Compiler diagnostic missing from UTF-8 log');
      Rows:=ParseBuildDiagnostics(TFile.ReadAllText(Log,TEncoding.UTF8),function(const FileName: string): string
        begin Result:=TPath.Combine(ExtractFileDir(Project),FileName); end);
      try
        if (Rows.Count<>1) or ((Rows.Items[0] as TJSONObject).GetValue<string>('code','')<>'E2003') or
          ((Rows.Items[0] as TJSONObject).GetValue<Integer>('line',0)<>5) then raise Exception.Create('Actual structured diagnostics parsing/deduplication failed');
      finally Rows.Free; end;
    finally Run.Free; end;
    Writeln('PASS: actual external Delphi MSBuild success/failure and UTF-8 compiler log');
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
