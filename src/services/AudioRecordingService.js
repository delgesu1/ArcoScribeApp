import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import { Recording } from '../utils/DataModels';
import { formatTime } from '../utils/TimeUtils';


const { AudioRecorderModule } = NativeModules;
const audioRecorderEvents = new NativeEventEmitter(AudioRecorderModule);

// Variable to store event subscription references for cleanup
let eventSubscriptions = [];

// Variables to track current recording state
let currentRecordingId = null;
let currentRecordingPath = null;
let recordingStartTime = null;
let currentSegmentPaths = [];

// Progress callback for React components 
let progressCallback = null;

// Flag to enable mock recording mode for testing
const USE_MOCK_RECORDING = false;

// Seamless playback/composition is now always enabled (feature flag removed)

// Playback callback storage (only for composition path)
let onPlaybackProgressCb = null;
let onPlaybackFinishedCb = null;

// Time-to-first-audio metric
let playbackStartTs = null;
function getNowMs() {
  // Use global.performance.now() if available (RN >=0.63), else fallback to Date.now()
  if (global && global.performance && typeof global.performance.now === 'function') {
    return global.performance.now();
  }
  return Date.now();
}
const logTimeToFirstAudio = (label, ms) => {
  console.log(`[Metrics] ${label}: ${ms.toFixed(1)} ms`);
  // TODO: send to analytics backend when available
};

// Initialize event listeners
const setupEventListeners = () => {
  // Clean up any existing event listeners first
  removeEventListeners();
  
  // Create new listeners
  eventSubscriptions = [
    // Recording progress updates
    audioRecorderEvents.addListener('onRecordingProgress', (data) => {
      // Update local tracking of recording time
      if (progressCallback) {
        progressCallback(data);
      }
    }),
    
    // Recording segment complete
    audioRecorderEvents.addListener('onRecordingSegmentComplete', (data) => {
      console.log(`[AudioRecordingService] Recording segment completed: ${data.segmentNumber}`, data);
      // Store segment path
      if (data.segmentPath && !currentSegmentPaths.includes(data.segmentPath)) {
        currentSegmentPaths.push(data.segmentPath);
      }
    }),
    
    // Recording finished
    audioRecorderEvents.addListener('onRecordingFinished', async (data) => {
      console.log('[AudioRecordingService] Recording finished:', data);
      
      // Save segment paths for potential use in playback/transcription
      if (data.segmentPaths && data.segmentPaths.length > 0) {
        currentSegmentPaths = [...data.segmentPaths];
      }
      
      // Schedule background export of composition to merged file
      if (currentSegmentPaths.length > 1) {
        try {
          const recordingsDir = await getRecordingsDirectory();
          const mergedPath = `${recordingsDir}/${data.recordingId || Date.now()}_merged.m4a`;
          console.log('[AudioRecordingService] Starting background export to', mergedPath);
          AudioRecorderModule.exportCompositionToFile(currentSegmentPaths, mergedPath)
            .then(async (outPath) => {
              console.log('[AudioRecordingService] Export completed:', outPath);
              try {
                const recording = await getRecordingById(data.recordingId);
                if (recording) {
                  const updated = {
                    ...recording,
                    filePath: outPath,
                    processingStatus: 'pending', // trigger downstream upload logic
                  };
                  await updateRecording(updated);
                }
              } catch (dbErr) {
                console.error('[AudioRecordingService] Failed to persist merged path:', dbErr);
              }
            })
            .catch((err) => {
              console.error('[AudioRecordingService] Export failed:', err);
            });
        } catch (e) {
          console.error('[AudioRecordingService] Failed to initiate export:', e);
        }
      }
    }),
    
    // Recording errors
    audioRecorderEvents.addListener('onRecordingError', (error) => {
      console.error('[AudioRecordingService] Recording error:', error);
    }),
    
    // Recording update events (status updates, processing notifications, etc.)
    audioRecorderEvents.addListener('onRecordingUpdate', (data) => {
      console.log('[AudioRecordingService] Recording update:', data);
      // Handle different status updates
      if (data.status === 'processing') {
        // Handle processing status (previously came from onRecordingProcessing event)
        console.log('[AudioRecordingService] Recording is being processed');
      }
    }),
    
    // === New seamless playback events ===
    audioRecorderEvents.addListener('onPlaybackProgress', (data) => {
      if (progressCallback) {
        // Provide same shape as AudioRecorderPlayer for UI ease
        progressCallback({
          currentPosition: data.currentTime * 1000, // sec -> ms
          duration: data.duration * 1000,
        });
      }
    }),
    audioRecorderEvents.addListener('onPlaybackEnded', (data) => {
      playbackState.isPlaying = false;
      playbackState.isPaused = false;
      if (onPlaybackFinishedCb) onPlaybackFinishedCb();
    })
  ];
};

