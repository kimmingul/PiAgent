---
name: fmx-gui
description: Design or review FireMonkey forms with FMX layouts, Actions, menus and streamed form resources.
---

# FMX native GUI

Use TLayout as a non-rendering container, TGridPanelLayout for cells, TFlowLayout for flow, and TScaledLayout only when proportional scaling is intended. FMX Align values (Top, Client, Contents, etc.) are not VCL alTop/alClient. Margins/Padding and Position are structured properties. Avoid replacing adaptive layout with arbitrary coordinates.

For Windows desktop document apps, use TMainMenu/TMenuItem for application commands, TToolBar with suitable controls for frequent actions, and TStatusBar with a TLabel for text status. FMX TStatusBar does not expose VCL Panels/SimpleText. FMX TToolBar is not VCL TToolBar with TToolButton; select FMX TButton/TSpeedButton within it.

Share FMX TAction instances through TActionList and Action references. Respect target platform differences in menu presentation. Distinguish TFmxObject parentage from component ownership, and do not move style internals or arbitrary content collections. Keep .pas fields/handlers and .fmx serialization synchronized; let the IDE stream resources after supported edits. Verify DPI, resizing, focus and keyboard behavior in the actual Windows executable.

## Workflow

Inspect the active document with ide_designer_inspect. Read its hierarchy, references, supportedOperations and this catalog before changing GUI structure. State the intended containment tree and shared commands briefly. Preserve the user's existing UI/UX; do not impose a new layout or add menus to a screen that does not need them.

Use designer tools for operations the live snapshot permits. A catalog is reference knowledge, not evidence that a control is installed or an operation is supported. If creation, event wiring, collections or bindings are unsupported, use the existing approved multi-file source edit workflow, preserving generated/designer resources and code together, then reload the designer and inspect again. Do not claim source editing was a native designer operation. Reject stale or dirty snapshots and inspect again instead of forcing a write.

Verify resizing, keyboard access/tab order, accessible labels, focus, DPI scaling, enabled/checked state and the real command behavior. A build or serialized property check alone does not prove visual UX. Report which checks actually ran.

Reference catalog: ../../catalogs/fmx.json (also attached to the inspect result). This is a curated starter catalog, not a complete SDK inventory.

Official reference: https://docwiki.embarcadero.com/Libraries/Florence/en/FMX.Layouts

