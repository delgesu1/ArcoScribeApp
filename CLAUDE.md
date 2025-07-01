# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ArcoScribeApp is a **React Native application with extensive native iOS components** for recording, transcribing, and summarizing audio content (specifically music lessons). While built on React Native, the app relies heavily on custom native iOS modules written in Objective-C and Swift for critical audio functionality and background processing. The app provides a complete workflow from recording to AI-powered analysis with sharing capabilities.

## Development Commands

### Setup
```bash
# Install dependencies
npm install

# iOS CocoaPods setup (first time or after updating native deps)
cd ios && pod install && cd ..
```

### Development
```bash
# Start Metro bundler
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android

# Run tests
npm test

# Lint code
npm run lint
```

### Build Commands
```bash
# iOS build (via Xcode or command line)
# Open ios/ArcoScribeApp.xcworkspace in Xcode

# Android build
cd android && ./gradlew assembleRelease
```

## Architecture Overview

### Core Technology Stack
- **React Native 0.78.1** with React 19.0.0
- **Native iOS modules** in Objective-C (AudioRecorderModule, BackgroundTransferManager)
- **AVFoundation** for audio recording and playback
- **React Navigation v7** for navigation
- **External APIs**: ElevenLabs (transcription), OpenAI (summarization)

### Key Directories
- `src/screens/` - UI screens (HomeScreen, RecordingDetailScreen, RecordingScreen)
- `src/services/` - Business logic services
- `src/utils/` - Helper utilities and data models
- `src/components/` - Reusable UI components
- `ios/` - Native iOS modules and standard iOS project structure
- `android/` - Basic Android setup
- `docs/` - Comprehensive technical documentation

## Critical Native iOS Components

### AudioRecorderModule (Objective-C)
**Files**: `ios/AudioRecorderModule.h` and `ios/AudioRecorderModule.m` (1700+ lines)
**Purpose**: Core audio recording engine with advanced features
**Key Features**:
- **Segmented Recording**: Automatically splits recordings into 15-minute segments to avoid iOS memory limits
- **Seamless Playback**: Uses AVFoundation composition to play multi-segment recordings as continuous audio
- **Background Recording**: Continues recording when app is backgrounded or device is locked
- **Real-time Metering**: Provides audio level monitoring during recording
- **Pause/Resume**: Sophisticated pause/resume logic with proper state management
- **Event System**: Emits progress, completion, and error events to React Native
- **Audio Session Management**: Handles complex audio session configuration for recording and playback
- **Error Recovery**: Comprehensive error handling and recovery mechanisms

**Key Methods**:
- `startRecording:resolver:rejecter:` - Initiates recording with permission checks
- `stopRecording:rejecter:` - Stops recording and returns segment information
- `createPlaybackItem:resolver:rejecter:` - Creates seamless playback from segments
- `concatenateSegments:outputFilePath:resolver:rejecter:` - Merges segments into single file

### BackgroundTransferManager (Objective-C)
**Files**: `ios/BackgroundTransferManager.h` and `ios/BackgroundTransferManager.m` (800+ lines)
**Purpose**: Handles API communications with external services in background
**Key Features**:
- **Background Upload Tasks**: Uses NSURLSession background configuration for reliable uploads
- **Task Persistence**: Stores task state in NSUserDefaults for recovery after app restarts
- **Multi-part Form Data**: Supports complex multipart uploads (ElevenLabs transcription)
- **JSON Body Uploads**: Handles OpenAI API calls with JSON payloads
- **Progress Tracking**: Provides upload progress feedback
- **Error Handling**: Comprehensive error recovery and retry logic
- **Singleton Pattern**: Ensures consistent session management across app lifecycle

**Key Methods**:
- `startUploadTask:resolver:rejecter:` - Creates and starts background upload tasks
- `URLSession:task:didCompleteWithError:` - Handles task completion and cleanup
- `getActiveTasks:rejecter:` - Retrieves persisted task information

### BackgroundSessionHandlerStore (Swift)
**File**: `ios/ArcoScribeApp/AppDelegate.swift`
**Purpose**: Thread-safe storage for background session completion handlers
**Key Features**:
- **Singleton Pattern**: Ensures consistent handler management
- **Thread Safety**: Uses dispatch queue for safe concurrent access
- **Handler Storage**: Stores completion handlers for background URL sessions
- **Automatic Cleanup**: Removes handlers after use to prevent memory leaks

## Data Flow Architecture

### Recording Pipeline
1. **React Native Layer**: User initiates recording via UI (RecordingScreen)
2. **Service Layer**: AudioRecordingService calls native AudioRecorderModule
3. **Native Layer**: AudioRecorderModule handles actual recording using AVAudioRecorder
4. **Segmentation**: Audio automatically split into 15-minute segments and stored in app Documents/recordings/
5. **Progress Events**: Native module emits progress events back to React Native layer
6. **Metadata**: Recording information persisted in recordings.json

