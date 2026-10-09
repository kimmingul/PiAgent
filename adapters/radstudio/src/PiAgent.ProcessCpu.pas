unit PiAgent.ProcessCpu;
interface
uses System.JSON, Winapi.Windows;
type TPiProcessCpu=class
private
  FHandle: THandle;
  FCreated,FKernel,FUser: UInt64;
  FStarted,FDuration: UInt64;
  FExecutable: string;
  FProcessId: Cardinal;
public
  constructor Create(ProcessId: Cardinal; const ExpectedExecutable: string; DurationSeconds: Integer);
  destructor Destroy; override;
  function Poll: TJSONObject;
end;
implementation
uses System.SysUtils, System.IOUtils;
const ProcessQueryLimitedInformation=$1000;
function QueryProcessImageName(Process: THandle; Flags: DWORD; Name: PChar; var Size: DWORD): BOOL;
  stdcall; external 'kernel32.dll' name 'QueryFullProcessImageNameW';
function Stamp(const Time: TFileTime): UInt64;
begin Result:=(UInt64(Time.dwHighDateTime) shl 32) or Time.dwLowDateTime; end;
constructor TPiProcessCpu.Create(ProcessId: Cardinal; const ExpectedExecutable: string; DurationSeconds: Integer);
var Created,Exited,Kernel,User: TFileTime; Path: array[0..32767] of Char; Size: Cardinal;
begin
  inherited Create;
  if (DurationSeconds<1) or (DurationSeconds>30) then raise Exception.Create('CPU measurement duration must be 1..30 seconds');
  FHandle:=OpenProcess(ProcessQueryLimitedInformation or SYNCHRONIZE,False,ProcessId);
  if FHandle=0 then RaiseLastOSError;
  Size:=Length(Path);
  if not QueryProcessImageName(FHandle,0,Path,Size) then RaiseLastOSError;
  FExecutable:=TPath.GetFullPath(string(Path));
  if not SameText(FExecutable,TPath.GetFullPath(ExpectedExecutable)) then raise Exception.Create('CPU target executable does not match the bound project output');
  if not GetProcessTimes(FHandle,Created,Exited,Kernel,User) then RaiseLastOSError;
  FProcessId:=ProcessId; FCreated:=Stamp(Created); FKernel:=Stamp(Kernel); FUser:=Stamp(User);
  FStarted:=GetTickCount64; FDuration:=UInt64(DurationSeconds)*1000;
end;
destructor TPiProcessCpu.Destroy;
begin if FHandle<>0 then CloseHandle(FHandle); inherited; end;
function TPiProcessCpu.Poll: TJSONObject;
var Created,Exited,Kernel,User: TFileTime; Wall: UInt64; KernelMs,UserMs: Double;
begin
  Result:=nil; Wall:=GetTickCount64-FStarted;
  if (Wall<FDuration) and (WaitForSingleObject(FHandle,0)=WAIT_TIMEOUT) then Exit;
  if not GetProcessTimes(FHandle,Created,Exited,Kernel,User) then RaiseLastOSError;
  if Stamp(Created)<>FCreated then raise Exception.Create('CPU process identity changed');
  KernelMs:=(Stamp(Kernel)-FKernel)/10000; UserMs:=(Stamp(User)-FUser)/10000;
  Result:=TJSONObject.Create.AddPair('source','Windows GetProcessTimes').AddPair('backend','process CPU counters')
    .AddPair('processId',TJSONNumber.Create(FProcessId)).AddPair('executable',FExecutable)
    .AddPair('wallMilliseconds',TJSONNumber.Create(Int64(Wall)))
    .AddPair('kernelMilliseconds',TJSONNumber.Create(KernelMs)).AddPair('userMilliseconds',TJSONNumber.Create(UserMs))
    .AddPair('cpuMilliseconds',TJSONNumber.Create(KernelMs+UserMs))
    .AddPair('exitedEarly',TJSONBool.Create(Wall<FDuration)).AddPair('callStacksAvailable',TJSONBool.Create(False))
    .AddPair('reason','Process-wide CPU counters measure consumed CPU time; function sampling and Delphi GC profiling are unavailable');
  if Wall>0 then Result.AddPair('singleCorePercent',TJSONNumber.Create((KernelMs+UserMs)/Wall*100));
end;
end.
