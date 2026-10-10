unit PiAgent.DesignerJournal;
interface
uses System.JSON, System.SysUtils;
function BeginDesignerJournal(const Document: string; const Files: TArray<string>): string;
procedure CompleteDesignerJournal(const Id: string);
procedure SetDesignerJournalMutation(const Id: string; Mutation: TJSONObject);
function DesignerJournalMutation(const Id,Document: string): TJSONObject;
function DesignerRestorePreview(const Id,Document: string; const ExpectedFiles: TArray<string>): TJSONObject;
procedure RestoreDesignerJournal(const Id,Document,Revision: string; const ExpectedFiles: TArray<string>);
function DesignerBytesHash(const Bytes: TBytes): string;
procedure RequireDesignerReviewBudget(const Files: TArray<string>);
procedure RequireDesignerProposalBudget(Proposal: TJSONObject);
procedure RequireDesignerAuthoringText(const Files: TArray<string>);
implementation
uses System.IOUtils, System.Hash, System.NetEncoding,
  System.RegularExpressions, Winapi.Windows;
function JournalPath(const Id: string): string;
begin
  if not TRegEx.IsMatch(Id,'^\{[0-9a-fA-F-]{36}\}$') then raise Exception.Create('Invalid designer checkpoint');
  Result:=TPath.Combine(GetEnvironmentVariable('LOCALAPPDATA'),'PiAgent\designer-checkpoints\'+Id+'.json');
end;
function DesignerBytesHash(const Bytes: TBytes): string;
var Hash: THashSHA2;
begin Hash:=THashSHA2.Create; Hash.Update(Bytes); Result:=Hash.HashAsString; end;
function FileHash(const FileName: string): string;
begin Result:=DesignerBytesHash(TFile.ReadAllBytes(FileName)); end;
function DecodeReviewText(const Bytes: TBytes; out Text,EncodingName: string; out Preamble: Integer): Boolean;
var Encoding: TEncoding; Encoded: TBytes;
begin
  try
  Encoding:=nil; Preamble:=TEncoding.GetBufferEncoding(Bytes,Encoding,TEncoding.UTF8);
  Text:=Encoding.GetString(Bytes,Preamble,Length(Bytes)-Preamble); Encoded:=Encoding.GetBytes(Text);
  EncodingName:=Encoding.EncodingName;
  Result:=not Text.Contains(#0) and (Length(Encoded)=Length(Bytes)-Preamble) and ((Length(Encoded)=0) or
    CompareMem(Pointer(Encoded),@Bytes[Preamble],Length(Encoded)));
  except Result:=False; end;
end;
procedure AddRestoreReview(Row: TJSONObject; const CurrentBytes,BeforeBytes: TBytes);
var BeforeText,BeforeEncoding: string; BeforePreamble: Integer;
begin
  Row.AddPair('currentBytes',TJSONNumber.Create(Length(CurrentBytes))).AddPair('restoreBytes',TJSONNumber.Create(Length(BeforeBytes)));
  if not DecodeReviewText(BeforeBytes,BeforeText,BeforeEncoding,BeforePreamble) then begin
    Row.AddPair('reviewKind','binary_byte_restoration').AddPair('description','Exact binary bytes restored; compare byte sizes and SHA-256 hashes'); Exit;
  end;
  // Review the complete bytes that will replace the hash-bound current file.
  // Current text is deliberately absent: native save growth cannot enlarge
  // the review established before the original operation is approved.
  Row.AddPair('reviewKind','complete_original_text_restoration')
    .AddPair('description','Replace the exact current SHA-256 file with this complete original text, encoding and preamble')
    .AddPair('restoreText',BeforeText).AddPair('restoreEncoding',BeforeEncoding)
    .AddPair('restorePreambleBytes',TJSONNumber.Create(BeforePreamble));
end;
procedure RequireDesignerProposalBudget(Proposal: TJSONObject);
begin
  if TEncoding.UTF8.GetByteCount(Proposal.ToJSON)>220*1024 then
    raise Exception.Create('Complete designer proposal envelope exceeds limit');
end;
procedure RequireDesignerAuthoringText(const Files: TArray<string>);
var FileName,Text,EncodingName: string; Bytes: TBytes; Preamble: Integer;
begin
  for FileName in Files do begin
    if not FileExists(FileName) or (TFile.GetSize(FileName)>1048576) then
      raise Exception.Create('Designer recovery file is unavailable/too large');
    Bytes:=TFile.ReadAllBytes(FileName);
    if not DecodeReviewText(Bytes,Text,EncodingName,Preamble) then
      raise Exception.Create('Production designer authoring requires text source and form resources');
  end;
end;
procedure RequireDesignerReviewBudget(const Files: TArray<string>);
var Rows: TJSONArray; Row,Proposal: TJSONObject; FileName,Diff: string; Bytes: TBytes;
begin
  Rows:=TJSONArray.Create;
  Proposal:=TJSONObject.Create.AddPair('checkpointId','{00000000-0000-0000-0000-000000000000}')
    .AddPair('document','').AddPair('scope','source_and_form').AddPair('files',Rows)
    .AddPair('revision',StringOfChar('0',64));
  try
    if (Length(Files)<1) or (Length(Files)>8) then raise Exception.Create('Unsupported designer file set');
    for FileName in Files do begin
      if not FileExists(FileName) or (TFile.GetSize(FileName)>1048576) then
        raise Exception.Create('Designer recovery file is unavailable/too large');
      Bytes:=TFile.ReadAllBytes(FileName);
      Row:=TJSONObject.Create.AddPair('path',FileName).AddPair('currentHash',DesignerBytesHash(Bytes))
        .AddPair('restoreHash',DesignerBytesHash(Bytes)); Rows.AddElement(Row);
      AddRestoreReview(Row,Bytes,Bytes);
    end;
    // The complete original text is bounded independently of native save
    // growth. Measure the real duplicated/escaped diff envelope as well.
    if TEncoding.UTF8.GetByteCount(Rows.ToJSON)>48*1024 then
      raise Exception.Create('Designer source/form exceeds the pre-mutation complete review budget');
    Proposal.RemovePair('document').Free; Proposal.AddPair('document',Files[0]);
    Diff:='Restore saved source and form bytes:'+sLineBreak+Proposal.ToJSON;
    Proposal.AddPair('proposalId','{00000000-0000-0000-0000-000000000000}').AddPair('operation','restoreChange')
      .AddPair('diff',Diff).AddPair('expiresAt',TJSONNumber.Create(Int64(9999999999999)))
      .AddPair('recovery',TJSONObject.Create.AddPair('supported',TJSONBool.Create(True)).AddPair('scope','source_and_form'));
    RequireDesignerProposalBudget(Proposal);
  finally Proposal.Free; end;
end;
procedure WriteJournal(const Id: string; Journal: TJSONObject);
var FileName,Temporary: string;
begin
  FileName:=JournalPath(Id); ForceDirectories(ExtractFileDir(FileName)); Temporary:=FileName+'.tmp';
  TFile.WriteAllText(Temporary,Journal.ToJSON,TEncoding.UTF8);
  if not MoveFileEx(PChar(Temporary),PChar(FileName),MOVEFILE_REPLACE_EXISTING or MOVEFILE_WRITE_THROUGH) then
    RaiseLastOSError;
end;
function ReadJournal(const Id,Document: string): TJSONObject;
var FileName: string;
begin
  FileName:=JournalPath(Id);
  if not FileExists(FileName) or (TFile.GetSize(FileName)>8*1024*1024) then raise Exception.Create('Designer checkpoint unavailable');
  Result:=TJSONObject.ParseJSONValue(TFile.ReadAllText(FileName,TEncoding.UTF8)) as TJSONObject;
  if (Result=nil) or not SameText(Result.GetValue<string>('document',''),Document) then begin
    Result.Free; raise Exception.Create('Designer checkpoint document mismatch');
  end;
end;
procedure ValidateMutation(Mutation: TJSONObject);
var Kind,Component,Path,BeforeValue: string; HasParentFont: Boolean;
begin
  if Mutation=nil then raise Exception.Create('Missing designer mutation metadata');
  if not (Mutation.GetValue('kind') is TJSONString) or
    not (Mutation.GetValue('component') is TJSONString) or
    not (Mutation.GetValue('property') is TJSONString) or
    not (Mutation.GetValue('beforeValue') is TJSONString) then
    raise Exception.Create('Malformed designer mutation metadata');
  Kind:=Mutation.GetValue<string>('kind',''); Component:=Mutation.GetValue<string>('component','');
  Path:=Mutation.GetValue<string>('property',''); BeforeValue:=Mutation.GetValue<string>('beforeValue','');
  HasParentFont:=Mutation.GetValue('beforeParentFont')<>nil;
  if not TRegEx.IsMatch(Component,'^[A-Za-z_][A-Za-z0-9_]{0,62}$') or
    (Length(BeforeValue)>256) or (Mutation.Count<>4+Ord(HasParentFont)) then
    raise Exception.Create('Designer mutation metadata exceeds its supported scope');
  if Kind='setScalarProperty' then begin
    if not ((Path='Font.Name') or (Path='TextSettings.Font.Family')) or
      ((Path='Font.Name')<>HasParentFont) then
      raise Exception.Create('Unsupported designer Font mutation metadata');
    if HasParentFont and
      (not (Mutation.GetValue('beforeParentFont') is TJSONString) or
       not ((Mutation.GetValue<string>('beforeParentFont','')='True') or
            (Mutation.GetValue<string>('beforeParentFont','')='False'))) then
      raise Exception.Create('Malformed designer ParentFont metadata');
  end else if Kind='setCollectionProperty' then begin
    if HasParentFont or not TRegEx.IsMatch(Path,'^Columns\[(?:[0-9]|[1-2][0-9]|3[0-1])\]\.Caption$') then
      raise Exception.Create('Unsupported designer collection mutation metadata');
  end else raise Exception.Create('Unsupported designer mutation metadata kind');
end;
procedure SetDesignerJournalMutation(const Id: string; Mutation: TJSONObject);
var Journal: TJSONObject;
begin
  ValidateMutation(Mutation);
  Journal:=TJSONObject.ParseJSONValue(TFile.ReadAllText(JournalPath(Id),TEncoding.UTF8)) as TJSONObject;
  try
    if (Journal=nil) or (Journal.GetValue<string>('state','')<>'prepared') then
      raise Exception.Create('Designer checkpoint is not prepared');
    Journal.AddPair('mutation',TJSONValue(Mutation.Clone));
    WriteJournal(Id,Journal);
  finally Journal.Free; end;
end;
function DesignerJournalMutation(const Id,Document: string): TJSONObject;
var Journal: TJSONObject; Mutation: TJSONValue;
begin
  Result:=nil; Journal:=ReadJournal(Id,Document);
  try
    Mutation:=Journal.GetValue('mutation');
    if Mutation<>nil then begin
      if not (Mutation is TJSONObject) then raise Exception.Create('Malformed designer checkpoint mutation');
      ValidateMutation(TJSONObject(Mutation));
      Result:=TJSONObject(Mutation.Clone);
    end;
  finally Journal.Free; end;
end;
function BeginDesignerJournal(const Document: string; const Files: TArray<string>): string;
var Guid: TGUID; Journal,Entry: TJSONObject; Items: TJSONArray; FileName: string; Bytes: TBytes;
begin
  RequireDesignerReviewBudget(Files);
  CreateGUID(Guid); Result:=GUIDToString(Guid); Items:=TJSONArray.Create;
  Journal:=TJSONObject.Create.AddPair('schemaVersion',TJSONNumber.Create(1))
    .AddPair('document',Document).AddPair('state','prepared').AddPair('files',Items);
  try
    if (Length(Files)<1) or (Length(Files)>8) then raise Exception.Create('Unsupported designer file set');
    for FileName in Files do begin
      if not FileExists(FileName) or (TFile.GetSize(FileName)>1048576) then raise Exception.Create('Designer recovery file is unavailable/too large');
      Bytes:=TFile.ReadAllBytes(FileName);
      Entry:=TJSONObject.Create.AddPair('path',FileName).AddPair('beforeHash',DesignerBytesHash(Bytes))
        .AddPair('before',TNetEncoding.Base64.EncodeBytesToString(Bytes)); Items.AddElement(Entry);
    end;
    WriteJournal(Result,Journal);
  finally Journal.Free; end;
end;
procedure CompleteDesignerJournal(const Id: string);
var Journal,Entry: TJSONObject; Files: TJSONArray; I: Integer;
begin
  Journal:=TJSONObject.ParseJSONValue(TFile.ReadAllText(JournalPath(Id),TEncoding.UTF8)) as TJSONObject;
  try
    Files:=Journal.GetValue('files') as TJSONArray;
    for I:=0 to Files.Count-1 do begin
      Entry:=Files.Items[I] as TJSONObject;
      Entry.RemovePair('afterHash').Free; Entry.AddPair('afterHash',FileHash(Entry.GetValue<string>('path','')));
    end;
    Journal.RemovePair('state').Free; Journal.AddPair('state','applied'); WriteJournal(Id,Journal);
  finally Journal.Free; end;
end;
function DesignerRestorePreview(const Id,Document: string; const ExpectedFiles: TArray<string>): TJSONObject;
var Journal,Entry,Row: TJSONObject; Files,Rows: TJSONArray; I: Integer; Current,Allowed,State,Fingerprint,FileName,BeforeHash: string;
  BeforeBytes,CurrentBytes: TBytes;
begin
  Journal:=ReadJournal(Id,Document); Rows:=TJSONArray.Create;
  try
  Result:=TJSONObject.Create.AddPair('checkpointId',Id).AddPair('document',Document)
    .AddPair('scope','source_and_form').AddPair('files',Rows);
  try
    State:=Journal.GetValue<string>('state','');
    if not ((State='applied') or (State='restoring')) then raise Exception.Create('Designer checkpoint has no durable applied snapshot');
    Files:=Journal.GetValue('files') as TJSONArray;
    if (Files=nil) or (Files.Count<>Length(ExpectedFiles)) or (Files.Count<1) or (Files.Count>8) then
      raise Exception.Create('Designer checkpoint file identity mismatch');
    Fingerprint:=Id+Document;
    for I:=0 to Files.Count-1 do begin
      Entry:=Files.Items[I] as TJSONObject; FileName:=Entry.GetValue<string>('path','');
      if not SameText(FileName,ExpectedFiles[I]) then raise Exception.Create('Designer checkpoint file identity mismatch');
      if not FileExists(FileName) or (TFile.GetSize(FileName)>1048576) then raise Exception.Create('Designer recovery file unavailable/too large');
      BeforeHash:=Entry.GetValue<string>('beforeHash','');
      BeforeBytes:=TNetEncoding.Base64.DecodeStringToBytes(Entry.GetValue<string>('before',''));
      if DesignerBytesHash(BeforeBytes)<>BeforeHash then
        raise Exception.Create('Designer checkpoint original bytes are corrupt');
      CurrentBytes:=TFile.ReadAllBytes(FileName); Current:=DesignerBytesHash(CurrentBytes);
      Allowed:=Entry.GetValue<string>('afterHash','');
      if (Current<>Allowed) and not ((State='restoring') and (Current=Entry.GetValue<string>('beforeHash',''))) then
        raise Exception.Create('Designer recovery conflict: '+Entry.GetValue<string>('path',''));
      Fingerprint:=Fingerprint+FileName+Current+BeforeHash;
      Row:=TJSONObject.Create.AddPair('path',Entry.GetValue<string>('path',''))
        .AddPair('currentHash',Current).AddPair('restoreHash',Entry.GetValue<string>('beforeHash','')); Rows.AddElement(Row);
      AddRestoreReview(Row,CurrentBytes,BeforeBytes);
    end;
    Result.AddPair('revision',THashSHA2.GetHashString(Fingerprint));
    if TEncoding.UTF8.GetByteCount(Result.ToJSON)>120*1024 then raise Exception.Create('Complete designer restore review exceeds limit; no truncated restore proposal is offered');
  except Result.Free; raise; end;
  finally Journal.Free; end;
end;
procedure RestoreDesignerJournal(const Id,Document,Revision: string; const ExpectedFiles: TArray<string>);
var Preview,Journal,Entry: TJSONObject; Files: TJSONArray; I: Integer; FileName,Current: string;
begin
  Preview:=DesignerRestorePreview(Id,Document,ExpectedFiles);
  try if Preview.GetValue<string>('revision','')<>Revision then raise Exception.Create('Designer restore revision changed');
  finally Preview.Free; end;
  Journal:=ReadJournal(Id,Document);
  try
    Files:=Journal.GetValue('files') as TJSONArray;
    Journal.RemovePair('state').Free; Journal.AddPair('state','restoring'); WriteJournal(Id,Journal);
    for I:=0 to Files.Count-1 do begin
      Entry:=Files.Items[I] as TJSONObject; FileName:=Entry.GetValue<string>('path',''); Current:=FileHash(FileName);
      if (Current<>Entry.GetValue<string>('afterHash','')) and (Current<>Entry.GetValue<string>('beforeHash','')) then
        raise Exception.Create('Designer file changed during recovery');
      TFile.WriteAllBytes(FileName,TNetEncoding.Base64.DecodeStringToBytes(Entry.GetValue<string>('before','')));
      if FileHash(FileName)<>Entry.GetValue<string>('beforeHash','') then raise Exception.Create('Designer restore verification failed');
    end;
    Journal.RemovePair('state').Free; Journal.AddPair('state','restored'); WriteJournal(Id,Journal);
  finally Journal.Free; end;
end;
end.
