unit PiAgent.Wizard;
interface
procedure Register;
implementation
uses System.SysUtils, System.Classes, Vcl.Menus, Vcl.ExtCtrls, Winapi.Windows,
  ToolsAPI, PiAgent.ChatForm, PiAgent.MenuIcon, PiAgent.EditorSuggestions, PiAgent.DesignerAcceptance, PiAgent.IdeAcceptance, PiAgent.IdeSoak, PiAgent.CoreAcceptance;
type
  TChatWizard = class(TNotifierObject, IOTAWizard)
  protected
    function GetIDString: string;
    function GetName: string;
    function GetState: TWizardState;
    procedure Execute;
  end;
  TChatMenus = class(TComponent)
  private
    FViewItem, FToolsItem, FCompletionItem, FNextEditItem, FFixtureItem: TMenuItem;
    FToolsParent: TMenuItem;
    FToolsPopup: TNotifyEvent;
    FRetry: TTimer;
    FFixtureTimer: TTimer;
    FTries: Integer;
    procedure OpenChat(Sender: TObject);
    procedure Suggest(Sender: TObject);
    procedure Fixture(Sender: TObject);
    procedure Retry(Sender: TObject);
    procedure AutoFixture(Sender: TObject);
    procedure ToolsPopup(Sender: TObject);
    function Install: Boolean;
    procedure AddItem(const Services: INTAServices; const ParentNames: array of string;
      const ItemName: string; var Item: TMenuItem);
  protected
    procedure Notification(AComponent: TComponent; Operation: TOperation); override;
  public
    constructor Create(AOwner: TComponent); override;
    destructor Destroy; override;
  end;
var Wizard: IOTAWizard; ChatMenus: TChatMenus;
function TChatWizard.GetIDString: string;
begin Result := 'PiAgent.ConnectionWizard'; end;
function TChatWizard.GetName: string;
begin Result := 'PiAgent Chat'; end;
function TChatWizard.GetState: TWizardState;
begin Result := [wsEnabled]; end;
procedure TChatWizard.Execute;
begin ShowPiAgentChat; end;
procedure TChatMenus.OpenChat(Sender: TObject);
begin ShowPiAgentChat; end;
procedure TChatMenus.Suggest(Sender: TObject);
begin if Sender=FNextEditItem then SuggestPiAgentCode('next-edit') else SuggestPiAgentCode('completion'); end;
procedure TChatMenus.Fixture(Sender: TObject);
begin RunDesignerFixtureAcceptance; end;
procedure TChatMenus.AutoFixture(Sender: TObject);
begin
  try
    if not DesignerFixtureReady then Exit;
    FFixtureTimer.Enabled:=False;
    RunDesignerFixtureAcceptance;
  except on E:Exception do OutputDebugString(PChar('PiAgent fixture: '+E.Message)); end;
end;
procedure TChatMenus.Notification(AComponent: TComponent; Operation: TOperation);
begin
  inherited;
  if Operation = opRemove then begin
    if AComponent = FViewItem then FViewItem := nil;
    if AComponent = FToolsItem then FToolsItem := nil;
    if AComponent = FCompletionItem then FCompletionItem := nil;
    if AComponent = FNextEditItem then FNextEditItem := nil;
    if AComponent = FFixtureItem then FFixtureItem := nil;
    if AComponent = FToolsParent then begin FToolsParent := nil; FToolsPopup := nil; end;
  end;
end;
procedure TChatMenus.AddItem(const Services: INTAServices; const ParentNames: array of string;
  const ItemName: string; var Item: TMenuItem);
var I,J: Integer; Parent: TMenuItem;
begin
  if (Item <> nil) and (Item.Parent <> nil) then Exit;
  if Services.MainMenu = nil then Exit;
  for I := 0 to High(ParentNames) do
    for J := 0 to Services.MainMenu.Items.Count-1 do begin
      Parent := Services.MainMenu.Items[J];
      if not SameText(Parent.Name,ParentNames[I]) then Continue;
      if (ItemName = 'PiAgentToolsChat') and (FToolsParent = nil) then begin
        FToolsParent := Parent; Parent.FreeNotification(Self);
        FToolsPopup := Parent.OnClick; Parent.OnClick := ToolsPopup;
      end;
      if Item = nil then begin
        Item := TMenuItem.Create(Self); Item.Name := ItemName;
        Item.Caption := 'PiAgent'; Item.OnClick := OpenChat;
        Item.ImageIndex := AgentImageIndex;
      end;
      Parent.Add(Item);
      if Item.Parent <> nil then Exit;
    end;
