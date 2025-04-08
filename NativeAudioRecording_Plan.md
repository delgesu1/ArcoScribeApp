# Plan: Implementing Native Audio Recording Module

**Goal:** Replace the `react-native-audio-recorder-player` library with a custom native iOS module for improved reliability during long-duration background audio recording.

**Status:** In Progress

---

## Phase 1: Native Module Foundation & Basic Recording

**Objective:** Establish the core native recording functionality and integrate it into the React Native layer.

1.  **Enable Background Audio Mode (Prerequisite)**
    *   **Action:** Modify `ios/<YourApp>/Info.plist` to add `audio` to `UIBackgroundModes`.
    *   **Status:** ✅ **Complete**
    *   **Verification:** Confirmed `Info.plist` already contains the audio background mode.
    *   **Details:** Essential for any background audio task on iOS.

2.  **Define the Native Module Interface**
    *   **Action:** Specify JS functions (`startRecording`, `stopRecording`, `pauseRecording`, `resumeRecording`) and events (`onRecordingProgress`, `onRecordingError`, `onRecordingFinished`).
    *   **Status:** ✅ **Complete**
    *   **Details:** Interface will mirror existing functionality with added robustness.

3.  **Implement the iOS Native Module (Objective-C/Swift)**
    *   **Action:**
        *   Create native files (e.g., `AudioRecorderModule.h/.m` or `.swift`).
        *   Implement exported methods (`RCT_EXPORT_METHOD`).
        *   Configure and manage `AVAudioSession` (category, activation, interruptions).
        *   Manage `AVAudioRecorder` (setup, start, stop, pause, resume).
        *   Implement `AVAudioRecorderDelegate`.
        *   Set up `RCTEventEmitter` for main-thread event dispatch.
    *   **Status:** ✅ **Complete**
    *   **Details:** Created `AudioRecorderModule.h` and `AudioRecorderModule.m` files with robust implementation of audio recording using AVAudioSession and AVAudioRecorder, including segmentation, interrupt handling, and background support.

4.  **Integrate Native Module in React Native (`AudioRecordingService.js`)**
    *   **Action:**
        *   Modify `src/services/AudioRecordingService.js`.
        *   Remove `react-native-audio-recorder-player` usage.
        *   Import and use the new `AudioRecorderModule` via `NativeModules`.
        *   Subscribe to events using `NativeEventEmitter`.
    *   **Status:** ✅ **Complete**
    *   **Details:** Updated service to use native module for recording, while maintaining playback via the existing library for now.

---

## Phase 2: Enhancements & Cleanup

**Objective:** Add robustness features and remove the old library.

5.  **Implement Recording Segmentation**
    *   **Action:** Modify the native module to split recordings into time-based segments (e.g., 10-15 mins). Manage segment files and linking.
    *   **Status:** ✅ **Complete** (Included in native module)
    *   **Details:** Implemented in `startNewRecordingSegment` in the native module, with configurable `maxSegmentDuration` (default 15 min).

6.  **Optimize Background JavaScript (`RecordingScreen.js`)**
    *   **Action:** Use `AppState` API to pause/resume the UI timer `setInterval` when the app backgrounds/foregrounds.
    *   **Status:** ✅ **Complete**
    *   **Details:** Updated the RecordingScreen component to listen to app state changes and pause/resume animations appropriately. Also added a progress callback to receive updates from the native module and display segment information.

7.  **Remove Old Library**
    *   **Action:** Uninstall `react-native-audio-recorder-player` and run `pod install`.
    *   **Status:** ✅ **Complete - Partial**
    *   **Details:** Decision made: Keep the library temporarily for playback while using our native module for recording (Option A). Will revisit full removal in a future update if needed.

---

## Phase 3: Testing

**Objective:** Ensure the implementation is robust and reliable.

8.  **Thorough Testing**
    *   **Action:** Test on real devices under various conditions (long duration, background, locked screen, interruptions, low power).
    *   **Status:** ⏳ **Current Step**
    *   **Details:** Built and deployed to a real device for testing. Will conduct testing with:
        * 1+ hour recordings with app backgrounded
        * Device locked during recording
        * Interruptions (phone calls, other apps using audio)
        * Low battery conditions

---
**Progress Log:**
* 2023-11-16: Initial plan created.
* Discovered `UIBackgroundModes` already includes "audio" in Info.plist (Step 1 complete).
* Defined Native Module Interface with exported methods and events (Step 2 complete).
* Created `AudioRecorderModule.h` and `AudioRecorderModule.m` with complete implementation (Step 3 complete).
* Updated `AudioRecordingService.js` to use native module for recording (Step 4 complete).
* Updated `RecordingScreen.js` to optimize UI for background operation (Step 6 complete).
* Decided to keep the library temporarily for playback while using native module for recording (Step 7 partial).
* Built and deployed to real device for long-duration background recording testing (Step 8 in progress).