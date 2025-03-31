import React from 'react';
import { StyleSheet } from 'react-native';

// Common colors used throughout the app
export const Colors = {
  primary: '#FF3B30',       // Red color for record button and active elements
  primaryDark: '#D0312D',   // Darker red for pressed states
  secondary: '#007AFF',     // Blue color for interactive elements
  secondaryDark: '#0062CC', // Darker blue for pressed states
  background: '#FFFFFF',    // Main background color
  card: '#F2F2F7',          // Background color for cards
  text: '#000000',          // Primary text color
  textSecondary: '#8E8E93', // Secondary text color
  border: '#E5E5EA',        // Border color
  success: '#34C759',       // Success color
  warning: '#FF9500',       // Warning color
  error: '#FF3B30',         // Error color
  inactive: '#C7C7CC',      // Inactive elements color
};

// Common text styles
export const Typography = {
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  body: {
    fontSize: 16,
    color: Colors.text,
  },
  caption: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  small: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  timer: {
    fontSize: 60,
    fontWeight: '200',
    color: Colors.text,
  },
};

// Common spacing values
export const Spacing = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 48,
};

// Common border radius values
export const BorderRadius = {
  s: 4,
  m: 8,
  l: 16,
  xl: 24,
  round: 9999, // For circular elements
};

// Common shadow styles
export const Shadows = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
};

// Common button styles
export const Buttons = {
  primary: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.m,
    paddingVertical: Spacing.m,
    paddingHorizontal: Spacing.l,
    ...Shadows.small,
  },
  secondary: {
    backgroundColor: Colors.secondary,
    borderRadius: BorderRadius.m,
    paddingVertical: Spacing.m,
    paddingHorizontal: Spacing.l,
    ...Shadows.small,
  },
  outline: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: BorderRadius.m,
    paddingVertical: Spacing.m,
    paddingHorizontal: Spacing.l,
  },
  text: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '500',
  },
  icon: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
};

// Common input styles
export const Inputs = {
  default: {
    height: 40,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.m,
    paddingHorizontal: Spacing.m,
    fontSize: 16,
  },
  search: {
    height: 40,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.m,
    paddingHorizontal: Spacing.m,
    fontSize: 16,
  },
};

// Common container styles
export const Containers = {
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  card: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.m,
    padding: Spacing.m,
    marginVertical: Spacing.s,
    ...Shadows.small,
  },
  section: {
    marginBottom: Spacing.l,
  },
};

// Export all theme elements
export const Theme = {
  Colors,
  Typography,
  Spacing,
  BorderRadius,
  Shadows,
  Buttons,
  Inputs,
  Containers,
};

export default Theme;
