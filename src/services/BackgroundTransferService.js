import { NativeModules, NativeEventEmitter } from 'react-native';
import { getRecordingById, updateRecording } from './AudioRecordingService'; // Ensure getRecordingById is exported/imported
// Remove unused import: import { startSummarizationProcess } from './SummarizationService'; 
import { cleanMarkdownText } from './SummarizationService'; // Import cleaner function
import { ELEVENLABS_API_KEY, OPENAI_API_KEY } from '@env';

const { BackgroundTransferManager } = NativeModules;
const transferEmitter = new NativeEventEmitter(BackgroundTransferManager);

// --- Constants for OpenAI & ElevenLabs ---
// API endpoints
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/speech-to-text'; // ElevenLabs Speech-to-Text API
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'; // OpenAI Chat Completions API

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
  - Do not include any introduction, conclusion or summary sections.
  - Do not bold any of the markdown headings.

**Present your final output entirely within a properly formatted Markdown code block.**

# Here is the transcript:`; // Your detailed instructions

class BackgroundTransferService {
  constructor() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    transferEmitter.addListener('onTransferComplete', async (event) => {
      console.log('Transfer complete:', event);
      // Note: Native module sends 'responseData', JS uses 'response'. This is consistent internally.
      const { taskId, taskType, recordingId, response } = event; 
      try {
        if (taskType === 'transcription') {
          await this.handleTranscriptionComplete(recordingId, response);
        } else if (taskType === 'summarization') {
          await this.handleSummarizationComplete(recordingId, response);
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
    try {
      const processingRecording = { ...recording, processingStatus: 'processing' };
      await updateRecording(processingRecording);

      // Create form data for ElevenLabs API
      const formData = {
        model_id: "scribe_v1", // Updated to use the correct model name from ElevenLabs docs
        language_detection: true,
        timestamps_granularity: "word",
        diarize: true
      };

      // Fix: Change startUpload to startUploadTask to match native module
      const taskId = await BackgroundTransferManager.startUploadTask({ 
        // Pass both filePath and form data for multipart upload
        filePath: recording.filePath,
        apiUrl: ELEVENLABS_API_URL,
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY, 
          'Content-Type': 'multipart/form-data', // Our native module will handle multipart construction
        },
        body: JSON.stringify(formData), // Form fields as JSON
        taskType: 'transcription',
        // Pass recordingId within metadata for native module access
        metadata: { recordingId: recording.id } 
      });

      console.log('Started transcription upload task:', taskId, 'for recording:', recording.id);
      return taskId;
    } catch (error) {
      console.error('Error starting transcription upload:', error);
      await this.handleTransferError(null, 'transcription', recording.id, 'Failed to start upload'); // Handle start error
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
        model: "gpt-4o",
        messages: [
            { role: "system", content: SUMMARY_INSTRUCTIONS },
            { role: "user", content: recording.transcript }
        ],
        temperature: 0.5,
        max_tokens: 2048,
        // No 'response_format' needed unless you specifically want JSON output defined by a schema
      };

      // Fix: Change startUpload to startUploadTask to match native module
      const taskId = await BackgroundTransferManager.startUploadTask({ 
        apiUrl: OPENAI_API_URL, // Use Chat Completions endpoint
        headers: {
          // TODO: Use secure API key retrieval here
          'Authorization': `Bearer ${OPENAI_API_KEY}`, 
          'Content-Type': 'application/json', // Ensure this is set for JSON body
        },
        body: JSON.stringify(requestBody), // Pass JSON string as body
        taskType: 'summarization',
        // Pass recordingId within metadata for native module access
        metadata: { recordingId: recording.id }, 
        filePath: null // Explicitly null filePath when sending body
      });

      console.log('Started summarization upload task:', taskId, 'for recording:', recording.id);
      return taskId;
    } catch (error) {
      console.error('Error starting summarization upload:', error);
      await this.handleTransferError(null, 'summarization', recording.id, 'Failed to start upload'); // Handle start error
      throw error;
    }
  }

  async handleTranscriptionComplete(recordingId, response) {
    // (Logic remains similar, ensure JSON parsing is robust)
     try {
        console.log(`Raw transcription response for ${recordingId}:`, response);
        
        const responseData = JSON.parse(response);
        // Extract transcript based on ElevenLabs API response format
        // The API returns a 'text' field with the complete transcript
        const transcript = responseData.text;

        if (transcript === undefined || transcript === null) { // Check for undefined or null
            console.error('Unexpected ElevenLabs response structure:', JSON.stringify(responseData, null, 2));
            throw new Error('No transcript found in ElevenLabs response');
        }

        const recording = await getRecordingById(recordingId);
        if (!recording) throw new Error(`Recording ${recordingId} not found`);

        const updatedRecording = {
            ...recording,
            transcript,
            // Don't set to 'complete' yet, summarization is next
            processingStatus: 'processing', 
        };
        await updateRecording(updatedRecording);
        console.log(`Transcription complete for ${recordingId}, starting summarization...`);

        // Start summarization process
        await this.startSummarizationUpload(updatedRecording); // Use 'await'
    } catch (error) {
        console.error(`Error handling transcription completion for ${recordingId}:`, error);
        // Ensure we pass taskId if available, though it's not provided here by the event
        await this.handleTransferError(null, 'transcription', recordingId, `Processing failed: ${error.message}`);
    }
  }

  async handleSummarizationComplete(recordingId, response) {
    try {
        const responseData = JSON.parse(response);

        // **Simplified Summary Extraction:**
        if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
            const summary = responseData.choices[0].message.content;

            const recording = await getRecordingById(recordingId);
            if (!recording) throw new Error(`Recording ${recordingId} not found`);

            const updatedRecording = {
                ...recording,
                summary: cleanMarkdownText(summary), // Use the cleaner function
                processingStatus: 'complete', // Final state
            };
            await updateRecording(updatedRecording);
            console.log(`Summarization complete for ${recordingId}`);
        } else {
            // Log the structure if it's unexpected
            console.error('Unexpected OpenAI response structure:', JSON.stringify(responseData, null, 2));
            throw new Error('Could not extract summary from OpenAI response choices');
        }
    } catch (error) {
        console.error(`Error handling summarization completion for ${recordingId}:`, error);
         // Ensure we pass taskId if available, though it's not provided here by the event
        await this.handleTransferError(null, 'summarization', recordingId, `Processing failed: ${error.message}`);
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