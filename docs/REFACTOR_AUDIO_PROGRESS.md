# Audio Segmentation Refactor Progress

This document tracks the progress of refactoring the audio recording segmentation logic in the ArcoScribeApp.

**Branch:** `refactor/audio-segmentation-avduration`
**Base Branch:** `post-gdrive-removal`

## Overall Goal
Replace the `NSTimer`-based segmentation with `AVAudioRecorder`'s `recordForDuration:` method and handle segment transitions in the `audioRecorderDidFinishRecording:successfully:` delegate method for more precise and reliable audio segmenting.

## Phase 1: Core `recordForDuration` Implementation (Single Segment Focus)

**Objective:** Get `recordForDuration:` to control a single segment's length. Ensure progress updates and manual stop logic are functional. Recording will stop after one timed segment.

**Tasks:**

1.  **Modify `AudioRecorderModule.h`**
    *   [X] Add internal instance variable `BOOL _isManuallyStopping;` (or private property).
        *   *Note: Superseded by `SegmentStopReason currentStopReason;` enum in Phase 1.5.* 
    *   [X] Add internal instance variable `NSTimeInterval totalDurationOfCompletedSegmentsSoFar;` (or private property).
        *   *Note: Implemented as `@property (atomic, assign) NSTimeInterval totalDurationOfCompletedSegmentsSoFar;` in Phase 1.5.*
    *   Status: `Complete`
    *   Notes: `recordingTimer` property remains for now to drive `onRecordingProgress`.

2.  **Modify `AudioRecorderModule.m` - `startRecordingInternal` method**
    *   [X] Change `[self.audioRecorder record];` to `[self.audioRecorder recordForDuration:self.maxSegmentDuration];`.
    *   [X] Initialize `self.totalDurationOfCompletedSegmentsSoFar = 0;`.
    *   [X] `currentSegmentNumber` initialized to `1`.
        *   *Note: `currentSegmentNumber` instance variable removed in Phase 1.5; segment number is now derived dynamically.*
    *   [X] Call to `[self startRecordingTimer];` remains.
    *   Status: `Complete`

3.  **Modify `AudioRecorderModule.m` - `updateRecordingProgress` method**
    *   [X] Remove logic for checking segment duration and calling `startNewRecordingSegment`.
    *   [X] Calculate `currentTime` for `onRecordingProgress` event as: `self.totalDurationOfCompletedSegmentsSoFar + self.audioRecorder.currentTime`.
    *   Status: `Complete`
    *   Notes: Successfully updated to use new time calculation and removed old segmentation polling.

4.  **Modify `AudioRecorderModule.m` - `audioRecorderDidFinishRecording:successfully:` method**
    *   [X] Implement logic to differentiate between timed completion and manual stop using `_isManuallyStopping` flag.
    *   [X] If timed completion (and `flag == YES`):
        *   [X] Log completion.
        *   [X] Add segment path to `self.recordingSegments`.
        *   [X] Update `self.totalDurationOfCompletedSegmentsSoFar`.
        *   [X] Emit `onRecordingSegmentComplete`.
        *   [X] **Phase 1 Specific**: Stop recording (stop timer, emit `onRecordingFinished`, deactivate session, clean up relevant state like `self.audioRecorder = nil;`).
    *   [X] If manual stop (and `flag == YES`):
        *   [X] Log manual stop.
        *   [X] Add final segment path to `self.recordingSegments`.
        *   [X] Update `self.totalDurationOfCompletedSegmentsSoFar` with `recorder.currentTime`.
        *   [X] Emit `onRecordingSegmentComplete` for this final segment.
        *   [X] Reset `_isManuallyStopping = NO;`.
        *   [X] Return (let `stopRecordingInternal` handle further cleanup).
    *   [X] If `flag == NO` (recording failed):
        *   [X] Handle error (emit `onRecordingError`, stop timer, clean up state).
    *   Status: `Complete`
    *   Notes: Implemented core logic for handling timed segment end (stops after one segment for Phase 1) and manual stops, delegating final cleanup for manual stops back to `stopRecordingInternal`.

5.  **Modify `AudioRecorderModule.m` - `stopRecordingInternal` method**
    *   [X] Set `self._isManuallyStopping = YES;` before `[self.audioRecorder stop];`.
    *   [X] Ensure `[self.audioRecorder stop];` is called.
    *   [X] After `[self.audioRecorder stop];` returns:
        *   [X] Call `[self stopRecordingTimer];`.
        *   [X] Collect final recording data (filePath from last segment, duration from `totalDurationOfCompletedSegmentsSoFar`, `segmentPaths` from `recordingSegments`).
        *   [X] Emit `onRecordingFinished`.
        *   [X] Deactivate audio session.
        *   [X] Fully reset relevant state variables.
    *   Status: `Complete`
    *   Notes: Successfully updated to set manual stop flag, finalize recording data using new state variables, and ensure comprehensive state reset.

