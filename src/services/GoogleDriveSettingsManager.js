import { saveJsonFile, readJsonFile } from '../utils/FileUtils';
import { GoogleDriveSettings } from '../utils/DataModels';
import GoogleDriveService from './GoogleDriveService';

const SETTINGS_FILE_NAME = 'googleDriveSettings.json';

class GoogleDriveSettingsManager {
  constructor() {
    this.settings = null;
    this.initialized = false;
  }

  // Initialize settings manager
  async initialize() {
    if (this.initialized) {return;}

    try {
      await this.loadSettings();
      this.initialized = true;
      console.log('[GoogleDriveSettingsManager] Initialized successfully');
    } catch (error) {
      console.error('[GoogleDriveSettingsManager] Failed to initialize:', error);
      // Continue with default settings
      this.settings = new GoogleDriveSettings({});
      this.initialized = true;
    }
  }

  // Load settings from storage
  async loadSettings() {
    try {
      const settingsData = await readJsonFile(SETTINGS_FILE_NAME);
      if (settingsData) {
        this.settings = GoogleDriveSettings.fromJSON(settingsData);
        console.log('[GoogleDriveSettingsManager] Settings loaded successfully');
      } else {
        this.settings = new GoogleDriveSettings({});
        console.log('[GoogleDriveSettingsManager] No existing settings, using defaults');
      }
    } catch (error) {
      console.error('[GoogleDriveSettingsManager] Error loading settings:', error);
      this.settings = new GoogleDriveSettings({});
    }
  }

  // Save settings to storage
  async saveSettings() {
    try {
      if (!this.settings) {
        throw new Error('No settings to save');
      }

      await saveJsonFile(SETTINGS_FILE_NAME, this.settings.toJSON());
      console.log('[GoogleDriveSettingsManager] Settings saved successfully');
    } catch (error) {
      console.error('[GoogleDriveSettingsManager] Error saving settings:', error);
      throw error;
    }
  }

  // Get current settings (ensures initialization)
  async getSettings() {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.settings;
  }

  // Update specific setting
  async updateSetting(key, value) {
    await this.initialize();

    if (this.settings.hasOwnProperty(key)) {
      this.settings[key] = value;
      await this.saveSettings();
      console.log(`[GoogleDriveSettingsManager] Updated ${key} to:`, value);
    } else {
      throw new Error(`Invalid setting key: ${key}`);
    }
  }

  // Update multiple settings at once
  async updateSettings(updates) {
    await this.initialize();

    for (const [key, value] of Object.entries(updates)) {
      if (this.settings.hasOwnProperty(key)) {
        this.settings[key] = value;
      } else {
        console.warn(`[GoogleDriveSettingsManager] Invalid setting key ignored: ${key}`);
      }
    }

    await this.saveSettings();
    console.log('[GoogleDriveSettingsManager] Updated multiple settings:', updates);
  }

  // Connect to Google Drive
  async connectToGoogleDrive() {
    try {
      await this.initialize();

      console.log('[GoogleDriveSettingsManager] Starting Google Drive connection...');
      const userInfo = await GoogleDriveService.signIn();

      // Handle different response structures - data is nested
      const userData = userInfo?.data;
      const email = userData?.user?.email || 
                   userData?.email || 
                   userData?.additionalUserInfo?.profile?.email ||
                   userData?.user?.profile?.email ||
                   userInfo?.user?.email || 
                   userInfo?.email;

      if (!email) {
        throw new Error('No email found in Google Sign-In response');
      }

      // Update settings with connection info
      await this.updateSettings({
        isConnected: true,
        userEmail: email,
        lastSyncDate: new Date().toISOString(),
        totalSyncedFiles: 0,
      });

      console.log('[GoogleDriveSettingsManager] Successfully connected to Google Drive as:', email);
      return userInfo;

    } catch (error) {
      console.error('[GoogleDriveSettingsManager] Failed to connect to Google Drive:', error);

      // Ensure connection status is set to false on error
      await this.updateSetting('isConnected', false);
      throw error;
    }
  }

