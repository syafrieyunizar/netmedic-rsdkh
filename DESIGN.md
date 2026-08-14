# Netmedic AI Side Panel Design System

## Context

Netmedic RSDKH is a Chrome Side Panel for clinicians and medical reviewers. The interface must feel like a compact clinical documentation dashboard: calm, legible, structured, and optimized for repeated form entry.

The supplied `Netmedic RSDKH` HTML mockup is the visual source of truth. Its desktop navigation drawer must be adapted into a compact top app bar and segmented tabs because the product runs inside a narrow Chrome Side Panel.

## Design Direction

- Mode: light only.
- Style: clinical dashboard, functional, low decoration, clear hierarchy.
- Brand: `Netmedic AI`.
- Product title: `Documentation Assistant`.
- Primary language: Indonesian.
- Input remains in a card; editable AI output opens in a dedicated full-screen result view.
- The UI must not look like a marketing page or a generic AI chat.

## Tokens

### Typography

- `font.family.primary`: Manrope
- `font.family.stack`: `Manrope, "Segoe UI", Arial, sans-serif`
- `font.weight.regular`: 400
- `font.weight.medium`: 500
- `font.weight.semibold`: 600
- `font.weight.bold`: 700
- `font.size.label`: 11.9px / 1.25
- `font.size.body-sm`: 12px / 1.5
- `font.size.body`: 14px / 1.5
- `font.size.heading`: 17.5px / 1.35
- Letter spacing must remain `0`, except uppercase kickers may use the browser default spacing.

Manrope must be bundled locally so the extension works offline and complies with MV3 CSP.

### Colors

- `color.surface`: `#f9f9f9`
- `color.surface.lowest`: `#ffffff`
- `color.surface.low`: `#f3f3f3`
- `color.surface.container`: `#eeeeee`
- `color.surface.high`: `#e8e8e8`
- `color.text.primary`: `#1a1a1a`
- `color.text.secondary`: `#43474e`
- `color.outline`: `#74777f`
- `color.outline.variant`: `#c4c6d0`
- `color.primary`: `#006874`
- `color.primary.hover`: `#005861`
- `color.on-primary`: `#ffffff`
- `color.primary.container`: `#97f0ff`
- `color.secondary.container`: `#cde7ed`
- `color.error`: `#ba1a1a`
- `color.error.container`: `#ffdad6`
- `color.info.container`: `#dae2ff`
- `color.success.container`: `#d5f6e6`

### Geometry

- Spacing must follow a 4px rhythm: `4, 8, 12, 16, 20, 24px`.
- `radius.control`: 12px
- `radius.card`: 16px
- `radius.compact`: 8px
- Segmented tabs and small badges may use `999px` radius.
- `shadow.card`: `0 1px 3px rgba(26, 26, 26, 0.08)`
- `shadow.dialog`: `0 16px 48px rgba(26, 26, 26, 0.22)`
- Interactive transitions must use `200ms ease`.

## Layout

### App Shell

1. Sticky top app bar, 64px high.
2. Product icon and title on the left.
3. A noninteractive red/green API status dot plus compact history and settings icons on the right.
4. Sticky segmented tabs with equal-width labels and a sliding active indicator immediately below the app bar.
5. Scrollable content canvas with a maximum content width of 760px.
6. Sticky 40px status bar at the bottom.

Before an anonymous patient identity is set, both feature tabs expose only one shared identity gate. After confirmation, the gate is replaced by a sticky pastel-green patient bar below the tabs. The bar shows the active anonymous identity and one compact red `x` action that opens the confirmed new-patient flow. Magic SOAP, Kronologi, drafts, and history must all use this single identity source.

The desktop navigation drawer in the reference must not be rendered inside the Side Panel. At widths below 370px, the API status label must collapse visually to its status dot while preserving its accessible name.

### Content Cards

- Each tab must have one input card. Result content must not appear below the form.
- Card background must use `color.surface.lowest` on `color.surface` canvas.
- Cards must use a 1px `color.outline.variant` border, `radius.card`, and `shadow.card`.
- Card headings must use an uppercase teal kicker, a compact heading, and a bottom divider.
- Cards must not be nested inside other cards. A compact disclosure such as “Pengingat kronologi” may be framed inside the result view.

## Components

### Segmented Tabs

