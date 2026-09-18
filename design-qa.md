# Clear Blue UI: design QA

Date: 2026-09-18
Branch: `codex/clear-blue-ui`
Baseline: `f21030dce00ac0076de346b598097efc047d88df`

final result: passed (local visual implementation; production acceptance is separate)

## Reference and evidence

Approved reference: `C:/Users/sotso/.codex/generated_images/01a0aceb-124d-7503-a87b-e4d9a22c6621/exec-3057f45c-d890-47cf-aa1d-0282f2180876.png`.
The earlier two-row design was not used as the target.

Reference and final implementation are both 1491 × 1055 pixels at 1× DPR.
Route: `http://127.0.0.1:4317/teacher.html?lesson=1`; whiteboard mode, first page selected, pen settings expanded.
Both images were combined and visually reviewed, including separate full-size control crops:

- [Full comparison](output/playwright/clear-blue/reference-comparison.png)
- [Header, pen and lower toolbar detail](output/playwright/clear-blue/controls-comparison.png)
- [Final teacher board](output/playwright/clear-blue/teacher-desktop.png)
- [Teacher student list](output/playwright/clear-blue/teacher-students.png)
- [Notebook review modal and pen settings](output/playwright/clear-blue/teacher-modal.png)
- [File menu](output/playwright/clear-blue/file-menu.png)
- [Save dialog](output/playwright/clear-blue/save-dialog.png)
- [Form editor](output/playwright/clear-blue/form-editor.png)
- [Text and border color palettes](output/playwright/clear-blue/text-palette.png)
- [Student board at 320 × 568](output/playwright/clear-blue/student-mobile.png)
- [Notebook at 390 × 844](output/playwright/clear-blue/student-notebook-mobile.png)
- [Teacher login at 390 × 844](output/playwright/clear-blue/teacher-login-mobile.png)

These images are local review artifacts in the ignored `output/playwright/` directory.
The sample lesson is composed of editable app objects and differs from the reference's handwriting, timer placement and annotations. It is not a background screenshot or replacement for board functionality.

## Findings, fixes and recheck

| Priority | Finding | Fix and verification |
| --- | --- | --- |
| P1, resolved | Moving pages to their own top strip would consume additional canvas height. | Original page navigation moved inside the header. Desktop/tablet use one row; 320/390px phones wrap within that header. |
| P2, resolved | Native text color inputs expanded to a single vertical column after adding palettes. | Explicit full-width grid rows for palettes, alignment and sticky colors. Rendered text settings rechecked; blue selection updates the original input to `#0ea5e9`. |
| P2, resolved | Compact width buttons lacked the reference's stroke samples; pen popup was too high. | Added thickness samples and positioned pen/highlighter settings below their trigger, bounded by header and viewport. Final combined comparison verifies the change. |
| P2, resolved | Dynamically rendered group and previous-student icons could use a fallback glyph. | Completed icon aliases, refreshed module URLs and applied icon conversion to dynamic controls. Previous-student arrow confirmed in final modal screenshot. |
| P2, resolved | Short screens could hide camera/PDF and editing actions. | Retained every tool, internal rail scrolling, horizontal edit scrolling and reachable collapse/reopen handle; checked on phone and tablet. |

No remaining actionable P0/P1/P2 visual findings were observed in the tested surfaces.

## Required fidelity surfaces

- Typography: existing Japanese UI font stack retained. Header and button labels use consistent compact 13–15px weights; form headings have clear hierarchy. Handwriting in the reference is lesson content, so it is not substituted for app fonts. Desktop labels collapse to labeled icons on narrow screens; tooltips and accessible names remain.
- Spacing/layout: floating white panels, 14–20px radii, subtle shadows, one-row desktop header and large canvas follow the reference. Existing toolbar icons and a more compact bottom bar intentionally preserve familiar controls and canvas area. Phone page tabs wrap for usability.
- Colors/tokens: navy text, blue selection, light blue fills, white surfaces and pale borders are shared through `clear-blue.css`. Green connection status and danger treatments retain semantic roles. Existing 240-unit grid remains, with subtle 24-unit dots; ruled spacing and blank mode are unchanged.
- Image quality: existing vector UI icons stay sharp. No generated illustration, raster interface, or screenshot is used to replace interactive controls. Camera/PDF/media functionality remains in the original DOM. Lesson content, student snapshots and status text are dynamic and are not claimed to be pixel-identical to the mock.
- Copy/content: existing Japanese function labels and all control IDs/data attributes remain. Teacher whole-board clear and student selected-item delete retain their distinct meanings. No fictional actions were added from the mock.

## Functional and responsive evidence

- `npm.cmd test`: passed after the final JavaScript changes; includes syntax, Undo/Redo, deletion/synchronization contracts, media, forms, drafts and thumbnail tests. Expected missing-asset fixtures print errors while their tests pass.
- HTML comparison against the baseline: all existing IDs and data-* attributes preserved; no duplicate IDs. Teacher 212 IDs, student 129, teacher login 6, signup 5.
- Browser: drew a stroke, Undo enabled, Undo reverted it and enabled Redo, Redo restored it. Added and switched pages. Pen thickness and text color controls update their original inputs. Sidebar collapse/reopen and scroll retain access to tools.
- Browser visual review: teacher board, student board, student list, notebook review modal, notebook submission/feedback, chat, file menu/save dialog, form editor, teacher login/signup. Widths include 1491, 1280, 1024, 390 and 320px. At 320px the student board has `scrollWidth === innerWidth === 320`; signup's lower fields remain reachable by vertical scrolling at 320 × 500.
- Selected/disabled states, focus outlines and reduced-motion CSS are retained. Native custom-color inputs remain available alongside added presets.

## Verification boundaries

### 2026-09-18: independent visibility controls

Updated the status indicator to show only its green dot until hover/keyboard focus. Added a header toggle for the entire header (including pages) and bottom toolbar, retaining a restore button. The sidebar toggle now controls only the sidebar and its tool popovers.
Browser checks on both teacher and student verified all four sidebar/header visibility combinations and restoration. The student notebook header fits at 320px without horizontal document overflow. These checks use the same local fixtures as above.

The local preview replaces authentication, data APIs and realtime with fixtures. It does not prove real login, persistence, assignment distribution, camera/screen capture, or authenticated teacher/student synchronization. Screen sharing still uses the existing browser permission flow and was not started against a real device. Page rename uses the existing native prompt, which the in-app browser does not support; rename/delete confirmation completion needs a normal browser. Their original handlers are retained.

No production database, deployment, remote branch or main branch was changed. Before release, verify authenticated teacher + student workflows, camera/screen permissions, save/load and live synchronization on supported real devices.

## Implementation checklist

- [x] Shared theme loaded by entry, teacher, student, login and signup pages.
- [x] Page controls integrated into the header, with existing IDs/listeners.
- [x] Existing drawing, editing, file, communication and mode controls retained.
- [x] Preset palettes keep native custom colors and original change handlers.
- [x] Source/render comparison and representative responsive checks completed.
- [x] Automated regression suite passed.
- [ ] Production authenticated multi-device acceptance (outside this local design implementation).
