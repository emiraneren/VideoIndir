// VideoIndir.exe: masaüstü uygulaması. Yardımcı servisi (yt-dlp/ffmpeg'i çalıştıran Node programı) arka planda başlatır,
// sağ alttaki tepsiye simge koyar ve kendi penceresini (Edge/Chrome "uygulama" penceresi) açar.
// Ctrl+Alt+D: açık tarayıcı sekmesinin adresini okuyup videoyu çözer. Tarayıcı eklentisi isteğe bağlıdır (zor sitelerdeki gizli akışlar için).
// Windows'taki hazır C# derleyicisiyle (csc.exe, C# 5) derlenir; ek kurulum gerekmez.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;
using Microsoft.Win32;

namespace VideoIndir
{
    class BrowserInfo
    {
        public string Name;
        public string Exe;
        public string Url;      // eklenti sayfası
        public bool Firefox;    // Firefox ayrı paket (extension-firefox) ister
    }

    static class Program
    {
        const string PingUrl = "http://127.0.0.1:9696/ping";
        const string SiteUrl = "http://127.0.0.1:9696/";
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string RunName = "VideoIndir";

        static string helperDir, rootDir, nodePath;
        static Process child;
        static bool adopted;        // servis zaten çalışıyordu: biz başlatmadık, çıkışta kapatmayız
        static int restarts;
        static NotifyIcon tray;
        static ToolStripMenuItem statusItem, startupItem;
        static System.Windows.Forms.Timer timer;
        static HotKeyWindow hotKey;
        const int HotKeyId = 0x5649;   // "VI"

        internal static bool SelfTestMode;   // WebView2 testinde başarısızlık yedek pencereyi açmasın
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string path);
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        // Gizli pencere: yalnızca WM_HOTKEY mesajını dinler
        class HotKeyWindow : NativeWindow
        {
            public Action Pressed;
            public HotKeyWindow() { CreateHandle(new CreateParams()); }
            protected override void WndProc(ref Message m)
            {
                if (m.Msg == 0x0312 && Pressed != null) Pressed();   // WM_HOTKEY
                base.WndProc(ref m);
            }
        }

