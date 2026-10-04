unit PiAgent.DesignerRelations;
interface
uses System.Classes, System.JSON, System.TypInfo;
type TParentAccess = class(TComponent);
function CanParent(Root, Item, Parent: TComponent): Boolean;
function ReferenceWritable(Prop: PPropInfo): Boolean;
procedure AddRelations(Root, Item: TComponent; Obj: TJSONObject; Writable: Boolean);
procedure MoveParent(Item, Parent: TComponent);
implementation
uses System.SysUtils;
procedure MoveParent(Item, Parent: TComponent);
begin TParentAccess(Item).SetParentComponent(Parent); end;
function KindOf(Item: TComponent; const UnitName, ClassName: string): Boolean;
var Kind: TClass;
begin
  Result := False; if Item = nil then Exit; Kind := Item.ClassType;
  while Kind <> nil do begin
    if (Kind.UnitName = UnitName) and (Kind.ClassName = ClassName) then Exit(True);
    Kind := Kind.ClassParent;
  end;
end;

function ComponentId(Item: TComponent): string;
begin if Item = nil then Result := '' else Result := Item.Name; end;

function CanParent(Root, Item, Parent: TComponent): Boolean;
var Ancestor: TComponent; Depth: Integer;
begin
  Result := False;
  if (Item = nil) or (Parent = nil) or (Item = Root) or (Item = Parent) or
    (Item.Owner <> Root) or ((Parent <> Root) and (Parent.Owner <> Root)) then Exit;
  if csAncestor in Item.ComponentState then Exit;
  Ancestor := Parent; Depth := 0;
  while Ancestor <> nil do begin
    if (Ancestor = Item) or (Depth > 256) then Exit;
    if Ancestor = Root then Break;
    Ancestor := Ancestor.GetParentComponent; Inc(Depth);
  end;
  if KindOf(Item,'Vcl.Menus','TMenuItem') then
    Exit(KindOf(Parent,'Vcl.Menus','TMenu') or KindOf(Parent,'Vcl.Menus','TMenuItem'));
  if KindOf(Item,'FMX.Menus','TMenuItem') then
    Exit(KindOf(Parent,'FMX.Menus','TMainMenu') or KindOf(Parent,'FMX.Menus','TPopupMenu') or KindOf(Parent,'FMX.Menus','TMenuItem'));
  if KindOf(Item,'System.Actions','TContainedAction') then
    Exit(KindOf(Parent,'System.Actions','TContainedActionList'));
  if KindOf(Item,'Vcl.Controls','TControl') then
    Exit(KindOf(Parent,'Vcl.Controls','TWinControl'));
  if KindOf(Item,'FMX.Controls','TControl') then
    Exit((Parent = Root) or KindOf(Parent,'FMX.Layouts','TLayout') or
      KindOf(Parent,'FMX.StdCtrls','TToolBar') or KindOf(Parent,'FMX.StdCtrls','TStatusBar') or
      KindOf(Parent,'FMX.StdCtrls','TPanel'));
end;

function ReferenceWritable(Prop: PPropInfo): Boolean;
begin
  Result := (Prop <> nil) and (Prop.SetProc <> nil) and (Prop.PropType^.Kind = tkClass) and
    GetTypeData(Prop.PropType^).ClassType.InheritsFrom(TComponent) and
    ((string(Prop.Name) = 'Action') or (string(Prop.Name) = 'Menu') or
     (string(Prop.Name) = 'PopupMenu') or (string(Prop.Name) = 'ActionList'));
end;

procedure AddRelations(Root, Item: TComponent; Obj: TJSONObject; Writable: Boolean);
var I,J,Count: Integer; Candidate,Parent: TComponent; List: PPropList; Prop: PPropInfo;
  Parents,References,Targets: TJSONArray; Ref: TJSONObject;
begin
  Parent := nil; if Item <> Root then Parent := Item.GetParentComponent;
  Obj.AddPair('parentId',ComponentId(Parent));
  if Item = Root then Obj.AddPair('ownerId','') else Obj.AddPair('ownerId',ComponentId(Item.Owner));
  Parents := TJSONArray.Create; References := TJSONArray.Create;
  Obj.AddPair('allowedParentIds',Parents).AddPair('references',References);
  for I := -1 to Root.ComponentCount-1 do begin
    if I = -1 then Candidate := Root else Candidate := Root.Components[I];
    if Writable and CanParent(Root,Item,Candidate) then Parents.Add(Candidate.Name);
  end;
  Count := GetPropList(Item.ClassInfo,[tkClass],nil); GetMem(List,Count*SizeOf(Pointer));
  try
    GetPropList(Item.ClassInfo,[tkClass],List);
    for J := 0 to Count-1 do begin
      Prop := List^[J];
      if not GetTypeData(Prop.PropType^).ClassType.InheritsFrom(TComponent) then Continue;
      Targets := TJSONArray.Create;
      Ref := TJSONObject.Create.AddPair('name',string(Prop.Name))
        .AddPair('target',ComponentId(TComponent(GetObjectProp(Item,Prop))))
        .AddPair('writable',TJSONBool.Create(Writable and ReferenceWritable(Prop)))
        .AddPair('allowedTargets',Targets);
      References.AddElement(Ref);
      if Writable and ReferenceWritable(Prop) then begin
        Targets.Add('');
        for I := -1 to Root.ComponentCount-1 do begin
          if I = -1 then Candidate := Root else Candidate := Root.Components[I];
          if (Candidate <> Item) and Candidate.InheritsFrom(GetTypeData(Prop.PropType^).ClassType) then Targets.Add(Candidate.Name);
        end;
      end;
    end;
  finally FreeMem(List); end;
end;

end.
