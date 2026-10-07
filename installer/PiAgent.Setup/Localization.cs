using System.Globalization;
namespace PiAgent.Setup;
/// <summary>PiAgent-owned setup text. Default: Korean on Korean Windows, English elsewhere.</summary>
public static class L
{
    public static string Language { get; private set; } = Resolve("auto", CultureInfo.CurrentUICulture.Name);
    public static string Resolve(string value, string system) => value switch
    {
        "ko" or "en" => value,
        "auto" => system.Split('-', '_')[0].Equals("ko", StringComparison.OrdinalIgnoreCase) ? "ko" : "en",
        _ => throw new ArgumentException("Unsupported language. Use auto, ko or en.")
    };
    public static void Select(string value) => Language = Resolve(value, CultureInfo.CurrentUICulture.Name);
    public static readonly IReadOnlyDictionary<string, string> English = new Dictionary<string, string>
    {
        ["PiAgent 설치"] = "PiAgent Setup",
        ["Windows {0} · IDE별 선택 설치"] = "Windows {0} · Choose IDE components",
        ["설치할 IDE 선택"] = "Select IDEs to install",
        ["PiAgent Core (필수)"] = "PiAgent Core (required)",
        ["RAD Studio 13.2 — 32비트 IDE"] = "RAD Studio 13.2 — 32-bit IDE",
        ["RAD Studio 13.2 — 64비트 IDE"] = "RAD Studio 13.2 — 64-bit IDE",
        ["OMP 함께 설치 (공식 최신 버전 다운로드)"] = "Install OMP (download the latest official release)",
        ["OMP를 찾지 못했습니다. 선택을 해제하면 나중에 설치할 수 있습니다."] = "OMP was not found. Clear this option to install it later.",
        ["설치된 OMP를 재사용합니다: {0}"] = "Reuse installed OMP: {0}",
        ["Node.js와 .NET 런타임은 설치파일에 포함됩니다. IDE와 OMP 로그인 정보, 저장된 대화는 유지합니다. 설치 전에 선택한 IDE를 종료해주세요."] = "Node.js and .NET runtimes are included. IDE settings, OMP sign-in data and saved conversations are preserved. Close the selected IDEs before installation.",
        ["설치 위치: {0}"] = "Install location: {0}",
        ["설치"] = "Install", ["닫기"] = "Close", ["언어"] = "Language",
        ["PiAgent 제거"] = "Uninstall PiAgent",
        ["PiAgent만 제거합니다. 저장된 대화와 외부 OMP는 유지합니다."] = "Uninstall PiAgent. Saved conversations and external OMP installations are preserved.",
        ["PiAgent를 제거하시겠습니까?"] = "Uninstall PiAgent?",
        ["설치 완료. IDE에서 PiAgent 채팅창을 열면 Core가 자동으로 시작합니다. OMP 로그인은 OMP 실행 바로가기를 이용하세요."] = "Installation complete. Open PiAgent chat in the IDE to start Core automatically. Use the OMP shortcut to sign in.",
        ["설치 미완료"] = "Installation incomplete",
        ["PiAgent를 제거했습니다. 저장된 대화와 외부 OMP 설치는 유지됩니다."] = "PiAgent uninstalled. Saved conversations and external OMP installations are preserved.",
        ["기존 Core 설정을 읽지 못했습니다. 설정을 보존하기 위해 업데이트를 중단합니다."] = "Could not read existing Core settings. Update stopped to preserve your settings.",
        ["기존 Core 설정이 올바르지 않습니다. 설정을 보존하기 위해 업데이트를 중단합니다."] = "Existing Core settings are invalid. Update stopped to preserve your settings.",
        ["프로세스를 시작하지 못했습니다: "] = "Could not start process: ",
        ["설치 작업 시간이 초과되었습니다."] = "Installation timed out.",
        ["{0} 실행 실패 ({1}): {2} {3}"] = "{0} failed ({1}): {2} {3}",
        ["이미 존재하는 폴더에는 추출하지 않습니다."] = "Cannot extract into an existing folder.",
        ["설치 payload가 없습니다."] = "Installation payload is missing.",
        ["잘못된 ZIP 경로입니다."] = "Invalid ZIP path.",
        ["잘못된 manifest 경로입니다."] = "Invalid manifest path.",
        ["설치파일 무결성 오류: "] = "Installation integrity error: ",
        ["선택한 IDE를 모두 종료한 뒤 다시 설치해주세요."] = "Close all selected IDEs and try again.",
        ["선택한 IDE가 설치되어 있지 않습니다."] = "A selected IDE is not installed.",
        ["기존 설치 기록이 올바르지 않습니다."] = "Existing installation receipt is invalid.",
        ["설치파일을 확인하고 추출하고 있습니다…"] = "Verifying and extracting installation files…",
        ["공식 OMP 최신 버전을 다운로드하고 있습니다…"] = "Downloading the latest official OMP release…",
        ["IDE adapter를 등록하고 있습니다…"] = "Registering IDE adapters…",
        ["VSIX 설치 버전 확인에 실패했습니다. 로그: "] = "Could not verify the installed VSIX version. Log: ",
        ["PiAgent Core 실행"] = "Start PiAgent Core",
        ["OMP 실행 (로그인 및 설정)"] = "Start OMP (sign-in and settings)",
        ["설치 완료"] = "Installation complete",
        ["OMP 공식 SHA-256 정보가 없습니다."] = "Official OMP SHA-256 information is missing.",
        ["잘못된 OMP 다운로드 주소입니다."] = "Invalid OMP download URL.",
        ["OMP 다운로드 무결성 검증 실패."] = "OMP download integrity check failed.",
        ["시작 메뉴 바로가기를 만들 수 없습니다."] = "Could not create a Start Menu shortcut.",
        ["연결된 설치 경로는 허용하지 않습니다."] = "Linked installation paths are not allowed.",
        ["설치 기록이 없습니다."] = "Installation receipt is missing.",
        ["설치 기록이 올바르지 않습니다."] = "Installation receipt is invalid.",
        ["잘못된 RAD 설치 기록입니다."] = "Invalid RAD installation receipt.",
        ["연결된 설치 파일이 있어 제거를 중단했습니다."] = "Uninstall stopped because an installation file is linked."
    };
    public static string Text(string source, params object?[] args)
    {
        var text = Language == "ko" ? source : English.TryGetValue(source, out var value) ? value : source;
        return args.Length == 0 ? text : string.Format(CultureInfo.CurrentCulture, text, args);
    }
}
