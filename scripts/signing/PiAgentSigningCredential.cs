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
    [DllImport("crypt32.dll", SetLastError=true)] static extern bool CryptAcquireCertificatePrivateKey(IntPtr cert,uint flags,IntPtr reserved,out Microsoft.Win32.SafeHandles.SafeNCryptKeyHandle key,out uint keySpec,out bool callerFree);
    [DllImport("ncrypt.dll", CharSet=CharSet.Unicode)] static extern int NCryptSetProperty(Microsoft.Win32.SafeHandles.SafeNCryptKeyHandle key, string name, IntPtr value, int length, uint flags);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Pkcs1Info { [MarshalAs(UnmanagedType.LPWStr)] public string Algorithm; }
    [DllImport("ncrypt.dll")] static extern int NCryptSignHash(Microsoft.Win32.SafeHandles.SafeNCryptKeyHandle key, ref Pkcs1Info padding, byte[] hash, int hashLength, byte[] signature, int signatureLength, out int resultLength, uint flags);

    // Keep the silent flag on every private-key operation, not just key acquisition.
    internal sealed class SilentCngRsa : RSA {
        readonly CngKey key;
        readonly RSACng publicOperations;
        internal SilentCngRsa(CngKey key) { this.key=key; publicOperations=new RSACng(key); KeySizeValue=publicOperations.KeySize; }
        public override byte[] SignHash(byte[] hash, HashAlgorithmName algorithm, RSASignaturePadding padding) {
            if (padding != RSASignaturePadding.Pkcs1) throw new NotSupportedException("Only PKCS#1 signing is supported");
            if (algorithm != HashAlgorithmName.SHA256 && algorithm != HashAlgorithmName.SHA384 && algorithm != HashAlgorithmName.SHA512) throw new NotSupportedException("Unsupported signing digest");
            var info=new Pkcs1Info {Algorithm=algorithm.Name};
            byte[] signature=new byte[(KeySize+7)/8];
            int error=NCryptSignHash(key.Handle,ref info,hash,hash.Length,signature,signature.Length,out int length,0x42); // PKCS1 | SILENT
            if (error!=0) throw new CryptographicException(error);
            if (length!=signature.Length) Array.Resize(ref signature,length);
            return signature;
        }
        public override RSAParameters ExportParameters(bool includePrivateParameters) {
            if (includePrivateParameters) throw new NotSupportedException("Private signing key export is forbidden");
            return publicOperations.ExportParameters(false);
        }
        public override void ImportParameters(RSAParameters parameters) => throw new NotSupportedException();
        public override byte[] Decrypt(byte[] data,RSAEncryptionPadding padding) => throw new NotSupportedException();
        public override byte[] Encrypt(byte[] data,RSAEncryptionPadding padding) => publicOperations.Encrypt(data,padding);
        public override bool VerifyHash(byte[] hash,byte[] signature,HashAlgorithmName algorithm,RSASignaturePadding padding) => publicOperations.VerifyHash(hash,signature,algorithm,padding);
        protected override void Dispose(bool disposing) { if(disposing){publicOperations.Dispose();key.Dispose();} base.Dispose(disposing); }
    }

    static RSA OpenCng(ProviderInfo info, SecureString pin, CngKey acquiredKey=null) {
        CngKey key=null;
        IntPtr pinPointer=IntPtr.Zero;
        string stage="CNG key open";
        try {
            key=acquiredKey;
            if(key==null) {
                var options=CngKeyOpenOptions.Silent|((info.Flags&32)!=0?CngKeyOpenOptions.MachineKey:CngKeyOpenOptions.UserKey);
                key=CngKey.Open(Marshal.PtrToStringUni(info.Container),new CngProvider(Marshal.PtrToStringUni(info.Provider)),options);
            }
            stage="CNG PIN property";
            pinPointer=Marshal.SecureStringToGlobalAllocUnicode(pin);
            int error=NCryptSetProperty(key.Handle,"SmartCardPin",pinPointer,checked((pin.Length+1)*2),0x40);
            if(error!=0) throw new CryptographicException(error);
            var result=new SilentCngRsa(key); key=null; return result;
        } catch(CryptographicException error) { throw new CryptographicException(stage+" failed",error); }
        finally { if(pinPointer!=IntPtr.Zero)Marshal.ZeroFreeGlobalAllocUnicode(pinPointer); if(key!=null)key.Dispose(); }
    }

    static CngKey TryAcquireCng(X509Certificate2 certificate) {
        // Windows/smart-card propagation can change CERT_KEY_PROV_INFO back to legacy CSP.
        // Acquire CNG explicitly; this is key acquisition, not an authentication retry.
        bool acquired=CryptAcquireCertificatePrivateKey(certificate.Handle,0x40040,IntPtr.Zero,out var safe,out uint spec,out bool callerFree); // ONLY_NCRYPT | SILENT
        using(safe) {
            if(!acquired) return null;
            if(!callerFree) {safe.SetHandleAsInvalid();throw new NotSupportedException("Unexpected borrowed certificate key handle");}
            if(spec!=0xFFFFFFFF) throw new CryptographicException("Expected CNG key");
            return CngKey.Open(safe,CngKeyHandleOpenOptions.None);
        }
    }

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
                try {
                    var cng=TryAcquireCng(certificate);
                    if(cng!=null || info.Type==0) rsa=OpenCng(info,pin,cng);
                    else rsa=new RSACryptoServiceProvider(new CspParameters((int)info.Type,Marshal.PtrToStringUni(info.Provider),Marshal.PtrToStringUni(info.Container)) {
                        KeyNumber=(int)info.KeySpec,
                        Flags=CspProviderFlags.UseExistingKey|CspProviderFlags.NoPrompt|((info.Flags&32)!=0?CspProviderFlags.UseMachineKeyStore:0),
                        KeyPassword=pin
                    });
                    // Validate the PIN once here, before any file signer or retry loop runs.
                    byte[] digest,signature;
                    using (var sha=SHA256.Create()) digest=sha.ComputeHash(Encoding.UTF8.GetBytes("PiAgent signing key validation "+Guid.NewGuid().ToString("N")));
                    signature=rsa.SignHash(digest,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
                    using (RSA publicKey=certificate.GetRSAPublicKey())
                        if (!publicKey.VerifyHash(digest,signature,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1)) throw new CryptographicException("Signing key does not match certificate");
                    Array.Clear(digest,0,digest.Length); Array.Clear(signature,0,signature.Length);
                } catch (CryptographicException error) {
                    File.Move(path,path+".rejected-"+Guid.NewGuid().ToString("N"));
                    throw new CryptographicException("USB PIN/key validation failed (0x"+error.HResult.ToString("X8")+"); encrypted credential quarantined. No automatic retry or authentication dialog. Provider operation: "+(info.Type==0?"CNG":"CSP"),error);
                }
                RSA result=rsa; rsa=null; return result;
            } finally { if (rsa!=null) rsa.Dispose(); Marshal.FreeHGlobal(buffer); }
        }
    }
}
