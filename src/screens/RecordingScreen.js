import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Animated
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { startRecording, stopRecording, pauseRecording, resumeRecording } from '../services/AudioRecordingService';
import { formatTime } from '../utils/TimeUtils';

const RecordingScreen = ({ navigation }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingId, setRecordingId] = useState(null);
  const [waveformHeight, setWaveformHeight] = useState([]);
  const timerRef = useRef(null);
  const waveformAnimationValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Generate random waveform heights for visualization
    const heights = Array.from({ length: 50 }, () => Math.random() * 50 + 10);
    setWaveformHeight(heights);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isRecording && !isPaused) {
      // Animate waveform when recording
      Animated.loop(
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
      ).start();
    } else {
      // Stop animation when not recording
      waveformAnimationValue.stopAnimation();
    }
  }, [isRecording, isPaused, waveformAnimationValue]);

  const handleStartRecording = async () => {
    try {
      const id = await startRecording();
      setRecordingId(id);
      setIsRecording(true);
      setIsPaused(false);
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const handleStopRecording = async () => {
    if (!isRecording) return;
    
    try {
      clearInterval(timerRef.current);
      const result = await stopRecording();
      
      // Navigate back to home screen
      navigation.navigate('Home');
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      setRecordingTime(0);
    }
  };

  const handlePauseResumeRecording = async () => {
    if (!isRecording) return;
    
    try {
      if (isPaused) {
        await resumeRecording();
        timerRef.current = setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      } else {
        clearInterval(timerRef.current);
        await pauseRecording();
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
    marginBottom: 40,
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
