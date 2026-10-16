// Kaldir.exe: VideoIndir'i bilgisayardan kaldırır. Uygulamayı kapatır, kendi klasörünü siler, Windows kayıtlarını temizler,
// istenirse ayar ve geçmişi de siler. İndirilen videolara dokunmaz.
// Windows'taki hazır C# derleyicisiyle (csc.exe, C# 5) derlenir.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace VideoIndir
{
    static class Kaldir
    {
        static bool Under(string path, string dir)
        {
            if (string.IsNullOrEmpty(path)) return false;
            return path.StartsWith(dir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
        }

        static void KillUnder(string name, string root)
        {
            foreach (Process p in Process.GetProcessesByName(name))
            {
                try { if (Under(p.MainModule.FileName, root)) { p.Kill(); p.WaitForExit(3000); } }
                catch { }
            }
        }

        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            string root = Path.GetDirectoryName(Application.ExecutablePath);

            // Güvenlik: yalnızca gerçekten bir VideoIndir klasörünü sil (geliştirme klasörü ya da başka bir yer değil)
            bool ok = File.Exists(Path.Combine(root, "VideoIndir.exe"))
                && (File.Exists(Path.Combine(root, @"app\helper\server.js")) || File.Exists(Path.Combine(root, @"helper\server.js")))
                && !Directory.Exists(Path.Combine(root, ".git"));
            if (!ok)
            {
                MessageBox.Show("Bu klasörde bir VideoIndir kurulumu bulunamadı.\n\n" + root, "VideoIndir Kaldır", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 2;
            }

            bool wipe = true;
            bool silent = Array.IndexOf(args, "--yes") >= 0;   // sormadan kaldır (--keep-data: ayarları koru)
            if (Array.IndexOf(args, "--keep-data") >= 0) wipe = false;
            if (!silent)
            {
                Form f = new Form();
                f.Text = "VideoIndir Kaldır";
                f.FormBorderStyle = FormBorderStyle.FixedDialog;
                f.StartPosition = FormStartPosition.CenterScreen;
                f.MaximizeBox = false; f.MinimizeBox = false;
                f.ClientSize = new Size(440, 190);
                Label l = new Label();
                l.Text = "VideoIndir bu bilgisayardan kaldırılacak.\n\nSilinecek klasör:\n" + root + "\n\nİndirdiğin videolar silinmez.";
                l.SetBounds(16, 14, 408, 110);
                CheckBox cb = new CheckBox();
                cb.Text = "Ayarlarımı ve indirme geçmişimi de sil";
                cb.Checked = true;
                cb.SetBounds(16, 124, 408, 22);
                Button yes = new Button();
                yes.Text = "Kaldır";
                yes.DialogResult = DialogResult.OK;
                yes.SetBounds(244, 152, 90, 28);
                Button no = new Button();
                no.Text = "Vazgeç";
                no.DialogResult = DialogResult.Cancel;
                no.SetBounds(340, 152, 84, 28);
                f.Controls.Add(l); f.Controls.Add(cb); f.Controls.Add(yes); f.Controls.Add(no);
                f.AcceptButton = no; f.CancelButton = no;
                if (f.ShowDialog() != DialogResult.OK) return 0;
                wipe = cb.Checked;
            }

            // Çalışan uygulamayı, servisini ve indirme araçlarını kapat (yalnızca bu klasördekileri)
            KillUnder("VideoIndir", root);
            KillUnder("node", root);
            KillUnder("yt-dlp", root);
            KillUnder("ffmpeg", root);
            System.Threading.Thread.Sleep(800);

            // Windows kayıtları: Windows açılışında başlat, videoindir: bağlantısı
            try
            {
                using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (run != null)
                    {
                        string v = run.GetValue("VideoIndir") as string;
                        if (v != null && v.IndexOf(root, StringComparison.OrdinalIgnoreCase) >= 0) run.DeleteValue("VideoIndir", false);
                    }
                }
            }
            catch { }
            try
            {
                using (RegistryKey cmd = Registry.CurrentUser.OpenSubKey(@"Software\Classes\videoindir\shell\open\command"))
                {
                    string c = cmd == null ? null : cmd.GetValue("") as string;
                    if (c != null && c.IndexOf(root, StringComparison.OrdinalIgnoreCase) >= 0)
                        Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\videoindir", false);
                }
            }
            catch { }

            if (wipe)
            {
                try { string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VideoIndir"); if (Directory.Exists(d)) Directory.Delete(d, true); } catch { }
                try { string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VideoIndir"); if (Directory.Exists(d)) Directory.Delete(d, true); } catch { }
            }

            // Kaldir.exe bu klasörün içinde çalışıyor; kapandıktan sonra klasörü silmesi için ayrı bir komut başlat
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"" + root + "\"");
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process.Start(psi);

            if (!silent)
                MessageBox.Show("VideoIndir kaldırıldı.\n\nİndirdiğin videolar yerinde duruyor. Tarayıcıya eklenti kurduysan onu tarayıcının eklentiler sayfasından kaldır.",
                    "VideoIndir Kaldır", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
    }
}
