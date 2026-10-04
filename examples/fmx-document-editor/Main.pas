unit Main;
interface
uses System.SysUtils, System.Classes, System.Actions, FMX.Types, FMX.Controls,
  FMX.Forms, FMX.StdCtrls, FMX.Layouts, FMX.Memo, FMX.Memo.Types, FMX.ScrollBox,
  FMX.Controls.Presentation, FMX.Dialogs, FMX.Menus, FMX.ActnList;
type
  TEditorForm = class(TForm)
    MainMenu: TMainMenu;
    FileMenu, NewMenu, OpenMenu, SaveMenu: TMenuItem;
    Toolbar: TToolBar;
    NewButton, OpenButton, SaveButton: TButton;
    StatusBar: TStatusBar;
    StatusLabel: TLabel;
    Editor: TMemo;
    Actions: TActionList;
    NewAction, OpenAction, SaveAction: TAction;
    OpenDialog: TOpenDialog;
    SaveDialog: TSaveDialog;
    procedure NewExecute(Sender: TObject);
    procedure OpenExecute(Sender: TObject);
    procedure SaveExecute(Sender: TObject);
  public
    procedure LoadDocument(const FileName: string);
    procedure SaveDocument(const FileName: string);
  end;
var EditorForm: TEditorForm;
implementation
{$R *.fmx}
procedure TEditorForm.NewExecute(Sender: TObject);
begin
  Editor.Lines.Clear;
  SaveDialog.FileName := '';
  StatusLabel.Text := 'New document';
end;
procedure TEditorForm.OpenExecute(Sender: TObject);
begin
  if OpenDialog.Execute then LoadDocument(OpenDialog.FileName);
end;
procedure TEditorForm.SaveExecute(Sender: TObject);
begin
  if SaveDialog.Execute then SaveDocument(SaveDialog.FileName);
end;
procedure TEditorForm.LoadDocument(const FileName: string);
begin
  Editor.Lines.LoadFromFile(FileName,TEncoding.UTF8);
  SaveDialog.FileName := FileName;
  StatusLabel.Text := 'Opened '+ExtractFileName(FileName);
end;
procedure TEditorForm.SaveDocument(const FileName: string);
begin
  Editor.Lines.SaveToFile(FileName,TEncoding.UTF8);
  StatusLabel.Text := 'Saved '+ExtractFileName(FileName);
end;
end.
