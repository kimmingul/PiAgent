program EditorOffsetsSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, PiAgent.EditorOffsets in '..\src\PiAgent.EditorOffsets.pas';
var Text: string; I,BytePos: Integer; Rejected: Boolean;
begin
  try
    Text:='a'+#9+#$D55C+#$AE00+#$D83D+#$DE00+#13#10+'b';
    for I:=0 to Length(Text) do begin
      if I=5 then Continue; // Between the high and low emoji surrogate.
      BytePos:=Utf16ToByteOffset(Text,I);
      if ByteToUtf16Offset(Text,BytePos)<>I then raise Exception.Create('Offset round trip failed');
    end;
    Rejected:=False; try Utf16ToByteOffset(Text,5); except Rejected:=True; end;
    if not Rejected then raise Exception.Create('Surrogate split accepted');
    Rejected:=False; try ByteToUtf16Offset(Text,3); except Rejected:=True; end;
    if not Rejected then raise Exception.Create('UTF-8 split accepted');
    Rejected:=False; try ValidateEditRange(Text,4,1); except Rejected:=True; end;
    if not Rejected then raise Exception.Create('Split edit accepted');
    ValidateEditRange(Text,4,2);
    Writeln('PASS: UTF-16/UTF-8 offsets, Korean, emoji, tabs, CRLF, invalid boundaries');
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