end;
function TChatMenus.Install: Boolean;
var Services: INTAServices;
begin
  Result := False;
  if not Supports(BorlandIDEServices,INTAServices,Services) then Exit;
  try
    AddItem(Services,['ViewsMenu','ViewMenu'],'PiAgentViewChat',FViewItem);
    AddItem(Services,['ToolsMenu'],'PiAgentToolsChat',FToolsItem);
    AddItem(Services,['ToolsMenu'],'PiAgentSuggestCode',FCompletionItem);
    AddItem(Services,['ToolsMenu'],'PiAgentSuggestNextEdit',FNextEditItem);
    if FCompletionItem<>nil then begin FCompletionItem.Caption:='PiAgent: Suggest Code'; FCompletionItem.OnClick:=Suggest; end;
    if FNextEditItem<>nil then begin FNextEditItem.Caption:='PiAgent: Suggest Next Edit'; FNextEditItem.OnClick:=Suggest; end;
    if GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_PATH')<>'' then begin
      AddItem(Services,['ToolsMenu'],'PiAgentFixtureAcceptance',FFixtureItem);
      if FFixtureItem<>nil then begin FFixtureItem.Caption:='PiAgent: Fixture Acceptance'; FFixtureItem.OnClick:=Fixture; end;
    end;
    Result := (FViewItem <> nil) and (FViewItem.Parent <> nil) and
      (FToolsItem <> nil) and (FToolsItem.Parent <> nil);
  except on E: Exception do OutputDebugString(PChar('PiAgent menu: '+E.Message)); end;
end;
procedure TChatMenus.ToolsPopup(Sender: TObject);
begin
  // Configure Tools rebuilds this submenu. Let the IDE populate it first.
  if Assigned(FToolsPopup) then FToolsPopup(Sender);
  Install;
end;
procedure TChatMenus.Retry(Sender: TObject);
begin
  Inc(FTries);
  if Install or (FTries >= 240) then FRetry.Enabled := False;
end;
constructor TChatMenus.Create(AOwner: TComponent);
begin
  inherited;
  // Package registration can precede IDE main-menu creation.
  if not Install then begin
    FRetry := TTimer.Create(Self); FRetry.Interval := 250; FRetry.OnTimer := Retry;
  end;
  if GetEnvironmentVariable('PIAGENT_RAD_FIXTURE_AUTORUN')='1' then begin
    FFixtureTimer:=TTimer.Create(Self); FFixtureTimer.Interval:=2000; FFixtureTimer.OnTimer:=AutoFixture;
  end;
end;
destructor TChatMenus.Destroy;
var Handler: TNotifyEvent;
begin
  if FRetry <> nil then FRetry.Enabled := False;
  if FFixtureTimer<>nil then FFixtureTimer.Enabled:=False;
  Handler := ToolsPopup;
  if (FToolsParent <> nil) and
    (TMethod(FToolsParent.OnClick).Code = TMethod(Handler).Code) and
    (TMethod(FToolsParent.OnClick).Data = Self) then
    FToolsParent.OnClick := FToolsPopup;
  if FViewItem <> nil then FViewItem.OnClick := nil;
  if FToolsItem <> nil then FToolsItem.OnClick := nil;
  if FCompletionItem<>nil then FCompletionItem.OnClick:=nil;
  if FNextEditItem<>nil then FNextEditItem.OnClick:=nil;
  if FFixtureItem<>nil then FFixtureItem.OnClick:=nil;
  // Owned menu items detach from their parents on destruction.
  inherited;
end;
procedure Register;
begin
  if Wizard <> nil then Exit;
  Wizard := TChatWizard.Create; RegisterPackageWizard(Wizard);
  ChatMenus := TChatMenus.Create(nil);
  StartIdeFixtureAcceptance;
  StartIdeFixtureSoak;
  StartCoreFixtureAcceptance;
end;
initialization
  Wizard := nil; ChatMenus := nil;
finalization
  FreeAndNil(ChatMenus); Wizard := nil;
end.
