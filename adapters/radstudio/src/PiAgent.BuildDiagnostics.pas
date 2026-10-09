unit PiAgent.BuildDiagnostics;
interface
uses System.JSON;
type TResolveBuildFile = reference to function(const FileName: string): string;
function ParseBuildDiagnostics(const Log: string; const Resolve: TResolveBuildFile): TJSONArray;
implementation
uses System.SysUtils, System.Classes, System.RegularExpressions;
function ParseBuildDiagnostics(const Log: string; const Resolve: TResolveBuildFile): TJSONArray;
var Line,FileName,Code,Severity,Key: string; Match: TMatch; Seen: TStringList;
begin
  Result:=TJSONArray.Create; Seen:=TStringList.Create;
  try
  try
    for Line in Log.Replace(#13,'').Split([#10]) do begin
      if Result.Count>=100 then Break;
      Match:=TRegEx.Match(Line,'^\s*(?:\[[^\]]+\]\s*)?(.+?\.(?:pas|dpr|cpp|h|hpp))\((\d+)(?:,(\d+))?\)\s*:?\s*(?:Error|Warning|Hint)?\s*:?\s*([EWHF]\d+)\s*:?\s*(.*?)(?:\s+\[[^\]]+\.dproj\])?\s*$',[roIgnoreCase]);
      if not Match.Success then Continue;
      try FileName:=Resolve(Trim(Match.Groups[1].Value)); except Continue; end;
      Code:=UpperCase(Match.Groups[4].Value); Severity:='error';
      if Code.StartsWith('W') then Severity:='warning' else if Code.StartsWith('H') then Severity:='hint';
      Key:=LowerCase(FileName)+':'+Match.Groups[2].Value+':'+Code+':'+Match.Groups[5].Value;
      if Seen.IndexOf(Key)>=0 then Continue; Seen.Add(Key);
      Result.AddElement(TJSONObject.Create.AddPair('file',FileName)
        .AddPair('line',TJSONNumber.Create(StrToInt(Match.Groups[2].Value)))
        .AddPair('code',Code).AddPair('severity',Severity)
        .AddPair('message',Copy(Match.Groups[5].Value,1,2048)).AddPair('source','external'));
    end;
  except Result.Free; raise; end;
  finally Seen.Free; end;
end;
end.