// Remove event listeners
const removeEventListeners = () => {
  eventSubscriptions.forEach(subscription => subscription.remove());
  eventSubscriptions = [];
};

// Set up event listeners immediately
setupEventListeners();

// Utility to check if directory is writable
const ensureDirectoryIsWritable = async (dirPath) => {
  try {
    // Test write a small file
    const testFilePath = `${dirPath}/test_write.txt`;
    await RNFS.writeFile(testFilePath, 'test', 'utf8');
    
    // Remove test file
    const exists = await RNFS.exists(testFilePath);
    if (exists) {
      await RNFS.unlink(testFilePath);
    }
    return true;
  } catch (error) {
    console.error('Directory is not writable:', error);
    return false;
  }
};

// Get directory path for storing recordings
const getRecordingsDirectory = async () => {
  let baseDir;
  if (Platform.OS === 'ios') {
    // Use the cache directory for iOS which is more permissive
    baseDir = `${RNFS.CachesDirectoryPath}/recordings`;
    
    // Create directory if it doesn't exist
    try {
      const exists = await RNFS.exists(baseDir);
      if (!exists) {
        await RNFS.mkdir(baseDir);
      }
      
      // Simple verification - no separate writability check
      console.log('Using iOS directory:', baseDir);
    } catch (error) {
      console.error('Error creating iOS directory:', error);
      // Fallback to temporary directory
      baseDir = `${RNFS.TemporaryDirectoryPath}/recordings`;
      const tempExists = await RNFS.exists(baseDir);
      if (!tempExists) {
        await RNFS.mkdir(baseDir);
      }
    }
  } else {
    // Android path
    baseDir = `${RNFS.ExternalDirectoryPath}/recordings`;
    const exists = await RNFS.exists(baseDir);
    if (!exists) {
      await RNFS.mkdir(baseDir);
    }
  }
  
  return baseDir;
};

// Generate a unique ID for recordings
const generateId = () => {
  return Date.now().toString();
};

// Format date for display
const formatDate = (date) => {
  const options = { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return new Date(date).toLocaleDateString(undefined, options);
};

// Manually request Android permissions - iOS uses Info.plist
const requestAndroidPermission = async () => {
  if (Platform.OS !== 'android') return true;
  
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'App needs access to your microphone to record audio',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      },
    );
    
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.error('Failed to request permission:', err);
    return false;
  }
};

// Save recording metadata initially when recording starts
const saveInitialRecordingMetadata = async (recordingId, filePath, startTime) => {
  try {
    const recordings = await getRecordings();
    const newRecording = new Recording({
      id: recordingId,
      title: `${formatDate(startTime)} (In Progress)`, // Temporary title
      filePath: filePath,
      date: formatDate(startTime),
      duration: '0:00', // Placeholder duration
      processingStatus: 'recording_active', // New status
    });
    
    recordings.unshift(newRecording); // Add to the beginning

    const recordingsJson = JSON.stringify(recordings, null, 2);
    const recordingsDir = await getRecordingsDirectory();
    await RNFS.writeFile(`${recordingsDir}/recordings.json`, recordingsJson, 'utf8');
    console.log(`[AudioRecordingService] Saved initial metadata for recording_active ID: ${recordingId}`);
    return true;
  } catch (error) {
    console.error(`[AudioRecordingService] Error saving initial metadata for ID: ${recordingId}:`, error);
    // Don't throw here, allow recording to potentially continue
    return false; 
  }
};

// Set progress callback
export const setProgressCallback = (callback) => {
  progressCallback = callback;
};

