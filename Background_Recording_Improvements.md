# Background Audio Recording Improvements

## Overview

This document outlines the improvements made to ArcoScribeApp's audio recording capabilities, specifically enhancing its reliability during long-duration recordings (1+ hours) while the app is backgrounded or the device is locked.

## Problem Statement

The previous implementation using `react-native-audio-recorder-player` had limitations with long-duration background recordings:

1. Recordings would sometimes stop when the app was backgrounded for extended periods
2. No segmentation of recordings, leading to potential data loss if the recording process was interrupted
3. Insufficient `AVAudioSession` management for persistent background operation
4. Unnecessary JavaScript execution in the background, potentially impacting battery life and stability

## Solution Implemented

A comprehensive native implementation focusing on robust background operation:

### 1. Custom Native Module

We replaced the React Native library's recording functionality with a custom native module (`AudioRecorderModule`) that directly leverages iOS's audio APIs:

- Direct control of `AVAudioSession` with proper configuration
- Explicit management of `AVAudioRecorder`
- More robust error handling and session management

```objective-c
// Key AVAudioSession Configuration
[session setCategory:AVAudioSessionCategoryPlayAndRecord
         withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker |
                     AVAudioSessionCategoryOptionAllowBluetooth |
                     AVAudioSessionCategoryOptionMixWithOthers
               error:&error];
               
// Critical for background operation
[session setActive:YES error:&error];
```

### 2. Automatic Recording Segmentation

Implemented automatic segmentation of long recordings into smaller chunks (default: 15-minute segments):

- Reduces the risk of data loss if the app terminates unexpectedly
- Each segment is properly finalized before starting a new one
- Segments are tracked and logically linked in the app

```objective-c
// Automatically starts a new segment when needed
if (currentTime >= self.maxSegmentDuration) {
    [self startNewRecordingSegment];
}
```

### 3. Comprehensive Event Handling

Added proper handling of system events and interruptions:

- Audio session interruptions (e.g., phone calls)
- Route changes (e.g., connecting/disconnecting headphones)
- App lifecycle events (backgrounding/foregrounding)

```objective-c
// Handle interruptions like phone calls
- (void)handleAudioSessionInterruption:(NSNotification *)notification {
    NSInteger type = [notification.userInfo[AVAudioSessionInterruptionTypeKey] integerValue];
    
    if (type == AVAudioSessionInterruptionTypeBegan) {
        // Auto-pause recording
        [self pauseRecordingInternal];
    } else if (type == AVAudioSessionInterruptionTypeEnded) {
        // Check if we should resume
        NSInteger options = [notification.userInfo[AVAudioSessionInterruptionOptionKey] integerValue];
        BOOL shouldResume = (options & AVAudioSessionInterruptionOptionShouldResume) != 0;
        
        if (shouldResume && self.isPaused) {
            // Auto-resume recording
            [self resumeRecordingInternal];
        }
    }
}
```

### 4. Optimized JavaScript for Background Operation

Updated the React Native layer to be more efficient when backgrounded:

- Used `AppState` to pause UI animations and non-essential timers when backgrounded
- Leveraged events from the native module instead of JavaScript timers for progress updates
- Proper cleanup of event listeners and resources

```javascript
// Handle app state changes in RecordingScreen.js
const handleAppStateChange = (currentState, nextState) => {
  if (nextState === 'active') {
    // App came to foreground - restart UI animations
    startWaveformAnimation();
  } else if (nextState === 'background') {
    // App went to background - pause UI animations to save resources
    stopWaveformAnimation();
    // Note: The actual recording continues in the native module
  }
};
```

## Architecture Overview

The new implementation uses a layered approach:

1. **Native Layer:** `AudioRecorderModule` (iOS) handles the actual recording process, audio session management, and segmentation
2. **Service Layer:** `AudioRecordingService.js` provides a JavaScript API for React components to interact with the native module
3. **UI Layer:** `RecordingScreen.js` optimizes UI updates based on app state

## Testing

The implementation has been tested under the following conditions:

- Long-duration (1+ hour) recordings with app backgrounded
- Device locked during recording
- Various interruptions (phone calls, other audio apps)
- Low battery conditions

## Future Improvements

Potential future enhancements:

1. Extend native module to handle playback (currently still using the library for this)
2. Add configurable options for compression and audio quality
3. Implement file repair mechanisms for corrupted recordings
4. Add background upload functionality to automatically process segments
