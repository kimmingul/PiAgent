program DesignerPropertiesSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.Classes, System.JSON, System.TypInfo, Vcl.StdCtrls, Vcl.Graphics,
  PiAgent.DesignerProperties in '..\src\PiAgent.DesignerProperties.pas';
var Button: TButton; Rows: TJSONArray; Target: TPersistent; Prop: PPropInfo; I: Integer; Found,Rejected: Boolean;
begin
  try
    Button:=TButton.Create(nil); Rows:=TJSONArray.Create;
    try
      DescribeDesignerProperties(Button,Rows,True); Found:=False;
      for I:=0 to Rows.Count-1 do if (Rows.Items[I] as TJSONObject).GetValue<string>('name','')='Font.Style' then
        Found:=(Rows.Items[I] as TJSONObject).GetValue<string>('kind','')='tkSet';
      if not Found then raise Exception.Create('Nested font set schema missing');
      Prop:=ResolveDesignerProperty(Button,'Font.Style',Target);
      if (Prop=nil) or (Target<>Button.Font) then raise Exception.Create('Nested target not resolved');
      SetPropValue(Target,string(Prop.Name),'[fsBold,fsItalic]');
      if Button.Font.Style<>[fsBold,fsItalic] then raise Exception.Create('Typed set edit mismatch');
      Prop:=ResolveDesignerProperty(Button,'Font.Name',Target);
      if Prop=nil then raise Exception.Create('Persistent Font.Name unavailable');
      if ResolveDesignerProperty(Button,'Name',Target)<>nil then raise Exception.Create('Component rename exposed as scalar');
      if ResolveDesignerProperty(Button,'Action.Caption',Target)<>nil then raise Exception.Create('Component reference traversal allowed');
      Prop:=ResolveDesignerProperty(Button,'Font.Style',Target); Rejected:=False;
      try SetPropValue(Target,string(Prop.Name),'[fsNotReal]'); except Rejected:=True; end;
      if not Rejected then raise Exception.Create('Invalid set option accepted');
      Writeln('PASS: typed nested persistent/set properties, component-reference and rename restrictions');
    finally Rows.Free; Button.Free; end;
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
