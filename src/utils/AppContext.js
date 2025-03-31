import React, { createContext, useContext, useState, useEffect } from 'react';
import { getRecordings } from '../services/AudioRecordingService';

// Create context
const AppContext = createContext();

// Provider component
export const AppProvider = ({ children }) => {
  const [recordings, setRecordings] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load recordings from storage
  const loadRecordings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getRecordings();
      setRecordings(data);
    } catch (err) {
      setError('Failed to load recordings');
      console.error('Error loading recordings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Add a new recording
  const addRecording = (recording) => {
    setRecordings(prevRecordings => [recording, ...prevRecordings]);
  };

  // Update an existing recording
  const updateRecording = (updatedRecording) => {
    setRecordings(prevRecordings => 
      prevRecordings.map(recording => 
        recording.id === updatedRecording.id ? updatedRecording : recording
      )
    );
  };

  // Delete a recording
  const deleteRecordingFromState = (recordingId) => {
    setRecordings(prevRecordings => 
      prevRecordings.filter(recording => recording.id !== recordingId)
    );
  };

  // Initial load
  useEffect(() => {
    loadRecordings();
  }, []);

  // Context value
  const value = {
    recordings,
    isLoading,
    error,
    loadRecordings,
    addRecording,
    updateRecording,
    deleteRecordingFromState
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// Custom hook to use the context
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
