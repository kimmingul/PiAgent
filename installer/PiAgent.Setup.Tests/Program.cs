using System.Security.Cryptography;
using System.Text.Json;
using PiAgent.Setup;
var folder = Path.Combine(Path.GetTempPath(), "PiAgent-Setup-Test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(folder);
void MustReject(Action action, string test)
{
    try { action(); } catch (IOException) { Console.WriteLine("PASS " + test); return; }
    throw new Exception("Did not reject: " + test);
}
try
{
    foreach (var system in new[] {"en-US", "ja-JP", "de-DE", "fr-FR", ""})
        if (L.Resolve("auto", system) != "en") throw new Exception("Non-Korean default must be English");
    if (L.Resolve("auto", "ko-KR") != "ko" || L.Resolve("en", "ko-KR") != "en" || L.Resolve("ko", "en-US") != "ko") throw new Exception("Locale override failed");
    foreach (var pair in L.English)
    {
        var source = System.Text.RegularExpressions.Regex.Matches(pair.Key, @"\{\d+\}").Select(m => m.Value).Order().ToArray();
        var translated = System.Text.RegularExpressions.Regex.Matches(pair.Value, @"\{\d+\}").Select(m => m.Value).Order().ToArray();
        if (!source.SequenceEqual(translated) || string.IsNullOrWhiteSpace(pair.Value)) throw new Exception("Invalid translation: " + pair.Key);
        L.Select("ko"); if (L.Text(pair.Key) != pair.Key) throw new Exception("Korean resource lost");
        L.Select("en"); if (L.Text(pair.Key) != pair.Value) throw new Exception("English resource missing");
    }
    L.Select("en");
    MustReject(() => InstallerEngine.UpgradeCoreSettings("new-node", null, "invalid json"), "English errors preserve access policy");
    try { InstallerEngine.ExtractPayload(folder); } catch (IOException error) { if (error.Message != "Cannot extract into an existing folder.") throw; }
    L.Select("auto"); Console.WriteLine("PASS Korean/English setup resources, placeholders, system default and overrides");
    var fresh = InstallerEngine.UpgradeCoreSettings("new-node", "detected-omp", null);
    if (fresh.allowWrites || fresh.ompProfile != "restricted" || fresh.workspace != null || fresh.omp != "detected-omp") throw new Exception("Fresh install defaults changed");
    var saved = new CoreSettings("old-node", "custom-pipe", "saved-omp", "saved-workspace", true, "native");
    var upgraded = InstallerEngine.UpgradeCoreSettings("new-node", "detected-omp", JsonSerializer.Serialize(saved));
    if (upgraded != saved with { node = "new-node" }) throw new Exception("Upgrade lost owner settings");
    MustReject(() => InstallerEngine.UpgradeCoreSettings("new-node", null, "invalid json"), "malformed settings do not reset access policy");
    MustReject(() => InstallerEngine.UpgradeCoreSettings("new-node", null, JsonSerializer.Serialize(saved with { workspace = null })), "invalid native settings rejected");
    Console.WriteLine("PASS fresh defaults / upgrade preserves Core settings with new bundled Node path");
    var file = Path.Combine(folder, "core.txt"); File.WriteAllText(file, "valid payload");
    var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
    void Manifest(string path) => File.WriteAllText(Path.Combine(folder, "setup-manifest.json"), JsonSerializer.Serialize(new { sha256 = new Dictionary<string,string> { [path] = hash } }));
    Manifest("core.txt"); InstallerEngine.VerifyPayload(folder); Console.WriteLine("PASS valid payload");
    File.WriteAllText(file, "tampered payload"); MustReject(() => InstallerEngine.VerifyPayload(folder), "tampered payload");
    Manifest("../outside.txt"); MustReject(() => InstallerEngine.VerifyPayload(folder), "manifest traversal");
    MustReject(() => InstallerEngine.ExtractPayload(folder), "existing extraction folder");
    var absent = new Detection("arm64", false, false, new(), null);
    MustReject(() => InstallerEngine.Install(new(false,false,false,true,false), absent, new Progress<string>()), "unavailable VS2026 rejected before mutation");
    MustReject(() => InstallerEngine.Install(new(true,false,false,false,false), absent, new Progress<string>()), "unavailable RAD32 rejected before mutation");
    var detected = InstallerEngine.Detect();
    if (detected.Architecture is not ("arm64" or "x64") || detected.VisualStudio.Any(v => !File.Exists(Path.Combine(v.Path, @"Common7\IDE\VSIXInstaller.exe"))) || (detected.Omp != null && !File.Exists(detected.Omp))) throw new Exception("Detection returned invalid paths");
    Console.WriteLine("PASS installed IDE / OMP paths exist");
}
finally { Directory.Delete(folder, true); }
