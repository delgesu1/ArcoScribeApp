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

          // --- ADDED: Clean up concatenated file on error ---
          if (recording && recording._tempConcatPath) {
              console.log(`[BackgroundTransferService] Cleaning up temporary concatenated file on error: ${recording._tempConcatPath}`);
              await RNFS.unlink(recording._tempConcatPath);
              // Remove the temporary path from the recording metadata if necessary
              const updatedRecording = { ...recording };
              delete updatedRecording._tempConcatPath;
              await updateRecording(updatedRecording);
          }
      } catch (handlerError) {
          console.error('Critical error handling transfer error:', handlerError);
      }
  }


  async startTranscriptionUpload(recording) {
    let uploadFilePath = recording.filePath; // Default to existing filePath
    let tempConcatPath = null; // Track temporary path for cleanup

    try {
      // --- ADDED: Concatenation Logic ---
      if (recording.segmentPaths && recording.segmentPaths.length > 1) {
        console.log(`[BackgroundTransferService] Multiple segments found (${recording.segmentPaths.length}), concatenating...`);
        
        // Define a temporary output path in the cache directory
        const tempFileName = `concatenated_${recording.id}.m4a`;
        tempConcatPath = `${RNFS.CachesDirectoryPath}/${tempFileName}`;
        console.log(`[BackgroundTransferService] Temporary concatenation path: ${tempConcatPath}`);

        // Call the native concatenation method
        uploadFilePath = await AudioRecorderModule.concatenateSegments(
          recording.segmentPaths,
          tempConcatPath
        );
        console.log(`[BackgroundTransferService] Concatenation complete. Uploading: ${uploadFilePath}`);

        // Store temp path in recording temporarily for cleanup later
        // Note: This adds a temporary field; consider if this is the best approach
        // Alternatively, manage cleanup state within this service.
        const processingRecordingWithTempPath = { ...recording, processingStatus: 'processing', _tempConcatPath: tempConcatPath };
        await updateRecording(processingRecordingWithTempPath);
      } else {
         // If only one segment, update status normally
         const processingRecording = { ...recording, processingStatus: 'processing' };
         await updateRecording(processingRecording);
      }
      // --- END ADDED ---

      // --- MODIFIED: Use uploadFilePath which might be concatenated path --- 
      const formData = {
        model_id: "scribe_v1", 
        language_detection: true,
        timestamps_granularity: "word",
        diarize: true
      };

      const taskId = await BackgroundTransferManager.startUploadTask({ 
        filePath: uploadFilePath, // Use the potentially concatenated path
        apiUrl: ELEVENLABS_API_URL,
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY, 
          'Content-Type': 'multipart/form-data',
        },
        body: JSON.stringify(formData),
        taskType: 'transcription',
        metadata: { 
            recordingId: recording.id, 
            // Pass temp path if it exists, for cleanup on completion/error
            tempConcatPath: tempConcatPath 
        } 
      });

      console.log('Started transcription upload task:', taskId, 'for recording:', recording.id, 'using file:', uploadFilePath);
      return taskId;
    } catch (error) {
      console.error('Error starting transcription upload:', error);
      // Pass tempConcatPath to error handler for potential cleanup
      await this.handleTransferError(null, 'transcription', recording.id, `Failed to start upload: ${error.message}`);
      // Clean up temp file immediately if concatenation succeeded but upload start failed
      if (tempConcatPath) {
        try {
          console.log('[BackgroundTransferService] Cleaning up temp concat file after upload start failure:', tempConcatPath);
          await RNFS.unlink(tempConcatPath);
        } catch (unlinkError) {
          console.error('[BackgroundTransferService] Error cleaning up temp file after start failure:', unlinkError);
        }
      }
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
        model: "gpt-4.1", // User confirmed model
        instructions: SUMMARY_INSTRUCTIONS, // Use instructions field
        input: recording.transcript, // Use input field for the transcript
        temperature: 0.5, // Reinstate temperature
        store: false, // Optionally disable storage
        // max_output_tokens: 6000, // Optional, leave out for now
      };

      // Determine the API URL for the Responses API
      // Assuming it's /v1/responses based on python client: client.responses.create()
      const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses'; 

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

  async handleTranscriptionComplete(recordingId, response) {
    // --- ADDED: Cleanup for concatenated file ---
    let tempPathToClean = null;
    try {
       // Check if the temp path needs cleaning (passed via metadata in startUploadTask)
       // Note: This relies on the metadata being reliably available. 
       // Consider fetching the recording data again if metadata isn't guaranteed.
       const recording = await getRecordingById(recordingId);
       if (recording && recording._tempConcatPath) {
           tempPathToClean = recording._tempConcatPath;
           console.log(`[BackgroundTransferService] Will clean up temp file after processing: ${tempPathToClean}`);
           // Optionally remove the _tempConcatPath field from metadata now
           const updatedRec = { ...recording };
           delete updatedRec._tempConcatPath;
           await updateRecording(updatedRec);
       }
    } catch (fetchError) {
        console.error("[BackgroundTransferService] Error fetching recording data for cleanup check:", fetchError);
    }
    // --- END ADDED ---

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
        // Remove temporary path field if it still exists
        delete updatedRecording._tempConcatPath; 
        await updateRecording(updatedRecording);
        console.log(`Transcription complete for ${recordingId}, starting summarization...`);

        await this.startSummarizationUpload(updatedRecording);
    } catch (error) {
        console.error(`Error handling transcription completion for ${recordingId}:`, error);
        await this.handleTransferError(null, 'transcription', recordingId, `Processing failed: ${error.message}`);
    } finally {
        // --- ADDED: Perform cleanup regardless of success/failure within processing ---
        if (tempPathToClean) {
            try {
                console.log(`[BackgroundTransferService] Performing cleanup of temp file: ${tempPathToClean}`);
                await RNFS.unlink(tempPathToClean);
            } catch (cleanupError) {
                console.error('[BackgroundTransferService] Error during final cleanup of temp file:', cleanupError);
            }
        }
        // --- END ADDED ---
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
            summary: cleanMarkdownText(summary), // Use the cleaner function
            processingStatus: 'complete', // Final state
        };
        await updateRecording(updatedRecording);
        console.log(`Summarization complete (Responses API) for ${recordingId}`);


    } catch (error) {
        console.error(`Error handling summarization completion (Responses API) for ${recordingId}:`, error);
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