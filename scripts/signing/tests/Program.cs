using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Cryptography.Pkcs;
using System.Runtime.InteropServices;
using System.Text.Json;

if(args[0]=="silent-cng") {
    var parameters=new CngKeyCreationParameters {Provider=CngProvider.MicrosoftSoftwareKeyStorageProvider};
    parameters.Parameters.Add(new CngProperty("Length",BitConverter.GetBytes(2048),CngPropertyOptions.None));
    using var key=CngKey.Create(CngAlgorithm.Rsa,null,parameters);
    using var rsa=new PiAgentSigningCredential.SilentCngRsa(key);
    var digest=SHA256.HashData("PiAgent silent CNG regression"u8);
    var signature=rsa.SignHash(digest,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
    using var verifier=RSA.Create(); verifier.ImportParameters(rsa.ExportParameters(false));
    if(!verifier.VerifyHash(digest,signature,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1))throw new Exception("CNG signature failed");
    digest[0]^=1;
    if(verifier.VerifyHash(digest,signature,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1))throw new Exception("Tampered digest accepted");
    try {rsa.ExportParameters(true);throw new Exception("Private key exported");} catch(NotSupportedException){}
    try {rsa.SignHash(digest,HashAlgorithmName.SHA256,RSASignaturePadding.Pss);throw new Exception("Unsupported padding accepted");} catch(NotSupportedException){}
    Console.WriteLine("PASS silent CNG PKCS1 signature / tamper rejection / no private export / unsupported padding rejection");return;
}

if(args[0]=="credential") {
    using var pin=PiAgentSigningCredential.LoadPinFile(args[1]);
    var pointer=Marshal.SecureStringToGlobalAllocUnicode(pin);
    try { if(Marshal.PtrToStringUni(pointer)!="PiAgent test PIN 🚀")throw new Exception("DPAPI roundtrip failed"); }
    finally {Marshal.ZeroFreeGlobalAllocUnicode(pointer);}
    Console.WriteLine("PASS DPAPI SecureString decrypted inside the .NET signing process");
    try {PiAgentSigningCredential.LoadPinFile(args[1]+".absent");throw new Exception("Missing PIN accepted");}catch(IOException){Console.WriteLine("PASS absent credential fails without an authentication dialog");}
    var bad=args[1]+".bad";File.WriteAllText(bad,"<Objs><SS>0000</SS></Objs>");
    try{using var rejected=PiAgentSigningCredential.LoadPinFile(bad);throw new Exception("Corrupt DPAPI accepted");}catch(System.ComponentModel.Win32Exception){Console.WriteLine("PASS corrupt DPAPI rejected before CSP access");}finally{File.Delete(bad);}
    foreach(var xml in new[]{"<Objs><SS>0000</SS><SS>0000</SS></Objs>","<Objs><SS>0</SS></Objs>","<Objs/>"}){
        File.WriteAllText(bad,xml);
        try{using var rejected=PiAgentSigningCredential.LoadPinFile(bad);throw new Exception("Malformed XML accepted");}catch(IOException){}finally{File.Delete(bad);}
    }
    File.WriteAllText(bad,"<!DOCTYPE Objs [<!ENTITY secret SYSTEM 'file:///not-allowed'>]><Objs><SS>&secret;</SS></Objs>");
    try{using var rejected=PiAgentSigningCredential.LoadPinFile(bad);throw new Exception("DTD accepted");}catch(System.Xml.XmlException){}finally{File.Delete(bad);}
    Console.WriteLine("PASS duplicate/malformed SecureStrings and external entities rejected");
    return;
}
if(args[0]=="verify-pe") {
    byte[] pe=File.ReadAllBytes(args[1]);
    int header=BitConverter.ToInt32(pe,0x3c),optional=header+24;
    int directories=optional+(BitConverter.ToUInt16(pe,optional)==0x20b?112:96);
    int certificateOffset=BitConverter.ToInt32(pe,directories+4*8);
    int size=BitConverter.ToInt32(pe,certificateOffset);
    if(certificateOffset<directories||size<8||size>pe.Length-certificateOffset)throw new Exception("Invalid PE certificate table");
    var cms=new SignedCms();cms.Decode(pe.AsSpan(certificateOffset+8,size-8));cms.CheckSignature(true);
    if(cms.SignerInfos.Count!=1||cms.SignerInfos[0].Certificate!.Thumbprint!=args[2])throw new Exception("Unexpected test signer");
    if(!cms.SignerInfos[0].UnsignedAttributes.Cast<CryptographicAttributeObject>().Any(attribute=>attribute.Oid.Value=="1.3.6.1.4.1.311.3.3.1"))throw new Exception("Missing RFC3161 timestamp");
    Console.WriteLine("PASS PE CMS signature, expected signer and RFC3161 timestamp (test root is not trusted)");return;
}
if(args[0]=="reject-software-pin") {
    using var data=JsonDocument.Parse(File.ReadAllText(args[1]));
    string container=data.RootElement.GetProperty("container").GetString()!;
    if(!container.StartsWith("PiAgent-Signing-Test-",StringComparison.Ordinal))throw new Exception("Not a test container");
    string thumbprint=data.RootElement.GetProperty("thumbprint").GetString()!;
    string path=PiAgentSigningCredential.CredentialPath(thumbprint);
    PiAgentSigningCredential.AssertPlainPath(path);
    if(File.Exists(path))throw new Exception("Test credential unexpectedly exists");
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    using var store=new X509Store(StoreName.My,StoreLocation.CurrentUser);store.Open(OpenFlags.ReadOnly);
    using var cert=store.Certificates.Find(X509FindType.FindByThumbprint,thumbprint,false).Single();
    File.Copy(args[2],path);
    try {
        // The Microsoft software CSP rejects a token PIN; exercise the actual NoPrompt failure path.
        try{using var rsa=PiAgentSigningCredential.OpenRsa(cert);throw new Exception("Software CSP unexpectedly accepted token PIN");}
        catch(CryptographicException error){if(!error.Message.Contains("quarantined"))throw;}
        if(File.Exists(path)||Directory.GetFiles(Path.GetDirectoryName(path)!,Path.GetFileName(path)+".rejected-*").Length!=1)throw new Exception("Failed PIN not quarantined once");
        try{using var rsa=PiAgentSigningCredential.OpenRsa(cert);throw new Exception("Missing PIN accepted after quarantine");}catch(IOException){}
        Console.WriteLine("PASS NoPrompt CSP rejection quarantines once; subsequent calls stop before token access");
    }finally {
        File.Delete(path);
        foreach(string rejected in Directory.GetFiles(Path.GetDirectoryName(path)!,Path.GetFileName(path)+".rejected-*"))File.Delete(rejected);
    }
    return;
}
if(args[0]=="create-test-cert") {
    var parameters=new CspParameters(24,"Microsoft Enhanced RSA and AES Cryptographic Provider","PiAgent-Signing-Test-"+Guid.NewGuid().ToString("N")){Flags=CspProviderFlags.NoPrompt};
    using var rsa=new RSACryptoServiceProvider(2048,parameters){PersistKeyInCsp=true};
    var request=new CertificateRequest("CN=PiAgent Signing Test",rsa,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
    request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature,true));
    request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection {new Oid("1.3.6.1.5.5.7.3.3")},true));
    using var certificate=request.CreateSelfSigned(DateTimeOffset.Now.AddMinutes(-5),DateTimeOffset.Now.AddDays(1));
    using var store=new X509Store(StoreName.My,StoreLocation.CurrentUser);store.Open(OpenFlags.ReadWrite);store.Add(certificate);
    File.WriteAllText(args[1],JsonSerializer.Serialize(new{thumbprint=certificate.Thumbprint,container=parameters.KeyContainerName}));
    Console.WriteLine("Created temporary software signing certificate (not trusted)");return;
}
if(args[0]=="remove-test-cert") {
    using var data=JsonDocument.Parse(File.ReadAllText(args[1]));
    string container=data.RootElement.GetProperty("container").GetString()!;
    if(!container.StartsWith("PiAgent-Signing-Test-",StringComparison.Ordinal))throw new Exception("Not a test container");
    using var store=new X509Store(StoreName.My,StoreLocation.CurrentUser);store.Open(OpenFlags.ReadWrite);
    foreach(var cert in store.Certificates.Find(X509FindType.FindByThumbprint,data.RootElement.GetProperty("thumbprint").GetString()!,false))store.Remove(cert);
    try {
        using var rsa=new RSACryptoServiceProvider(new CspParameters(24,"Microsoft Enhanced RSA and AES Cryptographic Provider",container){Flags=CspProviderFlags.NoPrompt|CspProviderFlags.UseExistingKey});
        rsa.PersistKeyInCsp=false;rsa.Clear();
    }catch(CryptographicException error)when(error.HResult==unchecked((int)0x80090016)){/* already deleted */}
    Console.WriteLine("Removed only the temporary test certificate and key");return;
}
throw new ArgumentException("Unknown test action");
