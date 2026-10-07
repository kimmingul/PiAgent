# Windows code signing

Release builds sign first-party PE binaries, Delphi BPLs and the VSIX with the
Nanum Space certificate in CurrentUser/My, thumbprint
`3CE49DE1124F325082FA90BDE4944756D1626251`. Connect the SafeNet USB token.
Signing failures stop the build; an unsigned release is never reported as successful.

Latest verification: the [0.9.17 release](RELEASE-0.9.17.md), built on 2026-10-08 KST,
passed setup, VSIX/embedded assemblies, Win32/Win64 BPL and PipeHost signature/timestamp checks.
The completed installer also passed embedded payload hashes and ARM64/x64 runtime verification.

## Register the USB PIN once

Run in your own PowerShell session:

```powershell
& D:\source\PiAgent\scripts\set-signing-pin.ps1
```

Enter the PIN only into the local masked prompt. The script stores a Windows DPAPI
encrypted SecureString in `%USERPROFILE%\.piagent\signing\<thumbprint>.clixml`.
The directory ACL permits only the current user; directory/file links are rejected.
DPAPI binds decryption to the Windows user and machine. No PIN belongs in Git,
`.env`, command-line arguments, environment variables, logs or chat.

SafeNet's Token Logon dialog does **not** register this PiAgent credential. With no
saved credential, signed builds now fail before building rather than opening
repeated authentication dialogs. Run the registration script again to replace or
correct the saved PIN.

## PIN delivery inside the signing process

`sign-artifacts.ps1` and `sign-vsix.ps1` call `invoke-sign-cli.ps1`. Its certificate
provider decrypts the credential **inside the process that signs the files** and
opens the actual CSP RSA key with `CspParameters.KeyPassword`, `UseExistingKey`
and `NoPrompt`. A preflight RSA signature validates the key once; the file signer
uses that same key context. Separate signing processes each receive the saved PIN;
they do not depend on provider login caching across processes.

`unlock-signing-token.ps1` is now only a compatibility registration check. The old
separate pre-authentication worker could not guarantee that later SignTool/VSIX
processes reused its login; an environment marker was not proof of an unlocked key.

Automatic signing never falls back to an interactive PIN dialog. Key/PIN validation
failure quarantines the encrypted file with a `.rejected-<id>` suffix and stops
without automatic retries. It reports the provider error code, never the PIN.
CSP and CNG RSA tokens are supported. CNG receives the decrypted PIN through
`NCryptSetProperty(SmartCardPin)` in the signing process. Key acquisition and every
`NCryptSignHash` call carry the silent flag. PIN native memory is zeroed immediately;
private-key export and unsupported padding are rejected.
The signer uses `CryptAcquireCertificatePrivateKey(ONLY_NCRYPT | SILENT)` first,
so smart-card certificate propagation changing the provider metadata back to CSP
does not force the next signing process onto a legacy provider. This acquisition
does not retry PIN authentication. Software-only CSP fixtures retain the CSP path.
Explicit `-Interactive` on the individual signing scripts retains manual signing
for diagnosis and temporary software-certificate tests; release builds use the
saved-PIN path by default. This switch contains no credential.

## Tooling and verification

`prepare-sign-cli.ps1` builds MIT-licensed Microsoft's `dotnet/sign` at commit
`8e61df9fb776e0c2499dbed0b8037fe450da917b`. The scoped patch supplies the DPAPI PIN
to the certificate-store RSA provider, disables automatic signing retries, enables
the PE/BPL/VSIX paths on x86, and selects matching Windows SDK signing components.
The generated tool stays under ignored `.tools/sign-x86` or `.tools/sign-x64`;
source/patch hashes trigger rebuilding when the implementation changes.

On this ARM64 PC, the token provider is used from x86 processes. The helper uses
the x86 .NET 8 runtime under `C:\Program Files (x86)\dotnet` and x86 SDK components.
On x64, it builds/runs x64. These are build prerequisites, not PiAgent runtime
dependencies; Core remains native ARM64. This is not an official x86 Sign CLI release.

PE signing uses SHA-256 and GlobalSign's RFC 3161 timestamp. SDK SignTool performs
verification only (`verify /pa /tw`), followed by expected signer/timestamp checks;
it never needs private-key authentication. Third-party binaries retain their
original signatures. The exact first-party DLLs inside the completed VSSDK archive
are signed before the outer OPC signature. `verify-vsix.ps1` checks the content
signature, expected signer, trusted chain and embedded DLL signatures/timestamps.
This is separate from strong naming.

```powershell
& .\scripts\build-adapters.ps1
& .\scripts\build-installer.ps1
```

For unsigned local development, explicitly use `-SkipCodeSign` on the adapter
build or `-NoSign` on the installer build. Generate release manifests/archives
after successful signing because signatures change file hashes. JavaScript,
JSON, HTML and ZIP files do not receive PE Authenticode signatures.

## Tests and actual-token validation

```powershell
& .\scripts\test-signing.ps1
# Optionally exercise existing BPL/VSIX copies:
& .\scripts\test-signing.ps1 -BplPath .\adapters\radstudio\bin\Win64\PiAgent370.bpl `
    -VsixPath .\adapters\visualstudio\PiAgent.Vsix\bin\Release\net472\PiAgent.Vsix.vsix
# After registering the actual USB PIN:
& .\scripts\test-signing-token.ps1
```

Regression tests use a temporary software CSP certificate in CurrentUser/My;
they never trust its root or access the USB certificate. They check DPAPI decoding,
invalid/duplicate SecureStrings, DTD rejection, missing-credential failure before
file mutation, PE CMS signatures/timestamps, tamper rejection and VSIX content
signatures. Temporary certificates, keys and fake credentials are removed.

The actual-token test signs copies in `artifacts` in fresh processes and verifies
them, leaving release artifacts and installed IDEs untouched. Software tests alone
do not prove that this SafeNet middleware accepts a saved PIN without UI. At the
time the initial CSP fix was prepared, the actual PIN had not been registered.
On 2026-10-05 the owner registered it; the actual release key used CNG and its first
DLL signing/verification passed without another PIN prompt. Full release verification
is recorded in `RELEASE-0.9.9.md`.

References: [CspParameters.KeyPassword](https://learn.microsoft.com/dotnet/api/system.security.cryptography.cspparameters.keypassword),
[CNG PIN property](https://learn.microsoft.com/windows/win32/seccng/key-storage-property-identifiers),
[NCryptSignHash](https://learn.microsoft.com/windows/win32/api/ncrypt/nf-ncrypt-ncryptsignhash),
[Certificate key acquisition](https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptacquirecertificateprivatekey),
[SignTool](https://learn.microsoft.com/windows/win32/seccrypto/signtool),
[Signing VSIX packages](https://learn.microsoft.com/visualstudio/extensibility/signing-vsix-packages).