  // Disconnect from Google Drive
  async disconnectFromGoogleDrive() {
    try {
      await this.initialize();

      console.log('[GoogleDriveSettingsManager] Disconnecting from Google Drive...');
      await GoogleDriveService.signOut();

      // Reset connection-related settings
      await this.updateSettings({
        isConnected: false,
        userEmail: null,
        lastSyncDate: null,
        totalSyncedFiles: 0,
      });

      console.log('[GoogleDriveSettingsManager] Successfully disconnected from Google Drive');

    } catch (error) {
      console.error('[GoogleDriveSettingsManager] Error during disconnect:', error);
      // Even if sign out fails, update local settings
      await this.updateSettings({
        isConnected: false,
        userEmail: null,
      });
      throw error;
    }
  }

  // Check current connection status
  async checkConnectionStatus() {
    try {
      await this.initialize();

      // Check if we think we're connected
      if (!this.settings.isConnected) {
        return false;
      }

      // Verify with actual Google Sign-In status
      const isSignedIn = await GoogleDriveService.isSignedIn();

      // If there's a mismatch, update our settings
      if (isSignedIn !== this.settings.isConnected) {
        await this.updateSetting('isConnected', isSignedIn);
        if (!isSignedIn) {
          await this.updateSetting('userEmail', null);
        }
      }

      return isSignedIn;

    } catch (error) {
      console.error('[GoogleDriveSettingsManager] Error checking connection status:', error);
      // On error, assume disconnected
      await this.updateSetting('isConnected', false);
      return false;
    }
  }

  // Toggle auto-sync setting
  async toggleAutoSync() {
    await this.initialize();
    const newValue = !this.settings.autoSyncEnabled;
    await this.updateSetting('autoSyncEnabled', newValue);
    return newValue;
  }

  // Toggle specific sync type
  async toggleSyncType(type) {
    await this.initialize();

    const validTypes = ['syncAudioFiles', 'syncTranscripts', 'syncSummaries'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid sync type: ${type}`);
    }

    const newValue = !this.settings[type];
    await this.updateSetting(type, newValue);
    return newValue;
  }

  // Update sync statistics
  async updateSyncStats(incrementFiles = 0) {
    await this.initialize();

    const updates = {
      lastSyncDate: new Date().toISOString(),
    };

    if (incrementFiles > 0) {
      updates.totalSyncedFiles = this.settings.totalSyncedFiles + incrementFiles;
    }

    await this.updateSettings(updates);
  }

  // Get sync preferences for a specific recording
  getSyncPreferencesForRecording(recording) {
    if (!this.settings) {
      return {
        syncAudio: false,
        syncTranscript: true,
        syncSummary: true,
      };
    }

    // If recording has specific preferences, use those
    if (recording.syncPreferences) {
      return recording.syncPreferences;
    }

    // Otherwise use global settings
    return {
      syncAudio: this.settings.syncAudioFiles,
      syncTranscript: this.settings.syncTranscripts,
      syncSummary: this.settings.syncSummaries,
    };
  }

  // Validate settings integrity
  async validateSettings() {
    await this.initialize();

    let hasChanges = false;
    const updates = {};

    // Check for invalid email when not connected
    if (!this.settings.isConnected && this.settings.userEmail) {
      updates.userEmail = null;
      hasChanges = true;
    }

    // Check for invalid sync date format
    if (this.settings.lastSyncDate && !this.isValidISOString(this.settings.lastSyncDate)) {
      updates.lastSyncDate = null;
      hasChanges = true;
    }

    // Ensure totalSyncedFiles is a valid number
    if (typeof this.settings.totalSyncedFiles !== 'number' || this.settings.totalSyncedFiles < 0) {
      updates.totalSyncedFiles = 0;
      hasChanges = true;
    }

    if (hasChanges) {
      await this.updateSettings(updates);
      console.log('[GoogleDriveSettingsManager] Settings validated and corrected');
    }

    return this.settings;
  }

  // Helper: Check if string is valid ISO date
  isValidISOString(str) {
    try {
      const date = new Date(str);
      return date.toISOString() === str;
    } catch {
      return false;
    }
  }

  // Export settings for debugging
  async exportSettings() {
    await this.initialize();
    return {
      ...this.settings.toJSON(),
      timestamp: new Date().toISOString(),
    };
  }

  // Clear all settings (for testing/reset)
  async clearAllSettings() {
    try {
      this.settings = new GoogleDriveSettings({});
      await this.saveSettings();
      console.log('[GoogleDriveSettingsManager] All settings cleared');
    } catch (error) {
      console.error('[GoogleDriveSettingsManager] Error clearing settings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new GoogleDriveSettingsManager();
