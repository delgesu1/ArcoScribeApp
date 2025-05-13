# Seamless Playback Migration Plan

> Goal: **Instant, gap-less playback of multi-segment recordings with a single, continuous timeline (Voice-Memos style)**.  We will switch from concatenating files on demand to building an *in-memory AVMutableComposition* for playback, while exporting a merged asset only when needed (share / upload).

## Phases & Tasks

| ✔ | Task | Layer | Owner | Notes |
|---|------|-------|-------|-------|
| [ ] 1. Add `createPlaybackItem` bridge method to **`AudioRecorderModule`** | Native (Obj-C) | iOS | Build an `AVMutableComposition`, create an `AVPlayer`/`AVPlayerItem`, store in `NSMutableDictionary<NSNumber*,AVPlayer*>`, return an integer **playerId** (NSNumber) to JS. |
| [ ] 2. Expose `play`, `pause`, `seekTo`, `destroyPlaybackItem` & playback-progress events | Native | iOS | Bridge methods that take `playerId`; send `onPlaybackProgress`/`onPlaybackEnded` via `RCTEventEmitter`. |
| [ ] 3. Update **`AudioRecordingService.playRecording`** to use new bridge | JS | JS | `const id = await AudioRecorderModule.createPlaybackItem(segmentPaths);` then control via new methods or delegate to `AudioPlayerController`. |
| [ ] 4. Refactor progress / duration handling | JS | JS | Use `player.duration` & `player.currentTime` from native events; remove segment arithmetic. |
| [ ] 5. Implement `exportCompositionToFile` (background) | Native | iOS | `AVAssetExportSession` on background queue; wrap in `beginBackgroundTask`; resolve with `outputPath`. |
| [ ] 6. Schedule export after recording finishes | JS | JS | `onRecordingFinished` → call export; update DB when promise resolves. |
| [ ] 7. Remove lazy `concatenateSegments` path from playback | JS | JS | Keep only for upload fallback until export completes. |
| [ ] 8. Update **`BackgroundTransferService`** to rely on exported file path | JS | JS | Wait until export resolves; retry if pending. |
| [ ] 9. QA: Instant playback test (<= 100 ms) | QA | QA | Multi-segment, 30-min recording on mid-tier device. |
| [ ] 10. QA: Scrub across segment boundaries | QA | QA | Ensure no glitches & correct time ruler. |
| [ ] 11. QA: Transcription & share flows | QA | QA | Verify merged file is used; no temp-file leaks. |
| [ ] 12. Metrics collection hook | JS | JS | Log time-to-first-audio after tapping Play. |

## Roll-out Strategy
1. Merge native bridge + JS path under feature flag `USE_COMPOSITION_PLAYBACK` (default *off*).  
2. Ship internal build, collect latency metrics.  
3. If stable, remove flag & delete old concat code.

## Risks / Mitigations
- **Audible gap**: using composition avoids gaps; still test sample-rate mismatches.  
- **Resource leaks**: ensure `destroyPlaybackItem` is called on stop/unmount.  
- **Export failure**: fall back to existing `concatenateSegments` for upload.

## Status
*Document created:* 2025-05-12 21:05 EDT.  
Next check-in after Task 1 implementation.
