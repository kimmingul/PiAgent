program RequestRetirementSmoke;
{$APPTYPE CONSOLE}
uses System.SysUtils, System.Classes,
  PiAgent.RequestRetirement in '..\src\PiAgent.RequestRetirement.pas';
var Gate: TPiRequestRetirement; I: Integer; Rejected: Boolean; Worker: TThread;
procedure Require(Value: Boolean; const Message: string);
begin if not Value then raise Exception.Create(Message); end;
begin
  try
    Gate:=TPiRequestRetirement.Create;
    try
      Gate.Bind('session-one');
      Require(Gate.RegisterRequest('session-one','queued'),'Queued registration failed');
      Worker:=TThread.CreateAnonymousThread(procedure begin Gate.Retire('session-one','queued'); end);
      Worker.FreeOnTerminate:=False;
      try Worker.Start; Worker.WaitFor; finally Worker.Free; end;
      Require(not Gate.BeginRequest('session-one','queued'),'Worker cancellation did not prevent UI dispatch');
      Require(Gate.RegisterRequest('session-one','active'),'Active registration failed');
      Require(Gate.BeginRequest('session-one','active'),'First SDK dispatch failed');
      Require(not Gate.BeginRequest('session-one','active'),'Duplicate SDK dispatch accepted');
      Require(Gate.MayReply('active'),'Uncancelled reply rejected');
      Gate.Retire('session-one','active');
      Require(not Gate.MayReply('active'),'Late cancelled reply accepted');
      Require(Gate.RegisterRequest('session-one','old'),'Old session registration failed');
      Gate.Bind('session-two');
      Require(not Gate.BeginRequest('session-one','old'),'Previous session callback executed');
      Require(Gate.RegisterRequest('session-two','queued'),'Distinct session ID was incorrectly retired');
      Require(Gate.BeginRequest('session-two','queued'),'New session SDK dispatch failed');
      Gate.Complete('queued');
      Require(not Gate.MayReply('queued'),'Completed reply accepted');
      Gate.Bind('');
      Require(not Gate.BeginRequest('session-two','queued'),'Disconnected callback executed');
    finally Gate.Free; end;
    Gate:=TPiRequestRetirement.Create;
    try
      Gate.Bind('capacity');
      for I:=1 to 256 do Gate.Retire('capacity',IntToStr(I));
      Rejected:=False;
      try Gate.Retire('capacity','257'); except Rejected:=True; end;
      Require(Rejected,'Cancellation capacity silently evicted tombstones');
      Require(not Gate.RegisterRequest('capacity','new'),'Capacity overflow did not fail closed');
      Gate.Bind('another-session');
      Require(not Gate.RegisterRequest('another-session','new'),'Session switch reopened closed connection');
    finally Gate.Free; end;
    Gate:=TPiRequestRetirement.Create;
    try
      Gate.Bind('reconnected');
      Require(Gate.RegisterRequest('reconnected','new'),'Fresh connection gate could not recover');
      Rejected:=False;
      try Gate.RegisterRequest('reconnected',''); except Rejected:=True; end;
      Require(Rejected,'Invalid identity accepted');
      Require(not Gate.BeginRequest('reconnected','new'),'Invalid identity did not fail closed');
    finally Gate.Free; end;
    Writeln('PASS: worker cancellation before dispatch, late reply suppression, session isolation, capacity fail closed, new connection recovery');
  except on E: Exception do begin Writeln(E.Message); ExitCode:=1; end; end;
end.
