unit PiAgent.BuildCommand;
interface
function FindMsBuild: string;
function RadBuildArguments(const Project,Configuration,Platform,BdsRoot,LogFile,Target: string): TArray<string>;
implementation
uses System.SysUtils, System.IOUtils, System.RegularExpressions;
function FindMsBuild: string;
begin
  Result:=TPath.Combine(GetEnvironmentVariable('WINDIR'),'Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe');
  if not FileExists(Result) then Result:=TPath.Combine(GetEnvironmentVariable('WINDIR'),'Microsoft.NET\Framework\v4.0.30319\MSBuild.exe');
  if not FileExists(Result) then raise Exception.Create('Installed .NET Framework MSBuild is unavailable');
end;
function RadBuildArguments(const Project,Configuration,Platform,BdsRoot,LogFile,Target: string): TArray<string>;
begin
  if not TRegEx.IsMatch(Configuration,'^[A-Za-z0-9_. -]{1,128}$') or
    not TRegEx.IsMatch(Platform,'^[A-Za-z0-9_]{1,32}$') then raise Exception.Create('Unsupported build configuration/platform name');
  if not ((Target='Make') or (Target='Build')) then raise Exception.Create('Unsupported external build target');
  Result:=[Project,'/nologo','/v:normal','/t:'+Target,'/p:Config='+Configuration,
    '/p:Platform='+Platform,'/p:BDS='+BdsRoot,
    '/fileLogger','/fileLoggerParameters:LogFile='+LogFile+';Encoding=UTF-8;Verbosity=normal'];
end;
end.
