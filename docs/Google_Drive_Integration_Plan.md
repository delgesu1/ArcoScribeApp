# Google Drive Integration Master Plan
*ArcoScribeApp - Comprehensive Implementation Guide*

## 📋 Implementation Status Tracker

### Phase 1: Foundation Setup
- [ ] 1.1 Google Cloud Console Configuration
- [ ] 1.2 Install React Native Dependencies  
- [ ] 1.3 iOS Xcode Configuration
- [ ] 1.4 Core GoogleDriveService Creation
- [ ] 1.5 Data Model Updates

### Phase 2: Service Integration
- [ ] 2.1 BackgroundTransferService Extension
- [ ] 2.2 Token Management Implementation
- [ ] 2.3 Folder Creation & Management
- [ ] 2.4 File Upload Implementation

### Phase 3: User Interface
- [ ] 3.1 Google Drive Settings Screen
- [ ] 3.2 Recording Detail Screen Updates
- [ ] 3.3 Home Screen Integration
- [ ] 3.4 Sync Status Components

### Phase 4: Background Processing
- [ ] 4.1 Auto-sync After Processing
- [ ] 4.2 Manual Sync Implementation
- [ ] 4.3 Error Handling & Retry Logic
- [ ] 4.4 Offline Queue Management

### Phase 5: Testing & Polish
- [ ] 5.1 Background Upload Testing
- [ ] 5.2 Network Failure Testing
- [ ] 5.3 Token Refresh Testing
- [ ] 5.4 App Store Preparation

---

## 🎯 Technical Assessment

### ✅ Provided Instructions Validation
The Google Drive integration instructions provided are **technically sound and comprehensive**:
- OAuth 2.0 setup with correct client ID format
- React Native library choice (`@react-native-google-signin/google-signin`) is appropriate
- Security practices (Keychain storage, token refresh) are industry-standard
- Error handling strategies cover all major failure scenarios
- App Store compliance requirements are complete

### 🏗️ Architecture Integration Strategy
**Leverage Existing ArcoScribeApp Infrastructure:**
- Use existing `BackgroundTransferManager` for Google Drive uploads
- Extend current event system (`onTransferComplete`/`onTransferError`)
- Build on existing `Recording` data model with Google Drive fields
- Integrate with current file management in `AudioRecordingService`

---

## 📦 Phase 1: Foundation Setup

### 1.1 Google Cloud Console Configuration

**Prerequisites Checklist:**
- [ ] Google Cloud project created
- [ ] OAuth 2.0 Client ID obtained: `61774739702-jv8e7u7o5bg4gmb370k578daa8aj4pv7.apps.googleusercontent.com`
- [ ] Test user emails added to OAuth consent screen

**Required Actions:**
1. **Enable Google Drive API**
   ```
   Google Cloud Console → APIs & Services → Library → Google Drive API → Enable
   ```

2. **Publish OAuth Consent Screen**
   ```
   OAuth consent screen → Publish App
   ```

3. **Configure App Check (Optional but Recommended)**
   ```
   APIs & Services → OAuth consent screen → App verification
   ```

### 1.2 Install React Native Dependencies

**Package Installation:**
```bash
# Core Google Sign-In library
npm install @react-native-google-signin/google-signin

# Secure token storage
npm install react-native-keychain

# Update iOS dependencies
cd ios && pod install && cd ..
```

**Package Validation:**
- [ ] `@react-native-google-signin/google-signin` installed
- [ ] `react-native-keychain` installed  
- [ ] CocoaPods updated successfully
- [ ] No build errors after installation

### 1.3 iOS Xcode Configuration

**Info.plist Updates:**
```xml
<!-- Add to ios/ArcoScribeApp/Info.plist -->

<!-- URL Schemes for OAuth redirect -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.googleusercontent.apps.61774739702-jv8e7u7o5bg4gmb370k578daa8aj4pv7</string>
    </array>
  </dict>
</array>

<!-- Allow app to query Google apps -->
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>google</string>
  <string>com.googleusercontent.apps.61774739702-jv8e7u7o5bg4gmb370k578daa8aj4pv7</string>
</array>

<!-- Privacy usage descriptions -->
<key>NSUserTrackingUsageDescription</key>
<string>This app uses Google Drive to sync your recording transcripts and summaries.</string>
```

**Background Modes (Already Configured):**
```xml
<!-- Verify these exist in Info.plist -->
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
  <string>fetch</string>
  <string>processing</string>
</array>
```

### 1.4 Core GoogleDriveService Creation

