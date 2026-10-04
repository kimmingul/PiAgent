using System.Diagnostics;
using System.Windows;
namespace PiAgent.Setup;
public partial class MainWindow : Window
{
    private readonly Detection detection;
    private readonly bool uninstall;
    private bool busy;
    public MainWindow(bool uninstall)
    {
        InitializeComponent(); this.uninstall = uninstall;
        detection = InstallerEngine.Detect();
        Architecture.Text = $"Windows {detection.Architecture.ToUpperInvariant()} · IDE별 선택 설치";
        Rad32.IsEnabled = detection.Rad32; Rad32.IsChecked = detection.Rad32;
        Rad64.IsEnabled = detection.Rad64; Rad64.IsChecked = detection.Rad64;
        Vs22.IsEnabled = detection.VisualStudio.Any(v => v.Major == 17); Vs22.IsChecked = Vs22.IsEnabled;
        Vs26.IsEnabled = detection.VisualStudio.Any(v => v.Major == 18); Vs26.IsChecked = Vs26.IsEnabled;
        InstallOmp.IsEnabled = detection.Omp is null;
        InstallOmp.IsChecked = detection.Omp is null;
        OmpStatus.Text = detection.Omp is null ? "OMP를 찾지 못했습니다. 선택을 해제하면 나중에 설치할 수 있습니다." : $"설치된 OMP를 재사용합니다: {detection.Omp}";
        Location.Text = $"설치 위치: {InstallerEngine.Root}";
        if (uninstall) { Options.IsEnabled = false; InstallButton.Content = "PiAgent 제거"; Status.Text = "PiAgent만 제거합니다. 저장된 대화와 외부 OMP는 유지합니다."; }
        Closing += (_, e) => { if (busy) e.Cancel = true; };
    }
    private async void InstallClick(object sender, RoutedEventArgs e)
    {
        if (uninstall)
        {
            if (MessageBox.Show("PiAgent를 제거하시겠습니까?", "PiAgent", MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
            var temp = Path.Combine(Path.GetTempPath(), "PiAgent-Uninstall-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp); var exe = Path.Combine(temp, "PiAgent-Uninstall.exe");
            File.Copy(Environment.ProcessPath!, exe);
            Process.Start(new ProcessStartInfo(exe, "--uninstall-worker") { UseShellExecute = true }); Close(); return;
        }
        var selection = new Selection(Rad32.IsChecked == true, Rad64.IsChecked == true, Vs22.IsChecked == true, Vs26.IsChecked == true, InstallOmp.IsChecked == true);
        busy = true; Options.IsEnabled = InstallButton.IsEnabled = CloseButton.IsEnabled = false;
        Progress.Visibility = Visibility.Visible;
        var progress = new Progress<string>(text => Status.Text = text);
        try
        {
            await Task.Run(() => InstallerEngine.Install(selection, detection, progress));
            Status.Text = "설치 완료. 시작 메뉴의 PiAgent Core 실행 후 IDE에서 PiAgent 채팅창을 여세요. OMP 로그인은 OMP 실행 바로가기를 이용하세요.";
            InstallButton.Visibility = Visibility.Collapsed;
        }
        catch (Exception error)
        {
            Status.Text = error.Message;
            MessageBox.Show(error.Message, "설치 미완료", MessageBoxButton.OK, MessageBoxImage.Error);
            Options.IsEnabled = InstallButton.IsEnabled = true;
        }
        finally { busy = false; CloseButton.IsEnabled = true; Progress.Visibility = Visibility.Collapsed; }
    }
    private void CloseClick(object sender, RoutedEventArgs e) => Close();
}
