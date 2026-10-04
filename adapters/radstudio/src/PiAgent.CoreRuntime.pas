unit PiAgent.CoreRuntime;
interface
uses Winapi.Windows;
procedure EnsureInstalledCore(const Name:string; Cancel:THandle);
implementation
uses System.SysUtils,System.Classes,System.JSON,System.IOUtils,System.RegularExpressions;
function IsWow64Process2(Process:THandle; var ProcessMachine,NativeMachine:Word):BOOL;stdcall;external 'kernel32.dll';
function Quote(const Value:string):string;
var C:Char; Slashes:Integer;
begin
 Result := '"';Slashes := 0;
 for C in Value do begin
  if C='\' then begin Inc(Slashes);Continue;end;
  if C='"' then Result := Result+StringOfChar('\',Slashes*2+1)
  else Result := Result+StringOfChar('\',Slashes);
  Result := Result+C;Slashes := 0;
 end;
 Result := Result+StringOfChar('\',Slashes*2)+'"';
end;
function Listening(const Name:string):Boolean;
var Code:Cardinal;
begin
 // Probe availability without opening and immediately abandoning an unauthenticated peer.
 if WaitNamedPipe(PChar('\\.\pipe\'+Name),100) then Exit(True);
 Code := GetLastError;if (Code=ERROR_PIPE_BUSY) or (Code=ERROR_SEM_TIMEOUT) then Exit(True);
 if Code<>ERROR_FILE_NOT_FOUND then RaiseLastOSError(Code);Result := False;
end;
procedure EnsureInstalledCore(const Name:string; Cancel:THandle);
var Root,Release,Runtime,Node,Args,Auth,Dotnet,Environment,Path,Value:string;
 Receipt,Settings:TJSONObject; Start:TStartupInfo; Process:TProcessInformation;
 Source,Entry:PChar; Started:UInt64;
 ProcessMachine,NativeMachine:Word;
begin
 if not TRegEx.IsMatch(Name,'^[a-zA-Z0-9_-]{1,128}$') then raise Exception.Create('Invalid pipe name');
 if Listening(Name) then Exit;
 Root := TPath.Combine(GetEnvironmentVariable('LOCALAPPDATA'),'Programs\PiAgent');
 Receipt := TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(Root,'install-receipt.json'))) as TJSONObject;
 try
  if (Receipt=nil) or (Receipt.GetValue<string>('Product','')<>'PiAgent.Setup.38557171-e01d-4d7b-9842-3b435c5eed83') then raise Exception.Create('Invalid PiAgent install receipt');
  Release := TPath.GetFullPath(Receipt.GetValue<string>('Release',''));
  if not Release.ToLower.StartsWith(IncludeTrailingPathDelimiter(TPath.GetFullPath(Root)).ToLower) then raise Exception.Create('Invalid installed Core path');
 finally Receipt.Free;end;
 Runtime := TPath.Combine(Release,'core');
 Settings := TJSONObject.ParseJSONValue(TFile.ReadAllText(TPath.Combine(Runtime,'settings.json'))) as TJSONObject;
 try
  if Settings=nil then raise Exception.Create('Invalid Core settings');
  Node := TPath.GetFullPath(Settings.GetValue<string>('node',''));
  if not Node.ToLower.StartsWith(IncludeTrailingPathDelimiter(Release).ToLower) or not TFile.Exists(Node) then raise Exception.Create('Installed Node unavailable');
  Auth := GetEnvironmentVariable('PIAGENT_AUTH_FILE');if Auth='' then Auth := TPath.Combine(GetEnvironmentVariable('USERPROFILE'),'.piagent\security\'+Name+'\token');
  Args := Quote(Node)+' '+Quote(TPath.Combine(Runtime,'core.mjs'))+' --pipe '+Quote(Name)+' --auth-file '+Quote(Auth);
  Value := Settings.GetValue<string>('omp','');if Value<>'' then Args := Args+' --omp '+Quote(Value);
  Value := Settings.GetValue<string>('workspace','');if Value<>'' then Args := Args+' --workspace '+Quote(Value)+' --cwd '+Quote(Value);
  if Settings.GetValue<Boolean>('allowWrites',False) then Args := Args+' --allow-writes';
  Args := Args+' --omp-profile '+Quote(Settings.GetValue<string>('ompProfile','restricted'));
 finally Settings.Free;end;
 // Build a child-only environment; never mutate the IDE process environment.
 if not IsWow64Process2(GetCurrentProcess,ProcessMachine,NativeMachine) then RaiseLastOSError;
 if NativeMachine=$AA64 then Value := 'arm64' else Value := 'x64';
 Dotnet := TPath.Combine(Release,'runtimes\'+Value+'\dotnet');Environment := '';Path := GetEnvironmentVariable('PATH');
 Source := GetEnvironmentStrings;Entry := Source;
 try while Entry^<>#0 do begin
  Value := Entry;if not SameText(Copy(Value,1,5),'PATH=') and not Value.StartsWith('PIAGENT_DEV_PIPE=') then Environment := Environment+Value+#0;
  Inc(Entry,Length(Value)+1);
 end;finally FreeEnvironmentStrings(Source);end;
 Environment := Environment+'PATH='+Dotnet+';'+Path+#0+#0;
 FillChar(Start,SizeOf(Start),0);Start.cb := SizeOf(Start);UniqueString(Args);
 if not CreateProcess(PChar(Node),PChar(Args),nil,nil,False,CREATE_NO_WINDOW or CREATE_UNICODE_ENVIRONMENT,PChar(Environment),PChar(Runtime),Start,Process) then RaiseLastOSError;
 CloseHandle(Process.hThread);
 try
  Started := GetTickCount64;
  repeat
   if (Cancel<>0) and (WaitForSingleObject(Cancel,0)=WAIT_OBJECT_0) then raise Exception.Create('Core startup cancelled');
   if Listening(Name) and TFile.Exists(Auth) then Exit;
   if WaitForSingleObject(Process.hProcess,0)=WAIT_OBJECT_0 then raise Exception.Create('PiAgent Core startup failed');
   Sleep(100);
  until GetTickCount64-Started>20000;
  raise Exception.Create('PiAgent Core startup timed out');
 finally CloseHandle(Process.hProcess);end;
end;
end.
