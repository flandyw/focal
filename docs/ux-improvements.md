# Interaction improvements

This pass treats the six commits from `90fbd5d` through `2e6f0be` as protected. None of the files changed by those commits are edited. Existing storage keys, data formats, sync contracts, colours, friends features, and analytics are preserved.

The 50 changes below use the existing components and dependencies. They are code-reviewed improvements, not a claim that every interaction has been exercised on a device.

## Search — app-command-menu.tsx, exam-table.tsx, exam-library.tsx

1. Name sidebar search “Search pages and actions” so its scope is clear; disable spelling and autocorrection for command searches.
2. Escape closes sidebar search and releases input focus so it can be reopened naturally.
3. Clamp the search popup to the viewport, including when the sidebar input is wider than the available space.
4. Match exam-table search terms in any order instead of requiring one exact phrase.
5. Search logged exams by exam year and completion date, with matching guidance in the empty state.
6. Match library search terms in any order.
7. Include provider and normalized paper names in library search, including VCAA NHT.
8. Offer Clear filters beside the library filters even when some results remain.
9. Treat an empty library subject selection as All subjects instead of producing an unexplained empty list.
10. Give library completion toggles a readable paper-specific name and expose their pressed state.

## Subject selection — subject-combobox.tsx

11. Keep a selected subject visible when it is absent from the current suggestions.
12. Treat “All subjects” as a special value only in controls that actually offer that filter.
13. Explain that a typed custom subject can be used when suggestions have no match.

## Assessment breakdown — question-results-editor.tsx

14. Require an item label so a blank question cannot silently pass native form validation.
15. Require earned and maximum marks instead of treating empty numeric fields as usable entries.
16. Apply the question maximum as the earned-marks field's native upper bound.

## Linking topics — stoplight-item-picker.tsx

17. Match study subjects with the existing subject-normalization helper, so aliases do not hide matching topics.
18. Make removing a linked item explicitly a non-submit action inside assessment forms.
19. Explain the three-item limit, when all available items are already linked, and where to create missing topics instead of leaving an empty control.

## Error recovery — error-boundary.tsx

20. Show backup-export failures on the recovery screen instead of only logging them to the console.
21. Offer Try again after an application error without requiring a full reload.

## Logging past study — planning/PastStudyForm.tsx

22. Clear a stale submission error when the student edits the form.
23. Explain how to add a subject and disable saving when no subjects are available.

## Mistake JSON imports — mistake-json-import.tsx

24. Add an explicit Cancel action and protect pasted JSON on Cancel, Escape, backdrop, and close-button dismissal.
25. Preserve pasted JSON and show a recoverable error when the import callback throws.
26. Clear a completed import's JSON, preview, exam and selection so it cannot remain ready to import again.
27. Focus the JSON input when the importer opens.
28. Expose the JSON input's invalid state to assistive technology.

## Calendar imports — calendar-chatbot-import.tsx

29. Guard the async importer immediately against concurrent submissions, preserving partial-import tracking.
30. Show a selectable prompt when clipboard access fails so the workflow can continue manually.
31. Wrap long imported titles and preview rows so dates and titles remain readable on narrow screens.
32. Include the resolved subject in each imported item's preview.

## Chatbot revision — stoplight-revise.tsx

33. Resolve numbered ratings against the items in the last successfully copied prompt, even if group selection changed afterward.
34. Lock group changes and prompt replacement while a reply is entered, with instructions for starting a new round and a notice identifying the prompt's item count.
35. Protect pasted rating replies when closing or cancelling revision.
36. Keep the reply and report a save error when applying ratings throws.
37. Confirm how many items were updated after applying ratings.

## Bulk AI editing — mistake-bulk-edit-dialog.tsx

38. Guard generation immediately against concurrent runs and invalid empty requests.
39. Show “Preparing edit preview…” immediately, and clear progress from the previous run.
40. Show generation and application failures inline, preserve the preview on save failure, and avoid reporting a failed generation as “nothing to change”.
41. Rename Back to Change instruction so the recovery path explains what it does.

## Checklist imports — stoplight-import.tsx

42. Invalidate the copied indicator and reviewed preview when the subject changes, requiring review for the new subject.
43. Preserve the reply and preview when the checklist import callback throws.
44. Actually clear the reply, preview and error when confirming Discard changes.
45. Disable reviewing a checklist until a subject is provided.

## Study-session editing — study-session-dialog.tsx

46. Protect changed session details when dismissing the editor or cancelling.
47. Preserve a planned block's duration when changing its start; historical study retains independently editable timestamps.
48. Highlight the active duration preset and expose its pressed state to assistive technology.
49. Provide Keep session to back out of the armed delete action without closing the editor.
50. Stop Continue from silently ignoring unsaved session edits, and explain that they must be saved first.

## Validation

- `bun run check` (typechecking and lint)
- `bun run build` (web frontend)
- `bun run build:desktop` (desktop frontend)
- Impeccable mechanical detector over changed components
- Diff review and comparison against the file list touched by the six protected commits

No tests or dependencies added. Browser interaction checks, physical devices, live clipboard permissions, account sync, and a native Tauri build were not exercised in this pass. Past-study dismissal remains owned by the protected parent in App.tsx.
