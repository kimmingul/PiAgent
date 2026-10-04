program NativeEditor;
uses FMX.Forms, Main in 'Main.pas' {EditorForm};
begin
  Application.Initialize;
  Application.CreateForm(TEditorForm, EditorForm);
  Application.Run;
end.
