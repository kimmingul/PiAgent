unit PiAgent.MenuIcon;
interface
function AgentImageIndex: Integer;
implementation
uses System.Classes, System.SysUtils, Winapi.Windows, Vcl.Graphics, ToolsAPI;
var ImageIndex: Integer = -2;
function AgentImageIndex: Integer;
var Services: INTAServices280; Small, Large: TWICImage; Stream: TResourceStream;
begin
  if ImageIndex <> -2 then Exit(ImageIndex);
  ImageIndex := -1;
  Small := TWICImage.Create; Large := TWICImage.Create;
  try
    Stream := TResourceStream.Create(HInstance,'PIAGENT_ICON16',RT_RCDATA);
    try Small.LoadFromStream(Stream); finally Stream.Free; end;
    Stream := TResourceStream.Create(HInstance,'PIAGENT_ICON32',RT_RCDATA);
    try Large.LoadFromStream(Stream); finally Stream.Free; end;
    if Supports(BorlandIDEServices,INTAServices280,Services) then
      ImageIndex := Services.AddImage('PiAgent.Chat',[Small,Large]);
  finally Small.Free; Large.Free; end;
  Result := ImageIndex;
end;
end.
