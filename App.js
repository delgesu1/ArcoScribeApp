import React, { useEffect } from 'react';
import { AppRegistry } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { AppProvider } from './src/utils/AppContext';
import AppNavigator from './src/navigation/AppNavigator';
import { name as appName } from './app.json';

const App = () => {
  useEffect(() => {
    // Initialize Google Sign-In configuration when app starts
    GoogleSignin.configure({
      iosClientId: '61774739702-jv8e7u7o5bg4gmb370k578daa8aj4pv7.apps.googleusercontent.com',
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    console.log('[App] Google Sign-In configured at app startup');
  }, []);

  return (
    <AppProvider>
      <AppNavigator />
    </AppProvider>
  );
};

AppRegistry.registerComponent(appName, () => App);

export default App;
