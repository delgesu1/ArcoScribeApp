import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
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
  Alert,
  Platform,
  ActionSheetIOS
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import { getRecordings, updateRecording, deleteRecording, handleNotebookLMShareDetected, getRecordingById } from '../services/AudioRecordingService';
import { transcribeRecording } from '../services/TranscriptionService';
import { Swipeable } from 'react-native-gesture-handler';
import { 
  shareRecordingSummary, 
  generateCombinedSummaryContent, 
  showFormatSelectionAndShare, 
  cleanSummaryMarkdown,
  generateHTMLFromMarkdown,
  createPDFFromHTML,
  shareBulkTranscriptsToNotebookLM,
  shareTranscriptToNotebookLM
} from '../utils/ShareUtils';
import ActionIndicator from '../components/ActionIndicator';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';

const HomeScreen = ({ navigation }) => {
  const [recordings, setRecordings] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const isFocused = useIsFocused();
  const intervalRef = useRef(null);
  // Keep track of open swipeables so we can close them when needed
  const swipeableRefs = useRef({});
  const [filteredRecordings, setFilteredRecordings] = useState([]);

  // State for Edit Mode
  const [isEditing, setIsEditing] = useState(false);
  const [selectedRecordingIds, setSelectedRecordingIds] = useState(new Set());

  const loadRecordings = useCallback(async (forceRefresh = false) => {
    if (processingId && !forceRefresh) return;
    
    console.log('Loading recordings...');
    try {
      const recordingsList = await getRecordings();
      
      // Ensure all recordings have valid IDs to use as keys
      const validRecordings = recordingsList.filter(r => r && r.id);
      
      // Update recordings state with new array
      setRecordings(validRecordings);
      
      const stillProcessing = validRecordings.find(r => r.id === processingId && r.processingStatus === 'processing');
      if (processingId && !stillProcessing) {
          console.log(`Process for ${processingId} seems complete or errored, clearing local processing state.`);
          setProcessingId(null);
      }
      
    } catch (error) {
      console.error('Failed to load recordings:', error);
    }
  }, [processingId]);

  // Filter recordings based on search query
  useEffect(() => {
    if (searchQuery === '') {
      // Make sure we create a new array to avoid reference issues
      setFilteredRecordings([...recordings]);
    } else {
      const lowerCaseQuery = searchQuery.toLowerCase();
      const filtered = recordings.filter(recording => 
        recording && (
          (recording.title && recording.title.toLowerCase().includes(lowerCaseQuery)) ||
          (recording.date && recording.date.toLowerCase().includes(lowerCaseQuery)) ||
          (recording.transcript && recording.transcript.toLowerCase().includes(lowerCaseQuery)) ||
          (recording.summary && recording.summary.toLowerCase().includes(lowerCaseQuery))
        )
      );
      setFilteredRecordings(filtered);
    }
  }, [searchQuery, recordings]); // Re-run filter when query or recordings change

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

  // --- Edit Mode Toggle --- 
  const toggleEditMode = useCallback(() => {
    console.log(`[HomeScreen] Toggling edit mode from ${isEditing} to ${!isEditing}`);
    setIsEditing(prev => !prev);
    setSelectedRecordingIds(new Set()); // Clear selection when toggling mode
  }, [isEditing]); // Dependency on isEditing for logging, though setter itself is stable

  // Set header button based on edit mode
  useLayoutEffect(() => {
    console.log(`[HomeScreen] useLayoutEffect running, isEditing: ${isEditing}`); // Add Log

    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={() => navigation.navigate('GoogleDriveSettings')} 
            style={{ marginRight: 15 }}
          >
            <Icon name="settings-outline" size={22} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleEditMode} style={{ marginRight: 15 }}>
            <Text style={{ color: '#007AFF', fontSize: 17 }}>
              {isEditing ? 'Done' : 'Edit'} 
            </Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, isEditing, toggleEditMode]); // Add toggleEditMode back

  // Handle bulk deletion
  const handleBulkDelete = async () => {
    const idsToDelete = Array.from(selectedRecordingIds);
    if (idsToDelete.length === 0) return;

    Alert.alert(
      `Delete ${idsToDelete.length} Recording${idsToDelete.length > 1 ? 's' : ''}?`,
      'This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Call deleteRecording for each selected ID
              await Promise.all(idsToDelete.map(id => deleteRecording(id)));
              
              // Update local state immediately
              setRecordings(prev => prev.filter(r => !selectedRecordingIds.has(r.id)));
              
              console.log(`Recordings deleted: ${idsToDelete.join(', ')}`);
              // Exit edit mode after deletion
              toggleEditMode(); 
            } catch (error) {
              console.error('Failed to delete recordings:', error);
              Alert.alert('Error', 'Failed to delete one or more recordings.');
            }
          }
        },
      ]
    );
  };

  // Handle bulk sharing - mirrors individual recording share functionality
  const handleBulkShare = async () => {
    const idsToShare = Array.from(selectedRecordingIds);
    if (idsToShare.length === 0) return;

    try {
      // Fetch full data for selected recordings
      const allRecordings = await getRecordings();
      const selectedRecordings = idsToShare.map(id => 
        allRecordings.find(r => r.id === id)
      ).filter(Boolean); // Remove any undefined recordings

      // Filter recordings that are complete
      const completeRecordings = selectedRecordings.filter(r => 
        r.processingStatus === 'complete'
      );

      if (completeRecordings.length === 0) {
        return Alert.alert(
          'Cannot Share', 
          'None of the selected recordings have completed processing.'
        );
      }

      // Determine available options (similar to individual recording logic)
      const hasTranscripts = completeRecordings.some(r => r.transcript);
      const hasSummaries = completeRecordings.some(r => r.summary);

      const options = [];
      const callbacks = [];

      if (hasTranscripts) {
        options.push('Share Transcripts');
        callbacks.push(() => handleBulkTranscriptShare(completeRecordings));
      }

      if (hasSummaries) {
        options.push('Share Summaries');
        callbacks.push(() => handleBulkSummaryShare(completeRecordings));
      }

      if (options.length === 0) {
        return Alert.alert(
          'Cannot Share', 
          'None of the selected recordings have content to share.'
        );
      }

      if (options.length === 1) {
        // Only one option available, execute directly
        callbacks[0]();
        return;
      }

      // Multiple options available, show ActionSheet (like individual recording)
      options.push('Cancel');
      
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            cancelButtonIndex: options.length - 1,
            title: 'What would you like to share?'
          },
          (buttonIndex) => {
            if (buttonIndex < callbacks.length) {
              callbacks[buttonIndex]();
            }
          }
        );
      } else {
        // For Android, use Alert with buttons
        const buttons = callbacks.map((callback, index) => ({
          text: options[index],
          onPress: callback
        }));
        buttons.push({ text: 'Cancel', style: 'cancel' });
        
        Alert.alert('What would you like to share?', '', buttons);
      }

    } catch (error) {
      console.error('Failed to prepare bulk share:', error);
      Alert.alert('Error', 'Could not prepare recordings for sharing.');
    }
  };

  // Handle bulk transcript sharing (new functionality)
  const handleBulkTranscriptShare = async (recordings) => {
    const transcriptRecordings = recordings.filter(r => r.transcript);
    
    if (transcriptRecordings.length === 0) {
      return Alert.alert('No Transcripts', 'None of the selected recordings have transcripts to share.');
    }

    if (transcriptRecordings.length === 1) {
      // Single transcript - use individual sharing
      try {
        const result = await shareTranscriptToNotebookLM(
          transcriptRecordings[0],
          async (recordingId) => {
            await handleNotebookLMShareDetected(recordingId);
            await loadRecordings(true);
          }
        );

        if (result.notebookLMDetected) {
          Alert.alert(
            'NotebookLM Detected!',
            'Your transcript has been shared to NotebookLM. Google Drive files will be automatically renamed with [NLM] prefix.',
            [{ text: 'OK' }]
          );
        } else if (result.shared) {
          Alert.alert(
            'Transcript Shared',
            'Your transcript has been shared. If you shared it to NotebookLM, the app will automatically detect it and update the status.',
            [{ text: 'OK' }]
          );
        }
      } catch (error) {
        console.error('Error sharing transcript:', error);
        Alert.alert('Error', 'Failed to share transcript');
      }
      return;
    }

    // Multiple transcripts - give user choice
    Alert.alert(
      'Share Multiple Transcripts',
      `You're sharing ${transcriptRecordings.length} transcripts.\n\n⚠️ NotebookLM iOS app CANNOT import multiple files at once - only the first will be imported.\n\nFor NotebookLM: Choose "Share One by One" and they'll queue automatically. When you return to ArcoScribe, the next transcript will share automatically.\n\nFor other apps (AirDrop, email, etc.): "Share All Together" works normally.`,
      [
        {
          text: 'Share All Together (AirDrop/Email)',
          onPress: () => handleBulkShareTogether(transcriptRecordings)
        },
        {
          text: 'Share One by One (NotebookLM)', 
          onPress: () => handleSequentialShare(transcriptRecordings)
        },
        {
          text: 'Cancel',
          style: 'cancel'
        }
      ]
    );
  };

  // Share all transcripts at once (original behavior)
  const handleBulkShareTogether = async (recordings) => {
    try {
      const result = await shareBulkTranscriptsToNotebookLM(
        recordings,
        async (recordingId) => {
          await handleNotebookLMShareDetected(recordingId);
          await loadRecordings(true);
        }
      );

      if (result.notebookLMDetected) {
        Alert.alert(
          'NotebookLM Detected!',
          `${result.processedCount} transcript${result.processedCount > 1 ? 's have' : ' has'} been shared to NotebookLM. Note: NotebookLM may have combined them into one document.`,
          [{ text: 'OK' }]
        );
      } else if (result.shared) {
        Alert.alert(
          'Transcripts Shared',
          `${result.processedCount} transcript${result.processedCount > 1 ? 's have' : ' has'} been shared.`,
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error sharing bulk transcripts:', error);
      Alert.alert('Error', 'Failed to share transcripts');
    }
  };

  // Share transcripts one by one
  const handleSequentialShare = async (recordings) => {
    try {
      let successCount = 0;
      let notebookLMDetectedCount = 0;

      for (let i = 0; i < recordings.length; i++) {
        const recording = recordings[i];
        
        // Show progress
        console.log(`[HomeScreen] Sharing transcript ${i + 1} of ${recordings.length}: ${recording.title}`);
        
        const result = await shareTranscriptToNotebookLM(
          recording,
          async (recordingId) => {
            await handleNotebookLMShareDetected(recordingId);
          }
        );

        if (result.shared) {
          successCount++;
        }
        if (result.notebookLMDetected) {
          notebookLMDetectedCount++;
        }

        // Small delay between shares to help iOS process them separately
        if (i < recordings.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      // Reload recordings to show updated status
      await loadRecordings(true);

      // Show final result
      if (notebookLMDetectedCount > 0) {
        Alert.alert(
          'Sequential Sharing Complete!',
          `${successCount} transcript${successCount > 1 ? 's' : ''} shared successfully. ${notebookLMDetectedCount} detected as shared to NotebookLM. Each should appear as a separate source in NotebookLM.`,
          [{ text: 'OK' }]
        );
      } else if (successCount > 0) {
        Alert.alert(
          'Transcripts Shared',
          `${successCount} transcript${successCount > 1 ? 's' : ''} shared successfully.`,
          [{ text: 'OK' }]
        );
      }

    } catch (error) {
      console.error('Error in sequential sharing:', error);
      Alert.alert('Error', 'Failed to complete sequential sharing');
    }
  };

  // Handle bulk summary sharing (existing functionality, but refactored)
  const handleBulkSummaryShare = async (recordings) => {
    // Filter recordings that have summaries
    const validRecordings = recordings.filter(r => r.summary);

    if (validRecordings.length === 0) {
      return Alert.alert(
        'No Summaries', 
        'None of the selected recordings have summaries to share.'
      );
    }

    // Function to proceed with sharing the valid recordings
    const proceedWithSharing = async (chosenFormat) => {
      let filePaths = [];
      let tempFilePaths = [];

      // Generate individual files
      for (const recording of validRecordings) {
        const cleanedSummary = cleanSummaryMarkdown(recording.summary);
        const sanitizedTitle = recording.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

        if (chosenFormat === 'pdf') {
          const htmlContent = generateHTMLFromMarkdown(recording.title, cleanedSummary);
          console.log(`[HomeScreen] Generating PDF for: ${recording.title}`);
          try {
            const pdfPath = await createPDFFromHTML(recording.title, htmlContent);
            console.log(`[HomeScreen] PDF generated at path: ${pdfPath}`);
            const pdfExists = await RNFS.exists(pdfPath);
            console.log(`[HomeScreen] PDF file exists at path? ${pdfExists ? 'YES' : 'NO'}`);
            if (pdfExists) {
              filePaths.push(Platform.OS === 'ios' ? pdfPath : `file://${pdfPath}`);
            } else {
              console.warn(`[HomeScreen] PDF file generation reported success but file not found at: ${pdfPath}`);
            }
          } catch (pdfError) {
            console.error(`[HomeScreen] Error generating PDF for ${recording.title}:`, pdfError);
          }
        } else { // md
          const filename = `${sanitizedTitle}_summary.md`;
          const mdPath = `${RNFS.CachesDirectoryPath}/${filename}`;
          console.log(`[HomeScreen] Generating MD for: ${recording.title} at path: ${mdPath}`);
          try {
            await RNFS.writeFile(mdPath, cleanedSummary, 'utf8');
            const urlPath = Platform.OS === 'ios' ? `file://${mdPath}` : mdPath;
            filePaths.push(urlPath);
            tempFilePaths.push(mdPath);
          } catch (mdError) {
            console.error(`[HomeScreen] Error generating MD for ${recording.title}:`, mdError);
          }
        }
      }

      if (filePaths.length === 0) {
        return Alert.alert('Error', 'Failed to generate files for sharing.');
      }

      // Use Share.open for multiple files
      const shareOptions = {
        title: validRecordings.length > 1 ? 'Share Summaries' : `Share ${validRecordings[0].title} Summary`,
        urls: filePaths,
        type: chosenFormat === 'pdf' ? 'application/pdf' : 'text/markdown',
        subject: validRecordings.length > 1 ? 'Lesson Summaries' : `${validRecordings[0].title} Summary`,
      };

      await Share.open(shareOptions);

      // Clean up temporary MD files
      if (tempFilePaths.length > 0) {
        setTimeout(() => {
          tempFilePaths.forEach(p => RNFS.unlink(p).catch(err => console.error('MD cleanup failed:', err)));
        }, 5000);
      }
    };

    // Show format selection dialog (same as existing logic)
    const chosenFormat = await new Promise((resolve) => {
      Alert.alert(
        'Choose Format',
        `Share summaries for ${validRecordings.length} recording${validRecordings.length > 1 ? 's' : ''}?`,
        [
          { text: 'Markdown (.md)', onPress: () => resolve('md') },
          { text: 'PDF (.pdf)', onPress: () => resolve('pdf') },
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }
        ]
      );
    });

    if (chosenFormat) {
      await proceedWithSharing(chosenFormat);
    }
  };

  // Handle selecting/deselecting items in edit mode
  const handleSelectItem = (id) => {
    setSelectedRecordingIds(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      return newSelection;
    });
  };

  const renderItem = ({ item }) => {
    const isCurrentlyProcessing = processingId === item.id;
    const isSelected = selectedRecordingIds.has(item.id);



    const getProcessingStatus = () => {
      if (isCurrentlyProcessing || item.processingStatus === 'processing') {
        return 'processing';
      }
      return item.processingStatus || 'pending';
    };

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
        enabled={!isEditing && !isCurrentlyProcessing} // Disable swiping during editing or processing
      >
        <View style={[styles.recordingItemContainer, isSelected && styles.selectedItemContainer]}> 
          <TouchableOpacity 
            style={[styles.recordingItemRow, isEditing && styles.editingItemRow]} 
            onPress={() => {
              if (isEditing) {
                handleSelectItem(item.id);
              } else {
                navigation.navigate('RecordingDetail', { recordingId: item.id, title: item.title });
              }
            }}
            disabled={!isEditing && isCurrentlyProcessing} // Disable navigation only if not editing and processing
          >
            {isEditing && (
              <View style={styles.selectionCircleOuter}>
                <View style={[styles.selectionCircleInner, isSelected && styles.selectionCircleSelected]}>
                  {isSelected && <Icon name="checkmark" size={16} color="#FFFFFF" />} 
                </View>
              </View>
            )}
            <View style={styles.recordingInfo}>
              <Text style={styles.recordingTitle} numberOfLines={1} ellipsizeMode="tail">{item.title}</Text>
              <View style={styles.metadataContainer}>
                <View style={styles.dateInfoContainer}>
                  <Text style={styles.recordingDate}>{item.date}</Text>
                  <Text style={styles.recordingDuration}>{item.duration}</Text>
                </View>
                <ActionIndicator
                  status={getProcessingStatus()}
                  notebookLMStatus={item.notebookLMStatus}
                  onTranscribe={() => handleStartProcessing(item)}
                  onShare={() => handleShareRecording(item.id)}
                  onRetry={() => handleStartProcessing(item)}
                  disabled={!!processingId && processingId !== item.id}
                />
              </View>
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
        keyExtractor={item => item.id || `temp-${Math.random()}`} // Fallback key if id is missing
        contentContainerStyle={styles.listContent}
        extraData={[isEditing, selectedRecordingIds, processingId]} // Re-render when these change
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No recordings yet</Text>
            <Text style={styles.emptySubText}>Tap the record button to get started</Text>
          </View>
        }
      />
      
      {/* Bottom Action Area */}
      <View style={styles.bottomActionContainer}>
        {!isEditing ? (
          // Record Button when not editing
          <TouchableOpacity
            style={styles.recordButton}
            onPress={() => navigation.navigate('Recording')}
          >
            <Icon name="mic" size={30} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          // Share/Delete Buttons when editing
          <View style={styles.editActionsWrapper}>
            <TouchableOpacity
              style={[styles.editActionButton, selectedRecordingIds.size === 0 && styles.disabledEditButton]}
              onPress={handleBulkShare}
              disabled={selectedRecordingIds.size === 0}
            >
              <Icon name="share-outline" size={24} color={selectedRecordingIds.size === 0 ? '#BDBDBD' : '#007AFF'} />
              <Text style={[styles.editActionText, selectedRecordingIds.size === 0 && styles.disabledText]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.editActionButton, selectedRecordingIds.size === 0 && styles.disabledEditButton]}
              onPress={handleBulkDelete}
              disabled={selectedRecordingIds.size === 0}
            >
              <Icon name="trash-outline" size={24} color={selectedRecordingIds.size === 0 ? '#BDBDBD' : '#FF3B30'} />
              <Text style={[styles.editActionText, selectedRecordingIds.size === 0 && styles.disabledText]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
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
  recordingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    minHeight: 80,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  editingItemRow: {
    paddingLeft: 0,
  },
  selectedItemContainer: {
    backgroundColor: '#EFEFF4',
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
    marginLeft: 12,
  },
  recordingTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 2,
    color: '#1C1C1E',
    letterSpacing: -0.2,
  },
  recordingDate: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '400',
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDuration: {
    fontSize: 13,
    color: '#8E8E93',
    marginLeft: 12,
    fontWeight: '500',
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
  metadataContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  dateInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
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
  selectionCircleOuter: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 16,
  },
  selectionCircleInner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#C7C7CC',
    backgroundColor: '#FFFFFF',
  },
  selectionCircleSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomActionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 90,
    paddingBottom: 30,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#BDBDBD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editActionsWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  editActionButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  editActionText: {
    fontSize: 12,
    marginTop: 4,
    color: '#007AFF'
  },
  disabledEditButton: {
    opacity: 0.5,
  },
  disabledText: {
    color: '#BDBDBD',
  },
});

export default HomeScreen;
