import { NativeModules, NativeEventEmitter } from 'react-native';
import { getRecordingById, updateRecording } from './AudioRecordingService'; // Ensure getRecordingById is exported/imported
// Remove unused import: import { startSummarizationProcess } from './SummarizationService'; 
import { cleanMarkdownText } from './SummarizationService'; // Import cleaner function
import { ELEVENLABS_API_KEY, OPENAI_API_KEY } from '@env';
import RNFS from 'react-native-fs'; // Import RNFS for file system operations

const { BackgroundTransferManager, AudioRecorderModule } = NativeModules;
const transferEmitter = new NativeEventEmitter(BackgroundTransferManager);

// --- Constants for OpenAI & ElevenLabs ---
// API endpoints
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/speech-to-text'; // ElevenLabs Speech-to-Text API
// Shared Responses API endpoint for both summary and title generation
const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';

// --- Title Generation Constants ---
// Instructions to produce a concise, single-line recording title from a recording summary
const TITLE_INSTRUCTIONS = `Your task: from the given violin-lesson summary, output ONE concise line that best names the pieces or technical topics covered.
Guidelines:
- Use only the shortest possible label for each piece or composer mentioned (e.g., just the composer's surname, or 'Rode 12', 'Kreutzer 23', 'Tchaikovsky').
- Do NOT include details about what was done with each piece (e.g., do not include 'fast passages', 'octaves', etc. after the piece name).
- If multiple items, separate with commas (e.g., 'Tchaikovsky, Rode 12, String Crossings').
- If no pieces are mentioned, summarize the main technical topics in a few words (e.g., 'Bow hold', 'Spiccato').
- No complete sentences, avoid filler words.`;

// Regex patterns signalling an unusable summary/title
const TITLE_FAILURE_PATTERNS = [/no violin content/i, /no musical content/i, /transcription failed/i];

// TODO: Fill in your actual summary instructions
const SUMMARY_INSTRUCTIONS = `You are a renowned expert in violin pedagogy. Your task is to transform a raw transcript of a violin lesson into a meticulously structured and detailed guide that captures every nuance of the lesson. Follow these guidelines:

- **Faithfulness to Content:**  
  - Accurately preserve all original advice, actionable steps, exercises, metaphors, and subtle nuances.
  - Integrate original quotes to enhance the instructional quality.
  - Read between the lines and try to really understand the concept that the instructor is conveying

- **Clarity and Accuracy:**  
  - Avoid being redundant or irrelevant.
  - Be careful to not falsely characterize the advice of the instructor. It's better to keep it simple rather than risk portraying things inaccurately.
  - Carefully determine any names of any pieces and composers that are mentioned. 
  - Ensure that all composer names, violin techniques, and music-related terminology are correctly spelled and standardized. 
  - Explicitly highlight specific references (e.g., "Bar 50", "1st Movement", "in the last line") to maintain clear navigation within the lesson.

- **Content Focus:**  
  - Disregard any non-musical or non-violin related text (e.g., greetings or small talk).
  - Avoid meta-references such as "In the transcript" or "According to the teacher."

- **Document Structure:**  
  - Title: Plain, clear title that states the main topic/piece which worked on
  - Body: Organize the content in a clean, logically structured format using Markdown.
    - Use Markdown heading syntax for all major sections and subsections (e.g., # for main title, ## for primary sections, ### for subsections) to provide clarity and hierarchy.
    - Do not bold specifically any of the markdown headings.
    - You may utilize bolding, italics and other formatting to enhance the organization and presentation of the content.
    - Avoid unnecessary introduction, conclusion, or summary sections unless they are musically relevant.

**Present your final output entirely within a properly formatted Markdown code block.**

# Here is the transcript:`; // Your detailed instructions

