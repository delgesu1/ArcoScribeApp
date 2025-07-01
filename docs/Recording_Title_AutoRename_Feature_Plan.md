# Recording Title Auto-Rename Feature

## Goal
Automatically replace the default recording title with a concise, one-line list of the pieces / technical topics covered **after** transcription + summary finish.

## Functional Requirements
- Uses the existing OpenAI `/v1/responses` pipeline.
- Model: `gpt-4.1-mini`.
- Title produced from the **summary** field (not the raw transcript).
- Format: ultra-concise, e.g. `Tchaikovsky Concerto, Kreutzer 23, Sevcik`.
- Guard-rails  
  - If no summary exists, keep original title.  
  - If the summary looks like a failure (`length < 40 chars` or contains phrases such as “no violin content”, “transcription failed”, etc.), keep original title.

## Technical Design
1. **Constants**
   - `TITLE_INSTRUCTIONS` (rules above).
   - `OPENAI_RESPONSES_API_URL` already exists; reuse.
   - `FAILURE_PATTERNS = [/no violin content/i, /no musical content/i, /transcription failed/i]`.

2. **BackgroundTransferService.js**
   1. `startTitleGenerationUpload(recording)` – build request body and enqueue task (`taskType: 'titleGeneration'`).
   2. Extend `setupEventListeners` to dispatch `titleGeneration` completions.
   3. `handleTitleGenerationComplete()`  
      - Parse response → `titleText`.  
      - Validate (`> 5 chars`, not matching `FAILURE_PATTERNS`).  
      - If valid → `updateRecording({ …, title: titleText, processingStatus:'complete' })`.  
      - Else → leave title untouched and just set `processingStatus:'complete'`.
   4. In `handleSummarizationComplete` call `startTitleGenerationUpload` and leave status as `'processing'` until the title finishes.

3. **Unit Tests / Manual QA**
   - Mock summary with normal content → expect renamed title.
   - Mock summary with “There is no violin content.” → expect original title retained.

## Implementation Checklist

- [ ] Add constants (`TITLE_INSTRUCTIONS`, `FAILURE_PATTERNS`).
- [ ] Add `startTitleGenerationUpload`.
- [ ] Wire new listener branch.
- [ ] Implement `handleTitleGenerationComplete` incl. validation.
- [ ] Update flow in `handleSummarizationComplete`.
- [ ] Jest tests for validation helper.
- [ ] Manual end-to-end test on device.

## Roll-out
- Ship under default-on; no UI changes needed.
- Monitor for unexpected renaming; add analytics event in a later iteration.
