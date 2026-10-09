program DUnitXFixture;
{$APPTYPE CONSOLE}
uses System.SysUtils, DUnitX.TestFramework, DUnitX.Loggers.XML.NUnit;
type
  [TestFixture]
  TAgentFixture=class
  public
    [Test] procedure Passing;
    [Test] procedure Failing;
  end;
procedure TAgentFixture.Passing;
begin Assert.AreEqual(42,42); end;
procedure TAgentFixture.Failing;
begin Assert.AreEqual(42,43,'intentional fixture failure'); end;
var Runner: ITestRunner; Results: IRunResults;
begin
  TDUnitX.RegisterTestFixture(TAgentFixture);
  TDUnitX.CheckCommandLine;
  Runner:=TDUnitX.CreateRunner; Runner.UseRTTI:=True;
  Runner.AddLogger(TDUnitXXMLNUnitFileLogger.Create(TDUnitX.Options.XMLOutputFile));
  Results:=Runner.Execute;
  if not Results.AllPassed then ExitCode:=1;
end.