- Container must use `color.surface.low`, a subtle outline, and full radius.
- Active tab must use a shared teal indicator behind white text.
- Inactive tab must use secondary text and surface-high hover.
- The indicator must slide between two symmetrical, equal-width segments using transform only.
- Arrow Left/Right must move between tabs.
- The compact Side Panel variant uses an approximately 30px segment height and equal-width labels.

### Form Fields

- Labels must always remain visible above fields.
- Inputs and textareas must use `color.surface`, 12px radius, and outline-variant border.
- Focus must use teal border plus `0 0 0 2px rgba(0, 104, 116, 0.2)`.
- Required fields must include a visible asterisk and programmatic validation message.
- Textareas must resize vertically and never cause horizontal page overflow.
- The Objective field may expose one compact clinical-photo upload action. Its preview shows the selected thumbnail, filename, removal action, provider disclosure, and never persists the image to extension storage.
- Labels, inputs, selects, and textareas must explicitly use the bundled Manrope stack so Objective and all other SOAP fields render with identical typography.

### e-Resep Automation

- The hospital-specific Resep Elektronik V2 page may expose one compact `e-Resep otomatis` action beside Racikan.
- Its native dialog uses a three-option segmented control, one free-form source field, an editable therapy summary, and repeated 8px-radius prescription item cards.
- Every item exposes product/search name, dosage form, strength/size, Qty in pcs, directions, review warning, and insertion status.
- AI generation never writes directly to eRM. `Masukkan e-Resep` remains disabled until the clinician confirms therapy suitability.
- Product lookup selects automatically only when one candidate remains after form/strength filtering. Ambiguous or missing products stop on the affected card with a recoverable inline error.
- Insertion is strictly serial. Completed cards remain locked and are skipped during retry to prevent duplicates.

### Contextual Help

- A 30x30px circular `i` action sits at the right side of each input-card heading.
- Magic SOAP and Kronologi open the same compact help dialog with tab-specific instructions.

### Buttons

- Primary commands must use teal background, white text, and an outline SVG icon.
- Secondary commands must use transparent background with outline-variant border.
- Destructive actions must use semantic red and must not share the primary visual treatment.
- All controls must have at least a 44x44px interaction target.
- Pressed state must use opacity only and must not shift layout.

### Status

- The header API dot is green when an API key/model is active and red when inactive; it has no hover or click behavior.
- Loading uses info-container, an animated dot, disabled submit button, and descriptive text.
- Success uses success-container and a green dot.
- Error uses error-container and a red dot.
- Status changes must be announced through `aria-live`.
- Color must not be the only state indicator; text and dot are both required.

### Result View

- A successful generate must immediately open a full-screen result view over the Side Panel.
- The result view enters from the right and exits to the right using transform and opacity only.
- A visible `Kembali` action returns to the unchanged form and restores focus to the trigger.
- Result reopening is handled through patient history; per-tab `Lihat hasil terakhir` actions must not be rendered.
- Reopening the extension must keep the form as the initial screen; saved results open only on user request.
- AI output must remain editable.
- Editable result textareas must grow to fit their content, hide overflow, and provide no manual resize handle.
- Each result field must have its own copy button.
- The copy button must show a temporary success state without moving nearby content.
- The `Editable` badge must use secondary-container and teal text.
- Kronologi warning and JKN rule are non-editable metadata, rendered together only when either value is present.
- JKN warnings use an error-colored alert with a warning icon and compact 12px text.
- Magic SOAP chronology metadata is non-editable and appears only when `requires_chronology` is true.
- Magic SOAP chronology reminders use a warning-colored alert with the reason and effect when present.
- The chronology reminder includes a bottom-right `Buat kronologi` action.
- `Buat kronologi` closes the result view, opens the Kronologi tab, copies `chronology_effect` into editable `Akibat/cedera`, preserves any existing scenario draft, and focuses the scenario field.

### Settings Dialog

- Use a native `<dialog>` with white surface, 16px radius, outline border, and modal shadow.
- Backdrop must use approximately 42% black plus subtle blur.
- Provider-specific fields must appear progressively.
- API key must use a show/hide icon button within the input boundary.
- Save, cancel, and delete actions must remain distinct.
- On failed validation, the existing stored configuration must remain active.
- `Sumber API` offers personal BYOK and server-side admin API modes.
- Admin mode shows the public provider/model status, then requires a registered user login before generation.
- Owner administration stays behind a `Panel admin` disclosure. Before authentication, it renders only username, password, login feedback, and `Login Panel Admin`.
- Successful owner login replaces the login form with a memory-only admin session, a `Keluar Admin` command, and exactly two tabs: `API Key` and `Pengguna`; no Knowledge interface is rendered.
- The `API Key` tab provides provider configuration, validation, save, and confirmed reset. The `Pengguna` tab provides global admin-access user management: list, create, reset password, and confirmed deletion.
- Closing Settings or choosing `Keluar Admin` clears the owner credentials and requires a fresh login.
- The admin provider key must never be returned to or stored by the extension; only the public provider label/model and `hasApiKey` state may be shown.

