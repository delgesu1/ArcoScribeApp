import { updateRecording } from './AudioRecordingService';

/**
 * Clean up markdown text by removing code block delimiters
 * @param {string} text - Markdown text to clean
 * @returns {string} - Cleaned markdown text
 */
export const cleanMarkdownText = (text) => {
  if (!text) return '';
  
  // Remove markdown code block delimiters with any language specifier
  // This pattern matches opening ```[language] and closing ``` delimiters
  let cleanedText = text.replace(/```(\w*)\s*/g, '').replace(/```\s*$/g, '');
  
  // Trim extra whitespace
  cleanedText = cleanedText.trim();
  
  console.log("Original summary length:", text.length);
  console.log("Cleaned summary length:", cleanedText.length);
  
  return cleanedText;
};
