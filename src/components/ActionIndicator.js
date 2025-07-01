import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const ActionIndicator = ({ 
  status, 
  notebookLMStatus, 
  onTranscribe, 
  onShare, 
  onRetry, 
  disabled = false 
}) => {
  const renderContent = () => {
    switch (status) {
      case 'pending':
        return (
          <TouchableOpacity
            style={[styles.actionButton, styles.transcribeButton]}
            onPress={onTranscribe}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <Icon name="play" size={12} color="#FFFFFF" style={styles.icon} />
            <Text style={styles.actionText}>Transcribe</Text>
          </TouchableOpacity>
        );

      case 'processing':
        return (
          <View style={[styles.actionButton, styles.processingIndicator]}>
            <ActivityIndicator size="small" color="#666" style={styles.spinner} />
            <Text style={styles.processingText}>Transcribing...</Text>
          </View>
        );

      case 'complete':
        if (notebookLMStatus === 'imported') {
          return (
            <View style={[styles.actionButton, styles.notebookLMButton]}>
              <Icon name="document-text" size={14} color="#FFFFFF" style={styles.icon} />
              <Text style={styles.actionText}>In NotebookLM</Text>
            </View>
          );
        } else {
          return (
            <View style={[styles.actionButton, styles.completeButton]}>
              <Icon name="checkmark" size={14} color="#FFFFFF" style={styles.icon} />
              <Text style={styles.actionText}>Ready</Text>
            </View>
          );
        }

      case 'error':
        return (
          <TouchableOpacity
            style={[styles.actionButton, styles.errorButton]}
            onPress={onRetry}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <Icon name="refresh" size={14} color="#FFFFFF" style={styles.icon} />
            <Text style={styles.actionText}>Retry</Text>
          </TouchableOpacity>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 75,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  transcribeButton: {
    backgroundColor: '#007AFF',
  },
  processingIndicator: {
    backgroundColor: '#F2F2F7',
  },
  completeButton: {
    backgroundColor: '#34C759',
  },
  shareButton: {
    backgroundColor: '#007AFF',
  },
  notebookLMButton: {
    backgroundColor: '#6B46C1',
  },
  errorButton: {
    backgroundColor: '#FF3B30',
  },
  retryButton: {
    backgroundColor: '#007AFF',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  processingText: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '500',
  },
  spinner: {
    marginRight: 4,
  },
  icon: {
    marginRight: 4,
  },
});

export default ActionIndicator;