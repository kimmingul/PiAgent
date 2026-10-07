using System.Windows;
using System.Text.Json;
namespace PiAgent.Setup;
public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        try
        {
            var languageIndex = Array.IndexOf(e.Args, "--language");
            if (languageIndex >= 0) L.Select(languageIndex + 1 < e.Args.Length ? e.Args[languageIndex + 1] : "invalid");
            if (e.Args.Contains("--inspect"))
            {
                var path = e.Args.SkipWhile(a => a != "--inspect").Skip(1).First();
                File.WriteAllText(path, JsonSerializer.Serialize(InstallerEngine.Detect(), InstallerEngine.Json));
                Shutdown(0); return;
            }
            if (e.Args.Contains("--verify-payload"))
            {
                var path = e.Args.SkipWhile(a => a != "--verify-payload").Skip(1).First();
                await Task.Run(() => InstallerEngine.ExtractPayload(path));
                Shutdown(0); return;
            }
            if (e.Args.Contains("--install-components"))
            {
                var components = e.Args.SkipWhile(a => a != "--install-components").Skip(1).First().Split(',').ToHashSet(StringComparer.OrdinalIgnoreCase);
                if (components.Any(c => c is not ("core" or "rad32" or "rad64" or "vs22" or "vs26" or "omp"))) throw new ArgumentException("Unknown setup component.");
                var log = Path.Combine(Path.GetTempPath(), "PiAgent-setup-install.log");
                var progress = new Progress<string>(text => File.AppendAllText(log, DateTime.Now.ToString("s") + " " + text + Environment.NewLine));
                await Task.Run(() => InstallerEngine.Install(new(components.Contains("rad32"), components.Contains("rad64"), components.Contains("vs22"), components.Contains("vs26"), components.Contains("omp")), InstallerEngine.Detect(), progress));
                Shutdown(0); return;
            }
            if (e.Args.Contains("--uninstall-worker"))
            {
                await Task.Run(() => InstallerEngine.Uninstall());
                MessageBox.Show(L.Text("PiAgent를 제거했습니다. 저장된 대화와 외부 OMP 설치는 유지됩니다."), "PiAgent");
                Shutdown(0); return;
            }
            new MainWindow(e.Args.Contains("--uninstall")).Show();
        }
        catch (Exception error)
        {
            if (e.Args.Any(a => a.StartsWith("--inspect") || a == "--verify-payload" || a == "--install-components"))
                File.WriteAllText(Path.Combine(Path.GetTempPath(), "PiAgent-setup-error.txt"), error.ToString());
            else MessageBox.Show(error.Message, L.Text("PiAgent 설치"), MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
}
