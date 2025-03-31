import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import { Platform, PermissionsAndroid } from 'react-native';
import { Recording } from '../utils/DataModels';
import { formatTime } from '../utils/TimeUtils';

let audioRecorderPlayer = new AudioRecorderPlayer();
let currentRecordingPath = null;
let recordingStartTime = null;

// Flag to enable mock recording mode for testing
const USE_MOCK_RECORDING = false;

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

// Start recording
export const startRecording = async () => {
  try {
    console.log('Starting recording process...');
    
    // Mock mode check remains for backward compatibility
    if (USE_MOCK_RECORDING) {
      console.log('MOCK RECORDING MODE: Creating simulated recording');
      
      // Generate mock data
      const recordingId = generateId();
      const recordingsDir = await getRecordingsDirectory(); 
      const fileName = `mock_recording_${recordingId}.${Platform.OS === 'ios' ? 'm4a' : 'mp3'}`;
      const filePath = `${recordingsDir}/${fileName}`;
      
      // Create an empty file to simulate a recording
      await RNFS.writeFile(filePath, '', 'utf8');
      console.log('Created mock recording file at:', filePath);
      
      // Set recording start time and path
      recordingStartTime = Date.now();
      currentRecordingPath = filePath;
      
      return recordingId;
    }
    
    // Non-mock mode - actual recording
    
    // Request Android permissions manually
    if (Platform.OS === 'android') {
      const hasPermission = await requestAndroidPermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied');
      }
    }
    
    // Create a fresh recorder instance
    audioRecorderPlayer = new AudioRecorderPlayer();
    
    // Set subscription duration for more frequent updates
    audioRecorderPlayer.setSubscriptionDuration(0.1); // 100ms intervals
    
    // Get directory path
    const recordingsDir = await getRecordingsDirectory();
    console.log('Recording directory:', recordingsDir);
    
    // Generate unique filename
    const recordingId = generateId();
    const fileName = `recording_${recordingId}.${Platform.OS === 'ios' ? 'm4a' : 'mp3'}`;
    
    // Create the full path according to documentation
    let filePath;
    if (Platform.OS === 'ios') {
      filePath = `file://${recordingsDir}/${fileName}`; 
    } else {
      filePath = `${recordingsDir}/${fileName}`; // Android path
    }
    
    console.log('Recording file path:', filePath);
    
    // Use the same audio configuration for both platforms
    // Follow the exact patterns from the documentation
    const audioSet = {
      // iOS settings
      AVEncoderAudioQualityKeyIOS: 'low',
      AVNumberOfChannelsKeyIOS: 1,
      AVFormatIDKeyIOS: 'aac',
      
      // Android settings
      AudioEncoderAndroid: 'aac',
      AudioSourceAndroid: 'mic',
      OutputFormatAndroid: 'aac_adts',
    };
    
    // Enable metering for visualizing audio levels
    const meteringEnabled = true;
    
    // Start recording with the correct parameters as per documentation
    console.log('Starting recorder with audioSet:', audioSet);
    recordingStartTime = Date.now();
    
    // This matches the documentation example
    const result = await audioRecorderPlayer.startRecorder(
      filePath,
      audioSet,
      meteringEnabled
    );
    
    console.log('Recording started, path:', result);
    currentRecordingPath = result;
    
    // Add record back listener to get updates on recording progress
    audioRecorderPlayer.addRecordBackListener((e) => {
      // Log recording progress but not too frequently to avoid flooding console
      if (e.currentPosition % 1000 < 100) { // Log roughly every second
        console.log('Recording progress:', e.currentPosition, 'metering:', e.currentMetering);
      }
    });
    
    return recordingId;
  } catch (error) {
    console.error('Error starting recording:', error);
    console.error('Error details:', error.message, error.stack);
    throw error;
  }
};

