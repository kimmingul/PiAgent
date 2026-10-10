program DesignerFmxPropertiesSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.Classes, System.TypInfo, System.JSON, FMX.StdCtrls,
  PiAgent.DesignerProperties in '..\src\PiAgent.DesignerProperties.pas';
var Button: TButton; Rows: TJSONArray; Target: TPersistent; Prop: PPropInfo;
  I: Integer; Found: Boolean;
begin
  try
    Button:=TButton.Create(nil); Rows:=TJSONArray.Create;
    try
      DescribeDesignerProperties(Button,Rows,True); Found:=False;
      for I:=0 to Rows.Count-1 do
        if (Rows.Items[I] as TJSONObject).GetValue<string>('name','')='TextSettings.Font.Family' then Found:=True;
      if not Found then raise Exception.Create('FMX button Font family absent from inspected schema');
      Prop:=ResolveDesignerProperty(Button,'TextSettings.Font.Family',Target);
      if (Prop=nil) or (Prop.SetProc=nil) then raise Exception.Create('FMX Font family is not writable');
      SetPropValue(Target,string(Prop.Name),'Courier New');
      if Button.TextSettings.Font.Family<>'Courier New' then raise Exception.Create('FMX Font family edit mismatch');
      Writeln('PASS: FMX button nested Font family schema and setter');
    finally Rows.Free; Button.Free; end;
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