// Start recording
export const startRecording = async () => {
  try {
    console.log('Starting recording process...');
    
    // Reset segment tracking
    currentSegmentPaths = [];
    
    // Mock mode check remains for backward compatibility
    if (USE_MOCK_RECORDING) {
      console.log('MOCK RECORDING MODE: Creating simulated recording');
      
      // Generate mock data
      const mockRecordingId = generateId();
      const recordingsDir = await getRecordingsDirectory(); 
      const fileName = `mock_recording_${mockRecordingId}.${Platform.OS === 'ios' ? 'm4a' : 'mp3'}`;
      const mockFilePath = `${recordingsDir}/${fileName}`;
      
      // Create an empty file to simulate a recording
      await RNFS.writeFile(mockFilePath, '', 'utf8');
      console.log('Created mock recording file at:', mockFilePath);
      
      // Set recording start time and path
      recordingStartTime = Date.now();
      currentRecordingPath = mockFilePath;
      currentRecordingId = mockRecordingId;
      
      // Save initial mock metadata
      await saveInitialRecordingMetadata(mockRecordingId, mockFilePath, recordingStartTime);

      return mockRecordingId;
    }
    
    // Non-mock mode - actual recording
    
    // Request Android permissions manually
    if (Platform.OS === 'android') {
      const hasPermission = await requestAndroidPermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied');
      }
    }
    
    // Configure segment duration (in seconds)
    const segmentDuration = 15 * 60;
    console.log(`[AudioRecordingService] Calling setMaxSegmentDuration with: ${segmentDuration}`);
    // Temporarily disabled to debug freeze issue - native module has a default
    // await AudioRecorderModule.setMaxSegmentDuration(segmentDuration);
    
    // Start recording using native module
    recordingStartTime = Date.now();
    const result = await AudioRecorderModule.startRecording({});
    
    // Store the recording info
    currentRecordingId = result.recordingId;
    currentRecordingPath = result.filePath;
    
    console.log('Recording started:', result);
    
    // Save initial metadata
    await saveInitialRecordingMetadata(result.recordingId, result.filePath, recordingStartTime);
    
    return result.recordingId;
  } catch (error) {
    console.error('Error starting recording:', error);
    console.error('Error details:', error.message, error.stack);
    currentRecordingPath = null;
    currentRecordingId = null;
    recordingStartTime = null;
    throw error;
  }
};

// Pause recording
export const pauseRecording = async () => {
  try {
    // Check if using mock recording mode
    if (USE_MOCK_RECORDING || (currentRecordingPath && currentRecordingPath.includes('mock_recording'))) {
      console.log('Pausing mock recording');
      return true;
    }
    
    // Real recording - use native module
    console.log('Pausing real recording');
    const result = await AudioRecorderModule.pauseRecording();
    console.log('Pause result:', result);
    return true;
  } catch (error) {
    console.error('Error pausing recording:', error);
    console.error('Error details:', error.message, error.stack);
    
    // In case of error with mock mode enabled, still return success
    if (USE_MOCK_RECORDING) {
      return true;
    }
    
    throw error;
  }
};

// Resume recording
export const resumeRecording = async () => {
  try {
    // Check if using mock recording mode
    if (USE_MOCK_RECORDING || (currentRecordingPath && currentRecordingPath.includes('mock_recording'))) {
      console.log('Resuming mock recording');
      return true;
    }
    
    // Real recording - use native module
    console.log('Resuming real recording');
    const result = await AudioRecorderModule.resumeRecording();
    console.log('Resume result:', result);
    return true;
  } catch (error) {
    console.error('Error resuming recording:', error);
    console.error('Error details:', error.message, error.stack);
    
    // In case of error with mock mode enabled, still return success
    if (USE_MOCK_RECORDING) {
      return true;
    }
    
    throw error;
  }
};