// Pause recording
export const pauseRecording = async () => {
  try {
    // Check if using mock recording mode
    if (USE_MOCK_RECORDING || (currentRecordingPath && currentRecordingPath.includes('mock_recording'))) {
      console.log('Pausing mock recording');
      // No actual audio to pause in mock mode, just return success
      return true;
    }
    
    // Real recording - use audio recorder API
    console.log('Pausing real recording');
    const result = await audioRecorderPlayer.pauseRecorder();
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
      // No actual audio to resume in mock mode, just return success
      return true;
    }
    
    // Real recording - use audio recorder API
    console.log('Resuming real recording');
    const result = await audioRecorderPlayer.resumeRecorder();
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
  try {
    // If we're using a mock recording, handle it differently
    if (USE_MOCK_RECORDING || (currentRecordingPath && currentRecordingPath.includes('mock_recording'))) {
      console.log('Stopping mock recording:', currentRecordingPath);
      
      // Calculate duration
      const recordingEndTime = Date.now();
      const durationMs = recordingEndTime - recordingStartTime;
      const durationFormatted = formatTime(Math.floor(durationMs / 1000));
      
      // Create recording object with mock data
      const recordingId = currentRecordingPath.split('_').pop().split('.')[0];
      const recording = new Recording({
        id: recordingId,
        title: `${formatDate(recordingStartTime)} (Mock)`,
        filePath: currentRecordingPath,
        date: formatDate(recordingStartTime),
        duration: durationFormatted,
        processingStatus: 'pending',
        isMock: true
      });
      
      // Save recording metadata
      await saveRecording(recording);
      
      // Reset variables
      currentRecordingPath = null;
      recordingStartTime = null;
      
      return recording;
    }
    
    // Real recording - use the original approach
    console.log('Stopping real recording');
    
    // Stop recording according to documentation
    const result = await audioRecorderPlayer.stopRecorder();
    console.log('Stop result:', result);
    
    // Always remove the listener (this is critical)
    audioRecorderPlayer.removeRecordBackListener();
    
    // Calculate duration
    const recordingEndTime = Date.now();
    const durationMs = recordingEndTime - recordingStartTime;
    const durationFormatted = formatTime(Math.floor(durationMs / 1000));
    
    // Create recording object
    // Extract ID using a more robust approach
    let recordingId;
    try {
      recordingId = currentRecordingPath.split('_').pop().split('.')[0];
    } catch (error) {
      // Fallback to current timestamp if we can't parse the ID
      recordingId = generateId();
    }
    
    const recording = new Recording({
      id: recordingId,
      title: `${formatDate(recordingStartTime)}`,
      filePath: currentRecordingPath,
      date: formatDate(recordingStartTime),
      duration: durationFormatted,
      processingStatus: 'pending'
    });
    
    // Save recording metadata
    await saveRecording(recording);
    
    // Reset variables
    currentRecordingPath = null;
    recordingStartTime = null;
    
    return recording;
  } catch (error) {
    console.error('Error stopping recording:', error);
    console.error('Error details:', error.message, error.stack);
    
    // Clean up listeners even on error
    try {
      audioRecorderPlayer.removeRecordBackListener();
    } catch (listenerError) {
      console.log('Error removing listener:', listenerError);
    }
    
    // If stopping the real recording fails but we have a recording path
    if (currentRecordingPath) {
      console.log('Creating emergency recording after stop failure');
      
      // Calculate duration
      const recordingEndTime = Date.now();
      const durationMs = recordingEndTime - recordingStartTime;
      const durationFormatted = formatTime(Math.floor(durationMs / 1000));
      
      // Create recording object with emergency data
      const recordingId = currentRecordingPath.split('_').pop().split('.')[0];
      const recording = new Recording({
        id: recordingId,
        title: `${formatDate(recordingStartTime)} (Recovery)`,
        filePath: currentRecordingPath,
        date: formatDate(recordingStartTime),
        duration: durationFormatted,
        processingStatus: 'error'
      });
      
      // Save recording metadata
      await saveRecording(recording);
      
      // Reset variables
      currentRecordingPath = null;
      recordingStartTime = null;
      
      return recording;
    }
    
    throw error;
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

// Save recording metadata
const saveRecording = async (recording) => {
  try {
    // Get existing recordings
    const recordings = await getRecordings();
    
    // Add new recording
    recordings.unshift(recording);
    
    // Save to storage
    const recordingsJson = JSON.stringify(recordings);
    const recordingsDir = await getRecordingsDirectory();
    await RNFS.writeFile(`${recordingsDir}/recordings.json`, recordingsJson, 'utf8');
    
    return true;
  } catch (error) {
    console.error('Error saving recording:', error);
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

// Play recording
export const playRecording = async (filePath, onProgress, onFinished) => {
  try {
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
    console.log('Starting real playback for:', filePath);
    const result = await audioRecorderPlayer.startPlayer(filePath);
    console.log('Playback started:', result);
    
    // Add listener for progress updates
    audioRecorderPlayer.addPlayBackListener((e) => {
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
  } catch (error) {
    console.error('Error playing recording:', error);
    console.error('Error details:', error.message, error.stack);
    throw error;
  }
};

// Pause playback
export const pausePlayback = async () => {
  try {
    // If we're in mock mode, just return success
    if (USE_MOCK_RECORDING) {
      console.log('Pausing mock playback');
      return true;
    }
    
    return await audioRecorderPlayer.pausePlayer();
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
  try {
    // If we're in mock mode, just return success
    if (USE_MOCK_RECORDING) {
      console.log('Resuming mock playback');
      return true;
    }
    
    return await audioRecorderPlayer.resumePlayer();
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
