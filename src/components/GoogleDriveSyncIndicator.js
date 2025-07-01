import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const GoogleDriveSyncIndicator = ({
  syncStatus,
  onSyncPress,
  lastSyncDate,
  size = 'normal',
  showText = true,
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
        isSmall && styles.smallContainer,
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
            isSmall && styles.smallText,
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
