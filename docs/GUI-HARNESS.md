# Native GUI harness 1.0 / PiAgent 0.9.0

## Runtime connection

`packages/piagent-core/harness/manifest.json` routes an adapter's actual framework ID to one of five
packaged skills and curated component catalogs. `ide_designer_inspect` returns the selected skill body
and catalog to OMP in its host-tool result, including in restricted mode. No global skill installation,
OMP settings change or model-dependent filesystem discovery is required. Unknown frameworks receive
no guessed skill. Packaging copies these resources alongside Core's `dist`, with release hashes.

Core only loads data and brokers requests. SDK calls and compatibility rules remain in adapters.
The manifest is a PiAgent package format, not an assertion that an OMP/Codex plugin or MCP server is installed.
An MCP facade can later expose these same capabilities; this version uses the existing Named Pipe and OMP
host-tool paths, avoiding a second write/approval implementation.

## Framework distinctions

| Skill | Composition and command guidance | Current executable designer surface |
| --- | --- | --- |
| WinForms | MenuStrip, ToolStrip, StatusStrip; Table/FlowLayoutPanel, SplitContainer; shared handlers | Scalar properties with public in-process IDesignerHost. Modern .NET designer bridge unavailable; project detection still supplies guidance. |
| WPF | Grid/DockPanel; Menu/ToolBar/StatusBar; ICommand/RoutedCommand and bindings | XAML syntax hierarchy and existing literal scalar attribute edits. Binding/resource expressions are read-only. |
| WinUI 3 | Grid, appropriate NavigationView; MenuBar/CommandBar; XamlUICommand | XAML syntax hierarchy and existing literal scalar attribute edits; runtime tools required for visual validation. |
| VCL | Panels/splitters; TMainMenu/TToolBar/TStatusBar; TActionList/TAction | Scalar properties, compatible component references, supported existing component reparenting. |
| FMX | TLayout/TGridPanelLayout; TMainMenu, TToolBar with FMX buttons, TStatusBar with TLabel; FMX Actions | Same bounded structural operations through public component/ToolsAPI interfaces. |

Catalogs provide names, roles, representative properties/events and selection guidance. They are **not**
complete SDK catalogs, installed palette inventories or permission to invoke nonexistent APIs. Live snapshot
`supportedOperations`, `allowedParentIds`, reference `allowedTargets` and writable flags take precedence.
Adding/deleting components, generating handlers, arbitrary collections, templates and bindings still use
the existing approved source-edit workflow, followed by designer refresh, inspection and build/run checks.
The five skills do not imply equal automation coverage across the five frameworks.

## Native relationships

RAD snapshots distinguish lifetime `ownerId` from streamed `parentId`: a form-owned button can be inside a
panel, a menu item inside another menu, and an Action inside an ActionList. Reference properties are separate
edges. Parent changes never assign Owner. Root moves, inherited component moves, self/descendant cycles,
cross-document IDs and unsupported target classes are rejected. FMX visual targets are deliberately limited
to root, TLayout descendants, TToolBar, TStatusBar and TPanel; this does not cover arbitrary content hosts.
Menu and ActionList parents use their specific native contracts. Only `Action`, `Menu`, `PopupMenu` and
`ActionList` component-reference setters are offered, and targets must match their RTTI class.

Each write performs inspect → bounded proposal → existing approval card → adapter document/revision/dirty
recheck → one native change → IDE save. Reference setters can synchronize captions/text, enabled state and
other related properties; the approval reason discloses this. Reinspect after applying. Existing event handlers
are not silently removed. Designer changes do not yet participate in Core Git checkpoint restore. On save
failure the adapter attempts to restore the relationship and leaves the IDE dirty; it does not claim atomic
disk rollback or restoration of all setter side effects. Inspect and reconcile before continuing.

VS XAML parent IDs describe XML syntax, including property elements and templates, not runtime visual
parentage. Namespace and nodeKind are included. Unsupported structural writes are not advertised.

## Checks and example

`npm test` checks harness selection, delivery, packaged resource loading, approval/revision binding, denial,
cancellation, read-only access, unsupported adapters and invalid targets alongside existing tests.
`scripts/test-gui-harness.ps1` builds and runs the two following Win64 smoke programs.
`adapters/radstudio/tests/DesignerRelationsSmoke.dpr` checks actual VCL/FMX native parent/menu/Action behavior.
`examples/fmx-document-editor` contains a streamed FMX example with shared menu/toolbar Actions, native
dialogs and a status region. `NativeEditorSmoke.dpr` checks command execution and UTF-8 round trips.
It is a small architecture example, not a complete editor with unsaved-document recovery.

Build adapters with `scripts/build-adapters.ps1 -RadPlatforms Win64` (now also the default).
Release packaging includes Win64 RAD packages by default; Core still targets Windows x64/ARM64.
Win32 can be selected explicitly through the build parameter and programmatic packageCore radPlatforms;
it is not built or tested in this validation cycle. VS2022 testing remains deferred.