class BackgroundTransferService {
  constructor() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    transferEmitter.addListener('onTransferComplete', async (event) => {
      console.log('[DEBUG] onTransferComplete raw event:', JSON.stringify(event));
      console.log('Transfer complete:', event);
      // Note: Native module sends 'responseData', JS uses 'response'. This is consistent internally.
      const { taskId, taskType, recordingId, response } = event; 
      try {
        if (taskType === 'transcription') {
          await this.handleTranscriptionComplete(recordingId, response);
        } else if (taskType === 'summarization') {
          await this.handleSummarizationComplete(recordingId, response);
        } else if (taskType === 'titleGeneration') {
          await this.handleTitleGenerationComplete(recordingId, response);
        }
        // TODO: Implement 'clearTask' method in the native BackgroundTransferManager module
        await BackgroundTransferManager.clearTask(taskId); 
      } catch (error) {
        console.error(`Error handling ${taskType} completion:`, error);
        // Optionally update recording status to error here as well
        await this.handleTransferError(taskId, taskType, recordingId, error.message || 'Processing failed');
      }
    });

    transferEmitter.addListener('onTransferError', async (event) => {
        console.error('Transfer error event:', event);
        const { taskId, taskType, recordingId, error } = event;
        await this.handleTransferError(taskId, taskType, recordingId, error);
    });
  }

  async handleTransferError(taskId, taskType, recordingId, errorMessage) {
      try {
          console.error(`Handling error for ${taskType} task ${taskId} (Recording ${recordingId}): ${errorMessage}`);
          const recording = await getRecordingById(recordingId);
          if (recording && recording.processingStatus !== 'complete') { // Avoid overwriting completed state
              const updatedRecording = { ...recording, processingStatus: 'error' };
              await updateRecording(updatedRecording);
          }
          // TODO: Implement 'clearTask' method in the native BackgroundTransferManager module
          if (taskId) { // Only clear if taskId is available (might not be for start errors)
             await BackgroundTransferManager.clearTask(taskId); // Clear failed task from persistence 
          }
      } catch (handlerError) {
          console.error('Critical error handling transfer error:', handlerError);
      }
  }


  async startTranscriptionUpload(recording) {
    let uploadFilePath = recording.filePath; // Default to existing filePath

    try {
      // We now expect recording.filePath to already point to the merged asset (exported
      // by AudioRecordingService).  Simply mark processing and proceed.
      const processingRecording = { ...recording, processingStatus: 'processing' };
      await updateRecording(processingRecording);

      const formData = {
        model_id: "scribe_v1", 
        language_detection: true,
        timestamps_granularity: "word",
        diarize: true
      };

      const taskId = await BackgroundTransferManager.startUploadTask({ 
        filePath: uploadFilePath, // Now always the merged path
        apiUrl: ELEVENLABS_API_URL,
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY, 
          'Content-Type': 'multipart/form-data',
        },
        body: JSON.stringify(formData),
        taskType: 'transcription',
        metadata: { recordingId: recording.id }, 
      });

      console.log('Started transcription upload task:', taskId, 'for recording:', recording.id, 'using file:', uploadFilePath);
      return taskId;
    } catch (error) {
      console.error('Error starting transcription upload:', error);
      // Pass tempConcatPath to error handler for potential cleanup
      await this.handleTransferError(null, 'transcription', recording.id, `Failed to start upload: ${error.message}`);
      throw error;
    }
  }

  async startSummarizationUpload(recording) {
    if (!recording.transcript) {
        await this.handleTransferError(null, 'summarization', recording.id, 'Missing transcript');
        throw new Error('Missing transcript for summarization');
    }

    try {
      const processingRecording = { ...recording, processingStatus: 'processing' };
      await updateRecording(processingRecording);

      // Prepare request body for OpenAI Chat Completions
      const requestBody = {
        model: "gpt-4o", // User confirmed model
        instructions: SUMMARY_INSTRUCTIONS, // Use instructions field
        input: recording.transcript, // Use input field for the transcript
        temperature: 0.25, // Reinstate temperature
        store: false, // Optionally disable storage
        // max_output_tokens: 6000, // Optional, leave out for now
      };

      const taskId = await BackgroundTransferManager.startUploadTask({ 
        apiUrl: OPENAI_RESPONSES_API_URL, // Use Responses API endpoint
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`, 
          'Content-Type': 'application/json', 
        },
        body: JSON.stringify(requestBody), 
        taskType: 'summarization',
        metadata: { recordingId: recording.id }, 
        filePath: null 
      });

      console.log('Started summarization (Responses API) upload task:', taskId, 'for recording:', recording.id);
      return taskId;
    } catch (error) {
      console.error('Error starting summarization (Responses API) upload:', error);
      await this.handleTransferError(null, 'summarization', recording.id, 'Failed to start upload'); 
      throw error;
    }
  }

  async startTitleGenerationUpload(recording) {
    console.log('[DEBUG] startTitleGenerationUpload called for', recording.id, 'summary length:', (recording.summary||'').length);
    if (!recording.summary) {
      console.warn('[BackgroundTransfer] No summary – skip title generation for', recording.id);
      return null;
    }

    try {
      const processingRecording = { ...recording, processingStatus: 'processing' };
      await updateRecording(processingRecording);

      const requestBody = {
        model: 'gpt-4.1-mini',
        instructions: TITLE_INSTRUCTIONS,
        input: recording.summary,
        temperature: 0.2,
        store: false,
      };

      const taskId = await BackgroundTransferManager.startUploadTask({
        apiUrl: OPENAI_RESPONSES_API_URL,
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        taskType: 'titleGeneration',
        metadata: { recordingId: recording.id },
        filePath: null,
      });
      console.log('[DEBUG] startTitleGenerationUpload created task', taskId);

      console.log('Started title generation task:', taskId, 'for recording:', recording.id);
      return taskId;
    } catch (error) {
      console.error('Error starting title generation upload:', error);
      await this.handleTransferError(null, 'titleGeneration', recording.id, 'Failed to start upload');
      throw error;
    }
  }

  async handleTranscriptionComplete(recordingId, response) {
     try {
        console.log(`Raw transcription response for ${recordingId}:`, response);
        
        const responseData = JSON.parse(response);
        const transcript = responseData.text;

        if (transcript === undefined || transcript === null) { 
            console.error('Unexpected ElevenLabs response structure:', JSON.stringify(responseData, null, 2));
            throw new Error('No transcript found in ElevenLabs response');
        }

        const recording = await getRecordingById(recordingId); // Fetch again to ensure latest state
        if (!recording) throw new Error(`Recording ${recordingId} not found`);

        const updatedRecording = {
            ...recording,
            transcript,
            processingStatus: 'processing', 
        };
        await updateRecording(updatedRecording);
        console.log(`Transcription complete for ${recordingId}, starting summarization...`);

        await this.startSummarizationUpload(updatedRecording);
    } catch (error) {
        console.error(`Error handling transcription completion for ${recordingId}:`, error);
        await this.handleTransferError(null, 'transcription', recordingId, `Processing failed: ${error.message}`);
    }
  }

  async handleSummarizationComplete(recordingId, response) {
    try {
        const responseData = JSON.parse(response);
        console.log(`Raw summarization (Responses API) response for ${recordingId}:`, JSON.stringify(responseData, null, 2));

        // Correctly extract summary based on detailed API docs
        let summary = null;
        if (
            responseData.output && 
            Array.isArray(responseData.output) && 
            responseData.output.length > 0 &&
            responseData.output[0].type === 'message' && 
            responseData.output[0].content &&
            Array.isArray(responseData.output[0].content) &&
            responseData.output[0].content.length > 0 &&
            responseData.output[0].content[0].type === 'output_text' &&
            responseData.output[0].content[0].text
        ) {
            summary = responseData.output[0].content[0].text;
        } else {
            // Log the structure if it's unexpected
            console.error('Unexpected OpenAI Responses API structure:', JSON.stringify(responseData, null, 2));
            throw new Error('Could not extract summary text from OpenAI Responses API output structure');
        }
        
        // Ensure summary is not null or empty before proceeding
        if (!summary) {
             throw new Error('Extracted summary text is empty or null');
        }

        const recording = await getRecordingById(recordingId);
        if (!recording) throw new Error(`Recording ${recordingId} not found`);

        const updatedRecording = {
            ...recording,
            summary: cleanMarkdownText(summary),
            processingStatus: 'processing', // remain processing until title generation completes
        };
        await updateRecording(updatedRecording);
        console.log(`Summarization complete for ${recordingId}, starting title generation...`);

        await this.startTitleGenerationUpload(updatedRecording);

    } catch (error) {
        console.error(`Error handling summarization completion (Responses API) for ${recordingId}:`, error);
         // Ensure we pass taskId if available, though it's not provided here by the event
        await this.handleTransferError(null, 'summarization', recordingId, `Processing failed: ${error.message}`);
    }
  }

  async handleTitleGenerationComplete(recordingId, response) {
    console.log('[DEBUG] handleTitleGenerationComplete entered for', recordingId);
    try {
      const responseData = JSON.parse(response);
      console.log(`Raw title generation response for ${recordingId}:`, JSON.stringify(responseData, null, 2));

      const recording = await getRecordingById(recordingId);
      if (!recording) {
        console.error(`[BackgroundTransferService] Recording ${recordingId} not found in handleTitleGenerationComplete.`);
        throw new Error(`Recording ${recordingId} not found`);
      }

      // If user already modified the title, just mark as complete and don't override title
      if (recording.userModifiedTitle) {
        console.log(`[BackgroundTransferService] User has manually set title for ${recordingId}. Skipping auto-title.`);
        await updateRecording({ ...recording, processingStatus: 'complete' });
        console.log('Title generation process complete for (user-modified title kept)', recordingId);
        return; // Exit early
      }

      let titleText = null;
      if (
        responseData.output &&
        Array.isArray(responseData.output) &&
        responseData.output.length > 0 &&
        responseData.output[0].type === 'message' &&
        responseData.output[0].content &&
        Array.isArray(responseData.output[0].content) &&
        responseData.output[0].content.length > 0 &&
        responseData.output[0].content[0].type === 'output_text' &&
        responseData.output[0].content[0].text
      ) {
        titleText = responseData.output[0].content[0].text.trim();
      }
      console.log('[DEBUG] Parsed title text:', titleText);

      const invalid =
        !titleText ||
        titleText.length < 5 ||
        TITLE_FAILURE_PATTERNS.some((re) => re.test(titleText));
      console.log('[DEBUG] Title invalid?', invalid);

      if (invalid) {
        console.warn('Generated title invalid, keeping original. Title text:', titleText);
        await updateRecording({ ...recording, processingStatus: 'complete' });
      } else {
        await updateRecording({ ...recording, title: titleText, processingStatus: 'complete' });
      }

      console.log('Title generation complete for', recordingId);
    } catch (error) {
      console.error(`Error handling title generation completion for ${recordingId}:`, error);
      await this.handleTransferError(null, 'titleGeneration', recordingId, `Processing failed: ${error.message}`);
    }
  }

  // Fix: Change getActiveTransfers to getActiveTasks to match native module
  async getActiveTasks() {
    try {
      // Ensure the native module exports 'getActiveTasks'
      const activeTasks = await BackgroundTransferManager.getActiveTasks(); 
      console.log('Active background tasks:', activeTasks);
      return activeTasks; // Returns an array of task info from native side
    } catch (error) {
      console.error('Failed to get active tasks:', error);
      return []; // Return empty array on error
    }
  }
}

// Export a singleton instance so listeners are set up automatically upon import
export default new BackgroundTransferService(); 