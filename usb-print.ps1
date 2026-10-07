# Envía bytes ESC/POS en crudo (RAW) a una impresora instalada en Windows (USB), sin pasar por el driver.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File usb-print.ps1 -Printer "POS-80" -Path ticket.bin
param(
  [Parameter(Mandatory)] [string] $Printer,
  [Parameter(Mandatory)] [string] $Path
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    public string pDocName;
    public string pOutputFile;
    public string pDataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr h, byte[] buf, int len, out int written);

  static void Check(bool ok, string step) {
    if (!ok) throw new Exception(step + " fallo (error " + Marshal.GetLastWin32Error() + ")");
  }

  public static void Send(string printer, byte[] data) {
    IntPtr h;
    Check(OpenPrinter(printer, out h, IntPtr.Zero), "OpenPrinter '" + printer + "'");
    try {
      Check(StartDocPrinter(h, 1, new DOCINFO { pDocName = "Comanda", pDataType = "RAW" }) != 0, "StartDocPrinter");
      try {
        Check(StartPagePrinter(h), "StartPagePrinter");
        int written;
        Check(WritePrinter(h, data, data.Length, out written), "WritePrinter");
        if (written != data.Length) throw new Exception("WritePrinter escribio " + written + " de " + data.Length + " bytes");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@

try {
  [RawPrinter]::Send($Printer, [IO.File]::ReadAllBytes($Path))
} catch {
  # mensaje limpio en stderr para el log del agente (sin el envoltorio de PowerShell)
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message)
  exit 1
}
