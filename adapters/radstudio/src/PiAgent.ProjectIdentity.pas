unit PiAgent.ProjectIdentity;
interface
function TryExternalDelphiProject(const NativeProject,Personality: string; out Dproj: string): Boolean;
function RequireExternalDelphiProject(const NativeProject,Personality: string): string;
implementation
uses System.SysUtils;
function TryExternalDelphiProject(const NativeProject,Personality: string; out Dproj: string): Boolean;
var Extension: string;
begin
  Dproj:=''; Extension:=ExtractFileExt(NativeProject);
  Result:=(NativeProject<>'') and SameText(Personality,'Delphi.Personality') and
    (SameText(Extension,'.dproj') or SameText(Extension,'.dpr'));
  if Result then Dproj:=ChangeFileExt(NativeProject,'.dproj');
end;
function RequireExternalDelphiProject(const NativeProject,Personality: string): string;
begin
  if not TryExternalDelphiProject(NativeProject,Personality,Result) then
    raise Exception.Create('External build/diagnostics require the active Delphi personality and original .dproj/.dpr project identity');
end;
end.
