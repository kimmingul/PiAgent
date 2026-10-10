unit PiAgent.IdeDebug;
interface
uses System.JSON;
function DebugStateRevision(const Workspace: string): string;
function DebugAvailability(const Workspace,Operation: string; out Reason: string): Boolean;
function ExecuteIdeDebug(const Workspace: string; Args: TJSONObject): TJSONObject;
function DebugOutputFile(const Workspace: string): string;
implementation
uses System.SysUtils, System.IOUtils, System.TypInfo, System.Hash, System.Actions,
  Vcl.ActnList, ToolsAPI, CommonOptionStrs, PiAgent.IdeContext;
function LocalRunAction(const Workspace: string): TCustomAction;
var Native: INTAServices; I: Integer; Action: TContainedAction; Project: IOTAProject;
  Configurations: IOTAProjectOptionsConfigurations; Configuration: IOTABuildConfiguration;
  OptionName: string;
begin
  Result:=nil; Project:=GetActiveProject;
  if (Project=nil) or not ((Project.CurrentPlatform='Win32') or (Project.CurrentPlatform='Win64')) then
    raise Exception.Create('Native project launch is restricted to local Win32/Win64 targets');
  ResolveIdeFile(Workspace,Project.FileName);
  if not Supports(Project.ProjectOptions,IOTAProjectOptionsConfigurations,Configurations) then
    raise Exception.Create('Debugger configuration is unavailable');
  Configuration:=Configurations.ActiveConfiguration;
  if Configuration=nil then raise Exception.Create('Active debugger configuration is unavailable');
  for OptionName in [sDebugger_RunParams,sDebugger_RemoteRunParams,sDebugger_HostApplication,
    sDebugger_RemotePath,sDebugger_RemoteHost,sDebugger_EnvVars,sDebugger_Launcher,sDebugger_RemoteLauncher,
    sDebugger_CWD,sDebugger_RemoteCWD] do
    if Trim(Configuration.GetValue(OptionName))<>'' then
      raise Exception.Create('Native start requires default local debugger settings; configured '+OptionName+' is unsupported');
  for OptionName in [sDebugger_UseLauncher,sDebugger_UseRemoteLauncher,sDebugger_RemoteDebug] do
    if Configuration.GetBoolean(OptionName) then raise Exception.Create('Native start requires default local debugger settings');
  if not Supports(BorlandIDEServices,INTAServices,Native) or (Native.ActionList=nil) then
    raise Exception.Create('Native IDE run action is unavailable');
  for I:=0 to Native.ActionList.ActionCount-1 do begin
    Action:=Native.ActionList.Actions[I];
    if (Action is TCustomAction) and (TCustomAction(Action).ShortCut=$78) and
      LowerCase(Action.Name).Contains('run') then begin
      if Result<>nil then raise Exception.Create('Native F9 run action is ambiguous');
      Result:=TCustomAction(Action);
    end;
  end;
  if Result=nil then raise Exception.Create('Native F9 run action is unavailable');
  Result.Update;
  if not Result.Enabled then raise Exception.Create('Native IDE run action is disabled');
end;
function DebugOutputFile(const Workspace: string): string;
var Project: IOTAProject;
begin
  Result:=''; Project:=GetActiveProject;
  if Project=nil then Exit;
  ResolveIdeFile(Workspace,Project.FileName);
  if Project.ProjectOptions<>nil then begin
    Result:=Project.ProjectOptions.TargetName;
    if Result<>'' then begin
      Result:=ResolveIdeFile(Workspace,TPath.Combine(ExtractFileDir(Project.FileName),Result),True);
    end;
  end;
end;
function TargetProcess(const Workspace: string): IOTAProcess;
var Services: IOTADebuggerServices; Expected: string;
begin
  RequireIdeThread; Result:=nil;
  if not Supports(BorlandIDEServices,IOTADebuggerServices,Services) then Exit;
  Result:=Services.CurrentProcess;
  if Result=nil then Exit;
  Expected:=DebugOutputFile(Workspace);
  if (Expected='') or not SameText(TPath.GetFullPath(Result.ExeName),Expected) then
    raise Exception.Create('Current debugger process does not match the active project output');
