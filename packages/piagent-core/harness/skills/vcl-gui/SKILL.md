---
name: vcl-gui
description: Design or review Delphi VCL forms with native menus, Actions, docking and DFM structure.
---

# VCL native GUI

Separate Owner (lifetime/streaming), Parent (visual containment), menu ancestry and ActionList membership. A form-owned button may be parented to a panel. Use TPanel with Align for primary regions, TSplitter for resizable regions, and TGridPanel/TFlowPanel for structured groups. Account for Align order, Anchors, AutoSize and Margins; avoid hard-coded website-like button strips.

Use TMainMenu/TMenuItem for a conventional application menu, TToolBar/TToolButton for frequent commands and TStatusBar for status. Share TAction instances in a TActionList, or use an existing TActionManager/action-band architecture. Bind menu and toolbar Action to the same instance; put behavior in OnExecute and availability in OnUpdate instead of duplicating handlers. Preserve existing OnClick behavior when migrating; clear it only as an explicit approved change after shared behavior is wired.

Keep .pas field declarations, event handlers and .dfm serialization synchronized. Actions are nonvisual. Menu parentage is not a control Parent. Use only allowedParentIds and reference allowedTargets returned by the adapter. Do not write event handler names through scalar properties.

## Workflow

Inspect the active document with ide_designer_inspect. Read its hierarchy, references, supportedOperations and this catalog before changing GUI structure. State the intended containment tree and shared commands briefly. Preserve the user's existing UI/UX; do not impose a new layout or add menus to a screen that does not need them.

Use designer tools for operations the live snapshot permits. A catalog is reference knowledge, not evidence that a control is installed or an operation is supported. If creation, event wiring, collections or bindings are unsupported, use the existing approved multi-file source edit workflow, preserving generated/designer resources and code together, then reload the designer and inspect again. Do not claim source editing was a native designer operation. Reject stale or dirty snapshots and inspect again instead of forcing a write.

Verify resizing, keyboard access/tab order, accessible labels, focus, DPI scaling, enabled/checked state and the real command behavior. A build or serialized property check alone does not prove visual UX. Report which checks actually ran.

Reference catalog: ../../catalogs/vcl.json (also attached to the inspect result). This is a curated starter catalog, not a complete SDK inventory.

Official reference: https://docwiki.embarcadero.com/RADStudio/Alexandria/en/Handling_VCL_Actions_Using_an_Action_Manager

