# PiAgent 0.10.0 — Visual Studio IDE tools and editor suggestions

[한국어](RELEASE-0.10.0.md) · **English** · [User guide](VS-INTELLIGENCE.en.md)

The following five stages are available in Visual Studio 2026 and VS2022 17.14 or later.

1. Solution, project and unsaved context; Error List and compiler diagnostics; Roslyn C#/VB definitions, references and callers.
2. VS build and selected test-project discovery/filtered execution with TRX failures. Zero executed tests or missing reports cannot be reported as success.
3. Breakpoints, debugger start/continue/step/stop, paused call stack and locals, and approved expression evaluation.
4. Inline gray text through the native VS suggestion service, Tab acceptance, Esc dismissal and Ctrl+Z undo.
5. Next-edit preview/acceptance in the current document and top CPU methods in modern .NET processes attached to the debugger.

Automatic suggestions default to off. Configure them in Tools → Options → PiAgent → Editor Suggestions. Editor requests use a separate OMP process with tools and session storage disabled, leaving the chat session available. Stale document responses and superseded requests are discarded; UTF-16 ranges are validated. Requests and acceptance are avoided during Korean IME composition.

Build, tests, debugger changes and profiling require per-action approval and support cancellation. Plan/read-only mode cannot execute them. IDE read tools enforce workspace path limits. VS2022 versions before 17.14 are excluded from installation.

Native VS2026 testing exposed and fixed menu focus loss and cancellation when moving to the next-edit location. Chat/editor requests remain separate, and rapid request replacement now produces consistent cancellation results.

See the [VS tools guide](VS-INTELLIGENCE.en.md) and [validation record](VALIDATION.md) for scope and evidence. C++ semantic analysis, Test Explorer state control, native/.NET Framework profiling, memory analysis and next edits across documents are excluded. CPU sampling requires the official `dotnet-trace` tool separately. Existing RAD Studio VCL/FMX features are retained.
