import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Platform,
  AppState,
  useWindowDimensions,
  Image,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  getRecordingById,
  deleteRecording,
  playRecording,
  pausePlayback,
  resumePlayback,
  stopPlayback,
  seekPlayback,
  updateRecording,
} from '../services/AudioRecordingService';
import { formatTime } from '../utils/TimeUtils';
import MarkdownIt from 'markdown-it';
import { useIsFocused } from '@react-navigation/native';
import RenderHtml from 'react-native-render-html';
import { shareRecordingSummary } from '../utils/ShareUtils';
import Slider from '@react-native-community/slider';
import LinearGradient from 'react-native-linear-gradient';

const md = new MarkdownIt();

const RecordingDetailScreen = ({ route, navigation }) => {
  const { recordingId } = route.params;
  const [recording, setRecording] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerActive, setIsPlayerActive] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editableTitle, setEditableTitle] = useState('');
  const appState = useRef(AppState.currentState);
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();

  const loadRecording = useCallback(async () => {
    console.log(`Loading recording details for ID: ${recordingId}`);
    try {
      setLoading(true);
      const recordingData = await getRecordingById(recordingId);
      console.log('Loaded recording data:', recordingData);
      
      // Debug summary content
      if (recordingData?.summary) {
        console.log('Summary found with length:', recordingData.summary.length);
        console.log('Summary first 100 chars:', recordingData.summary.substring(0, 100));
        
        // Check for markdown code block delimiters
        const hasMarkdownDelimiters = recordingData.summary.includes('```');
        console.log('Contains markdown delimiters:', hasMarkdownDelimiters);
      } else {
        console.log('No summary available.');
      }
      
      console.log('Processing status:', recordingData?.processingStatus);
      
      setRecording(recordingData);
      if (recordingData?.duration) {
        const parts = recordingData.duration.split(':');
        if (parts.length === 2) {
          const minutes = parseInt(parts[0], 10);
          const seconds = parseInt(parts[1], 10);
          setDuration((minutes * 60 + seconds) * 1000);
        }
      }
    } catch (error) {
      console.error('Failed to load recording:', error);
      Alert.alert('Error', 'Failed to load recording details');
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    if (isFocused) {
      loadRecording();
    }

    // When recording data is loaded, initialize the editable title
    if (recording?.title && editableTitle === '') {
      setEditableTitle(recording.title);
    }
    
    const subscription = AppState.addEventListener('change', _handleAppStateChange);

    return () => {
      if (isPlayerActive) {
        stopPlayback().catch(e => console.error('Error stopping playback on unmount:', e));
      }
      subscription.remove();
    };
  }, [isFocused, loadRecording]);

  // Set up navigation header buttons once recording is loaded
  useEffect(() => {
    if (recording) {
      navigation.setOptions({
        headerRight: () => (
          <View style={styles.headerButtons}>
            <TouchableOpacity 
              style={styles.headerButton}
              onPress={handleShareSummary}
              disabled={!recording.summary || recording.processingStatus !== 'complete'}
            >
              <Icon 
                name="share-outline" 
                size={22} 
                color={!recording.summary || recording.processingStatus !== 'complete' ? "#8E8E93" : "#007AFF"} 
              />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.headerButton}
              onPress={handleDeleteRecording}
            >
              <Icon name="trash-outline" size={22} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        ),
      });
    }
  }, [recording, navigation]);

  const _handleAppStateChange = (nextAppState) => {
    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      console.log('App has come to the foreground!');
    } else if (nextAppState.match(/inactive|background/)) {
      if (isPlaying) {
        handlePlayPause();
      }
    }
    appState.current = nextAppState;
  };
  
  const onPlaybackProgress = (e) => {
    if (e.duration > 0) {
      setCurrentPosition(e.currentPosition);
      setDuration(e.duration);
    }
  };

  const onPlaybackFinished = () => {
    console.log('Playback finished');
    setIsPlaying(false);
    setCurrentPosition(0);
    setIsPlayerActive(false);
  };

  const handlePlayPause = async () => {
    if (!recording?.filePath) return;

    if (isPlaying) {
      try {
        await pausePlayback();
        setIsPlaying(false);
      } catch (error) {
        console.error('Error pausing playback:', error);
        Alert.alert('Error', 'Could not pause playback');
      }
    } else {
      try {
        if (isPlayerActive && currentPosition > 0) {
          await resumePlayback();
        } else {
          await playRecording(
            recording.filePath,
            onPlaybackProgress,
            onPlaybackFinished
          );
          setIsPlayerActive(true);
        }
        setIsPlaying(true);
      } catch (error) {
        console.error('Error starting/resuming playback:', error);
        Alert.alert('Error', `Could not play recording: ${error.message}`);
        setIsPlayerActive(false);
      }
    }
  };

  const handleSeek = async (direction) => {
    if (!isPlayerActive) return;
    const seekAmountMs = 15000;
    let newPosition = direction === 'forward' 
      ? currentPosition + seekAmountMs 
      : currentPosition - seekAmountMs;
      
    newPosition = Math.max(0, Math.min(newPosition, duration));
    
    try {
      await seekPlayback(newPosition);
      setCurrentPosition(newPosition);
    } catch (error) {
      console.error('Error seeking playback:', error);
    }
  };

  const handleDeleteRecording = () => {
    Alert.alert(
      'Delete Recording',
      'Are you sure you want to delete this recording? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteRecording(recordingId);
              navigation.goBack();
            } catch (error) {
              console.error('Failed to delete recording:', error);
              Alert.alert('Error', 'Failed to delete recording');
            }
          }
        },
      ]
    );
  };

  const handleCopyTranscript = () => {
    if (recording?.transcript) {
      Alert.alert('Success', 'Transcript copied to clipboard');
    }
  };

  const handleCopySummary = () => {
    if (recording?.summary) {
      Alert.alert('Feature coming soon', 'Copy functionality will be added soon');
    }
  };

  const handleShareSummary = async () => {
    if (!recording?.summary) {
      return Alert.alert('Cannot Share', 'This recording has no summary to share.');
    }
    
    if (recording.processingStatus !== 'complete') {
      return Alert.alert('Cannot Share', 'Wait for processing to complete before sharing.');
    }
    
    try {
      await shareRecordingSummary(recording);
    } catch (error) {
      console.error('Error sharing summary:', error);
      Alert.alert('Error', 'Failed to share summary');
    }
  };

  const toggleSummary = () => {
    setSummaryExpanded(!summaryExpanded);
  };

  const toggleTranscript = () => {
    setTranscriptExpanded(!transcriptExpanded);
  };

  const handleToggleEditTitle = async (save = false) => {
    if (isEditingTitle && save) {
      // Validate input
      if (!editableTitle.trim()) {
        Alert.alert('Error', 'Title cannot be empty');
        return;
      }

      try {
        // Save the new title
        await updateRecording({
          ...recording,
          title: editableTitle.trim(),
          userModifiedTitle: true,
        });
        // Update local state
        setRecording(prev => ({ ...prev, title: editableTitle.trim(), userModifiedTitle: true }));
        setIsEditingTitle(false);
      } catch (error) {
        console.error('Error updating title:', error);
        Alert.alert('Error', 'Failed to update recording title');
      }
    } else if (!isEditingTitle) {
      // Enter edit mode
      setEditableTitle(recording.title);
      setIsEditingTitle(true);
    } else {
      // Cancel editing
      setEditableTitle(recording.title);
      setIsEditingTitle(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!recording) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Recording not found</Text>
      </View>
    );
  }

  const renderProcessingStatus = () => {
    if (recording.processingStatus === 'processing') {
      return (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="small" color="#FF9500" />
          <Text style={styles.processingText}>Processing...</Text>
        </View>
      );
    } else if (recording.processingStatus === 'error') {
      return (
        <View style={styles.processingContainer}>
          <Icon name="alert-circle" size={18} color="#FF3B30" />
          <Text style={[styles.processingText, { color: '#FF3B30' }]}>Processing failed</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.headerContainer}>
          <View style={styles.titleRow}>
            {isEditingTitle ? (
              <TextInput
                style={styles.titleInput}
                value={editableTitle}
                onChangeText={setEditableTitle}
                autoFocus
                selectTextOnFocus
                maxLength={100}
                multiline={true}
                numberOfLines={3}
                blurOnSubmit={true}
              />
            ) : (
              <Text style={styles.titleText}>{recording.title}</Text>
            )}
            {isEditingTitle ? (
              <View style={{flexDirection: 'row'}}>
                <TouchableOpacity
                  style={{ padding: 5, marginRight: 10 }}
                  onPress={() => handleToggleEditTitle(true)}
                >
                  <Icon name="checkmark-circle-outline" size={28} color="#4CAF50" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ padding: 5 }}
                  onPress={() => handleToggleEditTitle(false)}
                >
                  <Icon name="close-circle-outline" size={28} color="#F44336" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => handleToggleEditTitle()}
              >
                <Icon name="pencil" size={18} color="#8E8E93" />
              </TouchableOpacity>
            )}
          </View>
          {!isEditingTitle && (
            <Text style={styles.dateText}>{recording.date} · {recording.duration}</Text>
          )}
        </View>

        <View style={styles.playerContainer}>
          <Text style={styles.timeDisplayText}>
            {formatTime(Math.floor(currentPosition / 1000))}
          </Text>
          
          <View style={styles.progressContainer}>
            <Slider
              style={styles.progressBar}
              minimumValue={0}
              maximumValue={duration || 1}
              value={currentPosition}
              minimumTrackTintColor="#007AFF"
              maximumTrackTintColor="#e0e0e0"
              thumbTintColor="#007AFF"
              onSlidingComplete={async (value) => {
                try {
                  await seekPlayback(value);
                  setCurrentPosition(value);
                } catch (error) {
                  console.error('Error seeking:', error);
                }
              }}
            />
          </View>
          
          <View style={styles.controlsContainer}>
            <TouchableOpacity 
              style={styles.circularButton}
              onPress={() => handleSeek('backward')}
              disabled={!isPlayerActive}
              activeOpacity={0.7}
            >
              <Image 
                source={require('../icons/15-back.png')}
                style={[styles.skipIcon, !isPlayerActive && styles.disabledIcon]}
              />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.playButton}
              onPress={handlePlayPause}
              activeOpacity={0.8}
            >
              <View style={styles.playButtonInner}>
                <Icon 
                  name={isPlaying ? "pause" : "play"} 
                  size={28} 
                  color="#777" 
                />
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.circularButton}
              onPress={() => handleSeek('forward')}
              disabled={!isPlayerActive}
              activeOpacity={0.7}
            >
              <Image 
                source={require('../icons/15-forward.png')}
                style={[styles.skipIcon, !isPlayerActive && styles.disabledIcon]}
              />
            </TouchableOpacity>
          </View>
        </View>

        {renderProcessingStatus()}

        {recording.summary && (
          <View style={styles.sectionContainer}>
            <TouchableOpacity style={styles.sectionHeader} onPress={toggleSummary}>
              <Text style={styles.sectionTitle}>Summary</Text>
              <View style={styles.sectionHeaderRight}>
                <TouchableOpacity onPress={handleCopySummary} style={styles.iconButton}>
                  <Icon name="copy-outline" size={20} color="#007AFF" />
                </TouchableOpacity>
                <Icon name={summaryExpanded ? "chevron-up" : "chevron-down"} size={20} color="#8E8E93" />
              </View>
            </TouchableOpacity>
            {summaryExpanded && (
              <View style={styles.summaryContainer}>
                <RenderHtml 
                  contentWidth={width}
                  source={{ 
                    html: md.render(recording.summary?.replace(/```(\w*)\s*|```/g, '').trim() || '') 
                  }}
                  tagsStyles={{
                    p: { fontSize: 16, lineHeight: 24, marginBottom: 10, color: '#333333' },
                    h1: { fontSize: 22, fontWeight: 'bold', marginVertical: 10, color: '#000000' },
                    h2: { fontSize: 20, fontWeight: 'bold', marginVertical: 8, color: '#000000' },
                    h3: { fontSize: 18, fontWeight: 'bold', marginVertical: 6, color: '#000000' },
                    h4: { fontSize: 17, fontWeight: 'bold', marginVertical: 5, color: '#000000' },
                    li: { fontSize: 16, lineHeight: 24, marginBottom: 5, color: '#333333' },
                    ul: { paddingLeft: 20, marginBottom: 10 },
                    ol: { paddingLeft: 20, marginBottom: 10 },
                    a: { color: '#007AFF', textDecorationLine: 'underline' },
                    em: { fontStyle: 'italic' },
                    strong: { fontWeight: 'bold' },
                    code: { fontFamily: 'monospace', backgroundColor: '#f0f0f0', padding: 4, fontSize: 14 },
                    pre: { backgroundColor: '#f0f0f0', padding: 10, borderRadius: 4, overflow: 'hidden' }
                  }}
                  enableExperimentalMarginCollapsing={true}
                />
              </View>
            )}
          </View>
        )}

        {recording.transcript && (
          <View style={styles.sectionContainer}>
            <TouchableOpacity style={styles.sectionHeader} onPress={toggleTranscript}>
              <Text style={styles.sectionTitle}>Transcript</Text>
              <View style={styles.sectionHeaderRight}>
                <TouchableOpacity onPress={handleCopyTranscript} style={styles.iconButton}>
                  <Icon name="copy-outline" size={20} color="#007AFF" />
                </TouchableOpacity>
                <Icon name={transcriptExpanded ? "chevron-up" : "chevron-down"} size={20} color="#8E8E93" />
              </View>
            </TouchableOpacity>
            {transcriptExpanded && (
              <View style={styles.transcriptContainer}>
                <Text style={styles.transcriptText}>{recording.transcript}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#FF3B30',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  headerContainer: {
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  titleText: {
    fontSize: 24,
    fontWeight: '600',
    flex: 1,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '600',
    flex: 1,
    padding: 4,
    paddingBottom: 8,
    color: '#007AFF',
    borderBottomWidth: 1,
    borderBottomColor: '#007AFF',
    minHeight: 30,
    maxHeight: 90, // Approximately 3 lines of text
    textAlignVertical: 'top',
  },
  editButton: {
    padding: 6,
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    padding: 4,
    marginLeft: 4,
    justifyContent: 'center',
  },
  dateText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  playerContainer: {
    alignItems: 'center',
    paddingVertical: 30,
    marginBottom: 30,
    width: '100%',
  },
  timeDisplayText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 48,
    fontWeight: '400',
    color: '#000',
    marginBottom: 20,
    fontVariant: ['tabular-nums'],
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBar: {
    width: '100%',
    height: 30,
  },
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  circularButton: {
    width: 40,
    height: 40,
    marginHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipIcon: {
    width: 34,
    height: 34,
    opacity: 1.0,
  },
  disabledIcon: {
    opacity: 0.3,
  },
  playButton: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 20,
  },
  playButtonInner: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
  },
  processingText: {
    fontSize: 16,
    color: '#FF9500',
    marginLeft: 8,
  },
  sectionContainer: {
    marginBottom: 20,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#E5E5EA',
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    marginRight: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  transcriptContainer: {
    padding: 12,
  },
  transcriptText: {
    fontSize: 16,
    lineHeight: 24,
  },
  summaryContainer: {
    padding: 12,
  },
});

export default RecordingDetailScreen;