        [STAThread]
        static int Main(string[] args)
        {
            bool selfTest = args.Length > 0 && args[0] == "--selftest";
            bool silent = Array.IndexOf(args, "--silent") >= 0;   // Windows açılışında pencere açmadan başla
            // Hata ayıklama: açık tarayıcının adresini bir dosyaya yaz ("--geturl dosya.txt")
            // Üçüncü argüman (isteğe bağlı) yalnızca o süreç kimliğindeki tarayıcı penceresine bakar
            if (args.Length > 1 && args[0] == "--geturl")
            {
                if (args.Length > 2) int.TryParse(args[2], out onlyPid);
                File.WriteAllText(args[1], FindBrowserUrl(false) ?? "(bulunamadi)", Encoding.UTF8);
                return 0;
            }
            // Hata ayıklama: uygulama penceresini (WebView2) açıp sayfanın yüklendiğini doğrular ("--webviewtest dosya.txt")
            if (args.Length > 1 && args[0] == "--webviewtest")
            {
                helperDir = FindHelperDir();
                if (helperDir == null) return 2;
                rootDir = Directory.GetParent(helperDir).FullName;
                SetupWebViewLoading();
                return WebViewSelfTest(args[1]);
            }
            bool created;
            using (Mutex mutex = new Mutex(true, @"Local\VideoIndir.Launcher", out created))
            {
                if (!created)
                {
                    if (!selfTest) MessageBox.Show("VideoIndir zaten çalışıyor. Sağ alttaki tepsi simgesine (^) bak.", "VideoIndir", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
                Application.EnableVisualStyles();

                helperDir = FindHelperDir();
                if (helperDir == null)
                {
                    if (!selfTest) MessageBox.Show("VideoIndir klasörü bulunamadı.\n\nBu dosyayı, içinde 'Apps\\VideoIndir' klasörü olan yere koy ya da VideoIndir klasörünün içine al.", "VideoIndir", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 2;
                }
                rootDir = Directory.GetParent(helperDir).FullName;
                SetupWebViewLoading();

                nodePath = FindNode();
                if (nodePath == null)
                {
                    if (!selfTest) MessageBox.Show("Node.js bulunamadı. Paketteki 'runtime' klasörü silinmiş olabilir; zip'i yeniden çıkar ya da https://nodejs.org adresinden Node.js kur.", "VideoIndir", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 2;
                }
                if (!EnsureTools(selfTest)) return 3;

                if (selfTest)
                {
                    bool ok = StartHelper();
                    StopHelper();
                    return ok ? 0 : 1;
                }

                BuildTray();
                bool up = StartHelper();

                // Kısayol: Ctrl+Alt+D → açık tarayıcı sekmesindeki (yoksa panodaki) bağlantıyı çöz
                hotKey = new HotKeyWindow();
                hotKey.Pressed = ResolveFromBrowser;
                bool hk = RegisterHotKey(hotKey.Handle, HotKeyId, 0x0001 | 0x0002 | 0x4000, 0x44);   // Alt+Ctrl+D (tekrarsız)

                tray.ShowBalloonTip(5000, "VideoIndir",
                    !up ? "Servis başlatılamadı. Menüden durumu kontrol et."
                        : hk ? "Hazır. Videoyu izlerken Ctrl+Alt+D'ye bas ya da simgeye çift tıkla."
                             : "Hazır. Simgeye çift tıklayarak uygulamayı açabilirsin. (Ctrl+Alt+D başka bir program tarafından kullanılıyor)",
                    up ? ToolTipIcon.Info : ToolTipIcon.Error);
                if (up && !silent) OpenApp(null);

                timer = new System.Windows.Forms.Timer();
                timer.Interval = 4000;
                timer.Tick += delegate { Tick(); };
                timer.Start();

                Application.Run();

                timer.Stop();
                UnregisterHotKey(hotKey.Handle, HotKeyId);
                tray.Visible = false;
                StopHelper();
                return 0;
            }
        }

        // ---------- konum bulma ----------

        static string FindHelperDir()
        {
            string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
            string[] candidates =
            {
                Path.Combine(exeDir, "helper"),
                Path.Combine(exeDir, @"VideoIndir\helper"),
                Path.Combine(exeDir, @"Apps\VideoIndir\helper"),
                Path.Combine(exeDir, @"..\helper")
            };
            foreach (string c in candidates)
                if (File.Exists(Path.Combine(c, "server.js"))) return Path.GetFullPath(c);

            // İsteğe bağlı: exe'nin yanındaki VideoIndir.yol.txt dosyasının ilk satırı helper klasörünün yolu
            string cfg = Path.Combine(exeDir, "VideoIndir.yol.txt");
            if (File.Exists(cfg))
            {
                string p = File.ReadAllText(cfg).Trim().Split('\n')[0].Trim();
                if (File.Exists(Path.Combine(p, "server.js"))) return p;
            }
            return null;
        }

        static string FindNode()
        {
            // Pakette yerleşik Node varsa onu kullan: kullanıcının ayrıca Node.js kurması gerekmez
            string bundled = Path.Combine(rootDir, @"runtime\node.exe");
            if (File.Exists(bundled)) return bundled;

            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in path.Split(';'))
            {
                try
                {
                    if (dir.Trim().Length == 0) continue;
                    string p = Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(p)) return p;
                }
                catch { }
            }
            string def = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"nodejs\node.exe");
            return File.Exists(def) ? def : null;
        }

        // ---------- ilk kurulum ----------

        static bool EnsureTools(bool silent)
        {
            string bin = Path.Combine(helperDir, "bin");
            Func<bool> ready = delegate { return File.Exists(Path.Combine(bin, "yt-dlp.exe")) && File.Exists(Path.Combine(bin, "ffmpeg.exe")); };
            if (ready()) return true;
            if (silent) return false;

            if (MessageBox.Show("İlk kurulum: yt-dlp ve ffmpeg indirilecek (yaklaşık 180 MB, resmi GitHub sürümleri). Devam edilsin mi?",
                "VideoIndir", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return false;

            Form wait = new Form();
            wait.Text = "VideoIndir";
            wait.FormBorderStyle = FormBorderStyle.FixedDialog;
            wait.StartPosition = FormStartPosition.CenterScreen;
            wait.ControlBox = false;
            wait.ClientSize = new Size(340, 70);
            Label l = new Label();
            l.Text = "yt-dlp ve ffmpeg indiriliyor…\nBu birkaç dakika sürebilir.";
            l.Dock = DockStyle.Fill;
            l.TextAlign = ContentAlignment.MiddleCenter;
            wait.Controls.Add(l);
            wait.Show();

            ProcessStartInfo psi = new ProcessStartInfo(nodePath, "setup.js");
            psi.WorkingDirectory = helperDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process p = Process.Start(psi);
            while (!p.HasExited) { Application.DoEvents(); Thread.Sleep(100); }
            wait.Close();

            if (p.ExitCode != 0 || !ready())
            {
                MessageBox.Show("Kurulum tamamlanamadı. İnternet bağlantını kontrol edip tekrar dene.", "VideoIndir", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
            return true;
        }

        // ---------- servis ----------

        static bool IsRunning()
        {
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(PingUrl);
                r.Timeout = 1500;
                r.Proxy = null;
                using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
                    return resp.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        static bool StartHelper()
        {
            if (IsRunning()) { adopted = true; return true; }
            adopted = false;
            ProcessStartInfo psi = new ProcessStartInfo(nodePath, "server.js");
            psi.WorkingDirectory = helperDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            child = Process.Start(psi);
            for (int i = 0; i < 40; i++)
            {
                if (IsRunning()) return true;
                if (child.HasExited) break;
                Thread.Sleep(200);
            }
            return IsRunning();
        }

        static void StopHelper()
        {
            if (adopted || child == null) return;
            try
            {
                if (!child.HasExited)
                {
                    // yt-dlp/ffmpeg alt süreçleri de kapansın
                    ProcessStartInfo k = new ProcessStartInfo("taskkill", "/PID " + child.Id + " /T /F");
                    k.CreateNoWindow = true;
                    k.UseShellExecute = false;
                    Process kp = Process.Start(k);
                    kp.WaitForExit(4000);
                }
            }
            catch { }
        }

        static void Tick()
        {
            bool up = IsRunning();
            if (!up && restarts < 3)
            {
                restarts++;
                up = StartHelper();
            }
            if (up) restarts = 0;
            statusItem.Text = up ? "Durum: çalışıyor ✓" : "Durum: durdu ✗";
            tray.Text = "VideoIndir: " + (up ? "çalışıyor" : "durdu");
        }

        // ---------- tepsi ----------

        static void BuildTray()
        {
            ContextMenuStrip menu = new ContextMenuStrip();

            statusItem = new ToolStripMenuItem("Durum: başlatılıyor…");
            statusItem.Enabled = false;
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem openItem = new ToolStripMenuItem("Uygulamayı aç");
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);
            openItem.Click += delegate { OpenApp(null); };
            menu.Items.Add(openItem);
            menu.Items.Add("Tarayıcıdaki videoyu çöz (Ctrl+Alt+D)", null, delegate { ResolveFromBrowser(); });
            menu.Items.Add("Panodaki bağlantıyı çöz", null, delegate
            {
                string u = ClipboardUrl();
                if (u == null) tray.ShowBalloonTip(3000, "VideoIndir", "Panoda bir bağlantı (http...) yok.", ToolTipIcon.Warning);
                else OpenApp(u);
            });
            menu.Items.Add("İndirilenler klasörünü aç", null, delegate
            {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @"Downloads\VideoIndir");
                Directory.CreateDirectory(d);
                Process.Start("explorer.exe", "\"" + d + "\"");
            });
            menu.Items.Add(new ToolStripSeparator());

            menu.Items.Add("Güncellemeleri denetle…", null, delegate
            {
                // Güncelleyici (Guncelle.bat) GitHub'daki son yamayı denetler, farklıysa indirip uygular; uygulamayı kapatıp yeniden açar
                string bat = Path.Combine(rootDir, "Guncelle.bat");
                if (!File.Exists(bat))
                {
                    MessageBox.Show("Guncelle.bat bulunamadı. Son sürümü GitHub'dan indir:\nhttps://github.com/emiraneren/VideoIndir/releases/latest", "VideoIndir", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                ProcessStartInfo upd = new ProcessStartInfo(bat);
                upd.WorkingDirectory = rootDir;
                Process.Start(upd);
            });

            ToolStripMenuItem install = new ToolStripMenuItem("Tarayıcı eklentisi (isteğe bağlı)");
            List<BrowserInfo> browsers = FindBrowsers();
            if (browsers.Count == 0) { ToolStripMenuItem none = new ToolStripMenuItem("Kurulu tarayıcı bulunamadı"); none.Enabled = false; install.DropDownItems.Add(none); }
            foreach (BrowserInfo b in browsers)
            {
                BrowserInfo bi = b;
                install.DropDownItems.Add(bi.Name, null, delegate { InstallExtension(bi); });
            }
            menu.Items.Add(install);

            startupItem = new ToolStripMenuItem("Windows açılışında başlat");
            startupItem.Checked = IsStartupEnabled();
            startupItem.Click += delegate { SetStartup(!IsStartupEnabled()); startupItem.Checked = IsStartupEnabled(); };
            menu.Items.Add(startupItem);

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Çıkış", null, delegate { Application.Exit(); });

            tray = new NotifyIcon();
            tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            tray.Text = "VideoIndir";
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenApp(null); };
            tray.Visible = true;
        }

        // ---------- uygulama penceresi ----------

        // Uygulamayı kullanıcının SİSTEM (varsayılan) tarayıcısında açar; Windows bunu kendisi seçer.
        static AppWindow appWin;

        // WebView2 DLL'leri exe'nin yanında değilse (ör. exe masaüstüne kopyalandıysa) VideoIndir klasöründen yüklensin
        static void SetupWebViewLoading()
        {
            try { SetDllDirectory(rootDir); } catch { }   // yerel WebView2Loader.dll için
            AppDomain.CurrentDomain.AssemblyResolve += delegate(object s, ResolveEventArgs e)
            {
                string p = Path.Combine(rootDir, new AssemblyName(e.Name).Name + ".dll");
                return File.Exists(p) ? Assembly.LoadFrom(p) : null;
            };
        }

        // Uygulamayı kendi penceresinde açar (tarayıcı çubuğu yok, hangi tarayıcının kurulu olduğundan bağımsız).
        // Pencere zaten açıksa öne getirir ve yeni bağlantıyla yeniler.
        static void OpenApp(string videoUrl)
        {
            string target = SiteUrl + (videoUrl != null ? "?url=" + Uri.EscapeDataString(videoUrl) : "");
            try { ShowAppWindow(target); }
            catch (Exception) { FallbackOpen(target); }   // WebView2 DLL'leri/bileşeni yoksa
        }

        // Ayrı yöntem: WebView2 DLL'leri eksikse hata OpenApp'in try bloğunda yakalanır
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void ShowAppWindow(string target)
        {
            if (appWin != null && !appWin.IsDisposed)
            {
                appWin.NavigateTo(target);
                if (appWin.WindowState == FormWindowState.Minimized) appWin.WindowState = FormWindowState.Normal;
                appWin.Activate();
                return;
            }
            appWin = new AppWindow(target, tray != null ? tray.Icon : null);
            appWin.FormClosed += delegate { appWin = null; };
            appWin.Show();
            appWin.Activate();
        }

        // Yedek: WebView2 yoksa Edge'in "uygulama penceresi", o da yoksa varsayılan tarayıcıda normal sekme
        internal static void FallbackOpen(string target)
        {
            try
            {
                string pf = Environment.GetEnvironmentVariable("ProgramFiles");
                string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
                string edge = FirstExisting(Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"), Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"));
                if (edge != null) { Process.Start(edge, "--app=\"" + target + "\" --window-size=480,720"); return; }
            }
            catch { }
            Open(target);
        }

        internal static void Balloon(string text)
        {
            if (tray != null) tray.ShowBalloonTip(4000, "VideoIndir", text, ToolTipIcon.Info);
        }

        // Test: pencereyi aç, 6 sn bekle, sayfanın durumunu dosyaya yaz
        [MethodImpl(MethodImplOptions.NoInlining)]
        static int WebViewSelfTest(string outFile)
        {
            SelfTestMode = true;
            Application.EnableVisualStyles();
            int code = 1;
            AppWindow w = new AppWindow(SiteUrl + "?url=" + Uri.EscapeDataString("https://www.youtube.com/watch?v=jNQXAC9IVRw"), null);
            w.Ready += async delegate
            {
                await Task.Delay(7000);
                try
                {
                    string r = await w.Eval("JSON.stringify({baslik: document.title, yol: location.pathname, icGenislik: innerWidth, icYukseklik: innerHeight, sonucKartiGorunuyor: !document.getElementById('result').hidden, videoAdi: document.getElementById('title').textContent})");
                    File.WriteAllText(outFile, r + " | form: " + w.ClientSize.Width + "x" + w.ClientSize.Height, Encoding.UTF8);
                    code = 0;
                }
                catch (Exception ex) { File.WriteAllText(outFile, "HATA: " + ex.Message, Encoding.UTF8); }
                w.Close();
            };
            w.FormClosed += delegate { Application.ExitThread(); };
            System.Windows.Forms.Timer guard = new System.Windows.Forms.Timer();
            guard.Interval = 40000;
            guard.Tick += delegate
            {
                if (code != 0) File.WriteAllText(outFile, "ZAMAN ASIMI. InitError=" + w.InitError, Encoding.UTF8);
                Application.ExitThread();
            };
            guard.Start();
            w.Show();
            Application.Run();
            return code;
        }

        static string ClipboardUrl()
        {
            try
            {
                if (!Clipboard.ContainsText()) return null;
                string t = Clipboard.GetText().Trim();
                if ((t.StartsWith("http://") || t.StartsWith("https://")) && t.IndexOfAny(new char[] { ' ', '\r', '\n', '\t' }) < 0) return t;
            }
            catch { }
            return null;
        }

        static void ResolveFromBrowser()
        {
            string url = FindBrowserUrl(true) ?? ClipboardUrl();
            if (url == null)
            {
                tray.ShowBalloonTip(4000, "VideoIndir", "Açık tarayıcı sekmesinden ya da panodan bağlantı alınamadı. Bağlantıyı kopyalayıp tekrar dene.", ToolTipIcon.Warning);
                return;
            }
            OpenApp(url);
        }

        // ---------- tarayıcı adres çubuğunu okuma (UI Automation) ----------

        static readonly string[] BrowserProcesses = { "chrome", "msedge", "opera", "brave", "firefox", "vivaldi", "launcher" };

        // foregroundOnly: yalnızca önde duran pencere bir tarayıcıysa onu okur; false ise açık tarayıcı pencerelerini sırayla dener
        static int onlyPid;   // hata ayıklama: >0 ise yalnızca bu süreç

        static string FindBrowserUrl(bool foregroundOnly)
        {
            try
            {
                IntPtr fg = onlyPid > 0 ? IntPtr.Zero : GetForegroundWindow();
                if (fg != IntPtr.Zero)
                {
                    uint pid;
                    GetWindowThreadProcessId(fg, out pid);
                    string name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
                    if (Array.IndexOf(BrowserProcesses, name) >= 0)
                    {
                        string u = ReadAddressBar(fg);
                        if (u != null) return u;
                    }
                }
                if (foregroundOnly) return null;
                foreach (Process p in Process.GetProcesses())
                {
                    try
                    {
                        if (onlyPid > 0 && p.Id != onlyPid) continue;
                        if (p.MainWindowHandle == IntPtr.Zero || Array.IndexOf(BrowserProcesses, p.ProcessName.ToLowerInvariant()) < 0) continue;
                        string u2 = ReadAddressBar(p.MainWindowHandle);
                        if (u2 != null) return u2;
                    }
                    catch { }
                }
            }
            catch { }
            return null;
        }

        static string ReadAddressBar(IntPtr hwnd)
        {
            // Chromium tarayıcıları erişilebilirlik ağacını ilk sorguda açar; ilk denemede boş dönebilir, bu yüzden birkaç kez dene
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    AutomationElement root = AutomationElement.FromHandle(hwnd);
                    AutomationElementCollection edits = root.FindAll(TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
                    string fallback = null;
                    foreach (AutomationElement e in edits)
                    {
                        object pat;
                        if (!e.TryGetCurrentPattern(ValuePattern.Pattern, out pat)) continue;
                        string url = NormalizeUrl(((ValuePattern)pat).Current.Value);
                        if (url == null) continue;
                        string n = (e.Current.Name ?? "").ToLowerInvariant();
                        // Adres çubuğunun adı dile göre değişir (Address and search bar / Adres ve arama çubuğu ...)
                        if (n.Contains("adres") || n.Contains("address") || n.Contains("url") || n.Contains("arama") || n.Contains("search")) return url;
                        if (fallback == null) fallback = url;
                    }
                    if (fallback != null) return fallback;
                }
                catch { }
                Thread.Sleep(400);
            }
            return null;
        }

        // Adres çubuğundaki metin "https://" olmadan ("youtube.com/watch?v=...") gelebilir
        static string NormalizeUrl(string v)
        {
            if (string.IsNullOrEmpty(v)) return null;
            v = v.Trim();
            if (v.IndexOfAny(new char[] { ' ', '\t', '\r', '\n' }) >= 0) return null;
            if (v.StartsWith("http://") || v.StartsWith("https://")) return v;
            if (v.Contains("://") || v.StartsWith("about:")) return null;   // chrome://, about: gibi iç sayfalar
            if (v.Contains(".") && !v.StartsWith(".")) return "https://" + v;
            return null;
        }

        static void Open(string url)
        {
            try { Process.Start(url); } catch { }
        }

        // ---------- Windows açılışı ----------

        static bool IsStartupEnabled()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey))
                return k != null && k.GetValue(RunName) != null;
        }

