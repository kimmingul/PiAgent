program NativeEditorSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.IOUtils, FMX.Forms, Main in 'Main.pas';
var Form: TEditorForm; Path,Expected: string;
procedure Check(Value: Boolean; const Message: string);
begin if not Value then raise Exception.Create(Message); end;
begin
  try
    Application.Initialize;
    Form := TEditorForm.Create(nil);
    try
      Check(Form.SaveMenu.Action = Form.SaveAction,'save menu uses Action');
      Check(Form.SaveButton.Action = Form.SaveAction,'save toolbar shares Action');
      Check(Form.SaveAction.ActionList = Form.Actions,'ActionList membership');
      Check(Form.SaveMenu.GetParentComponent = Form.FileMenu,'menu hierarchy');
      Check(Form.StatusLabel.Parent = Form.StatusBar,'status composition');
      Check(Form.Editor.Parent = Form,'editor fill region');
      Form.Editor.Text := 'discard test'; Form.NewAction.Execute;
      Check(Form.Editor.Text = '','shared New command executes');
      Path := TPath.Combine(TPath.GetTempPath,TGUID.NewGuid.ToString+'.txt');
      try
        Form.Editor.Text := 'PiAgent '+#$D55C#$AE00+' UTF-8'; Expected := Form.Editor.Text;
        Form.SaveDocument(Path); Form.NewAction.Execute; Form.LoadDocument(Path);
        Check(Form.Editor.Text = Expected,'UTF-8 round trip');
      finally if TFile.Exists(Path) then TFile.Delete(Path); end;
    finally Form.Free; end;
    Writeln('PASS: FMX streamed menu, shared Actions, toolbar, status hierarchy, New and UTF-8 round trip');
  except on E: Exception do begin Writeln(E.ClassName+': '+E.Message); ExitCode := 1; end; end;
end.