**File: `src/services/GoogleDriveService.js`**
```javascript
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as Keychain from 'react-native-keychain';
import { NativeModules } from 'react-native';
import { getRecordingById, updateRecording } from './AudioRecordingService';

const { BackgroundTransferManager } = NativeModules;

// Google Drive configuration
const GOOGLE_DRIVE_CONFIG = {
  iosClientId: '61774739702-jv8e7u7o5bg4gmb370k578daa8aj4pv7.apps.googleusercontent.com',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
};

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

class GoogleDriveService {
  constructor() {
    this.isConfigured = false;
    this.appFolderId = null;
    this.setupGoogleSignIn();
  }

  // Initialize Google Sign-In configuration
  setupGoogleSignIn() {
    try {
      GoogleSignin.configure(GOOGLE_DRIVE_CONFIG);
      this.isConfigured = true;
      console.log('[GoogleDriveService] Google Sign-In configured successfully');
    } catch (error) {
      console.error('[GoogleDriveService] Failed to configure Google Sign-In:', error);
    }
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
      console.log('[GoogleDriveService] Sign-in successful:', userInfo.user.email);

      // Store tokens securely
      if (userInfo.idToken) {
        await this.storeTokens(userInfo.idToken, null);
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
      const isSignedIn = await GoogleSignin.isSignedIn();
      return isSignedIn;
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
          headers: { 'Authorization': `Bearer ${token}` }
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'ArcoScribe Recordings',
          mimeType: 'application/vnd.google-apps.folder'
        })
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
      const token = await this.getValidToken();

      // Create date-based organization: YYYY/Month/
      const date = new Date(recordingDate);
      const year = date.getFullYear().toString();
      const month = date.toLocaleDateString('en-US', { month: 'long' });

      // Get or create year folder
      const yearFolderId = await this.getOrCreateSubfolder(appFolderId, year);
      
      // Get or create month folder
      const monthFolderId = await this.getOrCreateSubfolder(yearFolderId, month);

      // Create recording-specific folder
      const recordingFolderName = `${recordingTitle.replace(/[/\\?%*:|"<>]/g, '-')}_${date.getTime()}`;
      const recordingFolderId = await this.getOrCreateSubfolder(monthFolderId, recordingFolderName);

      console.log('[GoogleDriveService] Created recording folder:', recordingFolderName);
      return recordingFolderId;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to create recording folder:', error);
      throw error;
    }
  }

  // Helper: Get or create subfolder
  async getOrCreateSubfolder(parentId, folderName) {
    try {
      const token = await this.getValidToken();

      // Search for existing subfolder
      const searchQuery = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const searchResponse = await fetch(
        `${DRIVE_API_BASE}/files?q=${encodeURIComponent(searchQuery)}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const searchData = await searchResponse.json();

      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
      }

      // Create new subfolder
      const createResponse = await fetch(`${DRIVE_API_BASE}/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId]
        })
      });

      const folderData = await createResponse.json();
      return folderData.id;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to get/create subfolder:', error);
      throw error;
    }
  }

  // Upload file to Google Drive using BackgroundTransferManager
  async uploadFile(filePath, fileName, parentFolderId, fileType = 'file') {
    try {
      const token = await this.getValidToken();

      const metadata = {
        name: fileName,
        parents: [parentFolderId]
      };

      // Use existing BackgroundTransferManager for consistency
      const taskId = await BackgroundTransferManager.startUploadTask({
        filePath: filePath,
        apiUrl: `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/related'
        },
        body: JSON.stringify(metadata),
        taskType: 'driveUpload',
        metadata: { 
          fileName, 
          parentFolderId, 
          fileType,
          originalFilePath: filePath 
        }
      });

      console.log('[GoogleDriveService] Started upload task:', taskId, 'for file:', fileName);
      return taskId;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to start file upload:', error);
      throw error;
    }
  }

  // Upload text content (transcript, summary) as file
  async uploadTextFile(content, fileName, parentFolderId) {
    try {
      const token = await this.getValidToken();

      const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/related; boundary="foo_bar_baz"'
        },
        body: this.createMultipartBody({
          name: fileName,
          parents: [parentFolderId]
        }, content, 'text/plain')
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('[GoogleDriveService] Text file uploaded:', fileName, result.id);
      return result.id;

    } catch (error) {
      console.error('[GoogleDriveService] Failed to upload text file:', error);
      throw error;
    }
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

  // Sync recording to Google Drive
  async syncRecording(recordingId) {
    try {
      console.log('[GoogleDriveService] Starting sync for recording:', recordingId);

      const recording = await getRecordingById(recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }

      // Update sync status
      await updateRecording({
        ...recording,
        driveSyncStatus: 'syncing'
      });

      // Create recording folder
      const recordingFolderId = await this.createRecordingFolder(recording.title, recording.date);

      const driveFileIds = {};

      // Upload transcript if available
      if (recording.transcript) {
        const transcriptId = await this.uploadTextFile(
          recording.transcript,
          'transcript.txt',
          recordingFolderId
        );
        driveFileIds.transcript = transcriptId;
      }

      // Upload summary if available
      if (recording.summary) {
        const summaryId = await this.uploadTextFile(
          recording.summary,
          'summary.md',
          recordingFolderId
        );
        driveFileIds.summary = summaryId;
      }

      // Upload audio file (optional, based on user preference)
      // This would be handled by BackgroundTransferManager for large files
      // if (recording.filePath && userWantsAudioSync) {
      //   const audioTaskId = await this.uploadFile(
      //     recording.filePath,
      //     'audio.m4a',
      //     recordingFolderId,
      //     'audio'
      //   );
      //   driveFileIds.audio = audioTaskId; // Store task ID temporarily
      // }

      // Update recording with sync info
      await updateRecording({
        ...recording,
        driveSyncStatus: 'synced',
        driveFileIds,
        lastSyncDate: new Date().toISOString(),
        driveFolderId: recordingFolderId
      });

      console.log('[GoogleDriveService] Sync completed for recording:', recordingId);
      return { success: true, driveFileIds };

    } catch (error) {
      console.error('[GoogleDriveService] Sync failed for recording:', recordingId, error);

      // Update recording with error status
      try {
        const recording = await getRecordingById(recordingId);
        if (recording) {
          await updateRecording({
            ...recording,
            driveSyncStatus: 'error',
            lastSyncError: error.message
          });
        }
      } catch (updateError) {
        console.error('[GoogleDriveService] Failed to update error status:', updateError);
      }

      throw error;
    }
  }
}

// Export singleton instance
export default new GoogleDriveService();
```

### 1.5 Data Model Updates

**File: `src/utils/DataModels.js` - Updates**
```javascript
// Recording data model - ADD these fields to existing constructor
export class Recording {
  constructor({
    id,
    title,
    filePath,
    date,
    duration,
    transcript = null,
    summary = null,
    processingStatus = 'pending',
    userModifiedTitle = false,
    // NEW GOOGLE DRIVE FIELDS
    driveSyncStatus = 'none', // 'none' | 'pending' | 'syncing' | 'synced' | 'error'
    driveFileIds = {}, // { audio: string, transcript: string, summary: string }
    driveFolderId = null, // Google Drive folder ID for this recording
    lastSyncDate = null, // ISO string of last successful sync
    lastSyncError = null, // Error message if sync failed
    syncPreferences = { // User preferences for this recording
      syncAudio: false,
      syncTranscript: true,
      syncSummary: true
    }
  }) {
    // ... existing fields ...
    
    // Google Drive sync fields
    this.driveSyncStatus = driveSyncStatus;
    this.driveFileIds = driveFileIds;
    this.driveFolderId = driveFolderId;
    this.lastSyncDate = lastSyncDate;
    this.lastSyncError = lastSyncError;
    this.syncPreferences = syncPreferences;
  }

  // Update toJSON() method to include new fields
  toJSON() {
    return {
      // ... existing fields ...
      driveSyncStatus: this.driveSyncStatus,
      driveFileIds: this.driveFileIds,
      driveFolderId: this.driveFolderId,
      lastSyncDate: this.lastSyncDate,
      lastSyncError: this.lastSyncError,
      syncPreferences: this.syncPreferences
    };
  }
}

// NEW: Google Drive Settings data model
export class GoogleDriveSettings {
  constructor({
    isConnected = false,
    userEmail = null,
    autoSyncEnabled = true,
    syncAudioFiles = false, // Large files, default off
    syncTranscripts = true,
    syncSummaries = true,
    folderOrganization = 'date', // 'date' | 'flat'
    lastSyncDate = null,
    totalSyncedFiles = 0
  }) {
    this.isConnected = isConnected;
    this.userEmail = userEmail;
    this.autoSyncEnabled = autoSyncEnabled;
    this.syncAudioFiles = syncAudioFiles;
    this.syncTranscripts = syncTranscripts;
    this.syncSummaries = syncSummaries;
    this.folderOrganization = folderOrganization;
    this.lastSyncDate = lastSyncDate;
    this.totalSyncedFiles = totalSyncedFiles;
  }

  toJSON() {
    return {
      isConnected: this.isConnected,
      userEmail: this.userEmail,
      autoSyncEnabled: this.autoSyncEnabled,
      syncAudioFiles: this.syncAudioFiles,
      syncTranscripts: this.syncTranscripts,
      syncSummaries: this.syncSummaries,
      folderOrganization: this.folderOrganization,
      lastSyncDate: this.lastSyncDate,
      totalSyncedFiles: this.totalSyncedFiles
    };
  }

  static fromJSON(json) {
    return new GoogleDriveSettings(json);
  }
}
```

---

## 📡 Phase 2: Service Integration

### 2.1 BackgroundTransferService Extension

**File: `src/services/BackgroundTransferService.js` - Add Google Drive Support**

**Add to existing event listener setup:**
```javascript
// ADD this to existing setupEventListeners() method
transferEmitter.addListener('onTransferComplete', async (event) => {
  // ... existing handlers ...
  
  else if (taskType === 'driveUpload') {
    await this.handleDriveUploadComplete(recordingId, response);
  }
});

transferEmitter.addListener('onTransferError', async (event) => {
  // ... existing handlers ...
  
  if (taskType === 'driveUpload') {
    await this.handleDriveUploadError(taskId, recordingId, error);
  }
});
```

**Add new handler methods:**
```javascript
// ADD these methods to BackgroundTransferService class

async handleDriveUploadComplete(recordingId, response) {
  try {
    console.log(`[BackgroundTransferService] Google Drive upload complete for ${recordingId}:`, response);
    
    const responseData = JSON.parse(response);
    const fileId = responseData.id;
    
    if (!fileId) {
      throw new Error('No file ID in Drive upload response');
    }
    
    const recording = await getRecordingById(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }
    
    // Update recording with new Drive file ID
    const updatedDriveFileIds = { ...recording.driveFileIds };
    // Determine file type from metadata and update accordingly
    // This would be set based on the original upload request
    
    const updatedRecording = {
      ...recording,
      driveFileIds: updatedDriveFileIds,
      driveSyncStatus: 'synced',
      lastSyncDate: new Date().toISOString()
    };
    
    await updateRecording(updatedRecording);
    console.log(`[BackgroundTransferService] Updated recording ${recordingId} with Drive file ID: ${fileId}`);
    
  } catch (error) {
    console.error(`[BackgroundTransferService] Error handling Drive upload completion for ${recordingId}:`, error);
    await this.handleDriveUploadError(null, recordingId, error.message);
  }
}

async handleDriveUploadError(taskId, recordingId, errorMessage) {
  try {
    console.error(`[BackgroundTransferService] Google Drive upload error for ${recordingId}:`, errorMessage);
    
    const recording = await getRecordingById(recordingId);
    if (recording) {
      const updatedRecording = {
        ...recording,
        driveSyncStatus: 'error',
        lastSyncError: errorMessage
      };
      await updateRecording(updatedRecording);
    }
    
    // Clear failed task
    if (taskId) {
      await BackgroundTransferManager.clearTask(taskId);
    }
    
  } catch (handlerError) {
    console.error('[BackgroundTransferService] Critical error handling Drive upload error:', handlerError);
  }
}
```

### 2.2 Auto-Sync Integration Points

**Integrate Google Drive sync into existing completion handlers:**

```javascript
// MODIFY existing handleSummarizationComplete method
async handleSummarizationComplete(recordingId, response) {
  try {
    // ... existing summarization logic ...
    
    await this.startTitleGenerationUpload(updatedRecording);
    
    // NEW: Auto-sync to Google Drive if enabled
    await this.autoSyncToGoogleDrive(updatedRecording);
    
  } catch (error) {
    // ... existing error handling ...
  }
}

// ADD new method for auto-sync
async autoSyncToGoogleDrive(recording) {
  try {
    // Check if user has Google Drive connected and auto-sync enabled
    const driveSettings = await this.getGoogleDriveSettings();
    if (!driveSettings.isConnected || !driveSettings.autoSyncEnabled) {
      console.log('[BackgroundTransferService] Google Drive auto-sync disabled');
      return;
    }
    
    // Import GoogleDriveService
    const GoogleDriveService = require('./GoogleDriveService').default;
    
    // Check if user is still signed in
    const isSignedIn = await GoogleDriveService.isSignedIn();
    if (!isSignedIn) {
      console.log('[BackgroundTransferService] User not signed in to Google Drive');
      return;
    }
    
    // Start sync process
    console.log('[BackgroundTransferService] Starting auto-sync to Google Drive for recording:', recording.id);
    await GoogleDriveService.syncRecording(recording.id);
    
  } catch (error) {
    console.error('[BackgroundTransferService] Auto-sync to Google Drive failed:', error);
    // Don't throw - auto-sync failure shouldn't break the main processing flow
  }
}

// ADD helper method to get Google Drive settings
async getGoogleDriveSettings() {
  try {
    // This would read from stored preferences
    // For now, return default settings
    return {
      isConnected: false,
      autoSyncEnabled: true
    };
  } catch (error) {
    console.error('[BackgroundTransferService] Failed to get Google Drive settings:', error);
    return { isConnected: false, autoSyncEnabled: false };
  }
}
```

---

## 🎨 Phase 3: User Interface & UX Strategy

### 📱 UI/UX Best Practices & Integration Strategy

**Recommended Approach - Progressive Enhancement Pattern:**

#### 3.0.1 Main Home Screen Integration
**Location**: Top-left corner settings icon (to preserve existing Edit button on top-right)
- **Settings Icon**: Use SF Symbol `gearshape` in navigation bar header left
- **Preserve Edit Button**: Keep existing Edit button in top-right position
- **Subtle Status Indicator**: Small Google Drive cloud icon when connected (optional, in header left area)
- **No Intrusive UI**: Keep main recording flow clean and uncluttered

**Alternative Layout Options:**
1. **Recommended**: Settings icon top-left, Edit button top-right
2. **Dual Right**: Both buttons on right side with small spacing
3. **Action Sheet**: Combine into single "⋯" menu with Edit and Settings options

#### 3.0.2 Contextual Introduction Pattern
**When to Introduce Google Drive:**
1. **After First Successful Transcription** - Prime moment when user sees value
2. **Completion of First Summary** - User understands the content worth saving
3. **Settings Discovery** - User actively exploring app features

**Contextual Prompt Design:**
```javascript
// Auto-trigger after first transcription completes
const showGoogleDriveIntro = () => {
  Alert.alert(
    "Save to Google Drive? ☁️",
    "Keep your transcripts and summaries safe by syncing them to your Google Drive. You'll be able to access them anywhere!",
    [
      { text: "Not Now", style: "cancel" },
      { text: "Connect Drive", onPress: () => navigateToGoogleDriveSetup() }
    ]
  );
};
```

#### 3.0.3 Settings Screen Architecture
**Organized by Function with Clear Hierarchy:**

```
⚙️ Settings
├── 🔐 Account & Sync
│   ├── ☁️ Google Drive (Connection status + settings)
│   └── 📱 Local Storage
├── 🎙️ Recording Settings  
│   ├── Audio Quality
│   └── Auto-segment Duration
├── 🤖 AI Processing
│   ├── Transcription Settings
│   └── Summary Preferences
└── ℹ️ About & Support
```

#### 3.0.4 Google Drive Section Design
**Modern iOS Settings Pattern:**

```javascript
// Settings Screen - Google Drive Section
<View style={styles.section}>
  <Text style={styles.sectionHeader}>CLOUD SYNC</Text>
  
  {/* Connection Status Row */}
  <TouchableOpacity 
    style={styles.settingRow} 
    onPress={() => navigation.navigate('GoogleDriveSettings')}
  >
    <View style={styles.settingLeft}>
      <Text style={styles.googleDriveIcon}>☁️</Text>
      <View>
        <Text style={styles.settingTitle}>Google Drive</Text>
        <Text style={styles.settingSubtitle}>
          {isConnected ? `Connected as ${userEmail}` : 'Not connected'}
        </Text>
      </View>
    </View>
    <View style={styles.settingRight}>
      <GoogleDriveSyncIndicator 
        syncStatus={syncStatus} 
        size="small" 
        showText={false} 
      />
      <Text style={styles.chevron}>›</Text>
    </View>
  </TouchableOpacity>

  {/* Quick Toggle (when connected) */}
  {isConnected && (
    <View style={styles.settingRow}>
      <Text style={styles.settingTitle}>Auto-sync new recordings</Text>
      <Switch value={autoSync} onValueChange={setAutoSync} />
    </View>
  )}
</View>
```

#### 3.0.5 Navigation Flow
**Recommended User Journey:**
1. **Home Screen** → Settings Icon (top-right) → Settings Screen
2. **Settings Screen** → Google Drive Row → Google Drive Settings
3. **Recording Detail** → Sync Button → Direct sync action
4. **Contextual Prompt** → "Connect Drive" → Google Drive Setup

### 3.1 Google Drive Settings Screen

**File: `src/screens/GoogleDriveSettingsScreen.js`**
```javascript
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import GoogleDriveService from '../services/GoogleDriveService';
import { GoogleDriveSettings } from '../utils/DataModels';

const GoogleDriveSettingsScreen = ({ navigation }) => {
  const [settings, setSettings] = useState(new GoogleDriveSettings());
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    loadSettings();
    checkSignInStatus();
  }, []);

  const loadSettings = async () => {
    try {
      // Load settings from storage
      // Implementation would read from AsyncStorage or similar
      const savedSettings = await getSavedGoogleDriveSettings();
      if (savedSettings) {
        setSettings(GoogleDriveSettings.fromJSON(savedSettings));
      }
    } catch (error) {
      console.error('Failed to load Google Drive settings:', error);
    }
  };

  const checkSignInStatus = async () => {
    try {
      const isSignedIn = await GoogleDriveService.isSignedIn();
      if (isSignedIn) {
        // Get user info
        const user = await GoogleSignin.getCurrentUser();
        setUserInfo(user?.user);
        setSettings(prev => ({ ...prev, isConnected: true, userEmail: user?.user?.email }));
      }
    } catch (error) {
      console.error('Failed to check sign-in status:', error);
    }
  };

  const handleSignIn = async () => {
    try {
      setLoading(true);
      const userInfo = await GoogleDriveService.signIn();
      setUserInfo(userInfo.user);
      
      const updatedSettings = {
        ...settings,
        isConnected: true,
        userEmail: userInfo.user.email
      };
      
      setSettings(updatedSettings);
      await saveGoogleDriveSettings(updatedSettings);
      
      Alert.alert('Success', 'Connected to Google Drive successfully!');
    } catch (error) {
      console.error('Sign-in failed:', error);
      Alert.alert('Error', 'Failed to connect to Google Drive. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert(
      'Disconnect Google Drive',
      'Are you sure you want to disconnect from Google Drive? Your existing synced files will remain in Google Drive.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await GoogleDriveService.signOut();
              
              const updatedSettings = new GoogleDriveSettings();
              setSettings(updatedSettings);
              setUserInfo(null);
              await saveGoogleDriveSettings(updatedSettings);
              
              Alert.alert('Success', 'Disconnected from Google Drive');
            } catch (error) {
              console.error('Sign-out failed:', error);
              Alert.alert('Error', 'Failed to disconnect. Please try again.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleSyncAll = async () => {
    if (!settings.isConnected) {
      Alert.alert('Error', 'Please connect to Google Drive first');
      return;
    }

    try {
      setSyncing(true);
      // Get all recordings and sync them
      const recordings = await getRecordings();
      const unsyncedRecordings = recordings.filter(r => r.driveSyncStatus !== 'synced');
      
      if (unsyncedRecordings.length === 0) {
        Alert.alert('Info', 'All recordings are already synced');
        return;
      }

      Alert.alert(
        'Sync All Recordings',
        `This will sync ${unsyncedRecordings.length} recordings to Google Drive. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sync',
            onPress: async () => {
              for (const recording of unsyncedRecordings) {
                try {
                  await GoogleDriveService.syncRecording(recording.id);
                } catch (error) {
                  console.error(`Failed to sync recording ${recording.id}:`, error);
                }
              }
              Alert.alert('Success', 'Sync completed');
            }
          }
        ]
      );
    } catch (error) {
      console.error('Sync all failed:', error);
      Alert.alert('Error', 'Failed to sync recordings');
    } finally {
      setSyncing(false);
    }
  };

  const updateSetting = async (key, value) => {
    const updatedSettings = { ...settings, [key]: value };
    setSettings(updatedSettings);
    await saveGoogleDriveSettings(updatedSettings);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection Status</Text>
        
        {settings.isConnected ? (
          <View style={styles.connectedContainer}>
            <Text style={styles.connectedText}>
              ✅ Connected as {userInfo?.email || settings.userEmail}
            </Text>
            <TouchableOpacity
              style={[styles.button, styles.disconnectButton]}
              onPress={handleSignOut}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Disconnect</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.disconnectedContainer}>
            <Text style={styles.disconnectedText}>
              Not connected to Google Drive
            </Text>
            <TouchableOpacity
              style={[styles.button, styles.connectButton]}
              onPress={handleSignIn}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Connect Google Drive</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {settings.isConnected && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sync Settings</Text>
            
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Auto-sync new recordings</Text>
              <Switch
                value={settings.autoSyncEnabled}
                onValueChange={(value) => updateSetting('autoSyncEnabled', value)}
              />
            </View>
            
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Sync transcripts</Text>
              <Switch
                value={settings.syncTranscripts}
                onValueChange={(value) => updateSetting('syncTranscripts', value)}
              />
            </View>
            
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Sync summaries</Text>
              <Switch
                value={settings.syncSummaries}
                onValueChange={(value) => updateSetting('syncSummaries', value)}
              />
            </View>
            
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Sync audio files</Text>
              <Switch
                value={settings.syncAudioFiles}
                onValueChange={(value) => updateSetting('syncAudioFiles', value)}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Actions</Text>
            
            <TouchableOpacity
              style={[styles.button, styles.syncButton]}
              onPress={handleSyncAll}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sync All Recordings</Text>
              )}
            </TouchableOpacity>
          </View>

          {settings.lastSyncDate && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Last Sync</Text>
              <Text style={styles.infoText}>
                {new Date(settings.lastSyncDate).toLocaleString()}
              </Text>
              <Text style={styles.infoText}>
                Total synced files: {settings.totalSyncedFiles}
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: '#fff',
    margin: 10,
    padding: 15,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  connectedContainer: {
    alignItems: 'center',
  },
  connectedText: {
    fontSize: 16,
    color: '#4CAF50',
    marginBottom: 15,
  },
  disconnectedContainer: {
    alignItems: 'center',
  },
  disconnectedText: {
    fontSize: 16,
    color: '#757575',
    marginBottom: 15,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    minWidth: 150,
  },
  connectButton: {
    backgroundColor: '#4285F4',
  },
  disconnectButton: {
    backgroundColor: '#f44336',
  },
  syncButton: {
    backgroundColor: '#4CAF50',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  settingLabel: {
    fontSize: 16,
    color: '#333',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
});

// Helper functions (implement based on your storage strategy)
const getSavedGoogleDriveSettings = async () => {
  // Implementation to read from AsyncStorage
  return null;
};

const saveGoogleDriveSettings = async (settings) => {
  // Implementation to save to AsyncStorage
};

export default GoogleDriveSettingsScreen;
```

### 3.2 Sync Status Components

**File: `src/components/GoogleDriveSyncIndicator.js`**
```javascript
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const GoogleDriveSyncIndicator = ({ 
  syncStatus, 
  onSyncPress, 
  lastSyncDate, 
  size = 'normal',
  showText = true 
}) => {
  const getStatusInfo = () => {
    switch (syncStatus) {
      case 'synced':
        return { icon: '☁️', color: '#4CAF50', text: 'Synced' };
      case 'syncing':
        return { icon: '🔄', color: '#2196F3', text: 'Syncing...' };
      case 'pending':
        return { icon: '⏳', color: '#FF9800', text: 'Pending' };
      case 'error':
        return { icon: '❌', color: '#f44336', text: 'Error' };
      default:
        return { icon: '☁️', color: '#ccc', text: 'Not synced' };
    }
  };

  const statusInfo = getStatusInfo();
  const isSmall = size === 'small';

  return (
    <TouchableOpacity 
      style={[
        styles.container, 
        isSmall && styles.smallContainer
      ]} 
      onPress={onSyncPress}
      disabled={syncStatus === 'syncing'}
    >
      <Text style={[styles.icon, isSmall && styles.smallIcon]}>
        {statusInfo.icon}
      </Text>
      
      {showText && (
        <View style={styles.textContainer}>
          <Text style={[
            styles.statusText, 
            { color: statusInfo.color },
            isSmall && styles.smallText
          ]}>
            {statusInfo.text}
          </Text>
          
          {lastSyncDate && syncStatus === 'synced' && (
            <Text style={[styles.dateText, isSmall && styles.smallText]}>
              {new Date(lastSyncDate).toLocaleDateString()}
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f8f8f8',
  },
  smallContainer: {
    padding: 4,
  },
  icon: {
    fontSize: 16,
    marginRight: 6,
  },
  smallIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  textContainer: {
    flex: 1,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 12,
    color: '#666',
  },
  smallText: {
    fontSize: 10,
  },
});

export default GoogleDriveSyncIndicator;
```

---

## 🔄 Phase 4: Background Processing & Error Handling

### 4.1 Retry Logic and Offline Queue

**File: `src/services/GoogleDriveSyncQueue.js`**
```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import GoogleDriveService from './GoogleDriveService';

class GoogleDriveSyncQueue {
  constructor() {
    this.isProcessing = false;
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second base delay
    this.setupNetworkListener();
  }

  // Monitor network connectivity
  setupNetworkListener() {
    NetInfo.addEventListener(state => {
      if (state.isConnected && !this.isProcessing) {
        this.processQueue();
      }
    });
  }

  // Add recording to sync queue
  async addToQueue(recordingId, priority = 'normal') {
    try {
      const queue = await this.getQueue();
      
      // Check if already in queue
      const exists = queue.find(item => item.recordingId === recordingId);
      if (exists) {
        console.log('[GoogleDriveSyncQueue] Recording already in queue:', recordingId);
        return;
      }

      const queueItem = {
        id: Date.now().toString(),
        recordingId,
        priority, // 'high' | 'normal' | 'low'
        attempts: 0,
        addedAt: new Date().toISOString(),
        lastAttempt: null,
        lastError: null
      };

      queue.push(queueItem);
      
      // Sort by priority (high first)
      queue.sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      await this.saveQueue(queue);
      console.log('[GoogleDriveSyncQueue] Added to queue:', recordingId);

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }

    } catch (error) {
      console.error('[GoogleDriveSyncQueue] Failed to add to queue:', error);
    }
  }

  // Process the sync queue
  async processQueue() {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      const queue = await this.getQueue();

      if (queue.length === 0) {
        console.log('[GoogleDriveSyncQueue] Queue is empty');
        return;
      }

      // Check network connectivity
      const networkState = await NetInfo.fetch();
      if (!networkState.isConnected) {
        console.log('[GoogleDriveSyncQueue] No network connection, waiting...');
        return;
      }

      // Check if Google Drive is still connected
      const isSignedIn = await GoogleDriveService.isSignedIn();
      if (!isSignedIn) {
        console.log('[GoogleDriveSyncQueue] Google Drive not connected, clearing queue');
        await this.clearQueue();
        return;
      }

      console.log(`[GoogleDriveSyncQueue] Processing ${queue.length} items`);

      // Process items one by one
      for (const item of [...queue]) {
        try {
          await this.processQueueItem(item);
          await this.removeFromQueue(item.id);
        } catch (error) {
          await this.handleQueueItemError(item, error);
        }
      }

    } catch (error) {
      console.error('[GoogleDriveSyncQueue] Queue processing failed:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  // Process individual queue item
  async processQueueItem(item) {
    console.log('[GoogleDriveSyncQueue] Processing item:', item.recordingId);

    // Update attempt info
    item.attempts++;
    item.lastAttempt = new Date().toISOString();

    // Sync the recording
    await GoogleDriveService.syncRecording(item.recordingId);

    console.log('[GoogleDriveSyncQueue] Successfully synced:', item.recordingId);
  }

  // Handle queue item error
  async handleQueueItemError(item, error) {
    console.error(`[GoogleDriveSyncQueue] Error processing ${item.recordingId}:`, error);

    item.lastError = error.message;

    if (item.attempts >= this.retryAttempts) {
      console.log(`[GoogleDriveSyncQueue] Max attempts reached for ${item.recordingId}, removing from queue`);
      await this.removeFromQueue(item.id);
      
      // Mark recording as sync error
      try {
        const recording = await getRecordingById(item.recordingId);
        if (recording) {
          await updateRecording({
            ...recording,
            driveSyncStatus: 'error',
            lastSyncError: `Failed after ${item.attempts} attempts: ${error.message}`
          });
        }
      } catch (updateError) {
        console.error('[GoogleDriveSyncQueue] Failed to update recording error status:', updateError);
      }
    } else {
      // Update queue with error info and retry later
      const queue = await this.getQueue();
      const index = queue.findIndex(q => q.id === item.id);
      if (index >= 0) {
        queue[index] = item;
        await this.saveQueue(queue);
      }

      // Exponential backoff delay
      const delay = this.retryDelay * Math.pow(2, item.attempts - 1);
      console.log(`[GoogleDriveSyncQueue] Will retry ${item.recordingId} in ${delay}ms`);
      
      setTimeout(() => {
        if (!this.isProcessing) {
          this.processQueue();
        }
      }, delay);
    }
  }

  // Get queue from storage
  async getQueue() {
    try {
      const queueJson = await AsyncStorage.getItem('googleDriveSyncQueue');
      return queueJson ? JSON.parse(queueJson) : [];
    } catch (error) {
      console.error('[GoogleDriveSyncQueue] Failed to get queue:', error);
      return [];
    }
  }

  // Save queue to storage
  async saveQueue(queue) {
    try {
      await AsyncStorage.setItem('googleDriveSyncQueue', JSON.stringify(queue));
    } catch (error) {
      console.error('[GoogleDriveSyncQueue] Failed to save queue:', error);
    }
  }

  // Remove item from queue
  async removeFromQueue(itemId) {
    try {
      const queue = await this.getQueue();
      const filteredQueue = queue.filter(item => item.id !== itemId);
      await this.saveQueue(filteredQueue);
    } catch (error) {
      console.error('[GoogleDriveSyncQueue] Failed to remove from queue:', error);
    }
  }

  // Clear entire queue
  async clearQueue() {
    try {
      await AsyncStorage.removeItem('googleDriveSyncQueue');
      console.log('[GoogleDriveSyncQueue] Queue cleared');
    } catch (error) {
      console.error('[GoogleDriveSyncQueue] Failed to clear queue:', error);
    }
  }

  // Get queue status
  async getQueueStatus() {
    const queue = await this.getQueue();
    return {
      totalItems: queue.length,
      isProcessing: this.isProcessing,
      highPriorityItems: queue.filter(item => item.priority === 'high').length,
      failedItems: queue.filter(item => item.attempts >= this.retryAttempts).length
    };
  }
}

export default new GoogleDriveSyncQueue();
```

---

## 🧪 Phase 5: Testing & Validation

### 5.1 Testing Checklist

**OAuth & Authentication Testing:**
- [ ] Google Sign-In flow works correctly
- [ ] Tokens are stored securely in Keychain
- [ ] Token refresh works automatically
- [ ] Sign-out clears all stored data
- [ ] App handles revoked permissions gracefully

**Folder Management Testing:**
- [ ] App folder creation works
- [ ] Duplicate folder detection works
- [ ] Date-based organization creates correct structure
- [ ] Recording-specific folders have unique names

**File Upload Testing:**
- [ ] Text files (transcript, summary) upload correctly
- [ ] Large audio files upload in background
- [ ] Upload progress is tracked properly
- [ ] Failed uploads are retried
- [ ] Duplicate file handling works

**Background Processing Testing:**
- [ ] Uploads continue when app is backgrounded
- [ ] Uploads continue when app is killed
- [ ] App resumes uploads after restart
- [ ] Background session completion handlers work

**Network & Error Testing:**
- [ ] Offline uploads are queued
- [ ] Network recovery triggers queue processing
- [ ] Google API errors are handled gracefully
- [ ] Quota exceeded errors show appropriate message
- [ ] Invalid token errors trigger re-authentication

**UI & UX Testing:**
- [ ] Settings screen updates in real-time
- [ ] Sync indicators show correct status
- [ ] Manual sync buttons work correctly
- [ ] Error messages are user-friendly
- [ ] Loading states are visible

### 5.2 App Store Preparation

**Privacy Policy Requirements:**
```markdown
Google Drive Integration

Our app integrates with Google Drive to sync your recording transcripts and summaries. 

Data Collection:
- We access your Google Drive account to create folders and upload files
- We store your Google account authentication tokens securely on your device
- We do not access or modify any other files in your Google Drive

Data Usage:
- Uploaded files are stored in a dedicated "ArcoScribe Recordings" folder
- Files are organized by date for easy access
- You maintain full control over your Google Drive files
- You can disconnect Google Drive access at any time

Third-Party Services:
- Google Drive API is provided by Google LLC
- Your use of Google Drive is subject to Google's Privacy Policy
- We do not share your data with any other third parties
```

**App Store Connect Settings:**
- [ ] Add Google Drive integration to app description
- [ ] Update data collection disclosure
- [ ] Provide demo Google account for App Store review
- [ ] Include screenshots of Google Drive features

---

## 🔧 Implementation Notes

### Key Integration Points:
1. **Existing BackgroundTransferManager** - Leverage for large file uploads
2. **Current Event System** - Extend for Google Drive upload events  
3. **Recording Data Model** - Add Google Drive sync fields
4. **Processing Pipeline** - Auto-sync after transcription/summarization

### Security Best Practices:
1. **Token Storage** - Use Keychain for secure storage
2. **Permission Scopes** - Minimal required permissions (`drive.file`)
3. **Error Handling** - Never expose raw API errors to users
4. **Data Validation** - Validate all API responses

### Performance Considerations:
1. **Background Uploads** - Use existing background session infrastructure
2. **Queue Management** - Implement retry logic with exponential backoff
3. **Network Efficiency** - Only upload when on WiFi (optional setting)
4. **Memory Management** - Stream large files, don't load entirely into memory

### Future Enhancements:
1. **Selective Sync** - Per-recording sync preferences
2. **Conflict Resolution** - Handle file conflicts intelligently
3. **Version Control** - Track file versions for updated summaries
4. **Bandwidth Management** - Smart upload scheduling
5. **Collaborative Features** - Share recordings with others

---

## 📞 Support & Troubleshooting

### Common Issues:

**"Invalid Client ID" Error:**
- Verify client ID in `GoogleDriveService.js` matches Google Cloud Console
- Ensure URL scheme in Info.plist matches client ID format
- Check that bundle identifier matches registered app

**"Access Denied" Error:**
- Ensure Google Drive API is enabled in Google Cloud Console
- Verify OAuth consent screen is published
- Check that user has granted drive.file permission

**Upload Failures:**
- Check network connectivity
- Verify Google Drive quota limits
- Ensure access token is valid and not expired
- Check file size limits (5MB for simple upload, unlimited for resumable)

**Background Upload Issues:**
- Verify background modes are enabled in Info.plist
- Check iOS background app refresh settings
- Ensure proper background session completion handler management

This comprehensive plan provides a complete roadmap for implementing Google Drive sync in your ArcoScribeApp while leveraging your existing robust architecture.