---

### Phase 1 Summary

**Status: `Complete`**

Phase 1 aimed to lay the groundwork for the new segmentation logic using `recordForDuration:`. Key changes include:
- Modified `startRecordingInternal` to use `recordForDuration:`. 
- Introduced `_isManuallyStopping` and `totalDurationOfCompletedSegmentsSoFar` for state management.
- Adapted `updateRecordingProgress` to calculate progress based on `totalDurationOfCompletedSegmentsSoFar` and current segment time.
- Overhauled `audioRecorderDidFinishRecording` to differentiate between timed segment completion and manual stops. For Phase 1, a timed completion results in the entire recording stopping after one segment.
- Refined `stopRecordingInternal` to correctly set the manual stop flag and use the new state variables for finalizing recording data and resetting state.

The module should now record a single segment of `maxSegmentDuration` and then stop, or stop earlier if manually requested. All events (`onRecordingProgress`, `onRecordingSegmentComplete`, `onRecordingFinished`, `onRecordingError`) should still be emitted with appropriately updated data.

**Next Steps:** Thoroughly test the Phase 1 implementation.

---

### Phase 1.5: Incorporating High-Priority Best Practices

**Objective:** Enhance the robustness and maintainability of the Phase 1 implementation by incorporating key best-practice recommendations.

**Tasks:**

1.  **Adopt `SegmentStopReason` Enum for State Management**
    *   [X] Define `SegmentStopReason` enum (`Timed`, `Manual`, `Failed`, `Interrupted`, `None`).
    *   [X] Replace `BOOL _isManuallyStopping` with `currentStopReason` property (using the enum).
    *   [X] Update logic in `init`, `startRecordingInternal`, `stopRecordingInternal`, and `audioRecorderDidFinishRecording:successfully:` to use and manage this enum state.
    *   Status: `Complete`
    *   Notes: Successfully implemented the enum. Currently, `SegmentStopReasonInterrupted` will lead to the recording stopping after the current segment finishes (Phase 1 behavior), which is acceptable for now. Further refinement for continuous recording post-interruption will be in Phase 2/3.

2.  **Make `totalDurationOfCompletedSegmentsSoFar` Atomic**
    *   [X] Change `@property (nonatomic, assign)` to `@property (atomic, assign)` for `totalDurationOfCompletedSegmentsSoFar` in `AudioRecorderModule.m`'s class extension for thread-safety.
    *   Status: `Complete`

3.  **Derive Segment Number Dynamically**
    *   [X] Remove the `currentSegmentNumber` instance variable.
    *   [X] Calculate segment numbers as needed (e.g., `self.recordingSegments.count + 1` for new/current segments, `self.recordingSegments.count` for just-completed ones).
    *   [X] Update `startRecordingInternal`, `updateRecordingProgress`, `audioRecorderDidFinishRecording`, and `generateRecordingFilePath` calls accordingly.
    *   Status: `Complete`

4.  **Use ISO-8601 Timestamps in Filenames**
    *   [X] Modify `getFilepathForRecordingId:segmentNumber:` to include an ISO-8601 timestamp (e.g., `rec_<recordingID>_<YYYYMMDDTHHMMSSZ>_segment<segmentNumber%03lu>.m4a`).
    *   [X] Ensure timestamp is in UTC.
    *   Status: `Complete`

## Phase 2: Implement Continuous Segmentation via Delegate (No Timer)
**Goal:** Shift from timer-based segmentation to delegate-driven segmentation using `audioRecorderDidFinishRecording:successfully:`. This phase aims for seamless segment transitions managed by the `AVAudioRecorder` itself, allowing for continuous recording across multiple segments until explicitly stopped or an error occurs.

**Tasks:**

1.  **Enhance `audioRecorderDidFinishRecording:successfully:` for Continuous Segmentation:**
    *   [X] If `flag == YES` and `self.currentStopReason` is `SegmentStopReasonNone` (indicating a timed completion of a segment from `recordForDuration:`):
        *   [X] Finalize the just-completed segment: add path to `recordingSegments`, update `totalDurationOfCompletedSegmentsSoFar`, emit `onRecordingSegmentComplete`.
        *   [X] Generate a new file path for the *next* segment (e.g., using `self.recordingSegments.count + 1`).
        *   [X] Update `self.currentRecordingFilePath`.
        *   [X] Re-initialize `self.audioRecorder` with the new path and settings (crucially, nil out old recorder first).
        *   [X] Start the new segment using `[self.audioRecorder recordForDuration:self.maxSegmentDuration];`.
        *   [X] If starting the new segment fails (e.g., `recordForDuration:` returns `NO`):
            *   [X] Set `self.currentStopReason = SegmentStopReasonFailed;`.
            *   [X] Log the critical error.
            *   [X] Perform full stop/cleanup (stop timer, emit `onRecordingFinished` with error status, deactivate session, reset state) using a helper like `handleCriticalRecordingErrorAndStop:`.
    *   [X] Ensure that if `self.currentStopReason` is `SegmentStopReasonManual`, `SegmentStopReasonFailed` (from `flag == NO`), or `SegmentStopReasonInterrupted`, the recording session still stops (as implemented in Phase 1/1.5), rather than attempting to start a new segment.
    *   Status: `Complete`

