# ArcoScribeApp Functionality Overview

## Core Purpose

ArcoScribeApp is designed to assist violin students and teachers by recording lessons, automatically transcribing the audio, and generating concise summaries of the key instructional points.

## Key Features & Workflow

1.  **Audio Recording**:
    *   The app features a custom native iOS module (`AudioRecorderModule`) for robust and reliable audio recording.
    *   Supports long-duration recordings (e.g., 1+ hours), even when the app is backgrounded or the device is locked. This is achieved by leveraging iOS's "audio" background mode and direct `AVAudioSession` management.
    *   Automatically segments long recordings into manageable chunks (e.g., 15-minute configurable duration) to prevent data loss and improve stability. Each segment is properly finalized before a new one begins.
    *   Gracefully handles system events such as audio session interruptions (e.g., phone calls), app backgrounding/foregrounding, and route changes.
    *   Manages microphone permissions and checks for sufficient disk space before and during the recording process to prevent errors.
    *   Recordings are saved locally to the device's storage with detailed metadata, including paths to individual segments.

2.  **Transcription Process**:
    *   Users can initiate transcription for a selected recording.
    *   The app utilizes a custom native iOS module (`BackgroundTransferManager`) built with Objective-C to handle the upload process reliably in the background.
    *   An `NSURLSessionUploadTask` configured for background execution uploads the audio file to the **ElevenLabs Speech-to-Text API**.
    *   The task continues even if the app is backgrounded, the phone is locked, or the app is terminated by the system.
    *   Task status and necessary metadata (like `recordingId`) are persisted using `NSUserDefaults` (with robust error handling and thread safety).
    *   Upon successful transcription, the native module sends an event back to the React Native layer.

3.  **Summarization Process**:
    *   Triggered automatically after a successful transcription.
    *   The received transcript is sent to the **OpenAI Chat Completions API (gpt-4o model)** using the same background transfer mechanism (`BackgroundTransferManager` and `NSURLSessionUploadTask`).
    *   Specific instructions (a system prompt) guide the AI to generate a structured, relevant summary focused on violin pedagogy.
    *   This task also runs reliably in the background.
    *   Upon completion, the summary is received, cleaned (basic markdown cleanup), and stored locally with the corresponding recording.

4.  **Display & Management**:
    *   Users can view a list of their recordings.
    *   For processed recordings, users can view the generated transcript and summary.
    *   The app displays the processing status (pending, processing, complete, error) for each recording.

## Background Processing Capabilities

A core feature is the robust background processing pipeline, encompassing both audio capture and data uploads:

*   **Background Audio Recording**:
    *   The `AudioRecorderModule` ensures continuous audio capture when the app is backgrounded. It achieves this by correctly configuring and managing the `AVAudioSession` with the "audio" background mode, which signals to iOS that the app is actively using audio input.
    *   This mechanism is designed for persistent audio capture and is distinct from the background task execution used for network operations.

*   **Background Network Transfers (Uploads)**:
    *   Leverages `NSURLSession` with background configurations via the `BackgroundTransferManager` module. This allows network tasks (uploads of audio files to ElevenLabs for transcription and transcripts to OpenAI for summarization) to continue reliably even when the app is not in the foreground or the device is asleep.
    *   **Task Persistence**: Uses `NSUserDefaults` to store information about active background upload tasks. This allows the app to recover and manage these tasks even after being terminated or relaunched.
    *   **Event Handling**: Native iOS code for `BackgroundTransferManager` communicates back to React Native via `NativeEventEmitter`, ensuring events are dispatched on the main thread for UI updates and further actions (like triggering summarization).
    *   **Reliability**: Implemented thread safety (`@synchronized`) and data validation (`NSPropertyListSerialization`) for `NSUserDefaults` access related to upload tasks to prevent crashes and data corruption.

## Technology Stack

*   **Frontend**: React Native
*   **Native Modules (iOS)**: Objective-C (for `AudioRecorderModule` and `BackgroundTransferManager`)
*   **Audio Recording (iOS Native)**: `AVAudioSession`, `AVAudioRecorder` (managed by `AudioRecorderModule`)
*   **Background Networking (iOS for Uploads)**: `NSURLSession` (background configuration, managed by `BackgroundTransferManager`)
*   **Local Data Storage**: Async Storage (or similar for recording metadata/status), device file system (for audio files).
*   **Task Persistence (iOS)**: `NSUserDefaults`
*   **Transcription API**: ElevenLabs Scribe Speech-to-text
*   **Summarization API**: OpenAI (Chat Completions)
*   **API Key Management**: `react-native-dotenv` (using `.env` file) 