using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32;
namespace PiAgent.Setup;
public record VsInstance(string Id, string Path, int Major);
public record Detection(string Architecture, bool Rad32, bool Rad64, List<VsInstance> VisualStudio, string? Omp);
public record Selection(bool Rad32, bool Rad64, bool Vs22, bool Vs26, bool InstallOmp);
public record RegistryBackup(string Key, string Name, string Value);
public record Receipt(string Product, string Root, string Release, List<VsInstance> VisualStudio, List<string> RadKeys, List<RegistryBackup> PreviousRad);
public record CoreSettings(string node, string pipe = "piagent-dev", string? omp = null, string? workspace = null, bool allowWrites = false, string ompProfile = "restricted");
public static class InstallerEngine
{
    public static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "PiAgent");
    private const string Product = "PiAgent.Setup.38557171-e01d-4d7b-9842-3b435c5eed83";
    private const string VsixId = "PiAgent.Vsix.38557171-e01d-4d7b-9842-3b435c5eed83";
    private const string BdsKey = @"Software\Embarcadero\BDS\37.0";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PiAgent";
    private static string Architecture => RuntimeInformation.OSArchitecture == System.Runtime.InteropServices.Architecture.Arm64 ? "arm64" : "x64";
    public static CoreSettings UpgradeCoreSettings(string node, string? detectedOmp, string? previousJson)
    {
        if (previousJson == null) return new(node, omp: detectedOmp);
        CoreSettings settings;
        try { settings = JsonSerializer.Deserialize<CoreSettings>(previousJson, Json) ?? throw new JsonException("Empty settings"); }
        catch (JsonException error) { throw new IOException("기존 Core 설정을 읽지 못했습니다. 설정을 보존하기 위해 업데이트를 중단합니다.", error); }
        if (string.IsNullOrEmpty(settings.pipe) || settings.pipe.Length > 128 || settings.pipe.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('_' or '-')) ||
            settings.ompProfile is not ("restricted" or "native") || (settings.allowWrites && string.IsNullOrWhiteSpace(settings.workspace)) ||
            (settings.ompProfile == "native" && (!settings.allowWrites || string.IsNullOrWhiteSpace(settings.omp ?? detectedOmp))))
            throw new IOException("기존 Core 설정이 올바르지 않습니다. 설정을 보존하기 위해 업데이트를 중단합니다.");
        return settings with { node = node, omp = settings.omp ?? detectedOmp };
    }
    public static Detection Detect()
    {
        using var bds = Registry.CurrentUser.OpenSubKey(BdsKey);
        var bdsRoot = bds?.GetValue("RootDir") as string;
        var vs = new List<VsInstance>();
        var vswhere = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft Visual Studio\Installer\vswhere.exe");
        if (File.Exists(vswhere))
        {
            var result = Run(vswhere, ["-all", "-products", "*", "-format", "json", "-utf8"]);
            using var data = JsonDocument.Parse(result);
            foreach (var item in data.RootElement.EnumerateArray())
            {
                var path = item.GetProperty("installationPath").GetString()!;
                var major = int.Parse(item.GetProperty("installationVersion").GetString()!.Split('.')[0]);
                if (major is 17 or 18 && File.Exists(Path.Combine(path, @"Common7\IDE\VSIXInstaller.exe")))
                    vs.Add(new(item.GetProperty("instanceId").GetString()!, path, major));
            }
        }
        return new(Architecture, bdsRoot != null && File.Exists(Path.Combine(bdsRoot, @"bin\bds.exe")),
            bdsRoot != null && File.Exists(Path.Combine(bdsRoot, @"bin64\bds.exe")), vs, FindOmp());
    }
    private static string? FindOmp()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidates = new List<string> { Path.Combine(local, @"omp\omp.exe"), Path.Combine(local, @"Programs\omp\omp.exe"), Path.Combine(Root, @"dependencies\omp\omp.exe") };
        foreach (var path in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            if (!string.IsNullOrWhiteSpace(path)) candidates.Add(Path.Combine(path.Trim('"'), "omp.exe"));
        var deps = Path.Combine(local, @"PiAgent\dependencies\omp");
        if (Directory.Exists(deps))
            foreach (var version in Directory.GetDirectories(deps).OrderDescending())
                candidates.Add(Path.Combine(version, "win-" + Architecture, "omp.exe"));
        var current = Path.Combine(local, @"PiAgent\current-install.json");
        if (File.Exists(current))
        {
            try
            {
                using var data = JsonDocument.Parse(File.ReadAllText(current));
                if (data.RootElement.TryGetProperty("omp", out var value) && value.ValueKind == JsonValueKind.String) candidates.Add(value.GetString()!);
            }
            catch (JsonException) { }
        }
        return candidates.FirstOrDefault(File.Exists);
    }
    public static string Run(string executable, IEnumerable<string> arguments, int[]? accepted = null)
    {
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new IOException("프로세스를 시작하지 못했습니다: " + executable);
        var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(600_000)) { process.Kill(true); throw new IOException("설치 작업 시간이 초과되었습니다."); }
        Task.WaitAll(output, errors);
        if (!(accepted ?? [0]).Contains(process.ExitCode)) throw new IOException($"{Path.GetFileName(executable)} 실행 실패 ({process.ExitCode}): {errors.Result} {output.Result}");
        return output.Result;
    }
    public static void ExtractPayload(string destination)
    {
        if (Directory.Exists(destination)) throw new IOException("이미 존재하는 폴더에는 추출하지 않습니다.");
        Directory.CreateDirectory(destination);
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PiAgent.Payload.zip") ?? throw new IOException("설치 payload가 없습니다.");
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var prefix = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (var entry in archive.Entries)
        {
            var target = Path.GetFullPath(Path.Combine(destination, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("잘못된 ZIP 경로입니다.");
            if (entry.FullName.EndsWith('/')) { Directory.CreateDirectory(target); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!); entry.ExtractToFile(target);
        }
        VerifyPayload(destination);
    }
    public static void VerifyPayload(string destination)
    {
        var prefix = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(destination, "setup-manifest.json")));
        foreach (var entry in manifest.RootElement.GetProperty("sha256").EnumerateObject())
        {
            var target = Path.GetFullPath(Path.Combine(destination, entry.Name));
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("잘못된 manifest 경로입니다.");
            using var input = File.OpenRead(target);
            if (!Convert.ToHexString(SHA256.HashData(input)).Equals(entry.Value.GetString(), StringComparison.OrdinalIgnoreCase)) throw new IOException("설치파일 무결성 오류: " + entry.Name);
        }
    }
    private static void CheckClosed(bool rad, bool vs)
    {
        if ((rad && Process.GetProcessesByName("bds").Length > 0) || (vs && Process.GetProcessesByName("devenv").Length > 0))
            throw new IOException("선택한 IDE를 모두 종료한 뒤 다시 설치해주세요.");
    }
    public static void Install(Selection selection, Detection detected, IProgress<string> progress)
    {
        if ((selection.Rad32 && !detected.Rad32) || (selection.Rad64 && !detected.Rad64) ||
            (selection.Vs22 && !detected.VisualStudio.Any(v => v.Major == 17)) || (selection.Vs26 && !detected.VisualStudio.Any(v => v.Major == 18)))
            throw new IOException("선택한 IDE가 설치되어 있지 않습니다.");
        CheckClosed(selection.Rad32 || selection.Rad64, selection.Vs22 || selection.Vs26);
        EnsurePlainPath(Root);
        Receipt? previous = null;
        if (File.Exists(Path.Combine(Root, "install-receipt.json")))
        {
            previous = JsonSerializer.Deserialize<Receipt>(File.ReadAllText(Path.Combine(Root, "install-receipt.json")), Json);
            if (previous?.Product != Product || previous.Root != Root || !previous.Release.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new IOException("기존 설치 기록이 올바르지 않습니다.");
        }
        Directory.CreateDirectory(Root);
        var release = Path.Combine(Root, "releases", "0.9.17-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"));
        var selectedVs = detected.VisualStudio.Where(v => (v.Major == 17 && selection.Vs22) || (v.Major == 18 && selection.Vs26)).ToList();
        var receipt = new Receipt(Product, Root, release, previous?.VisualStudio.ToList() ?? new(), previous?.RadKeys.ToList() ?? new(), previous?.PreviousRad.ToList() ?? new());
        try
        {
            progress.Report("설치파일을 확인하고 추출하고 있습니다…"); ExtractPayload(release);
            var omp = detected.Omp;
            if (omp is null && selection.InstallOmp)
            {
                progress.Report("공식 OMP 최신 버전을 다운로드하고 있습니다…");
                omp = DownloadOmp();
            }
            var runtime = Path.Combine(release, "core");
            var node = Path.Combine(release, "runtimes", Architecture, "node", "node.exe");
            var dotnet = Path.Combine(release, "runtimes", Architecture, "dotnet");
            Run(node, ["-p", "process.arch"]);
            var previousSettings = previous == null ? null : Path.Combine(previous.Release, "core", "settings.json");
            if (previousSettings != null) EnsurePlainPath(previousSettings);
            var settings = UpgradeCoreSettings(node, omp, previousSettings != null && File.Exists(previousSettings) ? File.ReadAllText(previousSettings) : null);
            File.WriteAllText(Path.Combine(runtime, "settings.json"), JsonSerializer.Serialize(settings, Json));
            var startCore = Path.Combine(release, "Start-Core.ps1");
            File.WriteAllText(startCore, "$ErrorActionPreference='Stop'\n$env:PATH=(Join-Path $PSScriptRoot 'runtimes/" + Architecture + "/dotnet')+';'+$env:PATH\n& (Join-Path $PSScriptRoot 'core/scripts/start-core.ps1')\n");
            progress.Report("IDE adapter를 등록하고 있습니다…");
            if (selection.Rad32) RegisterRad(@"Known Packages", release, "Win32", receipt);
            if (selection.Rad64) RegisterRad(@"Known Packages x64", release, "Win64", receipt);
            SaveReceipt(receipt);
            foreach (var instance in selectedVs)
            {
                var installer = Path.Combine(instance.Path, @"Common7\IDE\VSIXInstaller.exe");
                var log = Path.Combine(Root, "vsix-" + instance.Id + ".log");
                var installed = InstalledVsixVersion(instance);
                using var manifest = new ZipArchive(File.OpenRead(Path.Combine(runtime, @"adapters\visualstudio\PiAgent.Vsix.vsix")));
                using var reader = new StreamReader(manifest.GetEntry("extension.vsixmanifest")!.Open());
                var xml = System.Xml.Linq.XDocument.Parse(reader.ReadToEnd());
                var ns = xml.Root!.Name.Namespace;
                var targetVersion = xml.Descendants(ns + "Identity").Single().Attribute("Version")!.Value;
                // A repair must replace unsigned/same-version content rather than accept AlreadyInstalled.
                if (installed != null && Version.Parse(installed) >= Version.Parse(targetVersion))
                    Run(installer, ["/quiet", "/shutdownprocesses", "/instanceIds:" + instance.Id, "/uninstall:" + VsixId, "/logFile:" + log]);
                Run(installer, ["/quiet", "/shutdownprocesses", "/instanceIds:" + instance.Id, "/logFile:" + log, Path.Combine(runtime, @"adapters\visualstudio\PiAgent.Vsix.vsix")]);
                if (InstalledVsixVersion(instance) != targetVersion) throw new IOException("VSIX 설치 버전 확인에 실패했습니다. 로그: " + log);
                if (!receipt.VisualStudio.Any(v => v.Id == instance.Id)) receipt.VisualStudio.Add(instance);
                SaveReceipt(receipt);
            }
            var setup = Path.Combine(Root, "PiAgent-Setup.exe"); File.Copy(Environment.ProcessPath!, setup, true);
            CreateShortcut("PiAgent Core 실행", "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + startCore + "\"");
            if (omp != null) CreateShortcut("OMP 실행 (로그인 및 설정)", omp, "");
            CreateShortcut("PiAgent 제거", setup, "--uninstall");
            using var uninstall = Registry.CurrentUser.CreateSubKey(UninstallKey);
            uninstall.SetValue("DisplayName", "PiAgent"); uninstall.SetValue("DisplayVersion", "0.9.17");
            uninstall.SetValue("Publisher", "Nanum Space Co., Ltd."); uninstall.SetValue("InstallLocation", Root);
            uninstall.SetValue("UninstallString", "\"" + setup + "\" --uninstall"); uninstall.SetValue("DisplayIcon", setup);
            uninstall.SetValue("NoModify", 1, RegistryValueKind.DWord); uninstall.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            SaveReceipt(receipt); progress.Report("설치 완료");
        }
        catch
        {
            // Keep a receipt for partial installs so the uninstaller can remove only our registrations.
            SaveReceipt(receipt);
            throw;
        }
    }
    private static string? InstalledVsixVersion(VsInstance instance)
    {
        var extensions = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "VisualStudio", instance.Major + ".0_" + instance.Id, "Extensions");
        if (!Directory.Exists(extensions)) return null;
        foreach (var directory in Directory.GetDirectories(extensions))
        {
            var file = Path.Combine(directory, "extension.vsixmanifest"); if (!File.Exists(file)) continue;
            try
            {
                var xml = System.Xml.Linq.XDocument.Load(file); var ns = xml.Root!.Name.Namespace;
                var identity = xml.Descendants(ns + "Identity").FirstOrDefault();
                if (identity?.Attribute("Id")?.Value == VsixId) return identity.Attribute("Version")?.Value;
            }
            catch (System.Xml.XmlException) { }
        }
        return null;
    }
    private static string DownloadOmp()
    {
        using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromMinutes(20) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("PiAgent-Setup/0.9.17");
        var text = http.GetStringAsync("https://api.github.com/repos/can1357/oh-my-pi/releases/latest").GetAwaiter().GetResult();
        using var data = JsonDocument.Parse(text);
        var name = "omp-windows-" + Architecture + ".exe";
        var asset = data.RootElement.GetProperty("assets").EnumerateArray().Single(a => a.GetProperty("name").GetString() == name);
        var digest = asset.GetProperty("digest").GetString()!;
        if (!digest.StartsWith("sha256:") || digest.Length != 71) throw new IOException("OMP 공식 SHA-256 정보가 없습니다.");
        var uri = new Uri(asset.GetProperty("browser_download_url").GetString()!);
        if (uri.Scheme != "https" || uri.Host != "github.com" || !uri.AbsolutePath.StartsWith("/can1357/oh-my-pi/releases/download/")) throw new IOException("잘못된 OMP 다운로드 주소입니다.");
        var folder = Path.Combine(Root, @"dependencies\omp"); Directory.CreateDirectory(folder);
        var temp = Path.Combine(folder, "omp-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var response = http.GetAsync(uri, System.Net.Http.HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult())
            {
                response.EnsureSuccessStatusCode();
                using var input = response.Content.ReadAsStream(); using var output = File.Create(temp); input.CopyTo(output);
            }
            using (var input = File.OpenRead(temp))
                if (!Convert.ToHexString(SHA256.HashData(input)).Equals(digest[7..], StringComparison.OrdinalIgnoreCase)) throw new IOException("OMP 다운로드 무결성 검증 실패.");
            var target = Path.Combine(folder, "omp.exe"); File.Move(temp, target, false); return target;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    private static void RegisterRad(string suffix, string release, string platform, Receipt receipt)
    {
        var keyName = BdsKey + "\\" + suffix;
        var path = Path.Combine(release, "core", "adapters", "radstudio", platform, "PiAgent370.bpl");
        using var key = Registry.CurrentUser.CreateSubKey(keyName);
        foreach (var name in key.GetValueNames())
        {
            if (!Path.GetFileName(name).Equals("PiAgent370.bpl", StringComparison.OrdinalIgnoreCase)) continue;
            if (!name.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && !receipt.PreviousRad.Any(p => p.Key == keyName && p.Name == name))
                receipt.PreviousRad.Add(new(keyName, name, key.GetValue(name)?.ToString() ?? "PiAgent"));
        }
        if (!receipt.RadKeys.Contains(keyName)) receipt.RadKeys.Add(keyName); SaveReceipt(receipt);
        foreach (var name in key.GetValueNames().Where(n => Path.GetFileName(n).Equals("PiAgent370.bpl", StringComparison.OrdinalIgnoreCase))) key.DeleteValue(name, false);
        key.SetValue(path, "PiAgent 0.9.17");
    }
    private static void SaveReceipt(Receipt receipt) => File.WriteAllText(Path.Combine(Root, "install-receipt.json"), JsonSerializer.Serialize(receipt, Json));
    private static void CreateShortcut(string name, string target, string arguments)
    {
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "PiAgent"); Directory.CreateDirectory(folder);
        var type = Type.GetTypeFromProgID("WScript.Shell") ?? throw new IOException("시작 메뉴 바로가기를 만들 수 없습니다.");
        dynamic shell = Activator.CreateInstance(type)!;
        try
        {
            dynamic link = shell.CreateShortcut(Path.Combine(folder, name + ".lnk"));
            try { link.TargetPath = target; link.Arguments = arguments; link.Save(); }
            finally { Marshal.FinalReleaseComObject(link); }
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }
    private static void EnsurePlainPath(string path)
    {
        for (var current = Path.GetFullPath(path); current != null; current = Path.GetDirectoryName(current))
            if (Directory.Exists(current) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("연결된 설치 경로는 허용하지 않습니다.");
    }
    public static void Uninstall()
    {
        EnsurePlainPath(Root);
        var receipt = JsonSerializer.Deserialize<Receipt>(File.ReadAllText(Path.Combine(Root, "install-receipt.json")), Json) ?? throw new IOException("설치 기록이 없습니다.");
        if (receipt.Product != Product || receipt.Root != Root || !receipt.Release.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("설치 기록이 올바르지 않습니다.");
        CheckClosed(receipt.RadKeys.Count > 0, receipt.VisualStudio.Count > 0);
        foreach (var instance in receipt.VisualStudio)
            if (InstalledVsixVersion(instance) != null)
                Run(Path.Combine(instance.Path, @"Common7\IDE\VSIXInstaller.exe"), ["/quiet", "/shutdownprocesses", "/instanceIds:" + instance.Id, "/uninstall:" + VsixId]);
        foreach (var name in receipt.RadKeys)
        {
            if (name != BdsKey + @"\Known Packages" && name != BdsKey + @"\Known Packages x64") throw new IOException("잘못된 RAD 설치 기록입니다.");
            using var key = Registry.CurrentUser.OpenSubKey(name, true);
            if (key == null) continue;
            foreach (var value in key.GetValueNames())
                if (value.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(value).Equals("PiAgent370.bpl", StringComparison.OrdinalIgnoreCase)) key.DeleteValue(value, false);
            foreach (var prior in receipt.PreviousRad.Where(p => p.Key == name && File.Exists(p.Name))) key.SetValue(prior.Name, prior.Value);
        }
        foreach (var path in Directory.EnumerateFileSystemEntries(Root, "*", SearchOption.AllDirectories))
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("연결된 설치 파일이 있어 제거를 중단했습니다.");
        // Never stop unrelated Core or IDE processes. A running installation must be closed by the user.
        Directory.Delete(Root, true);
        Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        var shortcuts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "PiAgent");
        if (Directory.Exists(shortcuts)) Directory.Delete(shortcuts, true);
    }
}
