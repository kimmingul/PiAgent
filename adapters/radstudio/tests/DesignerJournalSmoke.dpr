program DesignerJournalSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.IOUtils, System.JSON,
  PiAgent.DesignerJournal in '..\src\PiAgent.DesignerJournal.pas';
const ValidIndices: array[0..4] of Integer=(0,1,9,10,31);
      InvalidPaths: array[0..2] of string=('Columns[32].Caption','Columns[99].Caption','Columns[01].Caption');
var Root,Source,Form,Id,JournalFile: string; Preview,Mutation,Journal: TJSONObject; Conflict: Boolean; Original: TBytes; I: Integer;
begin
  try
    Root:=TPath.Combine(ExtractFileDir(ParamStr(0)),'journal-fixture'); ForceDirectories(Root);
    Source:=TPath.Combine(Root,'Main.pas'); Form:=TPath.Combine(Root,'Main.dfm');
    Original:=TBytes.Create($EF,$BB,$BF,$41,$0D,$0A,$ED,$95,$9C);
    TFile.WriteAllBytes(Source,Original); TFile.WriteAllText(Form,'object Main: TForm'+#13#10+'end',TEncoding.UTF8);
    Id:=BeginDesignerJournal(Source,[Source,Form]);
    Mutation:=TJSONObject.Create.AddPair('kind','setScalarProperty').AddPair('component','Button1')
      .AddPair('property','Font.Name').AddPair('beforeValue','Segoe UI').AddPair('beforeParentFont','True');
    try SetDesignerJournalMutation(Id,Mutation); finally Mutation.Free; end;
    TFile.WriteAllText(Source,'changed source',TEncoding.UTF8); TFile.WriteAllText(Form,'changed resource',TEncoding.UTF8);
    CompleteDesignerJournal(Id);
    Mutation:=DesignerJournalMutation(Id,Source);
    try
      if (Mutation=nil) or (Mutation.GetValue<string>('beforeValue','')<>'Segoe UI') or
        (Mutation.GetValue<string>('beforeParentFont','')<>'True') then
        raise Exception.Create('Saved live-property compensation metadata missing');
    finally Mutation.Free; end;
    Preview:=DesignerRestorePreview(Id,Source,[Source,Form]);
    try
      if ((Preview.GetValue('files') as TJSONArray).Items[0] as TJSONObject).GetValue<string>('reviewKind','')<>'complete_original_text_restoration' then raise Exception.Create('Complete original source restore review missing');
      if ((Preview.GetValue('files') as TJSONArray).Items[0] as TJSONObject).GetValue<string>('restoreText','')<>'A'+#13#10+#$D55C then raise Exception.Create('Concrete restored source text incorrect');
      TFile.WriteAllText(Source,'concurrent user edit',TEncoding.UTF8); Conflict:=False;
      try RestoreDesignerJournal(Id,Source,Preview.GetValue<string>('revision',''),[Source,Form]); except Conflict:=True; end;
      if not Conflict or (TFile.ReadAllText(Source,TEncoding.UTF8)<>'concurrent user edit') then raise Exception.Create('Concurrent edit overwritten');
      TFile.WriteAllText(Source,'changed source',TEncoding.UTF8);
      RestoreDesignerJournal(Id,Source,Preview.GetValue<string>('revision',''),[Source,Form]);
      if not CompareMem(Pointer(TFile.ReadAllBytes(Source)),Pointer(Original),Length(Original)) then raise Exception.Create('Source bytes/BOM not restored');
      if TFile.ReadAllText(Form,TEncoding.UTF8)<>'object Main: TForm'+#13#10+'end' then raise Exception.Create('Form bytes not restored');
    finally Preview.Free; end;
    for I:=Low(ValidIndices) to High(ValidIndices) do begin
      Id:=BeginDesignerJournal(Source,[Source,Form]);
      Mutation:=TJSONObject.Create.AddPair('kind','setCollectionProperty').AddPair('component','ListView1')
        .AddPair('property',Format('Columns[%d].Caption',[ValidIndices[I]])).AddPair('beforeValue','Before');
      try SetDesignerJournalMutation(Id,Mutation); finally Mutation.Free; end;
      Mutation:=DesignerJournalMutation(Id,Source);
      try
        if (Mutation=nil) or
          (Mutation.GetValue<string>('property','')<>Format('Columns[%d].Caption',[ValidIndices[I]])) then
          raise Exception.Create('Valid collection index was not persisted');
      finally Mutation.Free; end;
    end;
    for I:=Low(InvalidPaths) to High(InvalidPaths) do begin
      Id:=BeginDesignerJournal(Source,[Source,Form]);
      Mutation:=TJSONObject.Create.AddPair('kind','setCollectionProperty').AddPair('component','ListView1')
        .AddPair('property',InvalidPaths[I]).AddPair('beforeValue','Before');
      Conflict:=False;
      try try SetDesignerJournalMutation(Id,Mutation); except Conflict:=True; end; finally Mutation.Free; end;
      if not Conflict then raise Exception.Create('Invalid collection index was accepted');
    end;
    Id:=BeginDesignerJournal(Source,[Source,Form]);
    Mutation:=TJSONObject.Create.AddPair('kind','setCollectionProperty').AddPair('component','ListView1')
      .AddPair('property','Columns[0].Caption').AddPair('beforeValue','Before');
    try SetDesignerJournalMutation(Id,Mutation); finally Mutation.Free; end;
    JournalFile:=TPath.Combine(GetEnvironmentVariable('LOCALAPPDATA'),'PiAgent\designer-checkpoints\'+Id+'.json');
    Journal:=TJSONObject.ParseJSONValue(TFile.ReadAllText(JournalFile,TEncoding.UTF8)) as TJSONObject;
    try
      Mutation:=Journal.GetValue('mutation') as TJSONObject;
      Mutation.RemovePair('property').Free; Mutation.AddPair('property','Columns[99].Caption');
      TFile.WriteAllText(JournalFile,Journal.ToJSON,TEncoding.UTF8);
    finally Journal.Free; end;
    Conflict:=False;
    try Mutation:=DesignerJournalMutation(Id,Source); except Conflict:=True; end;
    if not Conflict then begin Mutation.Free; raise Exception.Create('Tampered collection mutation accepted'); end;
    TFile.WriteAllBytes(Form,TBytes.Create($FF,$00,$81)); Id:=BeginDesignerJournal(Source,[Source,Form]);
    TFile.WriteAllBytes(Form,TBytes.Create($00,$FF)); CompleteDesignerJournal(Id);
    Preview:=DesignerRestorePreview(Id,Source,[Source,Form]);
    try
      if ((Preview.GetValue('files') as TJSONArray).Items[1] as TJSONObject).GetValue<string>('reviewKind','')<>'binary_byte_restoration' then raise Exception.Create('Unsafe binary restore review was labeled text');
    finally Preview.Free; end;
    Conflict:=False;
    try RequireDesignerAuthoringText([Source,Form]); except Conflict:=True; end;
    if not Conflict then raise Exception.Create('Binary form admitted to production authoring');
    TFile.WriteAllText(Source,StringOfChar('a',60000),TEncoding.UTF8); Conflict:=False;
    try Id:=BeginDesignerJournal(Source,[Source,Form]); except Conflict:=True; end;
    if not Conflict or (Length(TFile.ReadAllText(Source,TEncoding.UTF8))<>60000) then
      raise Exception.Create('Large original review budget accepted or modified file');
    TFile.WriteAllText(Source,StringOfChar('"',30000),TEncoding.UTF8); Conflict:=False;
    try RequireDesignerReviewBudget([Source,Form]); except Conflict:=True; end;
    if not Conflict then raise Exception.Create('JSON escaped original review budget ignored');
    Preview:=TJSONObject.Create.AddPair('diff',StringOfChar('"',120000)); Conflict:=False;
    try
      if Length(Preview.GetValue<string>('diff',''))>128*1024 then raise Exception.Create('Envelope fixture exceeds raw diff scope');
      try RequireDesignerProposalBudget(Preview); except Conflict:=True; end;
      if not Conflict then raise Exception.Create('Escaped final proposal envelope budget ignored');
    finally Preview.Free; end;
    Writeln('PASS: durable source/form recovery, byte/BOM fidelity, concurrent-edit and pre-mutation encoded-budget guards');
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.

