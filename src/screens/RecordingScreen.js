import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Animated,
  AppState
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { startRecording, stopRecording, pauseRecording, resumeRecording, setProgressCallback } from '../services/AudioRecordingService';
import { formatTime } from '../utils/TimeUtils';

const RecordingScreen = ({ navigation }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingId, setRecordingId] = useState(null);
  const [waveformHeight, setWaveformHeight] = useState([]);
  const [currentSegment, setCurrentSegment] = useState(1);
  const timerRef = useRef(null);
  const waveformAnimationValue = useRef(new Animated.Value(0)).current;
  const appState = useRef(AppState.currentState);
  const recordingStartTimeRef = useRef(null);
  const pauseStartTimeRef = useRef(null);
  const totalPauseDurationRef = useRef(0);
  const animationRef = useRef(null);

  // Generate random waveform heights 
  useEffect(() => {
    const heights = Array.from({ length: 50 }, () => Math.random() * 50 + 10);
    setWaveformHeight(heights);

    // Set up AppState listener
    const subscription = AppState.addEventListener('change', nextAppState => {
      handleAppStateChange(appState.current, nextAppState);
      appState.current = nextAppState;
    });

    // Set up progress callback from native module
    setProgressCallback(handleRecordingProgress);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      subscription.remove();
      setProgressCallback(null);
    };
  }, []);

  // Handle recording progress updates from native module
  const handleRecordingProgress = (data) => {
    if (data && data.currentTime) {
      setRecordingTime(Math.floor(data.currentTime));
      
      // Update segment number if changed
      if (data.segmentNumber && data.segmentNumber !== currentSegment) {
        setCurrentSegment(data.segmentNumber);
        console.log(`Recording segment changed to: ${data.segmentNumber}`);
      }
    }
  };

  // Animate waveform when recording
  useEffect(() => {
    if (isRecording && !isPaused) {
      startWaveformAnimation();
    } else {
      stopWaveformAnimation();
    }
  }, [isRecording, isPaused, waveformAnimationValue]);

  // Handle app state changes
  const handleAppStateChange = (currentState, nextState) => {
    console.log(`App state changed from ${currentState} to ${nextState}`);
    
    if (nextState === 'active') {
      // App came to foreground
      if (isRecording && !isPaused) {
        // Restart UI animations/timers only (recording continues in native module)
        startWaveformAnimation();
        
        // We don't need to restart the timer as we're now getting updates from the native module
      }
    } else if (nextState === 'background') {
      // App went to background
      // Stop UI animations and timers to save resources
      stopWaveformAnimation();
      
      // Note: The actual recording continues in the native module
      // We're just pausing UI updates to save battery/resources
    }
  };

  // Start waveform animation
  const startWaveformAnimation = () => {
    // Stop any existing animation first
    stopWaveformAnimation();
    
    // Create and store the animation reference
    animationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(waveformAnimationValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: false,
        }),
        Animated.timing(waveformAnimationValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: false,
        }),
      ])
    );
    
    // Start the animation
    animationRef.current.start();
  };

  // Stop waveform animation
  const stopWaveformAnimation = () => {
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
    waveformAnimationValue.stopAnimation();
  };

  const handleStartRecording = async () => {
    try {
      const id = await startRecording();
      setRecordingId(id);
      setIsRecording(true);
      setIsPaused(false);
      recordingStartTimeRef.current = Date.now();
      setCurrentSegment(1);
      
      // Timer is no longer needed as we're getting updates from native module
      // via the progress callback
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const handleStopRecording = async () => {
    if (!isRecording) return;
    
    try {
      stopWaveformAnimation();
      const result = await stopRecording();
      
      // Navigate back to home screen
      navigation.navigate('Home');
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
      recordingStartTimeRef.current = null;
      pauseStartTimeRef.current = null;
      totalPauseDurationRef.current = 0;
    }
  };

  const handlePauseResumeRecording = async () => {
    if (!isRecording) return;
    
    try {
      if (isPaused) {
        // Resume recording
        await resumeRecording();
        
        // Calculate total pause duration
        if (pauseStartTimeRef.current) {
          const pauseDuration = Date.now() - pauseStartTimeRef.current;
          totalPauseDurationRef.current += pauseDuration;
          pauseStartTimeRef.current = null;
        }
        
        // Animations will restart from the useEffect
      } else {
        // Pause recording
        await pauseRecording();
        pauseStartTimeRef.current = Date.now();
        
        // Animations will stop from the useEffect
      }
      setIsPaused(!isPaused);
    } catch (error) {
      console.error('Failed to pause/resume recording:', error);
    }
  };

  const renderWaveform = () => {
    return (
      <View style={styles.waveformContainer}>
        {waveformHeight.map((height, index) => {
          const animatedHeight = waveformAnimationValue.interpolate({
            inputRange: [0, 1],
            outputRange: [height * 0.3, height],
          });
          
          return (
            <Animated.View
              key={index}
              style={[
                styles.waveformBar,
                {
                  height: isRecording ? animatedHeight : height * 0.3,
                  backgroundColor: isRecording ? '#FF3B30' : '#C7C7CC',
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <TouchableOpacity 
        style={styles.closeButton}
        onPress={() => {
          if (isRecording) {
            handleStopRecording();
          } else {
            navigation.goBack();
          }
        }}
      >
        <Text style={styles.closeButtonText}>Done</Text>
      </TouchableOpacity>
      
      <View style={styles.contentContainer}>
        <Text style={styles.timerText}>{formatTime(recordingTime)}</Text>
        
        {isRecording && currentSegment > 1 && (
          <Text style={styles.segmentText}>Segment: {currentSegment}</Text>
        )}
        
        {renderWaveform()}
        
        <View style={styles.controlsContainer}>
          {isRecording ? (
            <>
              {isPaused ? (
                <TouchableOpacity 
                  style={styles.recordButton}
                  onPress={handlePauseResumeRecording}
                >
                  <View style={styles.recordButtonInner} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  style={styles.pauseButton}
                  onPress={handlePauseResumeRecording}
                >
                  <Icon name="pause" size={30} color="#FF3B30" />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <TouchableOpacity 
              style={styles.recordButton}
              onPress={handleStartRecording}
            >
              <View style={styles.recordButtonInner} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  closeButton: {
    padding: 16,
    alignSelf: 'flex-end',
  },
  closeButtonText: {
    fontSize: 17,
    color: '#007AFF',
    fontWeight: '500',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  timerText: {
    fontSize: 60,
    fontWeight: '200',
    marginBottom: 10,
  },
  segmentText: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 20,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 100,
    width: '100%',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: '#C7C7CC',
  },
  controlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  controlButton: {
    alignItems: 'center',
    marginHorizontal: 30,
  },
  controlText: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 4,
  },
  recordButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordButtonInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
  },
  pauseButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 30,
  },
});

export default RecordingScreen;
