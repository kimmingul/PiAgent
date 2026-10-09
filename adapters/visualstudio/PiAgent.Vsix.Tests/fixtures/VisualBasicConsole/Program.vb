Imports System
Imports System.Threading

Namespace PiAgentAcceptanceFixtures
    Public Module Program
        Public Sub Main(args As String())
            Dim actual = New FixtureCaller().Run()
            If actual <> 3 Then Throw New InvalidOperationException("Fixture calculation failed")
            Console.WriteLine("PiAgent VB fixture: 한글 🚀 " & actual.ToString())
            If Array.IndexOf(args, "--verify") >= 0 Then Return
            ' Keep the explicitly owned target alive for debugger start/pause/stop.
            While True
                Thread.Sleep(100)
            End While
        End Sub
    End Module
End Namespace
