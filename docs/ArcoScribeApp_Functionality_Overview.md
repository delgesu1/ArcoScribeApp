# ArcoScribeApp Functionality Overview

*Last updated: 2025-05-13*

---

## Core Purpose
ArcoScribeApp empowers music students and teachers to capture, transcribe, and organize lessons, making every insight searchable, shareable, and actionable.

---

## Key Features

### 1. Seamless Audio Recording & Playback
- **Native iOS audio engine** ensures robust, long-duration recording (1+ hours), even with the app backgrounded or device locked.
- **Automatic segmentation**: Long lessons are split into safe, manageable chunks, preventing data loss and improving reliability.
- **Seamless playback**: Instantly plays back multi-segment recordings as a single, continuous timeline—no audible gaps, no waiting for concatenation.
- **Scrubbing and progress tracking**: Users can jump to any point in a recording with accurate time display.
- **Mock recording mode**: For development and testing.
- **Event-driven status updates**: All recording and playback status is communicated via robust, unified event streams.
- **Resilient to interruptions**: Gracefully handles phone calls, backgrounding, and audio route changes.

### 2. Transcription & Summarization
- **Automatic transcription**: Uploads recordings to ElevenLabs Scribe Speech-to-Text API using a native background upload manager. Tasks persist and resume even if the app is killed or the phone is locked.
- **Automatic summarization**: After transcription, the transcript is sent to OpenAI's `/v1/responses` endpoint (using the `gpt-4.1` model) for a concise, structured summary focused on music pedagogy.
- **Background processing**: Both transcription and summarization use native background tasks and are resilient to network or app interruptions.
- **Status tracking**: Each recording shows clear progress—pending, processing, complete, or error.

### 3. Lesson Library & Management
- **Recording list view**: See all lessons, with status, date, and duration.
- **Transcript and summary display**: View, search, and copy the full transcript and summary for any lesson.
- **Export and sharing**: Share transcripts and summaries as Markdown or PDF. Easily send to apps like Obsidian for advanced note-taking, or share with teachers, students, or parents.
- **Metadata and file management**: All recordings and derived files are stored locally with robust metadata and safe cleanup.

### 4. Security, Privacy & Reliability
- **Local-first storage**: Audio and text data is stored on-device by default.
- **API keys**: Managed securely via environment variables.
- **Error handling**: All native and JS layers have robust error and edge-case handling.
- **Metrics**: Time-to-first-audio and other performance metrics are logged for continuous improvement.

---

## Example User Flow: Capturing and Organizing a Music Lesson

1. **Start recording** before or during your music lesson. The app captures high-quality audio, safely segmenting it in the background as needed.
2. **Stop recording** at the end of the lesson. The app instantly merges all segments for seamless playback.
3. **Tap “Transcribe”** to send your lesson to ElevenLabs. The app shows clear progress and notifies you when transcription is complete—even if you background the app or lock your phone.
4. **Automatic summarization**: As soon as the transcript is ready, it’s sent to OpenAI for a structured summary, which is then attached to your lesson.
5. **Review your lesson**: Play back the audio, read the transcript, and study the summary—all in a single, unified interface.
6. **Share or export**: Send the Markdown or PDF of your transcript/summary to:
    - **Obsidian**: Organize your lessons, link concepts, and use powerful note-taking features.
    - **NotebookLM**: (Planned) Aggregate all your summaries/transcripts in Google Drive, then use NotebookLM to chat with your entire lesson library for deep insights and study help.
7. **Teachers and students** both benefit: Teachers can review and share key points; students can revisit, search, and organize their learning journey.

---

## Technology Stack
- **Frontend**: React Native (cross-platform foundation)
- **Native iOS modules**: Objective-C (`AudioRecorderModule`, `BackgroundTransferManager`)
- **Audio**: `AVAudioSession`, `AVAudioRecorder`, in-memory composition for playback
- **Background networking**: `NSURLSession` (background config, persistent upload tasks)
- **Data storage**: Device file system for audio, Async Storage for metadata, `NSUserDefaults` for task persistence
- **Transcription API**: ElevenLabs Scribe
- **Summarization API**: OpenAI (`/v1/responses` endpoint, `gpt-4.1` model)
- **API key management**: `.env` via `react-native-dotenv`

---

## Future Features
- **Google Drive Integration**: Automatically upload transcripts and summaries to user-selected Google Drive folders for backup and cross-app access.
- **NotebookLM Integration**: Connect your Google Drive to NotebookLM and import all lesson transcripts/summaries. Use AI to:
    - Chat with your entire lesson library (e.g., "What were my teacher’s top comments on bow control this year?")
    - Extract trends, insights, and generate custom study materials or workshops.
- **Instant Review / AI Chat**: After a lesson, launch a live AI voice chat to review and quiz yourself on what you just learned. Perfect for younger students and parents—reinforce learning immediately after the lesson.
- **Android Support**: Planned for future releases.
- **Enhanced search and tagging**: Organize lessons by topic, piece, or skill.
- **Teacher dashboards**: Analytics and insights for instructors.

---

## Security, Privacy & Metrics
- All data is stored locally by default; uploads are user-initiated.
- API keys and sensitive data are never hardcoded.
- Metrics and analytics are used to improve performance and reliability, not for advertising.

---

## Lessons Learned & Philosophy
- **Reliability and user trust** are paramount—every feature is designed for real-world music lesson workflows.
- **Seamless, instant playback** is a core innovation, enabled by removing legacy code and feature flags.
- **Open, portable data**: Markdown/PDF export enables users to own and organize their learning however they wish.
- **Iterative development**: Feature flags and staged rollouts ensure safe, robust upgrades.