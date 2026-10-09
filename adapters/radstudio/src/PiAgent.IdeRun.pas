unit PiAgent.IdeRun;
interface
uses System.JSON;
function InspectIdeRun(const Workspace: string; Args: TJSONObject): TJSONObject;
implementation
uses System.SysUtils, System.IOUtils, System.TypInfo, ToolsAPI, DeploymentAPI, PiAgent.IdeContext, PiAgent.IdeDebug;
function InspectIdeRun(const Workspace: string; Args: TJSONObject): TJSONObject;
var Project: IOTAProject; Deployment: IProjectDeployment; FileItem: IProjectDeploymentFile;
  Rows: TJSONArray; Output,FileName: string;
begin
  RequireIdeThread;
  if Args.GetValue<string>('operation','inspect')<>'inspect' then raise Exception.Create('RAD deploy/publish completion and cancellation are not verified');
  Project:=GetActiveProject; if Project=nil then raise Exception.Create('Open a saved project first');
  ResolveIdeFile(Workspace,Project.FileName);
  if (Args.GetValue<string>('project','')<>'') and not SameText(ResolveIdeFile(Workspace,Args.GetValue<string>('project','')),Project.FileName) then raise Exception.Create('Select the requested project first');
  if (Args.GetValue<string>('configuration','')<>'') and (Args.GetValue<string>('configuration','')<>Project.CurrentConfiguration) then raise Exception.Create('Select the requested configuration first');
  Rows:=TJSONArray.Create; Result:=TJSONObject.Create.AddPair('source','RAD DeploymentAPI').AddPair('project',Project.FileName)
    .AddPair('configuration',Project.CurrentConfiguration).AddPair('platform',Project.CurrentPlatform)
    .AddPair('framework',Project.FrameworkType).AddPair('files',Rows).AddPair('publishAvailable',TJSONBool.Create(False))
    .AddPair('publishUnavailableReason','Native deployment dispatch has no verified completion/cancellation contract');
  try
    Output:=DebugOutputFile(Workspace); Result.AddPair('outputFile',Output).AddPair('outputExists',TJSONBool.Create((Output<>'') and FileExists(Output)));
    if not Supports(Project,IProjectDeployment,Deployment) then begin Result.AddPair('available',TJSONBool.Create(False)).AddPair('reason','The project has no public deployment metadata'); Exit; end;
    Result.AddPair('available',TJSONBool.Create(True));
    for FileItem in Deployment.GetSortedFiles do begin
      if Rows.Count>=128 then begin Result.AddPair('truncated',TJSONBool.Create(True)); Break; end;
      if (FileItem.Configuration<>'') and (FileItem.Configuration<>Project.CurrentConfiguration) then Continue;
      if (FileItem.FilePlatform<>'') and (FileItem.FilePlatform<>Project.CurrentPlatform) then Continue;
      try FileName:=ResolveIdeFile(Workspace,TPath.Combine(ExtractFileDir(Project.FileName),FileItem.LocalName),True); except Continue; end;
      Rows.AddElement(TJSONObject.Create.AddPair('localFile',FileName).AddPair('remoteName',Copy(FileItem.RemoteName[Project.CurrentPlatform],1,1024))
        .AddPair('remoteDirectory',Copy(GetDeploymentRemoteDir(FileItem,Project.CurrentPlatform,Deployment),1,1024))
        .AddPair('class',GetDeploymentClass(FileItem)).AddPair('enabled',TJSONBool.Create(FileItem.Enabled[Project.CurrentPlatform]))
        .AddPair('operation',GetEnumName(TypeInfo(TDeployOperation),Ord(GetDeploymentOperation(FileItem,Project.CurrentPlatform,Deployment)))));
    end;
  except Result.Free; raise; end;
end;
end.