end;
function DebugStateRevision(const Workspace: string): string;
var Process: IOTAProcess; Thread: IOTAThread; Services: IOTADebuggerServices;
  Breakpoint: IOTABreakpoint; I: Integer; FileName: string; Hash: THashSHA2;
begin
  RequireIdeThread;
  try
    Process:=TargetProcess(Workspace); Result:='no-process';
    if Process<>nil then begin
      Result:=IntToStr(Process.OSProcessId)+':'+IntToStr(Ord(Process.ProcessState));
      Thread:=Process.CurrentThread;
      if Thread<>nil then Result:=Result+':'+IntToStr(Thread.OSThreadID)+':'+
        IntToStr(Ord(Thread.State))+':'+IntToStr(Thread.CurrentLine);
    end;
    Hash:=THashSHA2.Create;
    Hash.Update(Result);
    if Supports(BorlandIDEServices,IOTADebuggerServices,Services) then
      for I:=0 to Services.SourceBkptCount-1 do begin
        Breakpoint:=Services.SourceBkpts[I];
        try FileName:=ResolveIdeFile(Workspace,Breakpoint.FileName); except Continue; end;
        Hash.Update(LowerCase(FileName)+':'+IntToStr(Breakpoint.LineNumber)+':'+
          BoolToStr(Breakpoint.Enabled,True)+':'+IntToStr(Breakpoint.PassCount)+':'+Breakpoint.Expression+#0);
      end;
    Result:=Hash.HashAsString;
  except on E: Exception do Result:='unavailable:'+E.Message; end;
end;
function DebugAvailability(const Workspace,Operation: string; out Reason: string): Boolean;
var Services: IOTADebuggerServices; Process: IOTAProcess;
begin
  RequireIdeThread; Result:=False; Reason:='';
  if not Supports(BorlandIDEServices,IOTADebuggerServices,Services) then begin
    Reason:='RAD debugger service unavailable'; Exit;
  end;
  if (Operation='snapshot') or (Operation='breakpoint') or (Operation='breakpoints') or
    (Operation='removeBreakpoint') or (Operation='enableBreakpoint') then Exit(True);
  try
    Process:=TargetProcess(Workspace);
    if Operation='start' then begin
      Result:=(Process=nil) and FileExists(DebugOutputFile(Workspace));
      if Result then LocalRunAction(Workspace);
      if not Result then Reason:='Build active project output first and stop its existing process';
      Exit;
    end;
    if Process=nil then begin Reason:='No debugger process matches the active project'; Exit; end;
    if Operation='stop' then Exit(True);
    if Operation='threads' then Exit(True);
    if Operation='pause' then begin Result:=Process.ProcessState=psRunning; if not Result then Reason:='Debugger process is not running'; Exit; end;
    Result:=(Process.ProcessState=psStopped) and (Process.CurrentThread<>nil) and
      (Process.CurrentThread.State=tsStopped);
    if not Result then Reason:='Pause the active project at a source breakpoint first';
  except on E: Exception do Reason:=E.Message; end;
end;
function ExecuteIdeDebug(const Workspace: string; Args: TJSONObject): TJSONObject;
var Services: IOTADebuggerServices; Process: IOTAProcess; Thread: IOTAThread;
  Operation,Reason,FileName: string; Frames: TJSONArray; I,Count,Line,FrameIndex: Integer;
  Buffer: array[0..4096] of Char; CanModify: Boolean; Address: TOTAAddress;
  Size,Value: LongWord; Evaluation: TOTAEvaluateResult; Breakpoint,Found: IOTABreakpoint; Id: string; Rows: TJSONArray;
  RunAction: TCustomAction;
begin
  RequireIdeThread; Operation:=Args.GetValue<string>('operation','snapshot');
  if not DebugAvailability(Workspace,Operation,Reason) then raise Exception.Create(Reason);
  Services:=BorlandIDEServices as IOTADebuggerServices;
  Result:=TJSONObject.Create.AddPair('source','RAD Studio ToolsAPI debugger').AddPair('operation',Operation);
  try
    if (Operation='breakpoints') or (Operation='removeBreakpoint') or (Operation='enableBreakpoint') then begin
      Rows:=TJSONArray.Create; Result.AddPair('breakpoints',Rows); Found:=nil;
      for I:=0 to Services.SourceBkptCount-1 do begin
        Breakpoint:=Services.SourceBkpts[I];
        try FileName:=ResolveIdeFile(Workspace,Breakpoint.FileName); except Continue; end;
        Id:=THashSHA2.GetHashString(LowerCase(FileName)+':'+IntToStr(Breakpoint.LineNumber));
        if Rows.Count<128 then Rows.AddElement(TJSONObject.Create.AddPair('id',Id).AddPair('file',FileName)
          .AddPair('line',TJSONNumber.Create(Breakpoint.LineNumber)).AddPair('enabled',TJSONBool.Create(Breakpoint.Enabled))
          .AddPair('condition',Copy(Breakpoint.Expression,1,4096)).AddPair('hitCount',TJSONNumber.Create(Breakpoint.PassCount)));
        if Id=Args.GetValue<string>('breakpointId','') then begin
          if Found<>nil then raise Exception.Create('Ambiguous source breakpoint identity'); Found:=Breakpoint;
        end;
      end;
      if Operation='breakpoints' then Exit;
      if Found=nil then raise Exception.Create('Source breakpoint no longer exists');
      if Operation='removeBreakpoint' then begin Services.RemoveBreakpoint(Found); Found:=nil; end
      else Found.Enabled:=Args.GetValue<Boolean>('enabled',True);
      Result.AddPair('executed',TJSONBool.Create(True)); Exit;
    end;
    if Operation='breakpoint' then begin
      FileName:=ResolveIdeFile(Workspace,Args.GetValue<string>('file',''));
      Line:=Args.GetValue<Integer>('line',0); if Line<1 then raise Exception.Create('Breakpoint line must be positive');
      Breakpoint:=Services.NewSourceBreakpoint(FileName,Line,nil);
      if Breakpoint<>nil then begin
        Breakpoint.Expression:=Args.GetValue<string>('condition','');
        if Args.GetValue<Integer>('hitCount',0)>0 then Breakpoint.PassCount:=Args.GetValue<Integer>('hitCount',0);
        Breakpoint.Enabled:=Args.GetValue<Boolean>('enabled',True);
      end;
      Result.AddPair('executed',TJSONBool.Create(Breakpoint<>nil)).AddPair('file',FileName)
        .AddPair('line',TJSONNumber.Create(Line)); Exit;
    end;
    if Operation='start' then begin
      RequireSavedIdeBuffers; FileName:=DebugOutputFile(Workspace);
      if not SameText(ExtractFileExt(FileName),'.exe') then raise Exception.Create('Only local executable projects can start');
      // The IDE's project run action initializes its selected platform debugger.
      // The legacy generic CreateProcess API does not do so on RAD 13.2 x64.
      RunAction:=LocalRunAction(Workspace);
      if not RunAction.Execute then raise Exception.Create('Native IDE run action did not dispatch');
      Result.AddPair('executed',TJSONBool.Create(True)).AddPair('state','dispatched')
        .AddPair('executable',FileName).AddPair('arguments','').AddPair('nativeAction',RunAction.Name); Exit;
    end;
    Process:=TargetProcess(Workspace);
    if Process=nil then begin Result.AddPair('available',TJSONBool.Create(False)).AddPair('mode','no-process'); Exit; end;
    Result.AddPair('processId',TJSONNumber.Create(Process.OSProcessId))
      .AddPair('mode',GetEnumName(TypeInfo(TOTAProcessState),Ord(Process.ProcessState)));
    Thread:=Process.CurrentThread;
    if Operation='threads' then begin
      Rows:=TJSONArray.Create; Result.AddPair('threads',Rows);
      for I:=0 to Process.ThreadCount-1 do begin
        if Rows.Count>=64 then Break; Thread:=Process.Threads[I];
        Rows.AddElement(TJSONObject.Create.AddPair('id',TJSONNumber.Create(Thread.OSThreadID))
          .AddPair('state',GetEnumName(TypeInfo(TOTAThreadState),Ord(Thread.State)))
          .AddPair('current',TJSONBool.Create(Thread=Process.CurrentThread)));
      end;
      Exit;
    end;
    if Operation='selectThread' then begin
      Found:=nil; Thread:=nil;
      for I:=0 to Process.ThreadCount-1 do if Process.Threads[I].OSThreadID=Cardinal(Args.GetValue<Integer>('threadId',0)) then Thread:=Process.Threads[I];
      if Thread=nil then raise Exception.Create('Debugger thread no longer exists');
      Process.CurrentThread:=Thread; Result.AddPair('executed',TJSONBool.Create(True)); Exit;
    end;
    if Operation='snapshot' then begin
      Result.AddPair('locals',TJSONObject.Create.AddPair('available',TJSONBool.Create(False))
        .AddPair('reason','No public automatic locals enumeration contract is verified; use explicit evaluation'));
      if (Thread=nil) or (Thread.State<>tsStopped) then begin
        Result.AddPair('available',TJSONBool.Create(False)).AddPair('reason','Pause at a source breakpoint to inspect stack'); Exit;
      end;
      Frames:=TJSONArray.Create; Result.AddPair('stack',Frames).AddPair('threadId',TJSONNumber.Create(Thread.OSThreadID));
      if Thread.StartCallStackAccess<>csAccessible then begin
        Result.AddPair('available',TJSONBool.Create(False)).AddPair('reason','Call stack is temporarily unavailable'); Exit;
      end;
      try
        Count:=Thread.CallCount; if Count>32 then Count:=32;
        for I:=1 to Count do begin
          Thread.GetCallPos(I,FileName,Line);
          if FileName<>'' then try FileName:=ResolveIdeFile(Workspace,FileName); except FileName:=''; Line:=0; end;
          Frames.AddElement(TJSONObject.Create.AddPair('index',TJSONNumber.Create(I-1))
            .AddPair('function',Copy(Thread.CallHeaders[I],1,1024))
            .AddPair('file',FileName).AddPair('line',TJSONNumber.Create(Line)));
        end;
      finally Thread.EndCallStackAccess; end;
      Result.AddPair('available',TJSONBool.Create(True)); Exit;
    end;
    if Operation='evaluate' then begin
      FillChar(Buffer,SizeOf(Buffer),0);
      FrameIndex:=Args.GetValue<Integer>('frameIndex',0);
      if FrameIndex<0 then raise Exception.Create('Frame index must be nonnegative');
      // A source-location overload changes lexical scope, but the public SDK
      // does not promise selection of the actual runtime frame (e.g. recursion).
      if FrameIndex<>0 then raise Exception.Create('Non-top frame evaluation is unavailable in RAD ToolsAPI');
      Evaluation:=Thread.Evaluate(Args.GetValue<string>('expression',''),@Buffer[0],Length(Buffer),
        CanModify,False,nil,Address,Size,Value);
      Result.AddPair('executed',TJSONBool.Create(True)).AddPair('valid',TJSONBool.Create(Evaluation=erOK))
        .AddPair('value',string(Buffer)).AddPair('allowSideEffects',TJSONBool.Create(False))
        .AddPair('frameIndex',TJSONNumber.Create(FrameIndex))
        .AddPair('evaluationState',GetEnumName(TypeInfo(TOTAEvaluateResult),Ord(Evaluation)));
      if Evaluation in [erDeferred,erBusy] then Result.AddPair('reason','Evaluation did not complete synchronously; no value is asserted');
      Exit;
    end;
    if Operation='continue' then Process.Run(ormRun)
    else if Operation='stepOver' then Process.Run(ormStmtStepOver)
    else if Operation='stepInto' then Process.Run(ormStmtStepInto)
    else if Operation='stepOut' then Process.Run(ormRunUntilReturn)
    else if Operation='stop' then Process.Terminate
    else if Operation='pause' then Process.Pause
    else raise Exception.Create('Unsupported debugger operation');
    Result.AddPair('executed',TJSONBool.Create(True)).AddPair('state','dispatched');
  except Result.Free; raise; end;
end;
end.