// Stop recording
export const stopRecording = async () => {
  // Use local variables for the specific recording being stopped
  const stoppedRecordingPath = currentRecordingPath; 
  const stoppedRecordingStartTime = recordingStartTime;
  const stoppedRecordingId = currentRecordingId;
  
  // Clear module-level vars immediately to prevent reuse issues if stop fails partially
  currentRecordingPath = null; 
  recordingStartTime = null;
  currentRecordingId = null;

  if (!stoppedRecordingPath || !stoppedRecordingStartTime) {
      console.warn("[AudioRecordingService] stopRecording called but no active recording path or start time found.");
      return null; // Indicate nothing was stopped
  }

  try {
    // If we're using a mock recording, handle it differently
    if (USE_MOCK_RECORDING || (stoppedRecordingPath && stoppedRecordingPath.includes('mock_recording'))) {
      console.log('Stopping mock recording:', stoppedRecordingPath);
      
      // Calculate duration
      const recordingEndTime = Date.now();
      const durationMs = recordingEndTime - stoppedRecordingStartTime;
      const durationFormatted = formatTime(Math.floor(durationMs / 1000));
      
      // Extract ID
      const recordingId = stoppedRecordingPath.split('_').pop().split('.')[0];

      // Prepare updated data for the existing record
      const updatedData = {
        id: recordingId,
        title: `${formatDate(stoppedRecordingStartTime)} (Mock)`, // Final title
        filePath: stoppedRecordingPath,
        date: formatDate(stoppedRecordingStartTime),
        duration: durationFormatted, // Final duration
        processingStatus: 'pending', // Final status
        isMock: true
      };
      
      // *** UPDATE Existing Mock Recording Metadata ***
      await updateRecording(updatedData); 
      console.log(`[AudioRecordingService] Updated metadata for stopped mock recording ID: ${recordingId}`);
      
      // Find the Recording object to return (optional, depends if caller needs the object)
      const finalRecording = Recording.fromJSON(updatedData); // Create object from final data
      
      return finalRecording; 
    }
    
    // --- Real recording ---
    console.log('Stopping real recording for path:', stoppedRecordingPath);
    
    // Stop recording using native module
    const result = await AudioRecorderModule.stopRecording();
    console.log('Stop result received from native:', result); // Keep a simpler log

    // Directly use the first segment path provided by the native module
    // This ensures we have *a* playable path immediately.
    // Merging can be re-introduced later if needed.
    const finalAudioPath = result.firstSegmentPath;
    const combinedDuration = result.duration; // Use duration from native result

    console.log(`[AudioRecordingService] Using finalAudioPath from native result: ${finalAudioPath}`);
    
    // Calculate duration and format it
    const durationFormatted = formatTime(Math.floor(combinedDuration));
    
    // Prepare data for updating the existing record
    const updatedData = {
       id: stoppedRecordingId,
       title: `${formatDate(stoppedRecordingStartTime)}`, // Final title
       filePath: finalAudioPath, // Use the merged file path if concatenated, otherwise the original
       date: formatDate(stoppedRecordingStartTime),
       duration: durationFormatted, // Final duration
       processingStatus: 'pending', // Final status
       // Store segment paths from result for potential future use/debugging
       segmentPaths: result.segmentPaths || (finalAudioPath ? [finalAudioPath] : []) 
    };

    // *** UPDATE Existing Recording Metadata ***
    await updateRecording(updatedData);
    console.log(`[AudioRecordingService] Updated metadata for stopped recording ID: ${stoppedRecordingId} with filePath: ${finalAudioPath}`);

    // Return the final recording object
    const finalRecording = Recording.fromJSON(updatedData);
    return finalRecording;

  } catch (error) {
    console.error('Error stopping recording:', error);
    console.error('Error details:', error.message, error.stack);
    
    // If stopping failed, the 'recording_active' entry remains in recordings.json.
    if (stoppedRecordingPath) {
       console.log(`[AudioRecordingService] Recording stop failed for path: ${stoppedRecordingPath}. Metadata will remain 'recording_active'.`);
    }
    
    throw error; // Re-throw the error so the UI knows it failed
  }
};

// Get all recordings
export const getRecordings = async () => {
  try {
    const recordingsDir = await getRecordingsDirectory();
    const recordingsFile = `${recordingsDir}/recordings.json`;
    
    // Check if file exists
    const exists = await RNFS.exists(recordingsFile);
    if (!exists) {
      return [];
    }
    
    // Read file
    const recordingsJson = await RNFS.readFile(recordingsFile, 'utf8');
    const recordings = JSON.parse(recordingsJson);
    
    // Convert to Recording objects
    return recordings.map(recording => Recording.fromJSON(recording));
  } catch (error) {
    console.error('Error getting recordings:', error);
    // If there's an error, return empty array
    return [];
  }
};

