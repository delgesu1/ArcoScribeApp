import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Theme } from '../utils/Theme';

/**
 * Reusable button component with various styles
 * @param {Object} props - Component props
 * @param {string} props.type - Button type: 'primary', 'secondary', 'outline', 'icon'
 * @param {string} props.text - Button text
 * @param {string} props.iconName - Icon name for icon buttons
 * @param {Function} props.onPress - Button press handler
 * @param {Object} props.style - Additional style for the button
 * @param {Object} props.textStyle - Additional style for the button text
 */
export const Button = ({ 
  type = 'primary', 
  text, 
  iconName, 
  onPress, 
  style, 
  textStyle,
  disabled = false
}) => {
  // Determine button style based on type
  let buttonStyle;
  let buttonTextStyle;
  
  switch (type) {
    case 'primary':
      buttonStyle = Theme.Buttons.primary;
      buttonTextStyle = { color: 'white', fontWeight: '500' };
      break;
    case 'secondary':
      buttonStyle = Theme.Buttons.secondary;
      buttonTextStyle = { color: 'white', fontWeight: '500' };
      break;
    case 'outline':
      buttonStyle = Theme.Buttons.outline;
      buttonTextStyle = { color: Theme.Colors.primary, fontWeight: '500' };
      break;
    case 'icon':
      buttonStyle = Theme.Buttons.icon;
      break;
    default:
      buttonStyle = Theme.Buttons.primary;
      buttonTextStyle = { color: 'white', fontWeight: '500' };
  }
  
  // Apply disabled styles if needed
  if (disabled) {
    buttonStyle = {
      ...buttonStyle,
      backgroundColor: type === 'outline' ? 'transparent' : Theme.Colors.inactive,
      borderColor: Theme.Colors.inactive,
    };
    buttonTextStyle = {
      ...buttonTextStyle,
      color: Theme.Colors.textSecondary,
    };
  }
  
  return (
    <TouchableOpacity
      style={[buttonStyle, style]}
      onPress={onPress}
      disabled={disabled}
    >
      {iconName ? (
        <Icon 
          name={iconName} 
          size={24} 
          color={disabled ? Theme.Colors.textSecondary : (type === 'outline' ? Theme.Colors.primary : 'white')} 
        />
      ) : (
        <Text style={[buttonTextStyle, textStyle]}>{text}</Text>
      )}
    </TouchableOpacity>
  );
};

/**
 * Reusable card component
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Card content
 * @param {Object} props.style - Additional style for the card
 */
export const Card = ({ children, style }) => {
  return (
    <View style={[Theme.Containers.card, style]}>
      {children}
    </View>
  );
};

/**
 * Reusable section header component
 * @param {Object} props - Component props
 * @param {string} props.title - Section title
 * @param {React.ReactNode} props.rightComponent - Optional component to display on the right
 * @param {Object} props.style - Additional style for the section header
 */
export const SectionHeader = ({ title, rightComponent, style }) => {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={Theme.Typography.subtitle}>{title}</Text>
      {rightComponent}
    </View>
  );
};

/**
 * Reusable list item component
 * @param {Object} props - Component props
 * @param {string} props.title - Item title
 * @param {string} props.subtitle - Item subtitle
 * @param {string} props.rightText - Text to display on the right
 * @param {Function} props.onPress - Item press handler
 * @param {Object} props.style - Additional style for the list item
 */
export const ListItem = ({ title, subtitle, rightText, onPress, style }) => {
  return (
    <TouchableOpacity style={[styles.listItem, style]} onPress={onPress}>
      <View style={styles.listItemContent}>
        <Text style={styles.listItemTitle} numberOfLines={1}>{title}</Text>
        {subtitle && <Text style={styles.listItemSubtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      <View style={styles.listItemRight}>
        {rightText && <Text style={styles.listItemRightText}>{rightText}</Text>}
        <Icon name="chevron-forward" size={20} color={Theme.Colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
};

/**
 * Reusable recording button component
 * @param {Object} props - Component props
 * @param {boolean} props.isRecording - Whether recording is active
 * @param {boolean} props.isPaused - Whether recording is paused
 * @param {Function} props.onStartRecording - Start recording handler
 * @param {Function} props.onStopRecording - Stop recording handler
 * @param {Function} props.onPauseResumeRecording - Pause/resume recording handler
 * @param {Object} props.style - Additional style for the button
 */
export const RecordButton = ({ 
  isRecording, 
  isPaused, 
  onStartRecording, 
  onStopRecording, 
  onPauseResumeRecording, 
  style 
}) => {
  if (isRecording) {
    return (
      <View style={[styles.recordingControls, style]}>
        <TouchableOpacity 
          style={styles.pauseButton}
          onPress={onPauseResumeRecording}
        >
          <Icon name={isPaused ? "play" : "pause"} size={30} color={Theme.Colors.primary} />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.stopButton}
          onPress={onStopRecording}
        >
          <Icon name="square" size={24} color={Theme.Colors.primary} />
        </TouchableOpacity>
      </View>
    );
  }
  
  return (
    <TouchableOpacity 
      style={[styles.recordButton, style]}
      onPress={onStartRecording}
    >
      <View style={styles.recordButtonInner} />
    </TouchableOpacity>
  );
};

/**
 * Reusable waveform visualization component
 * @param {Object} props - Component props
 * @param {Array} props.data - Waveform data points
 * @param {boolean} props.isActive - Whether waveform is active
 * @param {Object} props.style - Additional style for the waveform
 */
export const Waveform = ({ data = [], isActive = false, style }) => {
  // If no data provided, generate random data
  const waveformData = data.length > 0 ? data : Array.from({ length: 50 }, () => Math.random() * 50 + 10);
  
  return (
    <View style={[styles.waveformContainer, style]}>
      {waveformData.map((height, index) => (
        <View
          key={index}
          style={[
            styles.waveformBar,
            {
              height: height,
              backgroundColor: isActive ? Theme.Colors.primary : Theme.Colors.inactive,
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.Spacing.s,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.Spacing.m,
    borderBottomWidth: 0.5,
    borderBottomColor: Theme.Colors.border,
  },
  listItemContent: {
    flex: 1,
    marginRight: Theme.Spacing.s,
  },
  listItemTitle: {
    ...Theme.Typography.body,
    marginBottom: 4,
  },
  listItemSubtitle: {
    ...Theme.Typography.caption,
  },
  listItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listItemRightText: {
    ...Theme.Typography.caption,
    marginRight: Theme.Spacing.xs,
  },
  recordButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Theme.Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...Theme.Shadows.medium,
  },
  recordButtonInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'white',
  },
  recordingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: Theme.Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: Theme.Spacing.m,
  },
  stopButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: Theme.Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: Theme.Spacing.m,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 100,
    width: '100%',
    justifyContent: 'space-between',
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: Theme.Colors.inactive,
  },
});