### Playback Pipeline
1. **Composition Creation**: AudioRecorderModule creates AVMutableComposition from segments
2. **Seamless Playback**: AVPlayer plays composition as continuous audio without gaps
3. **Progress Tracking**: Real-time playback progress events sent to React Native
4. **Scrubbing Support**: Accurate seeking within multi-segment recordings

### Background Processing Pipeline
1. **Upload Initiation**: React Native calls BackgroundTransferManager
2. **Task Creation**: Native module creates NSURLSessionUploadTask with background configuration
3. **Multipart Upload**: Complex form data construction for ElevenLabs API
4. **Background Execution**: Tasks continue even when app is backgrounded or killed
5. **Completion Handling**: Success/error events emitted to React Native layer
6. **Task Persistence**: Task state stored in NSUserDefaults for recovery

### API Integration Flow
1. **ElevenLabs Transcription**: Multipart form upload with audio file and metadata
2. **OpenAI Summarization**: JSON POST with transcript data
3. **Background Session Management**: Proper handling of iOS background URL session lifecycle
4. **Error Recovery**: Retry logic and task state persistence across app restarts

## Key Services

### AudioRecordingService.js
- Manages recording state and file operations
- Interfaces with native AudioRecorderModule
- Handles recording metadata and persistence
- Provides seamless playback functionality

### TranscriptionService.js
- Integrates with ElevenLabs Speech-to-Text API
- Manages upload and polling for transcription results
- Handles error recovery and retry logic

### BackgroundTransferService.js
- Wraps native BackgroundTransferManager
- Provides JavaScript interface for background uploads
- Manages task lifecycle and status updates

## Data Models

### Recording Object
```javascript
{
  id: string,
  title: string,
  filePath: string,
  date: string,
  duration: string,
  transcript: string | null,
  summary: string | null,
  processingStatus: 'pending' | 'processing' | 'complete' | 'error',
  userModifiedTitle: boolean
}
```

## File Storage Strategy

### Recording Files
- Stored in app cache directory as `rec_<id>_<timestamp>_segment<number>.m4a`
- Metadata stored in `recordings.json`
- Temporary files cleaned up after processing

### Playback System
- Uses native AVFoundation composition for seamless multi-segment playback
- No concatenation required - segments play as continuous audio
- Real-time scrubbing and progress tracking

## Important Development Notes

### Native iOS Development
- **Xcode Required**: Must have Xcode installed for iOS development
- **CocoaPods**: Run `cd ios && pod install` after any native dependency changes
- **Permissions**: App requires microphone permission (`NSMicrophoneUsageDescription`)
- **Background Modes**: Configured for `audio`, `fetch`, and `processing` in Info.plist
- **Background Tasks**: Registered for transcription and summarization in BGTaskSchedulerPermittedIdentifiers

### Audio Session Management
- **Complex Configuration**: AudioRecorderModule handles sophisticated audio session setup
- **Category Management**: Switches between `PlayAndRecord` for recording and `Playback` for playback
- **Route Handling**: Responds to audio route changes (headphones, Bluetooth, etc.)
- **Interruption Handling**: Properly handles phone calls and other audio interruptions

### Background Processing
- **NSURLSession Background Configuration**: Uses background sessions for reliable uploads
- **Task Persistence**: All tasks stored in NSUserDefaults for recovery after app termination
- **Completion Handlers**: Proper management of background session completion handlers
- **Memory Management**: Careful cleanup of temporary files and task data

### File Management
- **Segmented Storage**: Audio files stored as numbered segments (rec_ID_timestamp_segment001.m4a)
- **Temporary Files**: Background uploads create temporary files that require cleanup
- **Documents Directory**: Recordings stored in app's Documents/recordings/ folder
- **File Validation**: Checks for file existence and disk space before operations

### Event System
- **Native to JS Events**: AudioRecorderModule and BackgroundTransferManager emit events
- **Event Types**: Progress updates, completion notifications, error reporting
- **Thread Safety**: Events dispatched on appropriate queues for React Native bridge
- **Event Listening**: React Native services listen for native events to update UI

### Error Handling
- **Comprehensive Logging**: Extensive NSLog statements for debugging
- **Graceful Degradation**: Handles audio session failures, network errors, and file system issues
- **State Recovery**: Can recover from app termination during background operations
- **User Feedback**: Clear error messages propagated to React Native layer

### Testing & Debugging
- **Native Module Testing**: Requires iOS simulator or physical device
- **Background Testing**: Test background modes by putting app in background during operations
- **Audio Testing**: Test with different audio routes and interruptions
- **Network Testing**: Verify background uploads work with poor connectivity

## Common Issues & Solutions

### iOS Build Issues
- **Linking Errors**: Clean build folder in Xcode (Product → Clean Build Folder)
- **CocoaPods Issues**: Run `cd ios && rm -rf Pods && pod install` to refresh dependencies
- **Swift/Objective-C Bridge**: Ensure `ArcoScribeApp-Bridging-Header.h` is properly configured
- **Deployment Target**: Verify iOS deployment target is compatible across all dependencies

