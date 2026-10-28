# Shell spec (draft, 2026-10-28)

The viewer's next layout, built from shell pieces that go upstream into CyberDOS.
Draft for Armen to mark up; nothing is built yet.

Source: Shapr3D help pages (Accessing tools, Adaptive user interface, Section
View, 26.50 Advanced Section View controls, Items Manager) and the Section View
GIF on support.shapr3d.com, read 2026-10-28.

## What Shapr3D actually does

- **Menus float over the canvas** on both sides. The main menu is on the left. It
  holds four groups:
  - spaces at the top (Modeling, Visualization, Drawings, Items);
  - tools in the middle (Search, Sketch, Add, Transform, Tools);
  - modes at the bottom (Section View, Measure).
  - The right rail holds view settings: snap, grid size, view, Display Modes,
    Screenshot, History.
- **Every entry is an icon tile plus a label pill.**
  - Optional shortcut chips (⇧⌘\).
  - Optional state subtitle ("Off", "On", "Edit", "Shaded").
  - Optional corner triangle when it opens a submenu.
  - Optional blue dot for "new".
- **The middle group is contextual.** Selecting something swaps it for the tools
  that fit (the "adaptive menu"), plus "More". A default tool may go live at once
  (select a body and Move/Rotate is active).
- **Modes adapt the same way.**
  - Section View on: the bottom entry reads "Section View · Edit".
  - The middle group becomes Delete Section, 2D Section View · On/Off, and
    Section Only · On/Off.
  - A **tool card** sits top centre ("Section View — Adjust section with arrows",
    with a collapse chevron).
  - When the camera leaves the cut's normal, a "Normal to Section" pill appears
    under the card.
- **Clicking empty canvas finishes most tools.** There's no Done button to hunt
  for.
- **Section gizmo, on the plane**
  - A thin dashed rotation ring for tilt.
  - A small arrow for depth.
  - A tiny angle chip while dragging ("85°").
  - A small round flip badge.
  - Nothing else.
- **Section options**
  - 2D Section View: ortho, with edges and silhouettes.
  - Section Only: hide everything but the cut.
  - Cut faces are filled in the body's colour.
- **Items Manager**
  - Type icons per item (body, sketch, plane, mesh, image, folder).
  - An "All Items" type filter.
  - Multi-select (⌘, ⇧ range).
  - An eye per item; an eye on a folder toggles its children.
  - Folders by drag and drop.
  - Right-click for Rename, Zoom to, Delete.
  - "Reveal in Items" from the canvas.
  - Image opacity as a clickable % beside the item.
  - A fixed footer with new-folder and ⋯, where ⋯ holds Show Hidden and
    Invert Visibility.
- **Command search** (⌘F) launches any tool by name. Results narrow to the
  current selection.

## CyberDOS shell pieces (upstream)

Plain DOM + CSS: `web/shell.css`, `web/shell.ts`. The shell is described as
data and rendered by a small helper. herdr-web wraps it in React and the viewer
calls it directly. It uses platform features (popover, anchor positioning,
View Transitions, dialog). No UI framework.

| piece | what it is |
| --- | --- |
| `stage` | full-bleed content layer. CRT scanlines and vignette never cover it. |
| `slot` | left or right edge; holds a stack of panels, splits into sub-slots with a drag divider |
| `panel` | header (title, filter dropdown, actions) · scrolling body · pinned footer; collapses to its header |
| `rail` | vertical column of `entry`s in groups anchored top / middle / bottom |
| `entry` | icon tile + label pill + shortcut chips + state subtitle + submenu mark |
| `context group` | a rail group whose contents swap with the selection or mode, with a View Transition morph |
| `tray` | flyout from an entry (popover, anchored) for a tool's options |
| `card` | top-centre tool card: tool name, one-line hint, collapse chevron, follow-up pills |
| `hud` | small readout anchored to a point on the stage (selection size, angle chip) |
| `tree` | item rows: type icon, name, eye, dimmed when hidden, folders, multi-select |
| `palette` | command search dialog |

Rules this layer adds to the skin, as tests:
- **Text floor:** nothing used as text below 4.5:1 against its surface (3:1 for
  large labels). `--muted` is never a text colour.
- **Size floor:** no text below 12px × `--fs`.
- **Labels:** labels and the subtitles under labels use the body face, not
  the HUD mono, so they stay readable at small sizes.
- **Decoration:** CRT, glow and rain belong to chrome (rails, panels, trays),
  never to `stage`.

The cyberpunk part lives in the rail and tray:
- angled tiles;
- a neon rail line joining a group;
- the label pill sliding out of the tile;
- a short scan sweep when a group morphs.

## Viewer on the shell

- **Left rail, top (spaces):** View · Annotate · Trace · Items.
- **Left rail, middle (context group):**
  - nothing selected: Search, Box, Ghost, Refs;
  - a part selected: Isolate, Hide, Zoom to, Show code, Size;
  - in Annotate: Pen, Arrow, Label, Points (this replaces the top strip);
  - in Section: Flip, Look at cut, Re-plane, 2D section, Section only,
    Delete section.
- **Left rail, bottom (modes):** Section · Off/Edit, Measure.
- **Right rail:** view cube (small, at the top) · grid size readout · Display ·
  Shaded/Edges · Ortho/Persp · Fit · Screenshot · Settings (skin, text size).
- **Left slot: Items panel.**
  - Parts, refs, notes and overlays as item types; groups as folders.
  - Eye per item and folder; search; sort; "All items" type filter.
  - Footer: counts · ⋯ (show hidden, invert).
  - A ref image shows its overlay opacity as a % chip.
- **Right slot: Parameters panel.**
  - Sections fold; filter at the top; "selection only".
  - Footer: Apply · Reset · dirty count.
  - Log is a collapsed sub-slot under it.
- **Stage HUD:** selection size W × D × H, volume and triangle count, anchored by
  the selection's box.
- **Card:** the active tool's name and hint ("Section — drag the arrow, turn the
  ring"), plus "Normal to section" when the camera is off-axis.
- **Model picker:** the title becomes a breadcrumb (`gi_joe / whale / shroud ▾`)
  that opens a searchable dialog. It replaces the `#switch` combo.
- **Section gizmo, Shapr-minimal:**
  - a dashed ring for tilt;
  - an arrow for depth;
  - an angle/mm chip while dragging;
  - a flip badge.
  - Cut faces filled per part colour.

## Open

- Native: is the shell web-only, or does Capra get counterparts?
- Grid: dark, fine, fading, adaptive spacing, readout on the right rail
  (Shapr's dark mode shows the target). Separate pass after the shell.
- Order: CyberDOS shell + tests → static mockup page for visual calls → viewer
  rebuild → grid → section.