        static void SetStartup(bool on)
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (k == null) return;
                if (on) k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --silent");
                else k.DeleteValue(RunName, false);
            }
        }

        // ---------- tarayıcılar ----------

        static string FirstExisting(params string[] paths)
        {
            foreach (string p in paths) if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
            return null;
        }

        static string AppPath(string exeName)
        {
            string sub = @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exeName;
            foreach (RegistryKey root in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (RegistryKey k = root.OpenSubKey(sub))
                    {
                        object v = k == null ? null : k.GetValue("");
                        if (v != null && File.Exists(v.ToString().Trim('"'))) return v.ToString().Trim('"');
                    }
                }
                catch { }
            }
            return null;
        }

        static List<BrowserInfo> FindBrowsers()
        {
            string pf = Environment.GetEnvironmentVariable("ProgramFiles");
            string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            List<BrowserInfo> list = new List<BrowserInfo>();

            Action<string, string, string, bool> add = delegate(string name, string exe, string url, bool ff)
            {
                if (exe == null) return;
                BrowserInfo b = new BrowserInfo();
                b.Name = name; b.Exe = exe; b.Url = url; b.Firefox = ff;
                list.Add(b);
            };

            string opera = FirstExisting(Path.Combine(local, @"Programs\Opera\opera.exe"), Path.Combine(pf, @"Opera\opera.exe"));
            string operaGx = FirstExisting(Path.Combine(local, @"Programs\Opera GX\opera.exe"));
            if (operaGx == null) { string ap = AppPath("opera.exe"); if (ap != null && ap.IndexOf("Opera GX", StringComparison.OrdinalIgnoreCase) >= 0) operaGx = ap; }
            if (opera == null) { string ap2 = AppPath("opera.exe"); if (ap2 != null && ap2.IndexOf("Opera GX", StringComparison.OrdinalIgnoreCase) < 0) opera = ap2; }

            add("Opera", opera, "opera://extensions", false);
            add("Opera GX", operaGx, "opera://extensions", false);
            add("Chrome", FirstExisting(Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"), Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"), Path.Combine(local, @"Google\Chrome\Application\chrome.exe")), "chrome://extensions", false);
            add("Brave", FirstExisting(Path.Combine(pf, @"BraveSoftware\Brave-Browser\Application\brave.exe"), Path.Combine(local, @"BraveSoftware\Brave-Browser\Application\brave.exe")), "brave://extensions", false);
            add("Edge", FirstExisting(Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"), Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe")), "edge://extensions", false);
            add("Firefox", FirstExisting(Path.Combine(pf, @"Mozilla Firefox\firefox.exe"), Path.Combine(pf86, @"Mozilla Firefox\firefox.exe")), "about:debugging#/runtime/this-firefox", true);
            return list;
        }

        // Tarayıcı eklentiyi dışarıdan kuramaz (güvenlik): bu yüzden eklenti sayfasını açıp klasör yolunu panoya koyuyoruz
        static void InstallExtension(BrowserInfo b)
        {
            string folder = Path.Combine(rootDir, b.Firefox ? "extension-firefox" : "extension");
            if (!Directory.Exists(folder))
            {
                MessageBox.Show("Eklenti klasörü bulunamadı:\n" + folder + (b.Firefox ? "\n\nFirefox-Hazirla.bat dosyasını çalıştır." : ""), "VideoIndir", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try { Clipboard.SetText(folder); } catch { }
            try { Process.Start("explorer.exe", "\"" + folder + "\""); } catch { }
            try { Process.Start(b.Exe, b.Url); } catch { }

            string steps = b.Firefox
                ? "1) Açılan sayfada 'Geçici Eklenti Yükle'ye tıkla.\n2) Açılan klasördeki manifest.json dosyasını seç.\n\nNot: Firefox kapanınca eklenti kalkar, her açılışta tekrar yüklemen gerekir."
                : "1) Açılan sayfada sağ üstteki 'Geliştirici modu'nu AÇ.\n2) 'Paketlenmemiş öğe yükle' (Opera'da 'Load unpacked') düğmesine bas.\n3) Klasör yolu panoda: Ctrl+V ile yapıştır ya da açılan klasörü seç.\n4) Eklenti simgesini araç çubuğuna sabitle.\n5) Gizli pencerede kullanmak istersen eklentinin ayrıntılarında 'Gizli/Özel modda izin ver'i aç.";
            MessageBox.Show(b.Name + " için eklenti klasörü açıldı ve yolu panoya kopyalandı:\n" + folder + "\n\n" + steps, "VideoIndir: " + b.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}