// Get recording by ID
export const getRecordingById = async (id) => {
  try {
    console.log(`[AudioRecordingService] getRecordingById called for ID: ${id}`);
    const recordings = await getRecordings();
    console.log(`[AudioRecordingService] Total recordings loaded: ${recordings.length}`);
    
    const recording = recordings.find(recording => recording.id === id) || null;
    console.log(`[AudioRecordingService] Recording found: ${recording !== null}`);
    
    if (recording) {
      console.log(`[AudioRecordingService] Recording details - ID: ${recording.id}, Title: ${recording.title}`);
      console.log(`[AudioRecordingService] Recording summary exists: ${recording.summary !== null && recording.summary !== undefined}`);
      console.log(`[AudioRecordingService] Recording summary type: ${typeof recording.summary}`);
      console.log(`[AudioRecordingService] Recording summary length: ${recording.summary?.length || 0}`);
      if (recording.summary && recording.summary.length > 0) {
        console.log(`[AudioRecordingService] Summary preview: ${recording.summary.substring(0, 50)}...`);
      }
      console.log(`[AudioRecordingService] Recording processingStatus: ${recording.processingStatus}`);
    }
    
    return recording;
  } catch (error) {
    console.error('Error getting recording by ID:', error);
    throw error;
  }
};

// Update recording data
export const updateRecording = async (updatedRecording) => {
  try {
    console.log(`[AudioRecordingService] Attempting to update recording ID: ${updatedRecording.id} with data:`, JSON.stringify(updatedRecording, null, 2)); // Log data being saved
    
    // Get existing recordings
    const recordings = await getRecordings();
    
    // Find and update recording
    let found = false;
    const updatedRecordings = recordings.map(recording => {
      if (recording.id === updatedRecording.id) {
        found = true;
        return updatedRecording; // Replace the whole object
      }
      return recording;
    });
    
    if (!found) {
        console.warn(`[AudioRecordingService] Recording ID ${updatedRecording.id} not found for update. Adding it.`);
        updatedRecordings.unshift(updatedRecording); // Add if not found (shouldn't happen in update context normally)
    }
    
    // Save to storage
    const recordingsJson = JSON.stringify(updatedRecordings, null, 2); // Pretty print JSON for readability
    const recordingsDir = await getRecordingsDirectory();
    const filePath = `${recordingsDir}/recordings.json`;
    console.log(`[AudioRecordingService] Writing updated recordings list to: ${filePath}`);
    await RNFS.writeFile(filePath, recordingsJson, 'utf8');
    console.log(`[AudioRecordingService] Successfully updated recordings.json for ID: ${updatedRecording.id}`);
    
    // Add logging to check summary data
    if (updatedRecording.summary) {
      console.log(`[AudioRecordingService] Updated recording has summary of length: ${updatedRecording.summary.length}`);
      console.log(`[AudioRecordingService] Summary preview: ${updatedRecording.summary.substring(0, 50)}...`);
    }
    
    return true;
  } catch (error) {
    console.error(`[AudioRecordingService] Error updating recording ID: ${updatedRecording?.id}:`, error);
    throw error;
  }
};

// Delete recording
export const deleteRecording = async (id) => {
  try {
    // Get existing recordings
    const recordings = await getRecordings();
    
    // Find recording to delete
    const recordingToDelete = recordings.find(recording => recording.id === id);
    if (!recordingToDelete) {
      throw new Error('Recording not found');
    }
    
    // Delete audio file
    if (recordingToDelete.filePath) {
      const exists = await RNFS.exists(recordingToDelete.filePath);
      if (exists) {
        await RNFS.unlink(recordingToDelete.filePath);
      }
    }
    
    // Delete any segment files if they exist
    if (recordingToDelete.segmentPaths && Array.isArray(recordingToDelete.segmentPaths)) {
      for (const segmentPath of recordingToDelete.segmentPaths) {
        if (segmentPath) {
          const exists = await RNFS.exists(segmentPath);
          if (exists) {
            await RNFS.unlink(segmentPath);
          }
        }
      }
    }
    
    // Remove from list
    const updatedRecordings = recordings.filter(recording => recording.id !== id);
    
    // Save to storage
    const recordingsJson = JSON.stringify(updatedRecordings);
    const recordingsDir = await getRecordingsDirectory();
    await RNFS.writeFile(`${recordingsDir}/recordings.json`, recordingsJson, 'utf8');
    
    return true;
  } catch (error) {
    console.error('Error deleting recording:', error);
    throw error;
  }
};