### Audio Recording Issues  
- **Permission Denied**: Check microphone permissions in iOS Settings → Privacy & Security → Microphone
- **Session Conflicts**: Ensure no other audio apps are actively using the session
- **Background Recording**: Verify `audio` background mode is enabled in Info.plist
- **Segmentation Failures**: Check available disk space before starting recordings
- **Audio Route Issues**: Test with different audio routes (speaker, headphones, Bluetooth)

### Background Processing Issues
- **Task Timeouts**: iOS limits background execution time (usually 30 seconds for normal background tasks)
- **Session Completion**: Ensure background session completion handlers are properly managed
- **Task Persistence**: Check NSUserDefaults for orphaned tasks after app crashes
- **Network Connectivity**: Background uploads may be delayed on poor connections
- **File Cleanup**: Verify temporary files are cleaned up after upload completion

### Native Module Debugging
- **Event Emission**: Check that events are dispatched on main queue for React Native bridge
- **Memory Leaks**: Use Xcode Instruments to check for retain cycles in native modules
- **Thread Safety**: Ensure shared state is properly synchronized with @synchronized blocks
- **Exception Handling**: Wrap native operations in @try/@catch blocks for better error reporting

### Development Workflow Issues
- **Module Registration**: Ensure native modules are properly exported with RCT_EXPORT_MODULE()
- **Method Exposure**: Use RCT_EXPORT_METHOD for methods called from JavaScript
- **Property Lists**: Validate NSUserDefaults data is property list compatible before storage
- **File Paths**: Always use absolute paths, never relative paths for file operations

## External Dependencies

### Critical Libraries
- `react-native-audio-recorder-player` - Audio playback
- `react-native-fs` - File system operations
- `react-native-share` - Sharing functionality
- `react-native-html-to-pdf` - PDF export
- `axios` - HTTP client for API calls

### UI Libraries
- `@react-navigation/native` - Navigation
- `react-native-vector-icons` - Icons
- `react-native-gesture-handler` - Touch handling
- `react-native-linear-gradient` - UI gradients

## Performance Considerations

### Audio Recording
- **Memory Management**: Segmented recording prevents iOS memory limitations during long recordings
- **Low Latency**: Native AVAudioRecorder implementation ensures minimal recording latency
- **Background Efficiency**: Proper audio session management allows background recording without excessive battery drain
- **Progress Updates**: Throttled progress events (every 0.5 seconds) to avoid overwhelming React Native bridge

### File Management
- **Automatic Cleanup**: Temporary files cleaned up immediately after background upload completion
- **Efficient Storage**: Audio segments stored efficiently without unnecessary duplication
- **Lazy Loading**: Recording metadata loaded separately from large audio files
- **Disk Space Monitoring**: Pre-flight checks ensure sufficient space before starting operations

### API Integration & Background Processing
- **Background Transfer**: NSURLSession background configuration ensures uploads continue when app is backgrounded
- **Task Batching**: Multiple API calls can be queued and processed efficiently
- **Memory Efficient Uploads**: Large files streamed rather than loaded entirely into memory
- **Network Resilience**: Automatic retry logic and connection failure recovery

## Native iOS Architecture Deep Dive

### AudioRecorderModule Implementation Details
- **Segmentation Logic**: Uses `maxSegmentDuration` property (default 15 minutes) to automatically transition between segments
- **Timer Management**: Main thread timer for UI updates, background queue for file operations
- **State Machine**: Complex state tracking with `SegmentStopReason` and `PauseOrigin` enums
- **Event Dispatch**: Custom serial queue for event emission to prevent React Native bridge congestion
- **Audio Session Categories**: Dynamically switches between `PlayAndRecord` and `Playback` categories
- **Composition Playback**: Uses `AVMutableComposition` for gap-free playback across multiple segments

### BackgroundTransferManager Implementation Details
- **Singleton Pattern**: Ensures consistent session management across app lifecycle
- **Task Persistence**: Complex NSUserDefaults management with property list validation
- **Multipart Form Construction**: Dynamic form data building for ElevenLabs API requirements
- **Background Session Handling**: Proper completion handler management via Swift singleton store
- **Error Recovery**: Comprehensive error categorization and appropriate retry mechanisms
- **Memory Management**: Careful cleanup of temporary files and task dictionaries

### Thread Safety and Concurrency
- **@synchronized Blocks**: Protect shared state in both native modules
- **Dispatch Queues**: Custom serial queues for event emission and audio processing
- **Main Thread Requirements**: UI updates and React Native bridge calls on main thread
- **Background Thread Operations**: File I/O and network operations on background threads

### Critical Debugging Tips
- **Xcode Console**: Native modules emit extensive NSLog statements for debugging
- **React Native Debugger**: Monitor events flowing from native to JavaScript layer
- **Instruments**: Use for memory leak detection and performance profiling
- **Background App Refresh**: Ensure enabled in iOS Settings for background upload testing
- **NSUserDefaults**: Check persisted task data with `po [[NSUserDefaults standardUserDefaults] objectForKey:@"ArcoScribeActiveTasks"]` in debugger