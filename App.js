import React from 'react';
import { AppRegistry } from 'react-native';
import { AppProvider } from './src/utils/AppContext';
import AppNavigator from './src/navigation/AppNavigator';
import { name as appName } from './app.json';

const App = () => {
  return (
    <AppProvider>
      <AppNavigator />
    </AppProvider>
  );
};

AppRegistry.registerComponent(appName, () => App);

export default App;
