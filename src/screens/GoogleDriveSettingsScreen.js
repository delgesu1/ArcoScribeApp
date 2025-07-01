import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import GoogleDriveSettingsManager from '../services/GoogleDriveSettingsManager';
import GoogleDriveService from '../services/GoogleDriveService';
import { getRecordings } from '../services/AudioRecordingService';

const GoogleDriveSettingsScreen = ({ navigation }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const isFocused = useIsFocused();

  const loadSettings = useCallback(async () => {
    try {
      const currentSettings = await GoogleDriveSettingsManager.getSettings();
      setSettings(currentSettings);

      // Check actual connection status
      const isConnected = await GoogleDriveSettingsManager.checkConnectionStatus();
      setConnectionStatus(isConnected ? 'connected' : 'disconnected');
    } catch (error) {
      console.error('[GoogleDriveSettingsScreen] Failed to load settings:', error);
      setConnectionStatus('error');
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadSettings();
    }
  }, [isFocused, loadSettings]);

  const handleConnect = async () => {
    try {
      setLoading(true);
      await GoogleDriveSettingsManager.connectToGoogleDrive();

      // Reload settings to reflect the connection
      await loadSettings();

      Alert.alert(
        'Success',
        'Successfully connected to Google Drive! Your future recordings can now be automatically synced.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('[GoogleDriveSettingsScreen] Connection failed:', error);
      Alert.alert(
        'Connection Failed',
        'Failed to connect to Google Drive. Please check your internet connection and try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    Alert.alert(
      'Disconnect Google Drive',
      'Are you sure you want to disconnect from Google Drive? Your existing synced files will remain in Google Drive, but new recordings won\'t be automatically synced.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await GoogleDriveSettingsManager.disconnectFromGoogleDrive();
              await loadSettings();

              Alert.alert('Disconnected', 'Successfully disconnected from Google Drive.');
            } catch (error) {
              console.error('[GoogleDriveSettingsScreen] Disconnect failed:', error);
              Alert.alert('Error', 'Failed to disconnect. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleAutoSync = async () => {
    if (!settings.isConnected) {
      Alert.alert('Not Connected', 'Please connect to Google Drive first.');
      return;
    }

    try {
      const newValue = await GoogleDriveSettingsManager.toggleAutoSync();
      setSettings(prev => ({ ...prev, autoSyncEnabled: newValue }));
    } catch (error) {
      console.error('[GoogleDriveSettingsScreen] Failed to toggle auto-sync:', error);
      Alert.alert('Error', 'Failed to update auto-sync setting.');
    }
  };

  const handleToggleSyncType = async (type) => {
    if (!settings.isConnected) {
      Alert.alert('Not Connected', 'Please connect to Google Drive first.');
      return;
    }

    try {
      const newValue = await GoogleDriveSettingsManager.toggleSyncType(type);
      setSettings(prev => ({ ...prev, [type]: newValue }));
    } catch (error) {
      console.error(`[GoogleDriveSettingsScreen] Failed to toggle ${type}:`, error);
      Alert.alert('Error', `Failed to update ${type} setting.`);
    }
  };

  const handleSyncAll = async () => {
    if (!settings.isConnected) {
      Alert.alert('Not Connected', 'Please connect to Google Drive first.');
      return;
    }

    try {
      setSyncing(true);

      // Get all recordings that haven't been synced
      const recordings = await getRecordings();
      const unsyncedRecordings = recordings.filter(
        r => r.processingStatus === 'complete' && r.driveSyncStatus !== 'synced'
      );

      if (unsyncedRecordings.length === 0) {
        Alert.alert('All Synced', 'All your completed recordings are already synced to Google Drive.');
        return;
      }

      Alert.alert(
        'Sync All Recordings',
        `This will sync ${unsyncedRecordings.length} completed recording${unsyncedRecordings.length > 1 ? 's' : ''} to Google Drive. This may take a few minutes.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sync All',
            onPress: async () => {
              let successCount = 0;
              let errorCount = 0;

              for (const recording of unsyncedRecordings) {
                try {
                  await GoogleDriveService.syncRecording(recording.id, settings.folderOrganization);
                  successCount++;
                } catch (error) {
                  console.error(`Failed to sync recording ${recording.id}:`, error);
                  errorCount++;
                }
              }

              // Update sync statistics
              if (successCount > 0) {
                await GoogleDriveSettingsManager.updateSyncStats(successCount);
                await loadSettings(); // Refresh to show updated stats
              }

              if (errorCount === 0) {
                Alert.alert('Sync Complete', `Successfully synced ${successCount} recording${successCount > 1 ? 's' : ''} to Google Drive.`);
              } else {
                Alert.alert(
                  'Sync Partially Complete',
                  `Synced ${successCount} recording${successCount > 1 ? 's' : ''} successfully. ${errorCount} recording${errorCount > 1 ? 's' : ''} failed to sync.`
                );
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('[GoogleDriveSettingsScreen] Sync all failed:', error);
      Alert.alert('Error', 'Failed to sync recordings. Please try again.');
    } finally {
      setSyncing(false);
    }
  };


  if (!settings) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollContainer}>
        {/* Connection Status Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection Status</Text>

          {connectionStatus === 'connected' ? (
            <View style={styles.connectedContainer}>
              <View style={styles.statusRow}>
                <Icon name="checkmark-circle" size={24} color="#4CAF50" />
                <View style={styles.statusTextContainer}>
                  <Text style={styles.connectedText}>Connected to Google Drive</Text>
                  {settings.userEmail && (
                    <Text style={styles.emailText}>{settings.userEmail}</Text>
                  )}
                </View>
              </View>
              <TouchableOpacity
                style={[styles.button, styles.disconnectButton]}
                onPress={handleDisconnect}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Disconnect</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.disconnectedContainer}>
              <View style={styles.statusRow}>
                <Icon name="cloud-offline" size={24} color="#757575" />
                <Text style={styles.disconnectedText}>Not connected to Google Drive</Text>
              </View>
              <TouchableOpacity
                style={[styles.button, styles.connectButton]}
                onPress={handleConnect}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Icon name="logo-google" size={16} color="#fff" style={styles.buttonIcon} />
                    <Text style={styles.buttonText}>Connect Google Drive</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Sync Settings Section */}
        {settings.isConnected && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sync Settings</Text>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-sync new recordings</Text>
                <Text style={styles.settingDescription}>
                  Automatically sync transcripts and summaries when processing completes
                </Text>
              </View>
              <Switch
                value={settings.autoSyncEnabled}
                onValueChange={handleToggleAutoSync}
                trackColor={{ false: '#f4f3f4', true: '#81b0ff' }}
                thumbColor={settings.autoSyncEnabled ? '#007AFF' : '#f4f3f4'}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Sync transcripts</Text>
                <Text style={styles.settingDescription}>Upload transcript text files</Text>
              </View>
              <Switch
                value={settings.syncTranscripts}
                onValueChange={() => handleToggleSyncType('syncTranscripts')}
                trackColor={{ false: '#f4f3f4', true: '#81b0ff' }}
                thumbColor={settings.syncTranscripts ? '#007AFF' : '#f4f3f4'}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Sync summaries</Text>
                <Text style={styles.settingDescription}>Upload summary markdown files</Text>
              </View>
              <Switch
                value={settings.syncSummaries}
                onValueChange={() => handleToggleSyncType('syncSummaries')}
                trackColor={{ false: '#f4f3f4', true: '#81b0ff' }}
                thumbColor={settings.syncSummaries ? '#007AFF' : '#f4f3f4'}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Sync audio files</Text>
                <Text style={styles.settingDescription}>
                  Upload original audio recordings (large files)
                </Text>
              </View>
              <Switch
                value={settings.syncAudioFiles}
                onValueChange={() => handleToggleSyncType('syncAudioFiles')}
                trackColor={{ false: '#f4f3f4', true: '#81b0ff' }}
                thumbColor={settings.syncAudioFiles ? '#007AFF' : '#f4f3f4'}
              />
            </View>
          </View>
        )}

        {/* Actions Section */}
        {settings.isConnected && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Actions</Text>

            <TouchableOpacity
              style={[styles.button, styles.syncButton]}
              onPress={handleSyncAll}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Icon name="cloud-upload" size={16} color="#fff" style={styles.buttonIcon} />
                  <Text style={styles.buttonText}>Sync All Recordings</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.actionDescription}>
              Manually sync all completed recordings that haven't been uploaded yet
            </Text>
          </View>
        )}


        {/* Statistics Section */}
        {settings.isConnected && settings.lastSyncDate && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Statistics</Text>

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Last sync:</Text>
              <Text style={styles.statValue}>
                {new Date(settings.lastSyncDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Total synced files:</Text>
              <Text style={styles.statValue}>{settings.totalSyncedFiles}</Text>
            </View>
          </View>
        )}

        {/* Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About Google Drive Sync</Text>
          <Text style={styles.infoText}>
            Your recordings will be organized in a folder called "ArcoScribe Recordings" in your Google Drive. Files are organized by year and month for easy browsing.
          </Text>
          <Text style={styles.infoText}>
            Only completed recordings with transcripts or summaries will be synced. You can disconnect at any time - your files will remain in Google Drive.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f8f8',
  },
  scrollContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  connectedContainer: {
    alignItems: 'stretch',
  },
  disconnectedContainer: {
    alignItems: 'stretch',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  connectedText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '600',
  },
  disconnectedText: {
    fontSize: 16,
    color: '#757575',
    fontWeight: '500',
    marginLeft: 12,
  },
  emailText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minHeight: 44,
  },
  connectButton: {
    backgroundColor: '#4285F4',
  },
  disconnectButton: {
    backgroundColor: '#f44336',
  },
  syncButton: {
    backgroundColor: '#4CAF50',
    marginBottom: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  settingDescription: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
  },
  actionDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 16,
    color: '#333',
  },
  statValue: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 12,
  },
});

export default GoogleDriveSettingsScreen;