// --- PLAYBACK FUNCTIONS ---
// For playback, we'll keep using the react-native-audio-recorder-player library in a transitional approach.
// This allows us to focus on fixing the recording functionality first.
// In a future update, we could move playback to the native module as well.

// The current implementation requires AudioRecorderPlayer for playback
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
let audioRecorderPlayer = new AudioRecorderPlayer();

// Centralized playback state
const playbackState = {
  isPlaying: false,
  isPaused: false,
  currentPath: null,
  playerId: null,
  usingComposition: false,
};

// Play recording
export const playRecording = async (filePath, onProgress, onFinished) => {
  if (!filePath) {
    console.error('[AudioRecordingService] playRecording called with null or undefined filePath.');
    if (onFinished) onFinished('Error: Invalid file path');
    return;
  }

  console.log(`[AudioRecordingService] Attempting to play recording: ${filePath}`);

  // Configure native audio session for playback
  try {
    console.log('[AudioRecordingService] Configuring native audio session for playback...');
    await AudioRecorderModule.configureSessionForPlayback();
    console.log('[AudioRecordingService] Native audio session configured.');
  } catch (sessionError) {
      console.error('[AudioRecordingService] Failed to configure native audio session for playback:', sessionError);
      // Decide if playback should still be attempted or fail here
      if (onFinished) onFinished(`Error: Failed to configure audio session: ${sessionError.message}`);
      return; // Stop playback attempt if session config fails
  }

  if (playbackState.isPlaying || playbackState.isPaused) {
    console.log('[AudioRecordingService] Playback is already in progress or paused. Stopping it first.');
    await stopPlayback();
  }

  playbackStartTs = getNowMs(); // mark start for TTF-audio

  // Handle new composition playback
  if (currentSegmentPaths && currentSegmentPaths.length > 0) {
    try {
      // Ensure any existing playback stopped
      if (playbackState.isPlaying || playbackState.isPaused) {
        await stopPlayback();
      }

      // Configure native session
      await AudioRecorderModule.configureSessionForPlayback();

      const playerId = await AudioRecorderModule.createPlaybackItem(currentSegmentPaths);

      playbackState.playerId = playerId;
      playbackState.usingComposition = true;
      playbackState.isPlaying = true;
      playbackState.isPaused = false;

      // Store callbacks
      progressCallback = onProgress;
      onPlaybackFinishedCb = onFinished;

      // Start playback
      AudioRecorderModule.play(playerId);
      return playerId;
    } catch (err) {
      console.error('[AudioRecordingService] Composition playback failed, falling back:', err);
      // fallthrough to old path below
    }
  }

  // Check if this is a mock recording
  if (filePath && filePath.includes('mock_recording')) {
    console.log('Playing mock recording (simulated):', filePath);
    // Simulate playback for mock recordings
    if (onProgress) {
      let pos = 0;
      const interval = setInterval(() => {
        pos += 100;
        const duration = 5000; // Mock duration 5 seconds
        onProgress({ currentPosition: pos, duration });
        if (pos >= duration) {
          clearInterval(interval);
          if (onFinished) onFinished();
        }
      }, 100);
    }
    return filePath;
  }
  
  // Real recording
  // Ensure the filePath DOES have the correct prefix for the player library
  let pathForPlayer = filePath;
  if (!pathForPlayer.startsWith('file://')) {
    pathForPlayer = `file://${pathForPlayer}`;
  }
  console.log(`Starting real playback for path: ${filePath}`);
  console.log(`Using path with file:// prefix for player: ${pathForPlayer}`);
  
  if (currentSegmentPaths && currentSegmentPaths.length > 1) {
    // On-demand concatenation path removed (Task 7).  Composition playback handles
    // seamless multi-segment playback.
  }

  const result = await audioRecorderPlayer.startPlayer(pathForPlayer);
  console.log('Playback started:', result);
  
  // Update playback state
  playbackState.isPlaying = true;
  playbackState.isPaused = false;
  playbackState.currentPath = filePath;

  // Add listener for progress updates
  audioRecorderPlayer.addPlayBackListener((e) => {
    if (playbackStartTs != null) {
      const ttf = getNowMs() - playbackStartTs;
      logTimeToFirstAudio('time_to_first_audio', ttf);
      playbackStartTs = null; // ensure only logged once
    }
    if (onProgress) {
      onProgress(e); // e contains {currentPosition, duration}
    }
    if (e.currentPosition >= e.duration) {
      // Reached end
      stopPlayback();
      if (onFinished) onFinished();
    }
  });
  
  return result;
};

