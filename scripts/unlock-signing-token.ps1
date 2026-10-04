[CmdletBinding()]
param([string]$Thumbprint='3CE49DE1124F325082FA90BDE4944756D1626251',[switch]$Worker)
$ErrorActionPreference='Stop'
if($Thumbprint -notmatch '\A[0-9A-Fa-f]{40}\z'){throw 'Invalid certificate thumbprint.'}
$path=Join-Path $env:USERPROFILE ('.piagent/signing/'+$Thumbprint.ToUpperInvariant()+'.clixml')
if(!(Test-Path -LiteralPath $path)){return} # Use an already-unlocked USB token as before.
if((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Signing credential links are forbidden.'}
if(!$Worker) {
    if($env:PIAGENT_SIGNING_UNLOCKED_THUMBPRINT -eq $Thumbprint){return}
    $hostPath=Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    & $hostPath -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Thumbprint $Thumbprint -Worker
    if($LASTEXITCODE -ne 0){throw 'Stored USB PIN unlock failed. Re-enter it locally with set-signing-pin.ps1; automatic retries are disabled.'}
    $env:PIAGENT_SIGNING_UNLOCKED_THUMBPRINT=$Thumbprint
    return
}
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography.X509Certificates;
public static class PiAgentUsbPin {
 [StructLayout(LayoutKind.Sequential)] struct ProviderInfo { public IntPtr Container;public IntPtr Provider;public uint Type;public uint Flags;public uint Count;public IntPtr Parameters;public uint KeySpec; }
 [DllImport("crypt32.dll",SetLastError=true)] static extern bool CertGetCertificateContextProperty(IntPtr cert,uint property,IntPtr data,ref uint size);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CryptAcquireContextW(out IntPtr context,string container,string provider,uint type,uint flags);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool CryptSetProvParam(IntPtr context,uint parameter,IntPtr data,uint flags);
 [DllImport("advapi32.dll")] static extern bool CryptReleaseContext(IntPtr context,uint flags);
 public static void Unlock(X509Certificate2 cert,SecureString pin) {
  uint size=0;if(!CertGetCertificateContextProperty(cert.Handle,2,IntPtr.Zero,ref size))throw new Win32Exception();
  IntPtr buffer=Marshal.AllocHGlobal((int)size),context=IntPtr.Zero,secret=IntPtr.Zero;
  try {
   if(!CertGetCertificateContextProperty(cert.Handle,2,buffer,ref size))throw new Win32Exception();
   var info=(ProviderInfo)Marshal.PtrToStructure(buffer,typeof(ProviderInfo));
   if(info.Type==0)throw new InvalidOperationException("This token uses CNG; CSP PIN automation is unavailable.");
   if(!CryptAcquireContextW(out context,Marshal.PtrToStringUni(info.Container),Marshal.PtrToStringUni(info.Provider),info.Type,(info.Flags&32)|64))throw new Win32Exception();
   secret=Marshal.SecureStringToGlobalAllocAnsi(pin);
   if(!CryptSetProvParam(context,info.KeySpec==2?33u:32u,secret,0))throw new Win32Exception();
  } finally {if(secret!=IntPtr.Zero)Marshal.ZeroFreeGlobalAllocAnsi(secret);if(context!=IntPtr.Zero)CryptReleaseContext(context,0);Marshal.FreeHGlobal(buffer);}
 }
}
'@
$pin=Import-Clixml -LiteralPath $path
if($pin -isnot [Security.SecureString]){throw 'Expected DPAPI-protected SecureString.'}
try {
    $certificate=Get-Item ('Cert:/CurrentUser/My/'+$Thumbprint)
    [PiAgentUsbPin]::Unlock($certificate,$pin)
    Write-Host 'USB token accepted the Windows-encrypted PIN.'
} catch {
    # Quarantine once: a stale PIN must never be retried by subsequent builds.
    Move-Item -LiteralPath $path -Destination ($path+'.rejected-'+[guid]::NewGuid().ToString('N'))
    throw 'USB PIN pre-authentication failed; stored credential quarantined. No automatic retry.'
} finally {$pin.Dispose()}
