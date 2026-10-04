---
name: winui3-gui
description: Design or review WinUI 3 XAML desktop layouts, command surfaces and runtime visual validation.
---

# WinUI 3 native GUI

Use Grid with Auto/star sizes, NavigationView for actual top-level navigation, and SplitView for a collapsible pane where appropriate. Use MenuBar/MenuBarItem/MenuFlyoutItem for a desktop menu and CommandBar/AppBarButton for frequent commands. Avoid introducing NavigationView into a simple single-document editor without a navigation requirement.

Share XamlUICommand/StandardUICommand or existing view-model commands; connect KeyboardAccelerators, enabled states and access keys. Distinguish x:Bind compiled binding from Binding and preserve the intended update mode. Respect theme resources and accessibility.

WinUI 3 does not have the same Visual Studio visual XAML designer as WPF. Use XAML editing plus supported Hot Reload, Live Visual Tree and Live Property Explorer for runtime validation. Do not promise drag-and-drop designer automation. XML containment is not a runtime visual tree.

## Workflow

Inspect the active document with ide_designer_inspect. Read its hierarchy, references, supportedOperations and this catalog before changing GUI structure. State the intended containment tree and shared commands briefly. Preserve the user's existing UI/UX; do not impose a new layout or add menus to a screen that does not need them.

Use designer tools for operations the live snapshot permits. A catalog is reference knowledge, not evidence that a control is installed or an operation is supported. If creation, event wiring, collections or bindings are unsupported, use the existing approved multi-file source edit workflow, preserving generated/designer resources and code together, then reload the designer and inspect again. Do not claim source editing was a native designer operation. Reject stale or dirty snapshots and inspect again instead of forcing a write.

Verify resizing, keyboard access/tab order, accessible labels, focus, DPI scaling, enabled/checked state and the real command behavior. A build or serialized property check alone does not prove visual UX. Report which checks actually ran.

Reference catalog: ../../catalogs/winui3.json (also attached to the inspect result). This is a curated starter catalog, not a complete SDK inventory.

Official reference: https://learn.microsoft.com/en-us/windows/apps/develop/ui/xaml-runtime-design-tools

