unit PiAgent.TestResults;
interface
uses System.JSON;
function ParseNUnitResults(const XML: string): TJSONObject;
implementation
uses System.SysUtils, System.Variants, System.Win.ComObj;
function ParseNUnitResults(const XML: string): TJSONObject;
var Document,Root,Nodes,Node,Message: OleVariant; Rows: TJSONArray; I,Count: Integer;
  function Number(const Name: string): Integer;
  begin Result:=StrToIntDef(VarToStr(Root.getAttribute(Name)),-1); if (Result<0) or (Result>1000000) then raise Exception.Create('Invalid NUnit result counts'); end;
begin
  if (Length(XML)=0) or (Length(XML)>1048576) then raise Exception.Create('Test report is empty/too large');
  Document:=CreateOleObject('MSXML2.DOMDocument.6.0'); Document.async:=False;
  Document.validateOnParse:=False; Document.resolveExternals:=False; Document.setProperty('ProhibitDTD',True);
  if not Document.loadXML(XML) then raise Exception.Create('Malformed test report');
  Root:=Document.documentElement;
  if VarIsNull(Root) or VarIsClear(Root) then raise Exception.Create('Unsupported test report schema');
  if VarToStr(Root.nodeName)<>'test-results' then raise Exception.Create('Unsupported test report schema');
  Rows:=TJSONArray.Create; Result:=TJSONObject.Create.AddPair('source','DUnitX NUnit XML').AddPair('tests',Rows);
  try
    Result.AddPair('total',TJSONNumber.Create(Number('total'))).AddPair('errors',TJSONNumber.Create(Number('errors')))
      .AddPair('failures',TJSONNumber.Create(Number('failures'))).AddPair('ignored',TJSONNumber.Create(Number('ignored')));
    Nodes:=Document.selectNodes('//test-case'); Count:=Nodes.length;
    if Count>200 then Count:=200;
    for I:=0 to Count-1 do begin
      Node:=Nodes.item[I]; Message:=Node.selectSingleNode('failure/message');
      if VarIsNull(Message) or VarIsClear(Message) then Message:='' else Message:=Message.text;
      Rows.AddElement(TJSONObject.Create.AddPair('name',Copy(VarToStr(Node.getAttribute('name')),1,1024))
        .AddPair('result',VarToStr(Node.getAttribute('result'))).AddPair('executed',VarToStr(Node.getAttribute('executed')))
        .AddPair('message',Copy(VarToStr(Message),1,4096)));
    end;
    Result.AddPair('truncated',TJSONBool.Create(Integer(Nodes.length)>Count));
  except Result.Free; raise; end;
end;
end.
