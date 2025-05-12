# ArcoScribeApp Functionality Overview

## Core Purpose

ArcoScribeApp is designed to assist violin students and teachers by recording lessons, automatically transcribing the audio, and generating concise summaries of the key instructional points.

## Key Features & Workflow

1.  **Audio Recording**:
    *   Users can record audio directly within the app using the device microphone.
    *   Recordings are saved locally to the device's storage.
    *   Basic metadata (date, duration, etc.) is stored alongside the audio file.

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

A core feature is the robust background processing pipeline:

*   **iOS Background Transfers**: Leverages `NSURLSession` with background configurations, allowing network tasks (uploads to ElevenLabs and OpenAI) to continue reliably even when the app is not in the foreground or the device is asleep.
*   **Task Persistence**: Uses `NSUserDefaults` to store information about active background tasks. This allows the app to recover and manage tasks even after being terminated or relaunched.
*   **Event Handling**: Native iOS code communicates back to React Native via `NativeEventEmitter`, ensuring events are dispatched on the main thread for UI updates and further actions (like triggering summarization).
*   **Reliability**: Implemented thread safety (`@synchronized`) and data validation (`NSPropertyListSerialization`) for `NSUserDefaults` access to prevent crashes and data corruption.

## Technology Stack

*   **Frontend**: React Native
*   **Native Modules (iOS)**: Objective-C (for `BackgroundTransferManager`)
*   **Background Networking (iOS)**: `NSURLSession` (background configuration)
*   **Local Data Storage**: Async Storage (or similar for recording metadata/status), device file system (for audio files).
*   **Task Persistence (iOS)**: `NSUserDefaults`
*   **Transcription API**: ElevenLabs Scribe Speech-to-text
*   **Summarization API**: OpenAI (Chat Completions)
*   **API Key Management**: `react-native-dotenv` (using `.env` file) 