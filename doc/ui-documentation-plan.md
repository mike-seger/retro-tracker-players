# UI Documentation Automation Plan

## Objective
Build an automatically updatable "User Interface" documentation pipeline from runtime DOM state, using stable machine XPaths and readable human paths.

## Current State
- UI controls and information elements are spread across static HTML and dynamic runtime rendering.
- No canonical element inventory exists.
- No automatic refresh process currently updates UI documentation artifacts.

## Phase 1: Canonical Element Inventory
- Define JSON schema in `doc/elements.json`.
- Seed core controls and information elements with stable XPath entries.
- Ensure every item has `key`, `name`, `category`, `xpath`, `humanXPath`, and `notes`.

## Phase 2: Runtime URL Extractor
- Implement `scripts/extract-ui-elements.mjs`.
- Input: target URL (including deep-link query params).
- Output: regenerated `doc/elements.json` with stats and deterministic sorting.
- Prefer resilient locators: id-based XPath, then unique attributes.

## Phase 3: Quality Gates
- Add duplicate key detection.
- Add XPath uniqueness checks at extraction time.
- Validate required element coverage for critical controls.
- Keep output format stable to minimize noisy diffs.

## Phase 4: Documentation Generation
- Consume `doc/elements.json` to auto-build user-facing UI docs.
- Group sections by category and UI region.
- Include labels, purpose notes, and locator metadata.

## Phase 5: CI Integration
- Run extractor in CI against a deterministic local URL/state.
- Fail on invalid JSON, duplicate keys, or missing required elements.
- Optionally auto-commit documentation updates in dedicated workflows.

## Validation Checklist
- `node scripts/extract-ui-elements.mjs --url <target-url>` runs successfully.
- Generated JSON parses and includes schema/version metadata.
- All core controls exist: play, seek, filter, search mode, help, copy, zip.
- All core information fields exist: info, filter-count, sel-count, track-pos, time, duration.
- Share panel actions (`copy`, `twitter`, `facebook`) are discoverable.

## Future Enhancements
- Add state profiles: local mode, modland mode, help open, share open.
- Capture visibility flags and disabled/enabled state.
- Export markdown docs directly from the extractor.
- Add screenshot references tied to element keys.
- Add semantic aliases for test automation (`qaPath`).
