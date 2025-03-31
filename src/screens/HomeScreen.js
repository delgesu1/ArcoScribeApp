import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  TextInput,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import { getRecordings, updateRecording, deleteRecording } from '../services/AudioRecordingService';
import { transcribeRecording } from '../services/TranscriptionService';
import { Swipeable } from 'react-native-gesture-handler';
import { shareRecordingSummary } from '../utils/ShareUtils';

const HomeScreen = ({ navigation }) => {
  const [recordings, setRecordings] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const isFocused = useIsFocused();
  const intervalRef = useRef(null);
  // Keep track of open swipeables so we can close them when needed
  const swipeableRefs = useRef({});

  const loadRecordings = useCallback(async (forceRefresh = false) => {
    if (processingId && !forceRefresh) return;
    
    console.log('Loading recordings...');
    try {
      const recordingsList = await getRecordings();
      setRecordings(recordingsList);
      
      const stillProcessing = recordingsList.find(r => r.id === processingId && r.processingStatus === 'processing');
      if (processingId && !stillProcessing) {
          console.log(`Process for ${processingId} seems complete or errored, clearing local processing state.`);
          setProcessingId(null);
      }
      
    } catch (error) {
      console.error('Failed to load recordings:', error);
    }
  }, [processingId]);

  useEffect(() => {
    if (isFocused) {
      loadRecordings(true);
      
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      intervalRef.current = setInterval(() => {
        loadRecordings();
      }, 5000);
      
      return () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
      };
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [isFocused, loadRecordings]);

  const handleStartProcessing = async (recording) => {
    if (processingId) return;
    
    setProcessingId(recording.id);
    try {
      setRecordings(prev => prev.map(r => r.id === recording.id ? { ...r, processingStatus: 'processing' } : r)); 
      
      await updateRecording({ ...recording, processingStatus: 'processing' });
      
      transcribeRecording(recording); 
      
      console.log(`Started processing for ${recording.id}`);
      
    } catch (error) {
      console.error('Failed to start processing:', error);
      setRecordings(prev => prev.map(r => r.id === recording.id ? { ...r, processingStatus: 'error' } : r));
      try {
          await updateRecording({ ...recording, processingStatus: 'error' });
      } catch (updateError) {
          console.error('Failed to update recording to error state:', updateError);
      }
      setProcessingId(null); 
    }
  };

  // Handle deletion of a recording
  const handleDeleteRecording = async (recordingId) => {
    try {
      // Close any open swipeables
      Object.values(swipeableRefs.current).forEach(ref => {
        if (ref && ref.close) {
          ref.close();
        }
      });
      
      // Show confirmation dialog
      Alert.alert(
        'Delete Recording',
        'Are you sure you want to delete this recording?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Delete', 
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteRecording(recordingId);
                // Update local state to remove the deleted recording
                setRecordings(prev => prev.filter(r => r.id !== recordingId));
                console.log(`Recording ${recordingId} has been deleted`);
              } catch (error) {
                console.error('Failed to delete recording:', error);
                Alert.alert('Error', 'Failed to delete recording');
              }
            }
          },
        ]
      );
    } catch (error) {
      console.error('Error handling delete:', error);
    }
  };

  // Handle share recording
  const handleShareRecording = async (recordingId) => {
    try {
      // Close any open swipeables
      Object.values(swipeableRefs.current).forEach(ref => {
        if (ref && ref.close) {
          ref.close();
        }
      });
      
      // Find the recording by id
      const recordingToShare = recordings.find(r => r.id === recordingId);
      
      if (!recordingToShare) {
        throw new Error('Recording not found');
      }
      
      if (recordingToShare.processingStatus !== 'complete' || !recordingToShare.summary) {
        return Alert.alert('Cannot Share', 'This recording must be processed with a summary before it can be shared.');
      }
      
      // Share the recording summary
      await shareRecordingSummary(recordingToShare);
      
    } catch (error) {
      console.error('Error sharing recording:', error);
      Alert.alert('Error', 'Failed to share recording');
    }
  };

  const filteredRecordings = recordings.filter(recording => 
    recording.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (recording.transcript && recording.transcript.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const renderItem = ({ item }) => {
    const isCurrentlyProcessing = processingId === item.id;

    const statusIcon = () => {
      if (isCurrentlyProcessing) {
        return <ActivityIndicator size="small" color="#FF9500" />;
      }
      if (item.processingStatus === 'complete') {
        return (
          <View style={styles.statusBadge}>
            <Icon name="checkmark" size={12} color="#FFFFFF" />
          </View>
        );
      } else if (item.processingStatus === 'processing') {
        return <Icon name="hourglass-outline" size={18} color="#FF9500" />;
      } else if (item.processingStatus === 'error') {
        return (
          <View style={[styles.statusBadge, styles.errorBadge]}>
            <Icon name="alert" size={12} color="#FFFFFF" />
          </View>
        );
      }
      return null;
    };

    const showProcessButton = item.processingStatus !== 'complete' && !isCurrentlyProcessing;

    // Render the swipe actions (right swipe)
    const renderRightActions = (progress, dragX) => {
      return (
        <View style={styles.rightActions}>
          <TouchableOpacity
            style={[styles.shareAction]}
            onPress={() => handleShareRecording(item.id)}
          >
            <Icon name="share-outline" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>Share</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.deleteAction]}
            onPress={() => handleDeleteRecording(item.id)}
          >
            <Icon name="trash-outline" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>Delete</Text>
          </TouchableOpacity>
        </View>
      );
    };

    return (
      <Swipeable
        ref={ref => {
          if (ref) {
            swipeableRefs.current[item.id] = ref;
          }
        }}
        renderRightActions={renderRightActions}
        rightThreshold={40}
        friction={2}
        overshootRight={false}
        enabled={!isCurrentlyProcessing} // Disable swiping during processing
      >
        <View style={styles.recordingItemContainer}> 
          <TouchableOpacity
            style={styles.recordingItem}
            onPress={() => navigation.navigate('RecordingDetail', { recordingId: item.id, title: item.title })}
            disabled={isCurrentlyProcessing}
          >
            <View style={styles.recordingInfo}>
              <Text style={styles.recordingTitle} numberOfLines={1} ellipsizeMode="tail">{item.title}</Text>
              <View style={styles.dateStatusContainer}>
                <Text style={styles.recordingDate}>{item.date}</Text>
                {statusIcon()}
              </View>
            </View>
            
            <View style={styles.actionsContainer}>
              {isCurrentlyProcessing ? (
                <View style={styles.processingIndicator}>
                  <ActivityIndicator size="small" color="#FF9500" />
                </View>
              ) : showProcessButton ? (
                <TouchableOpacity 
                  style={[
                    styles.iconButton,
                    processingId && styles.disabledIconButton
                  ]}
                  onPress={() => handleStartProcessing(item)}
                  disabled={!!processingId}
                >
                  <Icon 
                    name="chatbubbles-outline" 
                    size={18} 
                    color={processingId ? "#BDBDBD" : "#FFFFFF"}
                  />
                </TouchableOpacity>
              ) : (
                <View style={styles.buttonPlaceholder} />
              )}
              <Text style={styles.recordingDuration}>{item.duration}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </Swipeable>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.searchContainer}>
        <Icon name="search" size={20} color="#8E8E93" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Titles, Transcripts"
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
      </View>
      
      <FlatList
        data={filteredRecordings}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No recordings yet</Text>
            <Text style={styles.emptySubText}>Tap the record button to get started</Text>
          </View>
        }
      />
      
      <TouchableOpacity
        style={styles.recordButton}
        onPress={() => navigation.navigate('Recording')}
      >
        <Icon name="mic" size={30} color="#FFFFFF" />
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFEFF4',
    borderRadius: 10,
    margin: 16,
    paddingHorizontal: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 17,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  recordingItemContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    marginHorizontal: 16,
    marginBottom: 0,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    overflow: 'hidden',
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  recordingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 0,
  },
  recordingInfo: {
    flex: 1,
  },
  recordingTitle: {
    fontSize: 17,
    fontWeight: '500',
    marginBottom: 4,
  },
  recordingDate: {
    fontSize: 14,
    color: '#8E8E93',
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDuration: {
    fontSize: 14,
    color: '#8E8E93',
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '500',
    color: '#3A3A3C',
    marginBottom: 8,
  },
  emptySubText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  recordButton: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  statusBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  errorBadge: {
    backgroundColor: '#FF3B30',
  },
  dateStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    backgroundColor: '#007AFF',
    borderRadius: 15,
    padding: 0,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  disabledIconButton: {
    backgroundColor: '#BDBDBD',
  },
  processingIndicator: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  rightActions: {
    flexDirection: 'row',
  },
  shareAction: {
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
  },
  deleteAction: {
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  buttonPlaceholder: {
    width: 30,
    height: 30,
    marginRight: 4,
  },
});

export default HomeScreen;
