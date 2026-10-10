unit PiAgent.DiagnosticFreshness;
interface
uses System.JSON;
function TryCaptureDiagnosticFiles(const ProjectFile: string; Rows: TJSONArray;
  out Snapshot: TJSONObject; out Reason: string): Boolean;
function DiagnosticFilesCurrent(Snapshot: TJSONObject; out Reason: string): Boolean;
implementation
uses System.SysUtils, System.Classes, System.IOUtils, System.Hash;
const MaxDiagnosticFileBytes=1048576;
function Fingerprint(const FileName: string): string;
begin
  if not FileExists(FileName) then raise Exception.Create('Diagnostic input no longer exists');
  if TFile.GetSize(FileName)>MaxDiagnosticFileBytes then
    raise Exception.Create('Diagnostic input exceeds the freshness check limit');
  Result:=THashSHA2.GetHashStringFromFile(FileName);
end;
function TryCaptureDiagnosticFiles(const ProjectFile: string; Rows: TJSONArray;
  out Snapshot: TJSONObject; out Reason: string): Boolean;
var Paths: TStringList; Entry: TJSONObject; FileName: string; I: Integer;
begin
  Result:=False; Snapshot:=nil; Reason:=''; Paths:=TStringList.Create;
  try
    Paths.Sorted:=True; Paths.Duplicates:=dupIgnore; Paths.CaseSensitive:=False;
    try
      if (Rows=nil) or (Rows.Count>100) then raise Exception.Create('Diagnostic rows exceed the freshness check limit');
      Paths.Add(TPath.GetFullPath(ProjectFile));
      for I:=0 to Rows.Count-1 do begin
        if not (Rows.Items[I] is TJSONObject) then raise Exception.Create('Malformed diagnostic row');
        Entry:=Rows.Items[I] as TJSONObject;
        FileName:=Entry.GetValue<string>('file','');
        if not TPath.IsPathRooted(FileName) then raise Exception.Create('Diagnostic file is not absolute');
        Paths.Add(TPath.GetFullPath(FileName));
      end;
      Snapshot:=TJSONObject.Create;
      for I:=0 to Paths.Count-1 do Snapshot.AddPair(Paths[I],Fingerprint(Paths[I]));
      Result:=True;
    except on E: Exception do begin
      FreeAndNil(Snapshot); Reason:=E.Message;
    end; end;
  finally Paths.Free; end;
end;
function DiagnosticFilesCurrent(Snapshot: TJSONObject; out Reason: string): Boolean;
var I: Integer; Pair: TJSONPair;
begin
  Result:=False; Reason:='';
  if (Snapshot=nil) or (Snapshot.Count=0) then begin Reason:='No captured diagnostic inputs'; Exit; end;
  try
    for I:=0 to Snapshot.Count-1 do begin
      Pair:=Snapshot.Pairs[I];
      if not SameText(Fingerprint(Pair.JsonString.Value),Pair.JsonValue.Value) then begin
        Reason:='A diagnostic input changed since the external build'; Exit;
      end;
    end;
    Result:=True;
  except on E: Exception do Reason:=E.Message; end;
end;
end.
