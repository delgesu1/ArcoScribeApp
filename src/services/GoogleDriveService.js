import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as Keychain from 'react-native-keychain';
import { NativeModules } from 'react-native';
import { getRecordingById, updateRecording } from './AudioRecordingService';

const { BackgroundTransferManager } = NativeModules;

// Google Drive configuration
const GOOGLE_DRIVE_CONFIG = {
  iosClientId: '61774739702-jv8e7u7o5bg4gmb370k578daa8aj4pv7.apps.googleusercontent.com',
  scopes: [
    'https://www.googleapis.com/auth/drive.file',
  ],
};

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

class GoogleDriveService {
  constructor() {
    this.isConfigured = true; // Configuration is handled at app level
    this.appFolderId = null;
    console.log('[GoogleDriveService] Service initialized (configuration handled at app level)');
  }

  // Secure token storage
  async storeTokens(accessToken, refreshToken) {
    try {
      await Keychain.setInternetCredentials(
        'google_drive_tokens',
        'user',
        JSON.stringify({ accessToken, refreshToken, timestamp: Date.now() })
      );
      console.log('[GoogleDriveService] Tokens stored securely');
    } catch (error) {
      console.error('[GoogleDriveService] Failed to store tokens:', error);
      throw error;
    }
  }

  // Retrieve stored tokens
  async getStoredTokens() {
    try {
      const credentials = await Keychain.getInternetCredentials('google_drive_tokens');
      if (credentials) {
        return JSON.parse(credentials.password);
      }
    } catch (error) {
      console.log('[GoogleDriveService] No stored tokens found:', error);
    }
    return null;
  }

  // Clear stored tokens
  async clearTokens() {
    try {
      await Keychain.resetInternetCredentials('google_drive_tokens');
      console.log('[GoogleDriveService] Tokens cleared');
    } catch (error) {
      console.error('[GoogleDriveService] Failed to clear tokens:', error);
    }
  }

  // Get valid access token (with refresh if needed)
  async getValidToken() {
    try {
      // Try to get fresh tokens from GoogleSignin
      const tokens = await GoogleSignin.getTokens();
      if (tokens.accessToken) {
        return tokens.accessToken;
      }

      // Fallback to stored tokens
      const storedTokens = await this.getStoredTokens();
      if (storedTokens && storedTokens.accessToken) {
        return storedTokens.accessToken;
      }

      throw new Error('No valid tokens available');
    } catch (error) {
      console.error('[GoogleDriveService] Failed to get valid token:', error);
      throw new Error('Please reconnect your Google Drive account');
    }
  }

  // Sign in to Google Drive
  async signIn() {
    try {
      if (!this.isConfigured) {
        throw new Error('Google Sign-In not configured');
      }

      const userInfo = await GoogleSignin.signIn();

      // Handle the correct response structure - data is nested
      const userData = userInfo?.data;
      const email = userData?.user?.email || 
                   userData?.email || 
                   userData?.additionalUserInfo?.profile?.email ||
                   userData?.user?.profile?.email ||
                   userInfo?.user?.email || 
                   userInfo?.email;
      
      const idToken = userData?.idToken || userData?.accessToken || userInfo?.idToken || userInfo?.accessToken;

      if (!email) {
        console.error('[GoogleDriveService] Could not find email in Google Sign-In response');
        throw new Error('No email found in Google Sign-In response');
      }

      console.log('[GoogleDriveService] Sign-in successful:', email);

      // Store tokens securely
      if (idToken) {
        await this.storeTokens(idToken, null);
      }

      return userInfo;
    } catch (error) {
      console.error('[GoogleDriveService] Sign-in failed:', error);
      throw error;
    }
  }

  // Check if user is signed in
  async isSignedIn() {
    try {
      // Try to get current user info - if successful, user is signed in
      const userInfo = await GoogleSignin.getCurrentUser();
      return userInfo !== null;
    } catch (error) {
      console.error('[GoogleDriveService] Failed to check sign-in status:', error);
      return false;
    }
  }

  // Sign out
  async signOut() {
    try {
      await GoogleSignin.signOut();
      await this.clearTokens();
      this.appFolderId = null;
      console.log('[GoogleDriveService] Sign-out successful');
    } catch (error) {
      console.error('[GoogleDriveService] Sign-out failed:', error);
      throw error;
    }
  }

