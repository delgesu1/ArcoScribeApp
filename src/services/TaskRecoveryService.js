import BackgroundTransferService from './BackgroundTransferService';
import { getRecordingById, updateRecording } from './AudioRecordingService';

/**
 * Checks for persisted background tasks upon app launch and attempts to reconcile
 * the application state (recording status) with the persisted task information.
 */
export const recoverTasks = async () => {
  try {
    console.log('[TaskRecovery] Checking for persisted background tasks...');
    // Get tasks persisted by the native module (returns a dictionary/map)
    // Assumes BackgroundTransferService.getActiveTasks() calls the native getActiveTransfers
    const persistedTasks = await BackgroundTransferService.getActiveTasks(); 
    const taskIds = Object.keys(persistedTasks);
    console.log(`[TaskRecovery] Found ${taskIds.length} persisted tasks.`);

    if (taskIds.length === 0) {
        console.log('[TaskRecovery] No persisted tasks found.');
        return;
    }

    for (const taskId of taskIds) {
      const taskInfo = persistedTasks[taskId]; // Get the persisted info (type, metadata, etc.)
      // Ensure metadata and recordingId exist. Adjust path if metadata structure is different.
      const recordingId = taskInfo?.metadata?.recordingId; 

      console.log(`[TaskRecovery] Processing persisted task ${taskId} with info:`, taskInfo);

      if (!recordingId) {
        console.warn(`[TaskRecovery] Task ${taskId} has missing or invalid recordingId in metadata. Clearing task.`);
        // Ensure BackgroundTransferService.clearTask exists and is implemented in native code
        try {
            await BackgroundTransferService.clearTask(taskId); 
        } catch(clearError) {
            console.error(`[TaskRecovery] Failed to clear task ${taskId} with missing recordingId:`, clearError);
        }
        continue;
      }

      // Check the application's state for the associated recording
      let recording = null;
      try {
          recording = await getRecordingById(recordingId);
      } catch (getRecordingError) {
          console.error(`[TaskRecovery] Error fetching recording ${recordingId} for task ${taskId}:`, getRecordingError);
          // Decide if we should clear the task or retry later. For now, let's log and continue.
          continue; 
      }
      

      if (!recording) {
        // Recording doesn't exist in our app state - orphan task
        console.warn(`[TaskRecovery] Recording ${recordingId} for task ${taskId} not found in app state. Clearing task.`);
        try {
            await BackgroundTransferService.clearTask(taskId);
        } catch(clearError) {
            console.error(`[TaskRecovery] Failed to clear orphan task ${taskId}:`, clearError);
        }
        continue;
      }

      console.log(`[TaskRecovery] Recording ${recording.id} current status: ${recording.processingStatus}`);

      // Check if the recording state is already final
      if (recording.processingStatus === 'complete' || recording.processingStatus === 'error') {
        // The recording is already finished, but the native task persisted. Clean up the zombie task.
        console.warn(`[TaskRecovery] Recording ${recording.id} is already '${recording.processingStatus}', but task ${taskId} persists. Clearing task.`);
         try {
            await BackgroundTransferService.clearTask(taskId);
        } catch(clearError) {
            console.error(`[TaskRecovery] Failed to clear zombie task ${taskId} for recording ${recording.id}:`, clearError);
        }
      } else if (recording.processingStatus !== 'processing') {
        // The recording is NOT finished and NOT marked as 'processing'.
        // This likely means the app quit after the native task started but before the JS could update the status.
        // Update the status to 'processing' so the UI reflects the ongoing background work.
        console.log(`[TaskRecovery] Updating recording ${recording.id} status from '${recording.processingStatus}' to 'processing'.`);
        const updatedRecording = { ...recording, processingStatus: 'processing' };
        try {
            await updateRecording(updatedRecording);
        } catch(updateError) {
            console.error(`[TaskRecovery] Failed to update recording ${recording.id} status to 'processing':`, updateError);
            // If update fails, the task might get stuck. Consider implications.
        }
      } else {
        // Recording is already marked as 'processing'. Assume the native task is handling it.
        console.log(`[TaskRecovery] Recording ${recording.id} is already 'processing'. No state change needed.`);
      }
    }
    console.log('[TaskRecovery] Task recovery check finished.');
  } catch (error) {
    // Catch errors from getActiveTasks() itself or other unexpected issues
    console.error('[TaskRecovery] Critical error during task recovery process:', error);
  }
}; 