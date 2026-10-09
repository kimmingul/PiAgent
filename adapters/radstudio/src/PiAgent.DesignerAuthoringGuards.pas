unit PiAgent.DesignerAuthoringGuards;
interface
uses System.Classes;
function SupportedDesignerTypes(const Framework: string): TArray<string>;
function StandardDesignerClass(const Framework: string; Candidate: TClass): Boolean;
function StandardDesignerParent(const Framework: string; Candidate: TClass): Boolean;
function StandardDesignerRoot(Root: TComponent; const Framework: string): Boolean;
procedure RequireBoundedDesignerDeletion(Item: TComponent);
implementation
uses System.SysUtils;
type TDeletionReviewStream = class(TMemoryStream)
  function Write(const Buffer; Count: NativeInt): NativeInt; override;
end;
function TDeletionReviewStream.Write(const Buffer; Count: NativeInt): NativeInt;
begin
  if (Count<0) or (Position+Count>8192) then raise Exception.Create('Component serialization exceeds the bounded reviewed deletion scope');
  Result:=inherited Write(Buffer,Count);
end;
procedure RequireBoundedDesignerDeletion(Item: TComponent);
var Stream: TDeletionReviewStream;
begin
  if Item=nil then raise Exception.Create('Deletion target unavailable');
  Stream:=TDeletionReviewStream.Create;
  try Stream.WriteComponent(Item); finally Stream.Free; end;
end;
function SupportedDesignerTypes(const Framework: string): TArray<string>;
begin
  if Framework='vcl' then Result:=['TButton','TLabel','TPanel','TEdit','TMainMenu','TPopupMenu','TMenuItem','TActionList','TAction']
  else if Framework='fmx' then Result:=['TButton','TLabel','TLayout','TEdit','TMainMenu','TPopupMenu','TMenuItem','TActionList','TAction']
  else Result:=nil;
end;
function StandardDesignerClass(const Framework: string; Candidate: TClass): Boolean;
var UnitName,Name,Expected: string;
begin
  Result:=False; if Candidate=nil then Exit;
  UnitName:=Candidate.UnitName; Name:=Candidate.ClassName; Expected:='';
  if Framework='vcl' then begin
    if (Name='TButton') or (Name='TLabel') or (Name='TEdit') then Expected:='Vcl.StdCtrls'
    else if Name='TPanel' then Expected:='Vcl.ExtCtrls'
    else if (Name='TMainMenu') or (Name='TPopupMenu') or (Name='TMenuItem') then Expected:='Vcl.Menus'
    else if Name='TActionList' then Expected:='Vcl.ActnList'
    else if Name='TAction' then Expected:='Vcl.ActnList';
  end else if Framework='fmx' then begin
    if (Name='TButton') or (Name='TLabel') then Expected:='FMX.StdCtrls'
    else if Name='TEdit' then Expected:='FMX.Edit'
    else if Name='TLayout' then Expected:='FMX.Layouts'
    else if (Name='TMainMenu') or (Name='TPopupMenu') or (Name='TMenuItem') then Expected:='FMX.Menus'
    else if Name='TActionList' then Expected:='FMX.ActnList'
    else if Name='TAction' then Expected:='FMX.ActnList';
  end;
  Result:=(Expected<>'') and (UnitName=Expected);
end;
function StandardDesignerParent(const Framework: string; Candidate: TClass): Boolean;
begin
  Result:=StandardDesignerClass(Framework,Candidate) and
    (((Framework='vcl') and (Candidate.ClassName='TPanel')) or
     ((Framework='fmx') and (Candidate.ClassName='TLayout')));
end;
function StandardDesignerRoot(Root: TComponent; const Framework: string): Boolean;
var I: Integer; ParentClass: TClass; UnitName: string;
begin
  Result:=False; if (Root=nil) or (csAncestor in Root.ComponentState) then Exit;
  ParentClass:=Root.ClassParent;
  if (ParentClass=nil) or (ParentClass.ClassName<>'TForm') then Exit;
  if ((Framework='vcl') and (ParentClass.UnitName<>'Vcl.Forms')) or
     ((Framework='fmx') and (ParentClass.UnitName<>'FMX.Forms')) or
     not ((Framework='vcl') or (Framework='fmx')) then Exit;
  for I:=0 to Root.ComponentCount-1 do begin
    UnitName:=Root.Components[I].ClassType.UnitName;
    if not UnitName.StartsWith('Vcl.') and not UnitName.StartsWith('FMX.') and
       (UnitName<>'System.Actions') and (UnitName<>'System.Classes') then Exit;
    if csAncestor in Root.Components[I].ComponentState then Exit;
  end;
  Result:=True;
end;
end.
