program ExternalBuildFixture;
{$APPTYPE CONSOLE}
begin
{$IFDEF FAIL_FIXTURE}
  ThisIdentifierDoesNotExist;
{$ENDIF}
end.
