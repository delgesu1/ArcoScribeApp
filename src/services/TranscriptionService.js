import { updateRecording } from './AudioRecordingService';
import BackgroundTransferService from './BackgroundTransferService';

/**
 * Initiates the background transcription process for a recording.
 * @param {Object} recording - The recording object to transcribe.
 * @returns {Promise<boolean>} - True if the task submission was successful, false otherwise.
 */
export const transcribeRecording = async (recording) => {
  try {
    console.log(`[TranscriptionService] Initiating background transcription for recording: ${recording.id}`);
    // Delegate the upload and processing to the BackgroundTransferService
    // The service internally handles setting the 'processing' status
    await BackgroundTransferService.startTranscriptionUpload(recording);
    console.log(`[TranscriptionService] Background transcription task submitted for recording: ${recording.id}`);
    return true; // Indicate task submission success
  } catch (error) {
    // Log the error from the submission attempt itself
    console.error(`[TranscriptionService] Failed to submit transcription task for recording ${recording.id}:`, error);
    // Note: The BackgroundTransferService handles setting the 'error' status on the recording
    // if the submission fails or if the background task itself fails later.
    return false; // Indicate task submission failure
  }
};
