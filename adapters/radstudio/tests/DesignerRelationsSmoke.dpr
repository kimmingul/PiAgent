program DesignerRelationsSmoke;
{$APPTYPE CONSOLE}
uses
  System.SysUtils, System.Classes, System.JSON, System.TypInfo,
  Vcl.Controls, Vcl.ExtCtrls, Vcl.StdCtrls, Vcl.Menus, Vcl.ActnList,
  FMX.Types, FMX.Controls, FMX.Layouts, FMX.StdCtrls, FMX.Menus, FMX.ActnList,
  PiAgent.DesignerRelations in '..\src\PiAgent.DesignerRelations.pas';

procedure Check(Value: Boolean; const Message: string);
begin if not Value then raise Exception.Create(Message); end;

procedure VerifyTree(Root,Panel,Button,Menu,MenuItem,Actions,Action: TComponent);
var View: TJSONObject; Ref: TJSONValue; Found: Boolean;
begin
  Root.Name := 'Root'; Panel.Name := 'Panel'; Button.Name := 'SaveButton';
  Menu.Name := 'MainMenu'; MenuItem.Name := 'SaveMenu'; Actions.Name := 'Actions'; Action.Name := 'SaveAction';
  Check(CanParent(Root,Panel,Root),'root parent'); MoveParent(Panel,Root);
  Check(CanParent(Root,Button,Panel),'panel parent'); MoveParent(Button,Panel);
  Check(Button.GetParentComponent = Panel,'actual native parent');
  Check(Button.Owner = Root,'parent must not change lifetime owner');
  Check(not CanParent(Root,Panel,Button),'cycle rejected');
  Check(not CanParent(Root,Button,Button),'self rejected');
  Check(not CanParent(Root,Root,Panel),'root move rejected');
  Check(CanParent(Root,MenuItem,Menu),'menu ancestry'); MoveParent(MenuItem,Menu);
  Check(MenuItem.GetParentComponent = Menu,'actual menu parent');
  Check(not CanParent(Root,MenuItem,Panel),'menu into panel rejected');
  Check(CanParent(Root,Action,Actions),'action-list membership'); MoveParent(Action,Actions);
  Check(Action.GetParentComponent = Actions,'actual action list');
  Check(ReferenceWritable(GetPropInfo(Button,'Action')),'button action is writable');
  Check(not ReferenceWritable(GetPropInfo(Button,'Name')),'scalar is not a reference');
  SetObjectProp(Button,'Action',Action); SetObjectProp(MenuItem,'Action',Action);
  Check(GetObjectProp(MenuItem,'Action') = GetObjectProp(Button,'Action'),'shared action');
  View := TJSONObject.Create;
  try
    AddRelations(Root,Button,View,True);
    Check(View.GetValue<string>('parentId') = 'Panel','parent id');
    Check(View.GetValue<string>('ownerId') = 'Root','owner id');
    Found := False;
    for Ref in View.GetValue<TJSONArray>('references') do
      if Ref.GetValue<string>('name') = 'Action' then begin
        Check(Ref.GetValue<string>('target') = 'SaveAction','action target'); Found := True;
      end;
    Check(Found,'action reference exposed');
  finally View.Free; end;
  View := TJSONObject.Create;
  try
    AddRelations(Root,Button,View,False);
    Check(View.GetValue<TJSONArray>('allowedParentIds').Count = 0,'dirty tree cannot move');
    for Ref in View.GetValue<TJSONArray>('references') do Check(not Ref.GetValue<Boolean>('writable'),'dirty reference cannot write');
  finally View.Free; end;
end;

var Root: TComponent;
begin
  try
    Root := Vcl.ExtCtrls.TPanel.Create(nil);
    try
      VerifyTree(Root,Vcl.ExtCtrls.TPanel.Create(Root),Vcl.StdCtrls.TButton.Create(Root),
        Vcl.Menus.TMainMenu.Create(Root),Vcl.Menus.TMenuItem.Create(Root),Vcl.ActnList.TActionList.Create(Root),Vcl.ActnList.TAction.Create(Root));
    finally Root.Free; end;
    Root := FMX.Layouts.TLayout.Create(nil);
    try
      VerifyTree(Root,FMX.Layouts.TLayout.Create(Root),FMX.StdCtrls.TButton.Create(Root),
        FMX.Menus.TMainMenu.Create(Root),FMX.Menus.TMenuItem.Create(Root),FMX.ActnList.TActionList.Create(Root),FMX.ActnList.TAction.Create(Root));
    finally Root.Free; end;
    Writeln('PASS: VCL/FMX native hierarchy, menus, shared Actions, owner preservation, cycles and read-only relations');
  except on E: Exception do begin Writeln(E.ClassName+': '+E.Message); ExitCode := 1; end; end;
end.
