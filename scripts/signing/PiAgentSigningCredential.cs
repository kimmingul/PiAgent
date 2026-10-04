#nullable disable
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Xml;

// Compiled into the signing process, never a separate pre-authentication process.
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public static class PiAgentSigningCredential
{
    [StructLayout(LayoutKind.Sequential)] struct Blob { public int Size; public IntPtr Data; }
    [StructLayout(LayoutKind.Sequential)] struct ProviderInfo {
        public IntPtr Container, Provider; public uint Type, Flags, Count; public IntPtr Parameters; public uint KeySpec;
    }
    [DllImport("crypt32.dll", SetLastError=true)] static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError=true)] static extern bool CertGetCertificateContextProperty(IntPtr cert, uint property, IntPtr data, ref uint size);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);

    public static string CredentialPath(string thumbprint) {
        if (thumbprint == null || thumbprint.Length != 40) throw new ArgumentException("Invalid certificate thumbprint");
        foreach (char value in thumbprint) if (!Uri.IsHexDigit(value)) throw new ArgumentException("Invalid certificate thumbprint");
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".piagent", "signing", thumbprint.ToUpperInvariant()+".clixml");
    }
    public static void AssertPlainPath(string path) {
        for (string current=Path.GetFullPath(path); current != null; current=Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)
                throw new IOException("Signing credential links are forbidden");
    }
    public static SecureString LoadPinFile(string path) {
        AssertPlainPath(path);
        if (!File.Exists(path)) throw new IOException("Register the USB PIN once with scripts/set-signing-pin.ps1. SafeNet Token Logon does not save it for PiAgent.");
        var settings=new XmlReaderSettings { DtdProcessing=DtdProcessing.Prohibit, XmlResolver=null, MaxCharactersInDocument=65536 };
        string encrypted=null;
        using (var reader=XmlReader.Create(path,settings)) {
            while (!reader.EOF) {
                if (reader.NodeType==XmlNodeType.Element && reader.LocalName=="SS") {
                    if (encrypted!=null) throw new IOException("Expected one DPAPI SecureString");
                    encrypted=reader.ReadElementContentAsString();
                } else reader.Read();
            }
        }
        if (string.IsNullOrEmpty(encrypted) || encrypted.Length%2!=0) throw new IOException("Expected a DPAPI SecureString file");
        byte[] bytes=new byte[encrypted.Length/2];
        for (int index=0; index<bytes.Length; index++) bytes[index]=Convert.ToByte(encrypted.Substring(index*2,2),16);
        Blob input=new Blob { Size=bytes.Length, Data=Marshal.AllocHGlobal(bytes.Length) }, output=new Blob();
        SecureString pin=null;
        try {
            Marshal.Copy(bytes,0,input.Data,bytes.Length);
            if (!CryptUnprotectData(ref input,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,1,out output)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Windows could not decrypt the signing PIN for this user/machine");
            if (output.Size<2 || output.Size%2!=0) throw new IOException("Invalid encrypted PIN");
            pin=new SecureString();
            for (int offset=0; offset<output.Size; offset+=2) pin.AppendChar(unchecked((char)(ushort)Marshal.ReadInt16(output.Data,offset)));
            pin.MakeReadOnly(); var result=pin; pin=null; return result;
        } finally {
            if (pin!=null) pin.Dispose();
            if (output.Data!=IntPtr.Zero) { for (int offset=0; offset<output.Size; offset++) Marshal.WriteByte(output.Data,offset,0); LocalFree(output.Data); }
            Marshal.FreeHGlobal(input.Data); Array.Clear(bytes,0,bytes.Length);
        }
    }
    public static RSA OpenRsa(X509Certificate2 certificate) {
        // An explicit opt-in retains manual signing for diagnostics/software certificates.
        if (Environment.GetEnvironmentVariable("PIAGENT_SIGNING_INTERACTIVE")=="1")
            return certificate.GetRSAPrivateKey() ?? throw new CryptographicException("RSA private key unavailable");
        string path=CredentialPath(certificate.Thumbprint);
        using (SecureString pin=LoadPinFile(path)) {
            uint size=0;
            if (!CertGetCertificateContextProperty(certificate.Handle,2,IntPtr.Zero,ref size)) throw new Win32Exception();
            IntPtr buffer=Marshal.AllocHGlobal((int)size);
            RSA rsa=null;
            try {
                if (!CertGetCertificateContextProperty(certificate.Handle,2,buffer,ref size)) throw new Win32Exception();
                var info=(ProviderInfo)Marshal.PtrToStructure(buffer,typeof(ProviderInfo));
                if (info.Type==0) throw new NotSupportedException("Stored-PIN signing currently supports CSP RSA tokens, not CNG-only tokens");
                var parameters=new CspParameters((int)info.Type,Marshal.PtrToStringUni(info.Provider),Marshal.PtrToStringUni(info.Container)) {
                    KeyNumber=(int)info.KeySpec,
                    Flags=CspProviderFlags.UseExistingKey|CspProviderFlags.NoPrompt|((info.Flags&32)!=0?CspProviderFlags.UseMachineKeyStore:0),
                    KeyPassword=pin
                };
                try {
                    rsa=new RSACryptoServiceProvider(parameters);
                    // Validate the PIN once here, before any file signer or retry loop runs.
                    byte[] digest,signature;
                    using (var sha=SHA256.Create()) digest=sha.ComputeHash(Encoding.UTF8.GetBytes("PiAgent signing key validation "+Guid.NewGuid().ToString("N")));
                    signature=rsa.SignHash(digest,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
                    using (RSA publicKey=certificate.GetRSAPublicKey())
                        if (!publicKey.VerifyHash(digest,signature,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1)) throw new CryptographicException("Signing key does not match certificate");
                    Array.Clear(digest,0,digest.Length); Array.Clear(signature,0,signature.Length);
                } catch (CryptographicException error) {
                    File.Move(path,path+".rejected-"+Guid.NewGuid().ToString("N"));
                    throw new CryptographicException("USB PIN/key validation failed (0x"+error.HResult.ToString("X8")+"); encrypted credential quarantined. No automatic retry or authentication dialog.");
                }
                RSA result=rsa; rsa=null; return result;
            } finally { if (rsa!=null) rsa.Dispose(); Marshal.FreeHGlobal(buffer); }
        }
    }
}