// Pause playback
export const pausePlayback = async () => {
  if (playbackState.usingComposition && playbackState.playerId != null) {
    await AudioRecorderModule.pause(playbackState.playerId);
    playbackState.isPaused = true;
    playbackState.isPlaying = false;
    return true;
  }
  try {
    // If we're in mock mode, just return success
    if (USE_MOCK_RECORDING) {
      console.log('Pausing mock playback');
      return true;
    }
    
    return await audioRecorderPlayer.pausePlayer();
    // Update playback state
    playbackState.isPlaying = false;
    playbackState.isPaused = true;
  } catch (error) {
    console.error('Error pausing playback:', error);
    
    // If mock mode is enabled, still return success
    if (USE_MOCK_RECORDING) {
      return true;
    }
    
    throw error;
  }
};

// Resume playback
export const resumePlayback = async () => {
  if (playbackState.usingComposition && playbackState.playerId != null) {
    await AudioRecorderModule.play(playbackState.playerId);
    playbackState.isPaused = false;
    playbackState.isPlaying = true;
    return true;
  }
  try {
    // If we're in mock mode, just return success
    if (USE_MOCK_RECORDING) {
      console.log('Resuming mock playback');
      return true;
    }
    
    return await audioRecorderPlayer.resumePlayer();
    // Update playback state
    playbackState.isPlaying = true;
    playbackState.isPaused = false;
  } catch (error) {
    console.error('Error resuming playback:', error);
    
    // If mock mode is enabled, still return success
    if (USE_MOCK_RECORDING) {
      return true;
    }
    
    throw error;
  }
};

// Stop playback
export const stopPlayback = async () => {
  if (playbackState.usingComposition && playbackState.playerId != null) {
    try {
      await AudioRecorderModule.destroyPlaybackItem(playbackState.playerId);
    } catch (e) {
      console.warn('destroyPlaybackItem error', e);
    }
    playbackState.isPlaying = false;
    playbackState.isPaused = false;
    playbackState.playerId = null;
    playbackState.usingComposition = false;
    progressCallback = null;
    onPlaybackFinishedCb = null;
    return true;
  }
  try {
    // If we're in mock mode, just return success
    if (USE_MOCK_RECORDING) {
      console.log('Stopping mock playback');
      // No listener to remove for mock mode
      return true;
    }
    
    console.log('Stopping real playback');
    await audioRecorderPlayer.stopPlayer();
    // Remove listener when stopping
    audioRecorderPlayer.removePlayBackListener();
    // Reset playback state
    playbackState.isPlaying = false;
    playbackState.isPaused = false;
    playbackState.currentPath = null;
    return true;
  } catch (error) {
    console.error('Error stopping playback:', error);
    console.error('Error details:', error.message, error.stack);
    // Try to remove listener even on error
    try { audioRecorderPlayer.removePlayBackListener(); } catch (e) {}
    throw error;
  }
};

// Seek playback
export const seekPlayback = async (timeMs) => {
  if (playbackState.usingComposition && playbackState.playerId != null) {
    await AudioRecorderModule.seekTo(playbackState.playerId, timeMs / 1000);
    return true;
  }
  try {
    if (USE_MOCK_RECORDING) {
      console.log('Seeking mock playback (simulated)');
      // Need to update the mock playback simulation if implementing seek
      return true;
    }
    console.log('Seeking real playback to:', timeMs);
    await audioRecorderPlayer.seekToPlayer(timeMs);
    return true;
  } catch (error) {
    console.error('Error seeking playback:', error);
    throw error;
  }
};
