/**
 * Utility functions for time formatting
 */

/**
 * Format seconds into MM:SS or HH:MM:SS format
 * @param {number} seconds - Time in seconds
 * @param {boolean} showMilliseconds - Whether to show milliseconds
 * @returns {string} Formatted time string
 */
export const formatTime = (seconds, showMilliseconds = false) => {
  if (typeof seconds !== 'number' || isNaN(seconds)) {
    return showMilliseconds ? '00:00.00' : '00:00';
  }
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const milliseconds = Math.floor(((seconds % 1) * 100));
  
  // Format with leading zeros
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(remainingSeconds).padStart(2, '0');
  const formattedMilliseconds = String(milliseconds).padStart(2, '0');
  
  // Include hours only if there are any
  let timeString;
  if (hours > 0) {
    const formattedHours = String(hours).padStart(2, '0');
    timeString = `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
  } else {
    timeString = `${formattedMinutes}:${formattedSeconds}`;
  }
  
  // Add milliseconds if requested
  if (showMilliseconds) {
    timeString += `.${formattedMilliseconds}`;
  }
  
  return timeString;
};

/**
 * Format date to display format
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date string
 */
export const formatDate = (date) => {
  const dateObj = new Date(date);
  
  const options = { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  
  return dateObj.toLocaleDateString(undefined, options);
};

/**
 * Get relative time (e.g., "2 hours ago", "Yesterday")
 * @param {Date|string|number} date - Date to format
 * @returns {string} Relative time string
 */
export const getRelativeTime = (date) => {
  const dateObj = new Date(date);
  const now = new Date();
  
  const diffMs = now - dateObj;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffDay > 30) {
    return formatDate(date);
  } else if (diffDay > 1) {
    return `${diffDay} days ago`;
  } else if (diffDay === 1) {
    return 'Yesterday';
  } else if (diffHour > 1) {
    return `${diffHour} hours ago`;
  } else if (diffHour === 1) {
    return '1 hour ago';
  } else if (diffMin > 1) {
    return `${diffMin} minutes ago`;
  } else if (diffMin === 1) {
    return '1 minute ago';
  } else {
    return 'Just now';
  }
};