  // Create or find app folder in Google Drive
  async getOrCreateAppFolder() {
    if (this.appFolderId) {
      return this.appFolderId;
    }

    try {
      const token = await this.getValidToken();

      // Search for existing folder
      const searchResponse = await fetch(
        `${DRIVE_API_BASE}/files?q=name='ArcoScribe Recordings' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );

      if (!searchResponse.ok) {
        throw new Error(`Drive API search failed: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();

      if (searchData.files && searchData.files.length > 0) {
        this.appFolderId = searchData.files[0].id;
        console.log('[GoogleDriveService] Found existing app folder:', this.appFolderId);
        return this.appFolderId;
      }

      // Create new folder
      const createResponse = await fetch(`${DRIVE_API_BASE}/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ArcoScribe Recordings',
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });

      if (!createResponse.ok) {
        throw new Error(`Failed to create app folder: ${createResponse.status}`);
      }

      const folderData = await createResponse.json();
      this.appFolderId = folderData.id;
      console.log('[GoogleDriveService] Created new app folder:', this.appFolderId);
      return this.appFolderId;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to get/create app folder:', error);
      throw error;
    }
  }

  // Create recording subfolder (organized by date)
  async createRecordingFolder(recordingTitle, recordingDate) {
    try {
      const appFolderId = await this.getOrCreateAppFolder();

      // Create date-based organization: YYYY/Month/
      // Handle formatted date strings like "Jul 1, 2025 at 2:10 AM"
      let date = this.parseRecordingDate(recordingDate);

      const year = date.getFullYear().toString();
      const month = date.toLocaleDateString('en-US', { month: 'long' });

      // Get or create year folder
      const yearFolderId = await this.getOrCreateSubfolder(appFolderId, year);

      // Get or create month folder
      const monthFolderId = await this.getOrCreateSubfolder(yearFolderId, month);

      // Create recording-specific folder with timestamp for uniqueness
      const sanitizedTitle = this.sanitizeFolderName(recordingTitle);
      const timestamp = date.toISOString().slice(0, 19).replace(/[T:]/g, '-'); // YYYY-MM-DD-HH-MM-SS
      const recordingFolderName = `${sanitizedTitle}_${timestamp}`;

      const recordingFolderId = await this.getOrCreateSubfolder(monthFolderId, recordingFolderName);

      console.log('[GoogleDriveService] Created recording folder:', recordingFolderName);
      return recordingFolderId;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to create recording folder:', error);
      throw error;
    }
  }

  // Alternative folder organization: flat structure
  async createRecordingFolderFlat(recordingTitle, recordingDate) {
    try {
      const appFolderId = await this.getOrCreateAppFolder();

      // Create recording-specific folder directly under app folder
      // Handle formatted date strings like "Jul 1, 2025 at 2:10 AM"
      let date = this.parseRecordingDate(recordingDate);

      const sanitizedTitle = this.sanitizeFolderName(recordingTitle);
      const timestamp = date.toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const recordingFolderName = `${sanitizedTitle}_${timestamp}`;

      const recordingFolderId = await this.getOrCreateSubfolder(appFolderId, recordingFolderName);

      console.log('[GoogleDriveService] Created flat recording folder:', recordingFolderName);
      return recordingFolderId;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to create flat recording folder:', error);
      throw error;
    }
  }

  // Helper: Get or create subfolder
  async getOrCreateSubfolder(parentId, folderName) {
    try {
      const token = await this.getValidToken();

      // Sanitize folder name for Drive compatibility
      const sanitizedFolderName = this.sanitizeFolderName(folderName);

      // Search for existing subfolder
      const searchQuery = `name='${sanitizedFolderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const searchResponse = await fetch(
        `${DRIVE_API_BASE}/files?q=${encodeURIComponent(searchQuery)}`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );

      if (!searchResponse.ok) {
        throw new Error(`Drive API search failed: ${searchResponse.status} ${searchResponse.statusText}`);
      }

      const searchData = await searchResponse.json();

      if (searchData.files && searchData.files.length > 0) {
        console.log(`[GoogleDriveService] Found existing folder: ${sanitizedFolderName}`);
        return searchData.files[0].id;
      }

      // Create new subfolder
      const createResponse = await fetch(`${DRIVE_API_BASE}/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: sanitizedFolderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Failed to create folder: ${createResponse.status} ${createResponse.statusText} - ${errorText}`);
      }

      const folderData = await createResponse.json();
      console.log(`[GoogleDriveService] Created new folder: ${sanitizedFolderName} (${folderData.id})`);
      return folderData.id;

    } catch (error) {
      console.error(`[GoogleDriveService] Failed to get/create subfolder "${folderName}":`, error);
      throw error;
    }
  }

