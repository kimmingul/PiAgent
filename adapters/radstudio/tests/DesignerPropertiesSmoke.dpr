program DesignerPropertiesSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.Classes, System.JSON, System.TypInfo, Vcl.StdCtrls, Vcl.Graphics, Vcl.ComCtrls,
  PiAgent.DesignerProperties in '..\src\PiAgent.DesignerProperties.pas';
var Button: TButton; List: TListView; Rows: TJSONArray; Target: TPersistent; Prop: PPropInfo; I: Integer; Found,Rejected: Boolean;
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
      SetPropValue(Button,'ParentFont','True');
      if not Button.ParentFont then raise Exception.Create('VCL ParentFont compensation failed');
      Writeln('PASS: typed nested persistent/set properties, component-reference and rename restrictions');
    finally Rows.Free; Button.Free; end;
    List:=TListView.Create(nil); Rows:=TJSONArray.Create;
    try
      List.Columns.Add.Caption:='Before';
      DescribeDesignerProperties(List,Rows,True); Found:=False;
      for I:=0 to Rows.Count-1 do
        if (Rows.Items[I] as TJSONObject).GetValue<string>('name','')='Columns[0].Caption' then Found:=True;
      if not Found then raise Exception.Create('Collection item scalar schema missing');
      Prop:=ResolveDesignerProperty(List,'Columns[0].Caption',Target);
      if (Prop=nil) or (Target<>List.Columns[0]) then raise Exception.Create('Collection item target mismatch');
      SetPropValue(Target,string(Prop.Name),'After');
      if List.Columns[0].Caption<>'After' then raise Exception.Create('Collection scalar edit mismatch');
      if ResolveDesignerProperty(List,'Columns[1].Caption',Target)<>nil then raise Exception.Create('Missing collection item accepted');
      if ResolveDesignerProperty(List,'Columns[-1].Caption',Target)<>nil then raise Exception.Create('Negative collection index accepted');
      if ResolveDesignerProperty(List,'Columns[0].Collection',Target)<>nil then raise Exception.Create('Collection internals exposed');
      if not SupportedColumnCaptionPath('Columns[0].Caption') or
        not SupportedColumnCaptionPath('Columns[1].Caption') or
        not SupportedColumnCaptionPath('Columns[9].Caption') or
        not SupportedColumnCaptionPath('Columns[10].Caption') or
        not SupportedColumnCaptionPath('Columns[31].Caption') or
        SupportedColumnCaptionPath('Columns[32].Caption') or
        SupportedColumnCaptionPath('Columns[99].Caption') or
        SupportedColumnCaptionPath('Columns[01].Caption') then
        raise Exception.Create('Reviewed collection index guard mismatch');
    finally Rows.Free; List.Free; end;
    Writeln('PASS: bounded VCL collection item schema, scalar edit, invalid index rejection');
  except on E:Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
