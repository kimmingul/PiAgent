---
name: winforms-gui
description: Design or review Windows Forms native application layouts, menus, shared commands and designer resources.
---

# WinForms native GUI

Use MenuStrip/ToolStrip/StatusStrip for a conventional document window where appropriate. Put editor content in a Dock=Fill region; use SplitContainer for resizable navigation/editor areas, TableLayoutPanel for aligned forms, and FlowLayoutPanel for flowing groups. Do not imitate CSS absolute positioning with rows of Buttons.

Dock and z-order interact; set docking order deliberately and inspect after resizing. Anchor belongs to the immediate parent. Match AutoSize, AutoScaleMode and tab order to the form. Centralize New/Open/Save command handlers and availability; menu and toolbar entries call the same operation. Use native OpenFileDialog/SaveFileDialog. Keep designer initialization in .Designer.cs and event behavior in the companion partial class, respecting localization .resx.

Modern .NET WinForms uses an out-of-process designer. Absence of IDesignerHost is an explicit limitation, not permission to fake designer calls. Keep framework detection separate from native designer availability.

## Workflow

Inspect the active document with ide_designer_inspect. Read its hierarchy, references, supportedOperations and this catalog before changing GUI structure. State the intended containment tree and shared commands briefly. Preserve the user's existing UI/UX; do not impose a new layout or add menus to a screen that does not need them.

Use designer tools for operations the live snapshot permits. A catalog is reference knowledge, not evidence that a control is installed or an operation is supported. If creation, event wiring, collections or bindings are unsupported, use the existing approved multi-file source edit workflow, preserving generated/designer resources and code together, then reload the designer and inspect again. Do not claim source editing was a native designer operation. Reject stale or dirty snapshots and inspect again instead of forcing a write.

Verify resizing, keyboard access/tab order, accessible labels, focus, DPI scaling, enabled/checked state and the real command behavior. A build or serialized property check alone does not prove visual UX. Report which checks actually ran.

Reference catalog: ../../catalogs/winforms.json (also attached to the inspect result). This is a curated starter catalog, not a complete SDK inventory.

Official reference: https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls/