  // Helper: Sanitize folder name for Google Drive compatibility
  sanitizeFolderName(name) {
    if (!name || typeof name !== 'string') {
      return 'Untitled';
    }

    // Replace invalid characters and limit length
    return name
      .replace(/[/\\?%*:|"<>]/g, '-')  // Replace invalid chars with dash
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .trim()                          // Remove leading/trailing whitespace
      .substring(0, 100);              // Limit to 100 characters
  }

  // Helper: Parse recording date strings into Date objects
  parseRecordingDate(recordingDate) {
    console.log('[GoogleDriveService] Parsing recording date:', recordingDate, 'Type:', typeof recordingDate);

    // If it's already a Date object, return it
    if (recordingDate instanceof Date) {
      if (isNaN(recordingDate.getTime())) {
        console.warn('[GoogleDriveService] Date object is invalid, using current date');
        return new Date();
      }
      return recordingDate;
    }

    // If it's a number (timestamp), convert to Date
    if (typeof recordingDate === 'number') {
      const date = new Date(recordingDate);
      if (isNaN(date.getTime())) {
        console.warn('[GoogleDriveService] Timestamp is invalid, using current date');
        return new Date();
      }
      return date;
    }

    // If it's not a string, use current date
    if (typeof recordingDate !== 'string') {
      console.warn('[GoogleDriveService] Recording date is not a string, using current date. Received:', recordingDate);
      return new Date();
    }

    // Try parsing the string directly first
    let date = new Date(recordingDate);
    if (!isNaN(date.getTime())) {
      console.log('[GoogleDriveService] Successfully parsed date directly:', date);
      return date;
    }

    // If direct parsing fails, try to extract date components from formatted strings
    // Handle formats like "Jul 1, 2025 at 2:10 AM" or "Jul 1, 2025"
    const patterns = [
      // Pattern 1: "Jul 1, 2025 at 2:10 AM" - extract just the date part
      /(\w{3})\s+(\d{1,2}),\s+(\d{4})/,
      // Pattern 2: "2025-07-01" ISO-like format
      /(\d{4})-(\d{1,2})-(\d{1,2})/,
      // Pattern 3: "07/01/2025" US format
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    ];

    for (const pattern of patterns) {
      const match = recordingDate.match(pattern);
      if (match) {
        console.log('[GoogleDriveService] Matched pattern:', pattern, 'Result:', match);
        
        if (pattern === patterns[0]) {
          // Month name, day, year format
          const [, month, day, year] = match;
          date = new Date(`${month} ${day}, ${year}`);
        } else if (pattern === patterns[1]) {
          // ISO-like format
          const [, year, month, day] = match;
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else if (pattern === patterns[2]) {
          // US format (MM/DD/YYYY)
          const [, month, day, year] = match;
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }

        if (!isNaN(date.getTime())) {
          console.log('[GoogleDriveService] Successfully parsed date with pattern:', date);
          return date;
        }
      }
    }

    // If all parsing attempts fail, use current date as fallback
    console.warn('[GoogleDriveService] All date parsing attempts failed for:', recordingDate, 'Using current date');
    return new Date();
  }

  // Verify folder exists and is accessible
  async verifyFolderAccess(folderId) {
    try {
      const token = await this.getValidToken();

      const response = await fetch(`${DRIVE_API_BASE}/files/${folderId}?fields=id,name,parents,trashed`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        return false;
      }

      const folderData = await response.json();
      return !folderData.trashed;

    } catch (error) {
      console.error('[GoogleDriveService] Error verifying folder access:', error);
      return false;
    }
  }

  // Get folder contents (for debugging/management)
  async getFolderContents(folderId, maxResults = 100) {
    try {
      const token = await this.getValidToken();

      const response = await fetch(
        `${DRIVE_API_BASE}/files?q='${folderId}' in parents and trashed=false&pageSize=${maxResults}&fields=files(id,name,mimeType,createdTime,size)`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get folder contents: ${response.status}`);
      }

      const data = await response.json();
      return data.files || [];

    } catch (error) {
      console.error('[GoogleDriveService] Error getting folder contents:', error);
      throw error;
    }
  }

  // Upload file to Google Drive using BackgroundTransferManager
  async uploadFile(filePath, fileName, parentFolderId, fileType = 'file') {
    try {
      const token = await this.getValidToken();

      // Validate inputs
      if (!filePath || !fileName || !parentFolderId) {
        throw new Error('Missing required parameters: filePath, fileName, or parentFolderId');
      }

      // Ensure parent folder exists
      const folderExists = await this.verifyFolderAccess(parentFolderId);
      if (!folderExists) {
        throw new Error(`Parent folder ${parentFolderId} does not exist or is not accessible`);
      }

      // Check if file exists locally
      const RNFS = require('react-native-fs');
      const fileExists = await RNFS.exists(filePath);
      if (!fileExists) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Get file stats for metadata
      const fileStats = await RNFS.stat(filePath);

      const metadata = {
        name: fileName,
        parents: [parentFolderId],
        description: `ArcoScribe recording uploaded on ${new Date().toISOString()}`,
      };

      // Use existing BackgroundTransferManager for consistency
      const taskId = await BackgroundTransferManager.startUploadTask({
        filePath: filePath,
        apiUrl: `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/related',
        },
        body: JSON.stringify(metadata),
        taskType: 'driveUpload',
        metadata: {
          fileName,
          parentFolderId,
          fileType,
          originalFilePath: filePath,
          fileSize: fileStats.size,
          uploadStartTime: new Date().toISOString(),
        },
      });

      console.log('[GoogleDriveService] Started upload task:', taskId, 'for file:', fileName, `(${Math.round(fileStats.size / 1024 / 1024 * 100) / 100} MB)`);
      return taskId;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to start file upload:', error);
      throw error;
    }
  }

  // Batch upload multiple files
  async uploadMultipleFiles(uploads) {
    const results = [];
    const errors = [];

    for (const upload of uploads) {
      try {
        const { filePath, fileName, parentFolderId, fileType } = upload;
        const result = await this.uploadFile(filePath, fileName, parentFolderId, fileType);
        results.push({ ...upload, taskId: result, status: 'started' });
      } catch (error) {
        console.error(`[GoogleDriveService] Failed to start upload for ${upload.fileName}:`, error);
        errors.push({ ...upload, error: error.message });
      }
    }

    return { results, errors };
  }

  // Upload text content (transcript, summary) as file
  async uploadTextFile(content, fileName, parentFolderId, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 1000 * Math.pow(2, retryCount); // Exponential backoff

    try {
      const token = await this.getValidToken();

      // Validate inputs
      if (!content || typeof content !== 'string') {
        throw new Error('Invalid content provided');
      }

      if (!fileName || !parentFolderId) {
        throw new Error('Missing required parameters: fileName or parentFolderId');
      }

      // Ensure parent folder exists
      const folderExists = await this.verifyFolderAccess(parentFolderId);
      if (!folderExists) {
        throw new Error(`Parent folder ${parentFolderId} does not exist or is not accessible`);
      }

      const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/related; boundary="foo_bar_baz"',
        },
        body: this.createMultipartBody({
          name: fileName,
          parents: [parentFolderId],
        }, content, fileName.endsWith('.md') ? 'text/markdown' : 'text/plain'),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[GoogleDriveService] Text file uploaded:', fileName, result.id);
      return result.id;

    } catch (error) {
      console.error(`[GoogleDriveService] Failed to upload text file (attempt ${retryCount + 1}):`, error);

      // Retry on specific errors
      if (retryCount < maxRetries && this.isRetryableError(error)) {
        console.log(`[GoogleDriveService] Retrying text upload in ${retryDelay}ms...`);
        await this.delay(retryDelay);
        return this.uploadTextFile(content, fileName, parentFolderId, retryCount + 1);
      }

      throw error;
    }
  }

