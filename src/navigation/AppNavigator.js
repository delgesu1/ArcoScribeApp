import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

// Import screens
import HomeScreen from '../screens/HomeScreen';
import RecordingScreen from '../screens/RecordingScreen';
import RecordingDetailScreen from '../screens/RecordingDetailScreen';

const Stack = createStackNavigator();

const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#f8f8f8',
          },
          headerTintColor: '#007AFF',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        <Stack.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ title: 'All Recordings' }}
        />
        <Stack.Screen 
          name="Recording" 
          component={RecordingScreen} 
          options={{ 
            title: 'New Recording',
            headerShown: false
          }}
        />
        <Stack.Screen 
          name="RecordingDetail" 
          component={RecordingDetailScreen} 
          options={({ route }) => ({ title: route.params?.title || 'Recording' })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
