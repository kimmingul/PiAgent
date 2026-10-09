program DesignerJournalSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.IOUtils, System.JSON,
  PiAgent.DesignerJournal in '..\src\PiAgent.DesignerJournal.pas';
var Root,Source,Form,Id: string; Preview: TJSONObject; Conflict: Boolean; Original: TBytes;
begin
  try
    Root:=TPath.Combine(ExtractFileDir(ParamStr(0)),'journal-fixture'); ForceDirectories(Root);
    Source:=TPath.Combine(Root,'Main.pas'); Form:=TPath.Combine(Root,'Main.dfm');
    Original:=TBytes.Create($EF,$BB,$BF,$41,$0D,$0A,$ED,$95,$9C);
    TFile.WriteAllBytes(Source,Original); TFile.WriteAllText(Form,'object Main: TForm'+#13#10+'end',TEncoding.UTF8);
    Id:=BeginDesignerJournal(Source,[Source,Form]);
    TFile.WriteAllText(Source,'changed source',TEncoding.UTF8); TFile.WriteAllText(Form,'changed resource',TEncoding.UTF8);
    CompleteDesignerJournal(Id); Preview:=DesignerRestorePreview(Id,Source,[Source,Form]);
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