  // Upload text content as Google Doc (for transcripts)
  async uploadTextAsGoogleDoc(content, docName, parentFolderId, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 1000 * Math.pow(2, retryCount); // Exponential backoff

    try {
      const token = await this.getValidToken();

      // Validate inputs
      if (!content || typeof content !== 'string') {
        throw new Error('Invalid content provided');
      }

      if (!docName || !parentFolderId) {
        throw new Error('Missing required parameters: docName or parentFolderId');
      }

      // Ensure parent folder exists
      const folderExists = await this.verifyFolderAccess(parentFolderId);
      if (!folderExists) {
        throw new Error(`Parent folder ${parentFolderId} does not exist or is not accessible`);
      }

      const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/related; boundary="foo_bar_baz"',
        },
        body: this.createMultipartBody({
          name: docName,
          mimeType: 'application/vnd.google-apps.document', // Convert to Google Doc
          parents: [parentFolderId],
        }, content, 'text/plain'), // Source content as plain text
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Doc upload failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[GoogleDriveService] Google Doc uploaded:', docName, result.id);
      return result.id;

    } catch (error) {
      console.error(`[GoogleDriveService] Failed to upload Google Doc (attempt ${retryCount + 1}):`, error);

      // Retry on specific errors
      if (retryCount < maxRetries && this.isRetryableError(error)) {
        console.log(`[GoogleDriveService] Retrying Google Doc upload in ${retryDelay}ms...`);
        await this.delay(retryDelay);
        return this.uploadTextAsGoogleDoc(content, docName, parentFolderId, retryCount + 1);
      }

      throw error;
    }
  }

  // Check if error is retryable
  isRetryableError(error) {
    const retryablePatterns = [
      /network/i,
      /timeout/i,
      /502/,
      /503/,
      /504/,
      /rate limit/i,
      /quota/i,
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  // Utility: Delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper: Create multipart body for uploads
  createMultipartBody(metadata, content, mimeType) {
    const delimiter = 'foo_bar_baz';
    let body = '';

    body += `--${delimiter}\r\n`;
    body += 'Content-Type: application/json\r\n\r\n';
    body += JSON.stringify(metadata) + '\r\n';

    body += `--${delimiter}\r\n`;
    body += `Content-Type: ${mimeType}\r\n\r\n`;
    body += content + '\r\n';

    body += `--${delimiter}--\r\n`;

    return body;
  }

  // Main sync function - sync a recording to Google Drive
  async syncRecording(recordingId) {
    try {
      console.log('[GoogleDriveService] Starting sync for recording:', recordingId);
      
      // Get recording metadata from local storage
      const recording = await getRecordingById(recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }

      // Create recording folder in Drive
      const recordingFolderId = await this.createRecordingFolder(
        recording.title || 'Untitled Recording',
        recording.date
      );

      const results = {
        folderId: recordingFolderId,
        uploads: [],
        errors: [],
      };

      // Upload audio file
      if (recording.filePath) {
        try {
          const RNFS = require('react-native-fs');
          const audioExists = await RNFS.exists(recording.filePath);
          
          if (audioExists) {
            const audioFileName = `${recording.title || 'Recording'}.m4a`;
            const audioTaskId = await this.uploadFile(
              recording.filePath,
              audioFileName,
              recordingFolderId,
              'audio'
            );
            results.uploads.push({
              type: 'audio',
              fileName: audioFileName,
              taskId: audioTaskId,
            });
          } else {
            console.warn('[GoogleDriveService] Audio file not found:', recording.filePath);
            results.errors.push({
              type: 'audio',
              error: 'Audio file not found',
            });
          }
        } catch (error) {
          console.error('[GoogleDriveService] Failed to upload audio:', error);
          results.errors.push({
            type: 'audio',
            error: error.message,
          });
        }
      }

      // Upload transcript as Google Doc
      if (recording.transcript) {
        try {
          const transcriptName = `${recording.title || 'Recording'}_Transcript`;
          const transcriptId = await this.uploadTextAsGoogleDoc(
            recording.transcript,
            transcriptName,
            recordingFolderId
          );
          results.uploads.push({
            type: 'transcript',
            fileName: transcriptName,
            fileId: transcriptId,
          });
        } catch (error) {
          console.error('[GoogleDriveService] Failed to upload transcript:', error);
          results.errors.push({
            type: 'transcript',
            error: error.message,
          });
        }
      }

      // Upload summary as markdown file
      if (recording.summary) {
        try {
          const summaryName = `${recording.title || 'Recording'}_Summary.md`;
          const summaryId = await this.uploadTextFile(
            recording.summary,
            summaryName,
            recordingFolderId
          );
          results.uploads.push({
            type: 'summary',
            fileName: summaryName,
            fileId: summaryId,
          });
        } catch (error) {
          console.error('[GoogleDriveService] Failed to upload summary:', error);
          results.errors.push({
            type: 'summary',
            error: error.message,
          });
        }
      }

      // Update recording with sync metadata
      await updateRecording(recordingId, {
        googleDriveSync: {
          folderId: recordingFolderId,
          lastSynced: new Date().toISOString(),
          uploads: results.uploads,
        },
      });

      console.log('[GoogleDriveService] Sync completed for recording:', recordingId, results);
      return results;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to sync recording:', error);
      throw error;
    }
  }

  // Get active upload tasks
  async getActiveUploadTasks() {
    try {
      const tasks = await BackgroundTransferManager.getActiveTasks();
      return tasks.filter(task => task.taskType === 'driveUpload');
    } catch (error) {
      console.error('[GoogleDriveService] Failed to get active upload tasks:', error);
      return [];
    }
  }

  // Cancel upload task
  async cancelUploadTask(taskId) {
    try {
      await BackgroundTransferManager.cancelTask(taskId);
      console.log('[GoogleDriveService] Cancelled upload task:', taskId);
    } catch (error) {
      console.error('[GoogleDriveService] Failed to cancel upload task:', error);
      throw error;
    }
  }

  // Check upload task status
  async getUploadTaskStatus(taskId) {
    try {
      const tasks = await this.getActiveUploadTasks();
      return tasks.find(task => task.taskId === taskId);
    } catch (error) {
      console.error('[GoogleDriveService] Failed to get upload task status:', error);
      return null;
    }
  }

  // Export recording as PDF to Google Drive
  async exportRecordingAsPDF(recordingId, pdfContent, fileName) {
    try {
      const recording = await getRecordingById(recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }

      // Get or use existing folder
      let folderId;
      if (recording.googleDriveSync?.folderId) {
        folderId = recording.googleDriveSync.folderId;
      } else {
        // Create new folder if not synced before
        folderId = await this.createRecordingFolder(
          recording.title || 'Untitled Recording',
          recording.date
        );
      }

      // Upload PDF file
      const pdfFileName = fileName || `${recording.title || 'Recording'}_Report.pdf`;
      const pdfId = await this.uploadFile(
        pdfContent,
        pdfFileName,
        folderId,
        'pdf'
      );

      console.log('[GoogleDriveService] PDF exported to Google Drive:', pdfFileName, pdfId);
      return { fileId: pdfId, fileName: pdfFileName, folderId };

    } catch (error) {
      console.error('[GoogleDriveService] Failed to export PDF:', error);
      throw error;
    }
  }

  // Create shareable link for a file
  async createShareableLink(fileId, permissions = 'reader') {
    try {
      const token = await this.getValidToken();

      // Create permission for anyone with link
      const permissionResponse = await fetch(`${DRIVE_API_BASE}/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'anyone',
          role: permissions,
        }),
      });

      if (!permissionResponse.ok) {
        throw new Error(`Failed to create permission: ${permissionResponse.status}`);
      }

      // Get the shareable link
      const fileResponse = await fetch(`${DRIVE_API_BASE}/files/${fileId}?fields=webViewLink,webContentLink`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!fileResponse.ok) {
        throw new Error(`Failed to get file info: ${fileResponse.status}`);
      }

      const fileData = await fileResponse.json();
      return {
        viewLink: fileData.webViewLink,
        downloadLink: fileData.webContentLink,
      };

    } catch (error) {
      console.error('[GoogleDriveService] Failed to create shareable link:', error);
      throw error;
    }
  }

  // Delete file or folder
  async deleteFile(fileId) {
    try {
      const token = await this.getValidToken();

      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete file: ${response.status}`);
      }

      console.log('[GoogleDriveService] File deleted:', fileId);
      return true;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to delete file:', error);
      throw error;
    }
  }

  // Move file to a different folder
  async moveFile(fileId, newParentId, removeFromCurrentParents = true) {
    try {
      const token = await this.getValidToken();

      let url = `${DRIVE_API_BASE}/files/${fileId}?addParents=${newParentId}`;
      
      if (removeFromCurrentParents) {
        // Get current parents first
        const fileResponse = await fetch(`${DRIVE_API_BASE}/files/${fileId}?fields=parents`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        
        if (fileResponse.ok) {
          const fileData = await fileResponse.json();
          if (fileData.parents && fileData.parents.length > 0) {
            url += `&removeParents=${fileData.parents.join(',')}`;
          }
        }
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to move file: ${response.status}`);
      }

      console.log('[GoogleDriveService] File moved:', fileId, 'to', newParentId);
      return true;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to move file:', error);
      throw error;
    }
  }

  // Rename file or folder
  async renameFile(fileId, newName) {
    try {
      const token = await this.getValidToken();

      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to rename file: ${response.status}`);
      }

      console.log('[GoogleDriveService] File renamed:', fileId, 'to', newName);
      return true;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to rename file:', error);
      throw error;
    }
  }

  // Get file metadata
  async getFileMetadata(fileId) {
    try {
      const token = await this.getValidToken();

      const response = await fetch(
        `${DRIVE_API_BASE}/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get file metadata: ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      console.error('[GoogleDriveService] Failed to get file metadata:', error);
      throw error;
    }
  }

  // Search for files
  async searchFiles(query, pageSize = 10) {
    try {
      const token = await this.getValidToken();

      const response = await fetch(
        `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&pageSize=${pageSize}&fields=files(id,name,mimeType,createdTime,size)`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();
      return data.files || [];

    } catch (error) {
      console.error('[GoogleDriveService] Search failed:', error);
      throw error;
    }
  }

  // Get storage quota info
  async getStorageQuota() {
    try {
      const token = await this.getValidToken();

      const response = await fetch(
        `${DRIVE_API_BASE}/about?fields=storageQuota`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get storage quota: ${response.status}`);
      }

      const data = await response.json();
      return data.storageQuota;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to get storage quota:', error);
      throw error;
    }
  }

  // Batch delete multiple files
  async batchDelete(fileIds) {
    const results = [];
    const errors = [];

    for (const fileId of fileIds) {
      try {
        await this.deleteFile(fileId);
        results.push({ fileId, status: 'deleted' });
      } catch (error) {
        console.error(`[GoogleDriveService] Failed to delete file ${fileId}:`, error);
        errors.push({ fileId, error: error.message });
      }
    }

    return { results, errors };
  }

  // Clean up orphaned files (files not in any folder)
  async cleanupOrphanedFiles() {
    try {
      const appFolderId = await this.getOrCreateAppFolder();
      const orphanedFiles = await this.searchFiles(
        `'${appFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and not 'me' in parents`
      );

      console.log('[GoogleDriveService] Found orphaned files:', orphanedFiles.length);
      return orphanedFiles;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to find orphaned files:', error);
      throw error;
    }
  }

  // Get all recording folders
  async getAllRecordingFolders() {
    try {
      const appFolderId = await this.getOrCreateAppFolder();
      const folders = await this.searchFiles(
        `'${appFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
        100
      );

      console.log('[GoogleDriveService] Found recording folders:', folders.length);
      return folders;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to get recording folders:', error);
      throw error;
    }
  }

  // Verify Drive API access
  async verifyAccess() {
    try {
      const token = await this.getValidToken();
      
      const response = await fetch(
        `${DRIVE_API_BASE}/about?fields=user`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Drive API access check failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('[GoogleDriveService] Drive API access verified for:', data.user.emailAddress);
      return true;

    } catch (error) {
      console.error('[GoogleDriveService] Drive API access verification failed:', error);
      return false;
    }
  }

}

// Export singleton instance
export default new GoogleDriveService();
