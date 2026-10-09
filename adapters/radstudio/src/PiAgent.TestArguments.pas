unit PiAgent.TestArguments;
interface
function DUnitXFilterValid(const Filter: string): Boolean;
implementation
uses System.SysUtils;
function DUnitXFilterValid(const Filter: string): Boolean;
var Ch: Char;
begin
  Result:=False;
  if Length(Filter)>1024 then Exit;
  for Ch in Filter do
    if not CharInSet(Ch,['A'..'Z','a'..'z','0'..'9','_','.',',',' ']) then Exit;
  Result:=True;
end;
end.
