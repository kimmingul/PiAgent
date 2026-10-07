using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
namespace PiAgent.Setup;
public partial class MainWindow : Window
{
    private readonly Detection detection;
    private readonly bool uninstall;
    private bool busy;
    private bool completed;
    public MainWindow(bool uninstall)
    {
        InitializeComponent(); this.uninstall = uninstall;
        detection = InstallerEngine.Detect();
        Rad32.IsEnabled = detection.Rad32; Rad32.IsChecked = detection.Rad32;
        Rad64.IsEnabled = detection.Rad64; Rad64.IsChecked = detection.Rad64;
        Vs22.IsEnabled = detection.VisualStudio.Any(v => v.Major == 17); Vs22.IsChecked = Vs22.IsEnabled;
        Vs26.IsEnabled = detection.VisualStudio.Any(v => v.Major == 18); Vs26.IsChecked = Vs26.IsEnabled;
        InstallOmp.IsEnabled = detection.Omp is null;
        InstallOmp.IsChecked = detection.Omp is null;
        if (uninstall) Options.IsEnabled = false;
        LanguageChoice.SelectedIndex = L.Language == "ko" ? 0 : 1;
        ApplyLanguage();
        Closing += (_, e) => { if (busy) e.Cancel = true; };
    }
    private void LanguageChanged(object sender, SelectionChangedEventArgs e)
    {
        if (detection == null || LanguageChoice.SelectedItem is not ComboBoxItem item) return;
        L.Select((string)item.Tag); ApplyLanguage();
    }
    private void ApplyLanguage()
    {
        Title = L.Text("PiAgent 설치"); LanguageLabel.Text = L.Text("언어");
        Architecture.Text = L.Text("Windows {0} · IDE별 선택 설치", detection.Architecture.ToUpperInvariant());
        IdeGroup.Header = L.Text("설치할 IDE 선택"); CoreChoice.Content = L.Text("PiAgent Core (필수)");
        Rad32.Content = L.Text("RAD Studio 13.2 — 32비트 IDE"); Rad64.Content = L.Text("RAD Studio 13.2 — 64비트 IDE");
        InstallOmp.Content = L.Text("OMP 함께 설치 (공식 최신 버전 다운로드)");
        OmpStatus.Text = detection.Omp is null ? L.Text("OMP를 찾지 못했습니다. 선택을 해제하면 나중에 설치할 수 있습니다.") : L.Text("설치된 OMP를 재사용합니다: {0}", detection.Omp);
        InstallHelp.Text = L.Text("Node.js와 .NET 런타임은 설치파일에 포함됩니다. IDE와 OMP 로그인 정보, 저장된 대화는 유지합니다. 설치 전에 선택한 IDE를 종료해주세요.");
        Location.Text = L.Text("설치 위치: {0}", InstallerEngine.Root);
        InstallButton.Content = L.Text(uninstall ? "PiAgent 제거" : "설치"); CloseButton.Content = L.Text("닫기");
        if (uninstall) Status.Text = L.Text("PiAgent만 제거합니다. 저장된 대화와 외부 OMP는 유지합니다.");
        if (completed) Status.Text = L.Text("설치 완료. IDE에서 PiAgent 채팅창을 열면 Core가 자동으로 시작합니다. OMP 로그인은 OMP 실행 바로가기를 이용하세요.");
    }
    private async void InstallClick(object sender, RoutedEventArgs e)
    {
        if (uninstall)
        {
            if (MessageBox.Show(L.Text("PiAgent를 제거하시겠습니까?"), "PiAgent", MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
            var temp = Path.Combine(Path.GetTempPath(), "PiAgent-Uninstall-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp); var exe = Path.Combine(temp, "PiAgent-Uninstall.exe");
            File.Copy(Environment.ProcessPath!, exe);
            Process.Start(new ProcessStartInfo(exe, "--uninstall-worker --language " + L.Language) { UseShellExecute = true }); Close(); return;
        }
        var selection = new Selection(Rad32.IsChecked == true, Rad64.IsChecked == true, Vs22.IsChecked == true, Vs26.IsChecked == true, InstallOmp.IsChecked == true);
        busy = true; LanguageChoice.IsEnabled = Options.IsEnabled = InstallButton.IsEnabled = CloseButton.IsEnabled = false;
        Progress.Visibility = Visibility.Visible;
        var progress = new Progress<string>(text => Status.Text = text);
        try
        {
            await Task.Run(() => InstallerEngine.Install(selection, detection, progress));
            completed = true; ApplyLanguage();
            InstallButton.Visibility = Visibility.Collapsed;
        }
        catch (Exception error)
        {
            Status.Text = error.Message;
            MessageBox.Show(error.Message, L.Text("설치 미완료"), MessageBoxButton.OK, MessageBoxImage.Error);
            Options.IsEnabled = InstallButton.IsEnabled = true;
        }
        finally { busy = false; LanguageChoice.IsEnabled = CloseButton.IsEnabled = true; Progress.Visibility = Visibility.Collapsed; }
    }
    private void CloseClick(object sender, RoutedEventArgs e) => Close();
}
