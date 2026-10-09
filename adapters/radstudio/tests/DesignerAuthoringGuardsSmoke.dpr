program DesignerAuthoringGuardsSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.Classes, Vcl.Forms, Vcl.StdCtrls, Vcl.ExtCtrls,
  FMX.StdCtrls, FMX.Edit, FMX.Layouts,
  PiAgent.DesignerAuthoringGuards in '..\src\PiAgent.DesignerAuthoringGuards.pas';
type
  TButton = class(Vcl.StdCtrls.TButton);
  TDirectForm = class(Vcl.Forms.TForm);
  TInheritedForm = class(TDirectForm);
var Form: Vcl.Forms.TForm; ThirdParty: TComponent; Button: Vcl.StdCtrls.TButton; Rejected: Boolean;
procedure Check(Value: Boolean; const Message: string);
begin if not Value then raise Exception.Create(Message); end;
begin
  try
    Check(StandardDesignerClass('vcl',Vcl.StdCtrls.TButton),'Real VCL button rejected');
    Check(StandardDesignerClass('fmx',FMX.StdCtrls.TButton),'Real FMX button rejected');
    Check(StandardDesignerClass('fmx',FMX.Edit.TEdit),'Actual FMX edit unit rejected');
    Check(not StandardDesignerClass('vcl',TButton),'Third-party same-name button accepted');
    Check(not StandardDesignerClass('fmx',Vcl.StdCtrls.TButton),'Cross-framework button accepted');
    Check(StandardDesignerParent('vcl',Vcl.ExtCtrls.TPanel),'Standard VCL parent rejected');
    Check(StandardDesignerParent('fmx',FMX.Layouts.TLayout),'Standard FMX parent rejected');
    Check(not StandardDesignerParent('vcl',Vcl.StdCtrls.TButton),'Unsupported button container accepted');
    Form:=TDirectForm.CreateNew(nil);
    try
      Check(StandardDesignerRoot(Form,'vcl'),'Direct standard VCL form rejected');
      Check(not StandardDesignerRoot(Form,'fmx'),'Cross-framework form accepted');
      ThirdParty:=TButton.Create(Form);
      Check(not StandardDesignerRoot(Form,'vcl'),'Form with third-party shadow class accepted');
      ThirdParty.Free;
      Check(StandardDesignerRoot(Form,'vcl'),'Clean form remained blocked');
      Button:=Vcl.StdCtrls.TButton.Create(Form);
      Button.Caption:='Reviewed bounded deletion'; RequireBoundedDesignerDeletion(Button);
      Button.Caption:=StringOfChar('x',100000); Rejected:=False;
      try RequireBoundedDesignerDeletion(Button); except Rejected:=True; end;
      Check(Rejected,'Large serialized deletion had no complete recovery review preflight');
    finally Form.Free; end;
    Form:=TInheritedForm.CreateNew(nil);
    try Check(not StandardDesignerRoot(Form,'vcl'),'Inherited source form accepted'); finally Form.Free; end;
    Writeln('PASS: production standard-unit allowlist, actual framework identity, direct form inheritance and supported parent guards');
  except on E: Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
