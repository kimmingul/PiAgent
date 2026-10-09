unit PiAgent.RequestRetirement;
interface
uses System.SysUtils, System.Generics.Collections;
type
  TSdkPending = record Session: string; Started: Boolean; end;
  TPiRequestRetirement = class
  private
    FLock: TObject;
    FSession: string;
    FPending: TDictionary<string,TSdkPending>;
    FRetired: TDictionary<string,Boolean>;
    FClosed: Boolean;
    function Key(const Session,Id: string): string;
  public
    constructor Create;
    destructor Destroy; override;
    procedure Bind(const Session: string);
    function RegisterRequest(const Session,Id: string): Boolean;
    procedure Retire(const Session,Id: string);
    function BeginRequest(const Session,Id: string): Boolean;
    function MayReply(const Id: string): Boolean;
    procedure Complete(const Id: string);
  end;
implementation
constructor TPiRequestRetirement.Create;
begin inherited; FLock:=TObject.Create; FPending:=TDictionary<string,TSdkPending>.Create; FRetired:=TDictionary<string,Boolean>.Create; end;
destructor TPiRequestRetirement.Destroy;
begin FPending.Free; FRetired.Free; FLock.Free; inherited; end;
function TPiRequestRetirement.Key(const Session,Id: string): string;
begin
  if (Session='') or (Length(Session)>128) or Session.Contains(#0) or (Id='') or (Length(Id)>128) or Id.Contains(#0) then begin
    FClosed:=True; raise Exception.Create('SDK request identity invalid; reconnect required');
  end;
  Result:=Session+#0+Id;
end;
procedure TPiRequestRetirement.Bind(const Session: string);
begin TMonitor.Enter(FLock); try FSession:=Session; FPending.Clear; finally TMonitor.Exit(FLock); end; end;
function TPiRequestRetirement.RegisterRequest(const Session,Id: string): Boolean;
var Pending: TSdkPending; RequestKey: string;
begin
  TMonitor.Enter(FLock);
  try
    RequestKey:=Key(Session,Id); Result:=False;
    if FClosed or (Session<>FSession) or FRetired.ContainsKey(RequestKey) then Exit;
    if FPending.ContainsKey(Id) then begin FClosed:=True; raise Exception.Create('Duplicate SDK request; reconnect required'); end;
    if FPending.Count>=256 then begin FClosed:=True; raise Exception.Create('SDK pending request limit; reconnect required'); end;
    Pending.Session:=Session; Pending.Started:=False; FPending.Add(Id,Pending); Result:=True;
  finally TMonitor.Exit(FLock); end;
end;
procedure TPiRequestRetirement.Retire(const Session,Id: string);
var RequestKey: string; Pending: TSdkPending;
begin
  TMonitor.Enter(FLock);
  try
    RequestKey:=Key(Session,Id);
    if not FRetired.ContainsKey(RequestKey) then begin
      if FRetired.Count>=256 then begin FClosed:=True; raise Exception.Create('SDK cancellation limit; reconnect required'); end;
      FRetired.Add(RequestKey,True);
    end;
    if FPending.TryGetValue(Id,Pending) and (Pending.Session=Session) then FPending.Remove(Id);
  finally TMonitor.Exit(FLock); end;
end;
function TPiRequestRetirement.BeginRequest(const Session,Id: string): Boolean;
var Pending: TSdkPending;
begin
  TMonitor.Enter(FLock);
  try
    Result:=not FClosed and (Session=FSession) and FPending.TryGetValue(Id,Pending);
    if Result then begin
      Result:=(Pending.Session=Session) and not Pending.Started and not FRetired.ContainsKey(Key(Session,Id));
      if Result then begin Pending.Started:=True; FPending[Id]:=Pending; end;
    end;
  finally TMonitor.Exit(FLock); end;
end;
function TPiRequestRetirement.MayReply(const Id: string): Boolean;
var Pending: TSdkPending;
begin
  TMonitor.Enter(FLock);
  try
    Result:=not FClosed and FPending.TryGetValue(Id,Pending);
    if Result then Result:=(Pending.Session=FSession) and Pending.Started and not FRetired.ContainsKey(Key(Pending.Session,Id));
  finally TMonitor.Exit(FLock); end;
end;
procedure TPiRequestRetirement.Complete(const Id: string);
begin TMonitor.Enter(FLock); try FPending.Remove(Id); finally TMonitor.Exit(FLock); end; end;
end.
