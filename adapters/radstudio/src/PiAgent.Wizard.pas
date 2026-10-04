unit PiAgent.Wizard;
interface
procedure Register;
implementation
uses ToolsAPI, PiAgent.ChatForm;
type
  TChatWizard = class(TNotifierObject, IOTAWizard, IOTAMenuWizard)
  protected
    function GetIDString: string;
    function GetName: string;
    function GetMenuText: string;
    function GetState: TWizardState;
    procedure Execute;
  end;
var Wizard: IOTAWizard;
function TChatWizard.GetIDString: string;
begin Result := 'PiAgent.ConnectionWizard'; end;
function TChatWizard.GetName: string;
begin Result := 'PiAgent Chat'; end;
function TChatWizard.GetMenuText: string;
begin Result := 'PiAgent: Open Chat'; end;
function TChatWizard.GetState: TWizardState;
begin Result := [wsEnabled]; end;
procedure TChatWizard.Execute;
begin ShowPiAgentChat; end;
procedure Register;
begin
  if Wizard <> nil then Exit;
  Wizard := TChatWizard.Create; RegisterPackageWizard(Wizard);
end;
initialization
  Wizard := nil;
finalization
  Wizard := nil;
end.