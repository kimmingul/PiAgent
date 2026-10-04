# Windows code signing

`scripts/build-adapters.ps1` signs by default, using the Nanum Space certificate in
CurrentUser/My (thumbprint `3CE49DE1124F325082FA90BDE4944756D1626251`). Connect the SafeNet
USB token and unlock it in the provider's Token Logon dialog. PINs and private keys are
never stored in this repository or passed on command lines. Failed signing stops the build;
it does not retry token authentication or silently produce a successful unsigned release.

Windows SDK SignTool signs first-party PE binaries with SHA-256 and GlobalSign's RFC 3161
timestamp. Every signed PE is checked with `verify /pa /tw`, expected signer, and timestamp.
On this ARM64 PC, SDK x86 SignTool is used because the SafeNet token provider exposes its
private key to x86 processes. Third-party binaries retain their original signatures.

The first-party assemblies inside the completed VSSDK archive are signed before the outer
VSIX signature. This also covers project-reference DLLs that VSSDK takes from `obj` instead
of the signed `bin` copy. Microsoft's Sign CLI signs the completed VSIX;
`verify-vsix.ps1` verifies the OPC signature, content, expected signer, certificate chain,
and embedded first-party assembly signatures/timestamps. This is separate from strong naming.

Install the pinned Sign CLI once from the repository root:

```powershell
dotnet tool install sign --tool-path .tools/sign --version 0.9.1-beta.26475.3
```

This official tool release uses x64 dependencies. For this ARM64 PC's x86 token middleware,
`scripts/prepare-sign-cli.ps1` builds the official MIT-licensed `dotnet/sign` source at
commit `8e61df9fb776e0c2499dbed0b8037fe450da917b` for x86. A scoped compatibility patch
permits x86 only when the final argument is a VSIX. Container recursion is disabled:
first-party PE files are already signed separately with SDK SignTool. The container signing
algorithm is unchanged. This compatibility build requires the x86 .NET 8 runtime under
`C:\Program Files (x86)\dotnet`; it is not an official x86 Sign CLI release. Microsoft's
VSIXSignTool independently verified the signed output. These are build prerequisites and
are not shipped as PiAgent runtime dependencies. Core remains native ARM64.

```powershell
& .\scripts\build-adapters.ps1
```

For explicit local development without signing, use `-SkipCodeSign`. Generate release
manifests/archives only after a successful signed build: signing changes file hashes.
Plain JavaScript, JSON, HTML and ZIP files do not receive PE Authenticode signatures.

References: [SignTool](https://learn.microsoft.com/windows/win32/seccrypto/signtool),
[Signing VSIX packages](https://learn.microsoft.com/visualstudio/extensibility/signing-vsix-packages).

### Windows-encrypted USB PIN

Run `scripts/set-signing-pin.ps1` once in your own PowerShell session. It prompts
with Read-Host -AsSecureString and stores only a Windows DPAPI encrypted SecureString
in `%USERPROFILE%/.piagent/signing/<certificate-thumbprint>.clixml`. The directory
ACL permits only the current user. No PIN belongs in this repository or a `.env` file.
DPAPI ties the saved value to this Windows user/machine.

Both signing scripts call `unlock-signing-token.ps1` automatically. It decrypts in
an x86 Windows PowerShell worker for this ARM64 PC's SafeNet middleware, submits the
PIN directly to the certificate's CSP using CryptSetProvParam and zeros the unmanaged
buffer. The PIN never appears in command-line arguments, environment variables or
logs. A rejected/unsupported stored PIN is quarantined after a single attempt;
subsequent builds do not retry it. CNG-only tokens are reported as unsupported by
this CSP helper. Provider-specific PIN caching controls whether separate SignTool
and VSIX signing processes reuse that login; repeated prompts cannot be guaranteed
absent until the actual saved PIN and USB middleware have been tested. With no
saved PIN, an already-unlocked token continues to work as before.

API: [CryptSetProvParam](https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptsetprovparam).
