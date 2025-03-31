// Utility functions for file operations
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

/**
 * Get the base directory for app storage
 * @returns {Promise<string>} Base directory path
 */
export const getBaseDirectory = async () => {
  const baseDir = Platform.OS === 'ios' 
    ? `${RNFS.DocumentDirectoryPath}/ArcoScribe` 
    : `${RNFS.ExternalDirectoryPath}/ArcoScribe`;
  
  // Create directory if it doesn't exist
  const exists = await RNFS.exists(baseDir);
  if (!exists) {
    await RNFS.mkdir(baseDir);
  }
  
  return baseDir;
};

/**
 * Create a subdirectory in the base directory
 * @param {string} subDir - Subdirectory name
 * @returns {Promise<string>} Full directory path
 */
export const createDirectory = async (subDir) => {
  const baseDir = await getBaseDirectory();
  const fullPath = `${baseDir}/${subDir}`;
  
  // Create directory if it doesn't exist
  const exists = await RNFS.exists(fullPath);
  if (!exists) {
    await RNFS.mkdir(fullPath);
  }
  
  return fullPath;
};

/**
 * Save data to a JSON file
 * @param {string} fileName - File name
 * @param {Object} data - Data to save
 * @param {string} subDir - Optional subdirectory
 * @returns {Promise<string>} File path
 */
export const saveJsonFile = async (fileName, data, subDir = '') => {
  try {
    let dirPath;
    
    if (subDir) {
      dirPath = await createDirectory(subDir);
    } else {
      dirPath = await getBaseDirectory();
    }
    
    const filePath = `${dirPath}/${fileName}`;
    const jsonString = JSON.stringify(data);
    
    await RNFS.writeFile(filePath, jsonString, 'utf8');
    return filePath;
  } catch (error) {
    console.error('Error saving JSON file:', error);
    throw error;
  }
};

/**
 * Read data from a JSON file
 * @param {string} fileName - File name
 * @param {string} subDir - Optional subdirectory
 * @returns {Promise<Object>} Parsed JSON data
 */
export const readJsonFile = async (fileName, subDir = '') => {
  try {
    let dirPath;
    
    if (subDir) {
      dirPath = await createDirectory(subDir);
    } else {
      dirPath = await getBaseDirectory();
    }
    
    const filePath = `${dirPath}/${fileName}`;
    
    // Check if file exists
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      return null;
    }
    
    const jsonString = await RNFS.readFile(filePath, 'utf8');
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error reading JSON file:', error);
    return null;
  }
};

/**
 * Delete a file
 * @param {string} filePath - Full path to file
 * @returns {Promise<boolean>} Success status
 */
export const deleteFile = async (filePath) => {
  try {
    // Check if file exists
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      return false;
    }
    
    await RNFS.unlink(filePath);
    return true;
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};

/**
 * Get file stats (size, creation date, etc.)
 * @param {string} filePath - Full path to file
 * @returns {Promise<Object>} File stats
 */
export const getFileStats = async (filePath) => {
  try {
    // Check if file exists
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      return null;
    }
    
    return await RNFS.stat(filePath);
  } catch (error) {
    console.error('Error getting file stats:', error);
    return null;
  }
};
