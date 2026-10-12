// VideoIndir'in kendi penceresi: tarayıcı çubuğu/sekmesi olmayan, kullanıcının hangi tarayıcıyı kullandığından bağımsız.
// Windows'ta hazır gelen WebView2 bileşenini kullanır (Edge motoru). Bileşen yoksa Program.FallbackOpen devreye girer.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace VideoIndir
{
    class AppWindow : Form
    {
        readonly WebView2 web = new WebView2();
        string pendingUrl;
        bool coreReady, readyRaised;
        public string InitError;
        public event EventHandler Ready;   // ilk sayfa yüklenince (test için)

        public AppWindow(string url, Icon icon)
        {
            Text = "VideoIndir";
            if (icon != null) Icon = icon;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(480, 720);
            MinimumSize = new Size(380, 520);
            Color dark = Color.FromArgb(19, 20, 23);   // sayfayla aynı koyu renk: yüklenirken beyaz parlama olmasın
            BackColor = dark;
            web.DefaultBackgroundColor = dark;
            web.Dock = DockStyle.Fill;
            Controls.Add(web);
            pendingUrl = url;
            Load += async delegate { await InitAsync(); };
        }

        async Task InitAsync()
        {
            try
            {
                // Çerezler/oturum için kalıcı ama bu uygulamaya özel klasör (kullanıcının tarayıcı profiline dokunulmaz)
                string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"VideoIndir\webview");
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, data, null);
                await web.EnsureCoreWebView2Async(env);
                CoreWebView2 core = web.CoreWebView2;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.PermissionRequested += OnPermission;
                core.NewWindowRequested += OnNewWindow;
                core.DownloadStarting += OnDownload;
                core.NavigationCompleted += delegate
                {
                    if (readyRaised) return;
                    readyRaised = true;
                    if (Ready != null) Ready(this, EventArgs.Empty);
                };
                coreReady = true;
                core.Navigate(pendingUrl);
            }
            catch (Exception ex)
            {
                // WebView2 başlatılamadı (bileşen yok vb.): pencereyi kapat, yedek yöntemle (Edge uygulama penceresi/sekme) aç
                InitError = ex.Message;
                string url = pendingUrl;
                BeginInvoke(new Action(delegate
                {
                    Close();
                    if (!Program.SelfTestMode) Program.FallbackOpen(url);
                }));
            }
        }

        public void NavigateTo(string url)
        {
            pendingUrl = url;
            if (coreReady) web.CoreWebView2.Navigate(url);
        }

        public Task<string> Eval(string js)
        {
            return web.CoreWebView2.ExecuteScriptAsync(js);
        }

        // "Yapıştır" düğmesi panoyu okur: yalnızca kendi sayfamıza izin ver
        void OnPermission(object sender, CoreWebView2PermissionRequestedEventArgs e)
        {
            if (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead && e.Uri.StartsWith("http://127.0.0.1:9696"))
                e.State = CoreWebView2PermissionState.Allow;
        }

        // Sayfadaki dış bağlantılar uygulama penceresinde değil, kullanıcının varsayılan tarayıcısında açılsın
        void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (e.Uri.StartsWith("http://") || e.Uri.StartsWith("https://"))
            {
                try { Process.Start(e.Uri); } catch { }
            }
        }

        // "Dosyayı indir": varsayılan indirme penceresi yerine İndirilenler\VideoIndir klasörüne sessizce kaydet
        void OnDownload(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @"Downloads\VideoIndir");
                Directory.CreateDirectory(dir);
                string name = Path.GetFileName(e.ResultFilePath);
                string target = Path.Combine(dir, name);
                for (int i = 2; File.Exists(target); i++)
                    target = Path.Combine(dir, Path.GetFileNameWithoutExtension(name) + " (" + i + ")" + Path.GetExtension(name));
                e.ResultFilePath = target;
                e.Handled = true;
                string shown = Path.GetFileName(target);
                CoreWebView2DownloadOperation op = e.DownloadOperation;
                op.StateChanged += delegate
                {
                    if (op.State == CoreWebView2DownloadState.Completed) Program.Balloon("Kaydedildi: " + shown);
                };
            }
            catch { }
        }
    }
}
