# NoticeVault UI Design System

> Newly designed 2026-10-21 for the synthetic demo (M06/M07).
> Professional financial workspace aesthetic. System font stack — no external fonts.

---

## Color palette

| Token | Value | Usage |
|---|---|---|
| `--nv-cream` | `#F7F5F0` | Page background |
| `--nv-slate-50` | `#F8FAFC` | Card backgrounds |
| `--nv-slate-100` | `#F1F5F9` | Subtle fills, table alternates |
| `--nv-slate-200` | `#E2E8F0` | Borders, dividers |
| `--nv-slate-400` | `#94A3B8` | Muted labels, secondary text |
| `--nv-slate-600` | `#475569` | Body text, secondary headings |
| `--nv-navy-700` | `#1E3A5F` | Sidebar background |
| `--nv-navy-800` | `#162C47` | Sidebar hover, sidebar text |
| `--nv-navy-900` | `#0F1E2F` | Sidebar active, headings |
| `--nv-ink` | `#0F172A` | Primary text |
| `--nv-blue-600` | `#2563EB` | Primary action buttons, links |
| `--nv-blue-700` | `#1D4ED8` | Button hover |
| `--nv-gold-500` | `#D97706` | Notice/warning accents, NOTICE_SCHEDULED |
| `--nv-gold-100` | `#FEF3C7` | Warning chip background |
| `--nv-red-600` | `#DC2626` | Error states, ENDED_CLAIMABLE |
| `--nv-red-50` | `#FEF2F2` | Error background |
| `--nv-green-600` | `#16A34A` | Success, CLOSED |
| `--nv-green-50` | `#F0FDF4` | Success background |
| `--nv-sim-bg` | `#FEF9C3` | SIMULATION banner background |
| `--nv-sim-border` | `#FDE68A` | SIMULATION banner border |
| `--nv-sim-text` | `#92400E` | SIMULATION banner text |

## Typography

- Font family: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- Monospace: `"SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace`
- Base body: 16px/1.6, `--nv-ink`
- Headings: 700 weight, tight tracking
  - h1: 28px, h2: 22px, h3: 18px, h4: 16px
- Labels/captions: 13px, 500 weight, `--nv-slate-600`
- Monospace amounts: 15px, tabular-nums feature, right-aligned in tables
- Minimum readable size: 13px (labels only). Body ≥ 16px.

## Spacing scale (4px base)

`4 8 12 16 20 24 32 40 48 64` — use Tailwind classes (p-1 through p-16).

## Elevation

- Level 0: no shadow (page bg)
- Level 1: `shadow-sm` — cards, table rows
- Level 2: `shadow-md` — floating panels, dropdowns
- Level 3: `shadow-lg` — modals, dialogs

## Interactive elements

- Minimum touch target: 44×44px
- Focus ring: 2px solid `--nv-blue-600`, 2px offset, visible on all interactive elements
- Hover: subtle background shift (5% darkening), no color changes that lose meaning
- Disabled: 40% opacity, `cursor-not-allowed`
- Destructive actions: red button variant, requires explicit confirmation dialog

## Phase status pills

| Phase | Background | Text | Border |
|---|---|---|---|
| SCHEDULED | `slate-100` | `slate-600` | `slate-200` |
| ACTIVE | `blue-50` | `blue-700` | `blue-200` |
| NOTICE_SCHEDULED | `gold-100` | `gold-700` | `gold-300` |
| NOTICE | `orange-100` | `orange-700` | `orange-300` |
| ENDED_CLAIMABLE | `red-50` | `red-700` | `red-200` |
| CLOSED | `green-50` | `green-700` | `green-200` |

## SIMULATION badge

- Pill: `--nv-sim-bg` background, `--nv-sim-text` text, `--nv-sim-border` border.
- Text: "SIMULATION" in 11px, 700 weight, uppercase, letter-spacing 0.05em.
- Always visible on every financial value card and the sticky banner.
- Never hidden, never removed in any role or view.

## Sticky banner

Position: top of content area (below header), full width, 40px height.
Content: "⚠ Synthetic demo — no real funds or blockchain transactions"
Style: `--nv-sim-bg` background, `--nv-sim-text` text, centered, 14px, border-bottom.

## Cards

- Background: white (`#FFFFFF`)
- Border: 1px solid `--nv-slate-200`
- Border-radius: 8px
- Padding: 20px 24px
- Shadow: level 1

## Tables

- Header: `--nv-slate-50` bg, 12px uppercase labels, `--nv-slate-400` text
- Row: white bg, `--nv-slate-100` alternating
- Row hover: `--nv-blue-50` subtle tint
- Border: 1px `--nv-slate-200` rows
- Amount cells: tabular-nums, right-aligned, monospace

## Buttons

Primary: `bg-blue-600 hover:bg-blue-700 text-white` — 14px 600 weight, 8px 16px padding
Secondary: `border border-slate-200 bg-white hover:bg-slate-50 text-slate-700`
Danger: `bg-red-600 hover:bg-red-700 text-white`
Ghost: `text-blue-600 hover:underline` — for links in prose
Disabled: any variant at 40% opacity, cursor-not-allowed

## Sidebar

Width: 240px fixed (desktop). Background: `--nv-navy-700`.
Logo/name area: 56px height, white text "NoticeVault".
Nav items: 40px height, white/80 text, hover: navy-800 bg.
Active item: left 2px solid white border, navy-800 bg.
Role switcher: at bottom of nav, pill toggle CLIENT|PROVIDER.
Scenario clock display: above role switcher, monospace, white/60 text.

## Dialogs

- `<dialog>` element, `open` attribute when visible.
- Backdrop: 40% black overlay.
- Panel: white, 480px max-width, centered, 24px padding, 12px border-radius, shadow-lg.
- Focus trap: first interactive element receives focus on open.
- Escape: closes without action.
- Return on focused Confirm button: triggers confirmation.
- aria-modal="true", role="dialog", aria-labelledby pointing to dialog heading.

## Icons

Use lucide-react icons (pre-installed). Recommended:
- Home, List, Plus, Settings, CheckSquare — nav
- AlertTriangle — warning, SIMULATION badge
- ChevronRight — navigation, breadcrumbs
- Clock — scenario clock
- Download — export
- RefreshCw — reload/reset
- TrendingUp — accrual/earnings
- Shield — notice reserve
- Wallet — funding

No emoji icons. No marketing badges or testimonials.

## Accessibility

- Semantic HTML: nav, main, aside, section, h1-h4, table, thead, tbody, dialog.
- All interactive elements: role, aria-label or visible label.
- Color never the ONLY indicator (always paired with shape/text/icon).
- Tab order follows visual reading order.
- Screen reader announcements for status changes (role="status" live regions).
