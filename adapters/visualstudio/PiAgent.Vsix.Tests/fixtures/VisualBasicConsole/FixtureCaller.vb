Namespace PiAgentAcceptanceFixtures
    Public Class FixtureCaller
        Public Function Run() As Integer
            Return New FixtureLogic().Add(1, 2)
        End Function
    End Class
End Namespace
