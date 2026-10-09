unit PiAgent.OwnedProcess;
interface
uses System.Classes, System.SysUtils, Winapi.Windows;
function QuoteProcessArgument(const Argument: string): string;
type
  TPiOwnedProcess = class(TThread)
  private
    FExecutable,FDirectory: string;
    FArguments: TArray<string>;
    FEnvironment: TArray<string>;
    FCancel: THandle;
    FTimeout: UInt64;
  protected
    procedure Execute; override;
  public
    Output,Error: string;
    Code: Cardinal;
    Cancelled,TimedOut,Truncated: Boolean;
    constructor Create(const Executable: string; const Arguments: TArray<string>;
      const Directory: string; Timeout: UInt64; const Environment: TArray<string> = nil);
    destructor Destroy; override;
    procedure Cancel;
  end;
implementation
// The SDK declaration uses a var for the reserved return-size argument, but
// HANDLE_LIST requires that argument to be NULL.
function UpdateProcessAttribute(List: PProcThreadAttributeList; Flags: DWORD;
  Attribute: NativeUInt; Value: Pointer; Size: NativeUInt; Previous,Returned: Pointer): BOOL;
  stdcall; external 'kernel32.dll' name 'UpdateProcThreadAttribute';
function QuoteProcessArgument(const Argument: string): string;
var I,Slashes: Integer;
begin
  if Pos(#0,Argument)>0 then raise Exception.Create('Process argument contains NUL');
  Result:='"'; Slashes:=0;
  for I:=1 to Length(Argument) do begin
    if Argument[I]='\' then Inc(Slashes)
    else begin
      if Argument[I]='"' then Result:=Result+StringOfChar('\',Slashes*2+1)
      else Result:=Result+StringOfChar('\',Slashes);
      Result:=Result+Argument[I]; Slashes:=0;
    end;
  end;
  Result:=Result+StringOfChar('\',Slashes*2)+'"';
end;
constructor TPiOwnedProcess.Create(const Executable: string; const Arguments: TArray<string>;
  const Directory: string; Timeout: UInt64; const Environment: TArray<string>);
begin
  inherited Create(True); FExecutable:=Executable; FArguments:=Copy(Arguments);
  FDirectory:=Directory; FTimeout:=Timeout; Code:=Cardinal(-1);
  FEnvironment:=Copy(Environment);
  FCancel:=CreateEvent(nil,True,False,nil); if FCancel=0 then RaiseLastOSError;
end;
procedure TPiOwnedProcess.Cancel;
begin SetEvent(FCancel); end;
destructor TPiOwnedProcess.Destroy;
begin Cancel; WaitFor; CloseHandle(FCancel); inherited; end;
procedure TPiOwnedProcess.Execute;
type TExtendedStartup = record Startup: TStartupInfo; Attributes: PProcThreadAttributeList; end;
var Job,ReadPipe,WritePipe,Input: THandle; Security: TSecurityAttributes;
  Info: TExtendedStartup; Process: TProcessInformation;
  Limits: TJobObjectExtendedLimitInformation; AttributeSize: NativeUInt;
  Handles: array[0..1] of THandle; Command,Argument,Stage: string; Began: UInt64;
  Available,ReadCount: Cardinal; Buffer: array[0..8191] of Byte; Bytes: TBytes; Count: Integer;
  AttributesInitialized: Boolean;
  Environment: TStringList; EnvironmentBlock,Pair: string; NativeEnvironment,Cursor: PChar;
  I,Equal: Integer;
  procedure Drain;
  var Take: Cardinal; Iterations: Integer;
  begin
    Iterations:=0;
    while (Iterations<64) and PeekNamedPipe(ReadPipe,nil,0,nil,@Available,nil) and (Available>0) do begin
      Inc(Iterations);
      Take:=Available; if Take>Cardinal(Length(Buffer)) then Take:=Length(Buffer);
      if not ReadFile(ReadPipe,Buffer[0],Take,ReadCount,nil) or (ReadCount=0) then Break;
      Count:=Length(Bytes);
      if Count+Integer(ReadCount)>131072 then begin ReadCount:=131072-Count; Truncated:=True; end;
      SetLength(Bytes,Count+Integer(ReadCount));
      if ReadCount>0 then Move(Buffer[0],Bytes[Count],ReadCount);
    end;
  end;
begin
  Job:=0; ReadPipe:=0; WritePipe:=0; Input:=INVALID_HANDLE_VALUE;
  FillChar(Info,SizeOf(Info),0); FillChar(Process,SizeOf(Process),0);
  AttributesInitialized:=False;
  try
    try
      Stage:='pipe';
      FillChar(Security,SizeOf(Security),0); Security.nLength:=SizeOf(Security); Security.bInheritHandle:=True;
      if not CreatePipe(ReadPipe,WritePipe,@Security,0) then RaiseLastOSError;
      if not SetHandleInformation(ReadPipe,HANDLE_FLAG_INHERIT,0) then RaiseLastOSError;
      Input:=CreateFile('NUL',GENERIC_READ,FILE_SHARE_READ or FILE_SHARE_WRITE,@Security,OPEN_EXISTING,0,0);
      if Input=INVALID_HANDLE_VALUE then RaiseLastOSError;
      Job:=CreateJobObject(nil,nil); if Job=0 then RaiseLastOSError;
      Stage:='job limits';
      FillChar(Limits,SizeOf(Limits),0); Limits.BasicLimitInformation.LimitFlags:=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if not SetInformationJobObject(Job,JobObjectExtendedLimitInformation,@Limits,SizeOf(Limits)) then RaiseLastOSError;
      AttributeSize:=0; InitializeProcThreadAttributeList(nil,1,0,AttributeSize);
      Stage:='attribute allocation';
      GetMem(Info.Attributes,AttributeSize);
      if not InitializeProcThreadAttributeList(Info.Attributes,1,0,AttributeSize) then RaiseLastOSError;
      AttributesInitialized:=True;
      Handles[0]:=WritePipe; Handles[1]:=Input;
      Stage:='handle inheritance';
      if not UpdateProcessAttribute(Info.Attributes,0,$00020002,@Handles[0],SizeOf(Handles),nil,nil) then RaiseLastOSError;
      Info.Startup.cb:=SizeOf(Info); Info.Startup.dwFlags:=STARTF_USESTDHANDLES;
      Info.Startup.hStdInput:=Input; Info.Startup.hStdOutput:=WritePipe; Info.Startup.hStdError:=WritePipe;
      Command:=QuoteProcessArgument(FExecutable);
      for Argument in FArguments do Command:=Command+' '+QuoteProcessArgument(Argument);
      UniqueString(Command);
      Environment:=TStringList.Create;
      try
        NativeEnvironment:=GetEnvironmentStrings;
        try
          Cursor:=NativeEnvironment;
          while Cursor^<>#0 do begin Pair:=string(Cursor); Environment.Add(Pair); Inc(Cursor,Length(Pair)+1); end;
        finally FreeEnvironmentStrings(NativeEnvironment); end;
        for Pair in FEnvironment do begin
          Equal:=Pos('=',Pair); if Equal<=1 then raise Exception.Create('Invalid child environment name');
          Environment.Values[Copy(Pair,1,Equal-1)]:=Copy(Pair,Equal+1,MaxInt);
        end;
        Environment.Sort; EnvironmentBlock:='';
        for I:=0 to Environment.Count-1 do EnvironmentBlock:=EnvironmentBlock+Environment[I]+#0;
        EnvironmentBlock:=EnvironmentBlock+#0;
      finally Environment.Free; end;
      Stage:='process launch';
      if not CreateProcess(PChar(FExecutable),PChar(Command),nil,nil,True,
        CREATE_SUSPENDED or CREATE_NO_WINDOW or EXTENDED_STARTUPINFO_PRESENT or CREATE_UNICODE_ENVIRONMENT,PChar(EnvironmentBlock),
        PChar(FDirectory),Info.Startup,Process) then RaiseLastOSError;
      if not AssignProcessToJobObject(Job,Process.hProcess) then begin
        Stage:='job assignment';
        TerminateProcess(Process.hProcess,1); RaiseLastOSError;
      end;
      if ResumeThread(Process.hThread)=Cardinal(-1) then RaiseLastOSError;
      CloseHandle(WritePipe); WritePipe:=0; CloseHandle(Input); Input:=INVALID_HANDLE_VALUE;
      Began:=GetTickCount64;
      repeat
        Drain;
        if WaitForSingleObject(Process.hProcess,20)=WAIT_OBJECT_0 then Break;
        Cancelled:=WaitForSingleObject(FCancel,0)=WAIT_OBJECT_0;
        TimedOut:=GetTickCount64-Began>=FTimeout;
        if Cancelled or TimedOut then begin TerminateJobObject(Job,1); WaitForSingleObject(Process.hProcess,5000); Break; end;
      until False;
      Drain; if not GetExitCodeProcess(Process.hProcess,Code) then RaiseLastOSError;
      Output:=TEncoding.Default.GetString(Bytes);
    except on E:Exception do Error:=Stage+': '+E.Message; end;
  finally
    if Job<>0 then CloseHandle(Job); // Kills descendants, including those outliving the root.
    if Process.hThread<>0 then CloseHandle(Process.hThread);
    if Process.hProcess<>0 then CloseHandle(Process.hProcess);
    if Input<>INVALID_HANDLE_VALUE then CloseHandle(Input);
    if WritePipe<>0 then CloseHandle(WritePipe);
    if ReadPipe<>0 then CloseHandle(ReadPipe);
    if Info.Attributes<>nil then begin
      if AttributesInitialized then DeleteProcThreadAttributeList(Info.Attributes);
      FreeMem(Info.Attributes);
    end;
  end;
end;
end.