2.  **Remove Obsolete Segmentation Logic:**
    *   [X] Remove the `startNewRecordingSegment` method.
    *   [X] Verify `recordingTimer` is solely used for progress updates and no longer involved in triggering segmentation logic (old call from `updateRecordingProgress` was already commented out).
    *   Status: `Complete`

3.  **Review and Refine State Initialization and Reset:**
    *   [X] Ensure `startRecordingInternal` correctly initializes `currentStopReason` to `SegmentStopReasonTimed` (or `SegmentStopReasonNone`), which will enable continuous segmentation when the first segment finishes by time.
    *   [X] Verify that full cleanup (timer, audio session, state variables) only occurs when the entire recording session definitively ends (manual stop, critical error, interruption), not between successful segment transitions.
    *   Status: `Complete`

## Phase 3: Robustness and Advanced Error Handling
**Goal:** Make the recording module more resilient by handling system events, permissions, and resource constraints gracefully.

**Tasks:**

1.  **Handle App Backgrounding & Foregrounding**
    *   [X] Implemented `PauseOrigin` enum (including `PauseOriginBackground`).
    *   [X] `handleAppDidEnterBackground:`: Pauses recording, sets origin to Background. Does not start new segment if pause is due to backgrounding. Manages background tasks for segment finalization.
    *   [X] `handleAppWillEnterForeground:`: If paused due to backgrounding, resumes recording by starting a new segment and resets pause origin.
    *   [X] `audioRecorderDidFinishRecording:successfully:` updated not to start new segment if recording finished due to backgrounding.
    *   [X] Manual `pauseRecording`/`resumeRecording` methods updated to use `PauseOriginUser` and interact correctly.
    *   Status: `Complete`

2.  **Handle Audio Session Interruptions (e.g., Phone Calls)**
    *   [X] Added `PauseOriginInterruption` to `PauseOrigin` enum.
    *   [X] `handleAudioSessionInterruption:`:
        *   On `AVAudioSessionInterruptionTypeBegan`: If recording, sets `currentPauseOrigin = PauseOriginInterruption`, pauses recorder, stops timer, emits `paused-by-interruption`.
        *   On `AVAudioSessionInterruptionTypeEnded`: If `currentPauseOrigin == PauseOriginInterruption` and system suggests resume, re-activates audio session, resumes recording, resets `currentPauseOrigin`, restarts timer, emits `resumed-from-interruption`.
    *   Status: `Complete`

3.  **Implement Permissions Handling (Microphone)**
    *   [X] Added private helper `_proceedWithRecordingAfterPermissionCheck`.
    *   [X] `startRecording` method now checks `AVAudioSession.recordPermission`:
        *   `Granted`: Calls helper to proceed.
        *   `Denied`: Rejects promise (`E_PERMISSION_DENIED`).
        *   `Undetermined`: Calls `requestRecordPermission`. On grant, calls helper; on denial, rejects promise. Callback dispatched to main queue.
    *   Status: `Complete`

4.  **Implement Disk Space Management**
    *   [X] Added `hasSufficientDiskSpaceForRecording` helper (checks against 100MB threshold).
    *   [X] Integrated check in `_proceedWithRecordingAfterPermissionCheck`: Rejects `startRecording` promise with `E_DISK_SPACE_LOW` if space is insufficient.
    *   [X] Integrated check in `audioRecorderDidFinishRecording:successfully:` (before starting new timed segment): Calls `handleCriticalRecordingErrorAndStop` if space is insufficient.
    *   Status: `Complete`

5.  **Stress Test Rapid Operations (Start/Stop/Pause/Resume)**
    *   Objective: Ensure stability under rapid, successive calls to control functions.
    *   Key Scenarios: Rapid Start/Stop; Start/Pause/Resume/Stop; Start/Pause/Stop; Overlapping calls; Interactions with backgrounding.
    *   Focus Areas: State consistency, event accuracy, file system integrity, timer behavior, promise handling.
    *   Status: `Pending` (To be performed by USER)

## Phase 4: Code Cleanup and Final Review

**Objective:** Clean up logs, comments, and perform a final code review.

**Tasks:**
*   [ ] (Details to be added after Phase 3 completion)
