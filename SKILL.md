---
name: netmedic-sidepanel-ui
description: Applies the Netmedic AI light clinical dashboard system to the Netmedic RSDKH Chrome Side Panel. Use when creating, modifying, or reviewing this extension's UI and UX.
---

# Netmedic AI Side Panel UI

## Source Of Truth

Read `DESIGN.md` before changing any visible UI. The supplied Netmedic RSDKH HTML reference defines the visual direction. `DESIGN.md` defines its approved Side Panel adaptation and tokens.

## Product Context

- Product: Netmedic RSDKH.
- Surface: Chrome MV3 Side Panel.
- Audience: clinicians and medical reviewers.
- Stack: vanilla HTML, CSS, and JavaScript.
- Language: Indonesian.
- Mode: light clinical dashboard.

## Required Visual System

- Use locally bundled Manrope at weights 400–700.
- Use `#f9f9f9` canvas, white cards, teal `#006874` primary, and `#c4c6d0` borders.
- Use a 4px spacing rhythm and 12–16px radii.
- Use a sticky top app bar, sticky pill tabs with a sliding indicator, an input card, a full-screen result view, and bottom status bar.
- Keep segmented tabs compact at approximately 30px content height and provide contextual `i` help beside each form heading.
- Use outline SVG icons with consistent 2px stroke.
- Keep all interactive targets at least 44x44px.

## Implementation Rules

1. Reuse existing semantic HTML and JavaScript IDs before adding markup.
2. Use CSS variables from `sidepanel.css`; do not introduce raw colors inside component rules.
3. Apply every component treatment to both Magic SOAP and Kronologi.
4. Preserve editable AI outputs and copy-per-field behavior.
5. Preserve API configuration security and all validation states.
6. Prefer native controls and native `<dialog>`; do not add a framework or UI dependency.
7. Keep font and other runtime assets local for MV3 CSP and offline use.
8. Do not modify legacy application runtime code. A shared, idempotent database migration may be mirrored across related repositories only when the user explicitly requests it.
9. Keep `app_id: netmedic-rsdkh` on every shared backend request; never infer it from visible UI text.
10. Keep provider API keys server-side in admin mode and preserve the independent personal BYOK path.

## Component Contract

### App Shell

- The header must show Netmedic AI, Documentation Assistant, a noninteractive red/green API dot, and compact history/settings buttons.
- Desktop drawer navigation from the reference must collapse into segmented tabs.
- The content canvas must remain scrollable without horizontal overflow.
- The bottom status bar must remain visible without covering content.

### Cards

- Inputs must live in a top-level card; results must not be rendered below that card.
- Card title anatomy: teal kicker, heading, divider.
- A card must use white surface, subtle border, 16px radius, and low shadow.
- Do not place cards inside cards.

### Forms

- Every field must have a visible associated label.
- Focus must use the teal focus ring defined in `DESIGN.md`.
- Validation errors must appear in the nearest live status region.
- Provider-specific settings must use progressive disclosure.

### Actions

- Generate and Save are primary teal commands.
- Clear and Cancel are outlined secondary commands.
- Delete API key is destructive red.
- Loading must disable the initiating button and replace its label with progress text.

### API Settings

- `API key pribadi` uses the existing local provider fields and direct provider validation.
- `API admin` first checks the public `netmedic-rsdkh` config, then requires a registered admin-access user session bound to the current device.
- The header status is green only when the selected source is ready: key/model for personal mode, or server key plus valid session for admin mode.
- Owner validate/save/reset actions require main admin credentials and must send them only to the shared Edge Function.
- Reset is destructive, requires confirmation, and must leave the provider inactive until a new key is saved.
- Owner user management reuses the shared global account table and supports list, create, password reset, and confirmed deletion without persisting passwords locally.
- Never reveal owner API or user controls before `login` succeeds. The unauthenticated panel contains only username, password, login action, and inline status.
- The authenticated owner panel contains only `API Key` and `Pengguna` tabs. Do not add a Knowledge tab until that product capability is explicitly requested.

### Results

- Open the matching full-screen result view immediately after a successful generate.
- Provide a predictable Kembali action that preserves the form and restores focus.
- Do not render per-tab Lihat hasil terakhir actions; use the shared patient history slide.
- Animate forward and backward navigation with transform/opacity and respect reduced motion.
- Results must remain editable after generation.
- Editable result textareas auto-grow to their content and must not expose manual resize handles.
- Warning/JKN metadata is not an editable field; show one red conditional alert only when content exists.
- Magic SOAP chronology metadata is not an editable field; show one yellow conditional alert only when chronology is required.
- The yellow alert provides `Buat kronologi`, which transfers the chronology effect into editable Kronologi input without clearing its scenario draft.
- Copy remains per output field for this MVP.

### Patient History

- Place one compact full-width pastel-green Pasien baru action below the tabs.
- Starting a new patient asks for anonymous identity, clears both drafts, and starts a new episode.
- Persist generated SOAP and Kronologi output under the active episode in chrome.storage.local.
- Open history from an app-bar icon as a right-side slide with identity list and combined episode details.
- Retain history for at most 60 days from its last update and provide a confirmed 30x30px destructive trash action per episode.
- Copy success must be visible and announced without layout shift.

## Interaction States

Every interactive component must define:

- default
- hover
- focus-visible
- active
- disabled
- loading when applicable
- success/error when applicable

State may use color only as reinforcement. A text label, icon, dot, or disabled semantic must also communicate the state.

## Responsive Behavior

- Test at 320px, 375px, and 600px widths.
- Test short landscape height with the settings dialog open.
- Collapse the API status label below 370px while keeping its accessible name.
- Use two columns only from 520px when content remains readable.
- Stack action buttons when the available width cannot hold them safely.

## Accessibility Gates

- WCAG 2.2 AA contrast.
- Visible keyboard focus.
- Arrow-key navigation for tabs.
- Correct `aria-selected`, `aria-controls`, labels, and live regions.
- Icon-only controls must have accessible names and tooltips.
- `prefers-reduced-motion` must remove non-essential animation.
- No text clipping, control overlap, or horizontal scroll.

## Never Do

- Do not restore the previous black/green/yellow theme.
- Do not use Poppins for this interface.
- Do not import Tailwind, Material Symbols, remote fonts, or other runtime libraries.
- Do not create a desktop sidebar inside the Side Panel.
- Do not add marketing sections, decorative gradients, glass effects, or oversized hero text.
- Do not change clinical prompts while performing UI work.

## Delivery Check

Run:

```powershell
node --check sidepanel.js
node --check background.js
node sidepanel.js
```

Then verify Magic SOAP, Kronologi, settings, API validation states, copy actions, and responsive layout in Chromium before delivery.
