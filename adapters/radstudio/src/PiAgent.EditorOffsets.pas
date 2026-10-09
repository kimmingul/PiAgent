unit PiAgent.EditorOffsets;
interface
function Utf16ToByteOffset(const Text: string; Offset: Integer): Integer;
function ByteToUtf16Offset(const Text: string; Offset: Integer): Integer;
procedure ValidateEditRange(const Text: string; Start,Count: Integer);
implementation
uses System.SysUtils;
procedure ValidateEditRange(const Text: string; Start,Count: Integer);
  procedure Boundary(Offset: Integer);
  begin
    if (Offset>0) and (Offset<Length(Text)) and
      (Ord(Text[Offset]) >= $D800) and (Ord(Text[Offset]) <= $DBFF) and
      (Ord(Text[Offset+1]) >= $DC00) and (Ord(Text[Offset+1]) <= $DFFF) then
      raise Exception.Create('Edit splits a Unicode character');
  end;
begin
  if (Start<0) or (Count<0) or (Start>Length(Text)-Count) then raise Exception.Create('Edit range is invalid');
  Boundary(Start); Boundary(Start+Count);
end;
function Utf16ToByteOffset(const Text: string; Offset: Integer): Integer;
begin ValidateEditRange(Text,Offset,0); Result:=TEncoding.UTF8.GetByteCount(Copy(Text,1,Offset)); end;
function ByteToUtf16Offset(const Text: string; Offset: Integer): Integer;
var Bytes,Check: TBytes; Prefix: string;
begin
  Bytes:=TEncoding.UTF8.GetBytes(Text);
  if (Offset<0) or (Offset>Length(Bytes)) then raise Exception.Create('Byte offset is invalid');
  Prefix:=TEncoding.UTF8.GetString(Bytes,0,Offset); Check:=TEncoding.UTF8.GetBytes(Prefix);
  if (Length(Check)<>Offset) or ((Offset>0) and not CompareMem(Pointer(Bytes),Pointer(Check),Offset)) then
    raise Exception.Create('Byte offset splits a Unicode character');
  Result:=Length(Prefix);
end;
end.
