---
name: wpf-gui
description: Design or review WPF XAML layouts, routed commands, bindings and desktop interaction.
---

# WPF native GUI

Use Grid with Auto/star sizing for primary layout, DockPanel for edge bars, and StackPanel for small linear groups. A horizontal StackPanel does not distribute spare width like a Grid. Avoid a fixed Canvas for ordinary resizable forms.

Use Menu/MenuItem, ToolBar/ToolBarTray and StatusBar where the application requires them. Share ICommand or RoutedCommand instances across menus, toolbar buttons and keyboard bindings; use CanExecute for availability. Preserve MVVM boundaries, existing resources, styles, DataContext, binding expressions and namescopes. Do not replace a binding with a literal just to get a preview.

The adapter edits the IDE XAML buffer and requires designer reload; XML containment includes property elements and templates, so it is not necessarily the runtime visual tree. Inspect namespaces and nodeKind before reasoning about parents. ResourceDictionary entries and Grid.RowDefinitions are not rendered controls.

## Workflow

Inspect the active document with ide_designer_inspect. Read its hierarchy, references, supportedOperations and this catalog before changing GUI structure. State the intended containment tree and shared commands briefly. Preserve the user's existing UI/UX; do not impose a new layout or add menus to a screen that does not need them.

Use designer tools for operations the live snapshot permits. A catalog is reference knowledge, not evidence that a control is installed or an operation is supported. If creation, event wiring, collections or bindings are unsupported, use the existing approved multi-file source edit workflow, preserving generated/designer resources and code together, then reload the designer and inspect again. Do not claim source editing was a native designer operation. Reject stale or dirty snapshots and inspect again instead of forcing a write.

Verify resizing, keyboard access/tab order, accessible labels, focus, DPI scaling, enabled/checked state and the real command behavior. A build or serialized property check alone does not prove visual UX. Report which checks actually ran.

Reference catalog: ../../catalogs/wpf.json (also attached to the inspect result). This is a curated starter catalog, not a complete SDK inventory.

Official reference: https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/commanding-overview

