param([string]$ExpectedText = '')
# Read format names and synthetic-test results only; never print clipboard text.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class UTClipboardProbeResult {
 public string[] Formats; public bool HasWindowsBitmap; public int Width; public int Height;
 public int BitsPerPixel; public bool TextMatchesExpected;
}
public static class UTWindowsClipboardProbe {
 [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr h);
 [DllImport("user32.dll")] static extern bool CloseClipboard();
 [DllImport("user32.dll")] static extern uint EnumClipboardFormats(uint f);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClipboardFormatName(uint f,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint f);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
 [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
 public static UTClipboardProbeResult Read(string expected) {
  if(!OpenClipboard(IntPtr.Zero))throw new InvalidOperationException("Clipboard is busy; retry later");
  try {
   var r=new UTClipboardProbeResult();var formats=new List<string>();uint f=0;
   while((f=EnumClipboardFormats(f))!=0){var n=new StringBuilder(256);GetClipboardFormatName(f,n,256);formats.Add(f+":"+n);}
   r.Formats=formats.ToArray();
   var dib=GetClipboardData(8);
   if(dib!=IntPtr.Zero){var p=GlobalLock(dib);if(p!=IntPtr.Zero){try{r.HasWindowsBitmap=true;r.Width=Marshal.ReadInt32(p,4);r.Height=Marshal.ReadInt32(p,8);r.BitsPerPixel=Marshal.ReadInt16(p,14);}finally{GlobalUnlock(dib);}}}
   if(!String.IsNullOrEmpty(expected)){var h=GetClipboardData(13);if(h!=IntPtr.Zero){var p=GlobalLock(h);if(p!=IntPtr.Zero){try{r.TextMatchesExpected=String.Equals(Marshal.PtrToStringUni(p),expected,StringComparison.Ordinal);}finally{GlobalUnlock(h);}}}}
   return r;
  } finally {CloseClipboard();}
 }
}
'@
[UTWindowsClipboardProbe]::Read($ExpectedText) | ConvertTo-Json -Depth 3