### API Administration

- The backend application identifier is always `netmedic-rsdkh`.
- Personal BYOK continues to call the selected provider directly and stores its key only in `chrome.storage.local`.
- Admin mode sends generation requests through the shared `knowledge-admin` Edge Function using a seven-day, device-bound user session.
- The shared endpoint is deployed without JWT gateway verification and performs its own user-session/owner checks. No Supabase anon key, provider key, owner credential, or user password may be hardcoded.
- The existing shared Edge Function is app-aware and must receive `app_id: netmedic-rsdkh` for config, login, session, generation, validate, save, and reset operations.
- A failed admin session must clear the local session and return the user to the login state.

### Patient Episodes And History

- A full-width compact pastel-green `Pasien baru` control sits directly below the segmented tabs.
- `Pasien baru` opens a compact identity dialog, clears both drafts after confirmation, and starts a new local episode.
- Successful Magic SOAP and Kronologi generations update the currently active episode.
- History is opened from the app bar and slides in from the right.
- History list labels use the format `[Identitas anonim]` and indicate which outputs are available.
- Opening an item shows both Magic SOAP and Kronologi sections, including explicit empty states when one result is not available.
- History remains stored only in `chrome.storage.local`; no history data is sent anywhere except as part of an explicit AI request.
- History expires automatically 60 days after its last update and may also be manually deleted earlier.
- Every history row has a 30x30px red outline trash action; hover uses a red background with a white icon, and deletion requires identity-specific confirmation.
- On first upgrade, an existing saved result draft is migrated once when no history exists.

## Responsive Rules

- Minimum supported width: 320px.
- Default side-panel gutter: 16px.
- At 520px and wider, gutter and card padding increase to 24px and paired metadata fields use two columns.
- At 370px and narrower, header API text collapses and action rows stack when necessary.
- No viewport may have horizontal scrolling.
- Text must wrap naturally and never be scaled from viewport width.

## Accessibility

- Target WCAG 2.2 AA.
- Normal text contrast must be at least 4.5:1.
- Focus-visible must be present on every interactive control.
- Every icon-only button must have an accessible label and tooltip.
- Labels must be explicitly associated with fields.
- Tab order must follow the visual reading order.
- Reduced-motion must disable non-essential animation.
- Disabled controls must use native `disabled` semantics.

## Content Style

- Use concise clinical Indonesian.
- Prefer concrete labels: `Generate`, `Pasien baru`, `Riwayat`, `Simpan`, `Hapus key`.
- Do not use decorative AI language, promotional copy, or ambiguous actions.
- Status text must state what happened and what the user can do next.

## Prohibited Patterns

- Dark or neon theme.
- Purple gradients, glow effects, decorative orbs, or glass cards.
- Oversized headings or marketing hero sections.
- Desktop sidebar inside the Chrome Side Panel.
- Placeholder-only form labeling.
- Read-only AI result without an editable preview.
- Copy-all behavior in the current MVP; copying remains per result field.
- New frameworks or remote runtime assets.

## QA Checklist

- [ ] Manrope loads from a local extension asset.
- [ ] Top app bar, segmented tabs, cards, dialog, and footer share the same tokens.
- [ ] Magic SOAP and Kronologi use identical component styling.
- [ ] API states are visible and announced.
- [ ] Generate is disabled while loading.
- [ ] Every result field can be copied independently.
- [ ] Keyboard tab switching and focus-visible work.
- [ ] Successful generation opens the matching full-screen result view.
- [ ] Kembali preserves form state and restores focus; Escape follows the same behavior.
- [ ] Starting a new patient clears both drafts and creates a new active episode.
- [ ] History groups Magic SOAP and Kronologi by episode identity and opens in a right-side slide.
- [ ] Layout passes at 320px, 375px, 600px, and short landscape height.
- [ ] No horizontal overflow or overlapping controls.
- [ ] Reduced-motion is respected.
