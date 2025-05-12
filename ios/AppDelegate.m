#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>
#import <React/RCTLinkingManager.h>
#import <React/RCTLog.h> // Import RCTLog
#import <AVFoundation/AVFoundation.h>

// Define Notification Names *locally* for testing robustness
NSNotificationName const AudioRecordingDidStartNotification_AppDelegate = @"AudioRecordingDidStartNotification";
NSNotificationName const AudioRecordingDidStopNotification_AppDelegate = @"AudioRecordingDidStopNotification";

@interface AppDelegate ()
@property (nonatomic, assign) UIBackgroundTaskIdentifier backgroundTaskIdentifier;
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"ArcoScribeApp";
  self.initialProps = @{};

  // Initialize background task identifier
  self.backgroundTaskIdentifier = UIBackgroundTaskInvalid;
  
  // --- Ensure Audio Session is configured for background --- 
  NSError *categoryError = nil;
  [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayAndRecord 
                                   withOptions:AVAudioSessionCategoryOptionMixWithOthers | AVAudioSessionCategoryOptionAllowBluetooth
                                         error:&categoryError];
  if (categoryError) {
    RCTLogError(@"[AppDelegate] Error setting AVAudioSession category: %@", categoryError);
  }
  // --- End Audio Session Config --- 

  BOOL didFinish = [super application:application didFinishLaunchingWithOptions:launchOptions];
  
  // Register for notifications *after* super returns
  [self registerAudioRecordingNotifications];
  
  return didFinish;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// Linking API
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  return [RCTLinkingManager application:application openURL:url options:options];
}

// Universal Links
- (BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)userActivity restorationHandler:(void(^)(NSArray<id<UIUserActivityRestoring>> * __nullable restorableObjects))restorationHandler {
  return [RCTLinkingManager application:application continueUserActivity:userActivity restorationHandler:restorationHandler];
}

// --- Background Task Handling --- 

- (void)registerAudioRecordingNotifications {
    // Use locally defined names for observation
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleAudioRecordingDidStart:)
                                                 name:AudioRecordingDidStartNotification_AppDelegate
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleAudioRecordingDidStop:)
                                                 name:AudioRecordingDidStopNotification_AppDelegate
                                               object:nil];
     RCTLogInfo(@"[AppDelegate] Registered for audio recording notifications."); // Use RCTLogInfo
}

- (void)unregisterAudioRecordingNotifications {
     RCTLogInfo(@"[AppDelegate] Unregistering audio recording notifications."); // Use RCTLogInfo
    [[NSNotificationCenter defaultCenter] removeObserver:self name:AudioRecordingDidStartNotification_AppDelegate object:nil];
    [[NSNotificationCenter defaultCenter] removeObserver:self name:AudioRecordingDidStopNotification_AppDelegate object:nil];
}

- (void)handleAudioRecordingDidStart:(NSNotification *)notification {
    RCTLogInfo(@"[AppDelegate] Received AudioRecordingDidStartNotification."); // Use RCTLogInfo
    if (self.backgroundTaskIdentifier == UIBackgroundTaskInvalid) {
         RCTLogInfo(@"[AppDelegate] Starting background task..."); // Use RCTLogInfo
        self.backgroundTaskIdentifier = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"AudioRecording" expirationHandler:^{
            RCTLogWarn(@"[AppDelegate] WARNING: Background task for audio recording expired!"); // Use RCTLogWarn
            if (self.backgroundTaskIdentifier != UIBackgroundTaskInvalid) {
                 RCTLogInfo(@"[AppDelegate] Ending background task due to expiration."); // Use RCTLogInfo
                [[UIApplication sharedApplication] endBackgroundTask:self.backgroundTaskIdentifier];
                self.backgroundTaskIdentifier = UIBackgroundTaskInvalid;
            }
        }];
        RCTLogInfo(@"[AppDelegate] Background task started with identifier: %lu", (unsigned long)self.backgroundTaskIdentifier); // Use RCTLogInfo
    } else {
         RCTLogWarn(@"[AppDelegate] WARNING: Received start notification but background task already active (%lu).", (unsigned long)self.backgroundTaskIdentifier); // Use RCTLogWarn
    }
}

- (void)handleAudioRecordingDidStop:(NSNotification *)notification {
     RCTLogInfo(@"[AppDelegate] Received AudioRecordingDidStopNotification."); // Use RCTLogInfo
    if (self.backgroundTaskIdentifier != UIBackgroundTaskInvalid) {
        RCTLogInfo(@"[AppDelegate] Ending background task with identifier: %lu", (unsigned long)self.backgroundTaskIdentifier); // Use RCTLogInfo
        [[UIApplication sharedApplication] endBackgroundTask:self.backgroundTaskIdentifier];
        self.backgroundTaskIdentifier = UIBackgroundTaskInvalid;
    } else {
         RCTLogWarn(@"[AppDelegate] WARNING: Received stop notification but no background task was active."); // Use RCTLogWarn
    }
}

// Optional: Add observer removal if your app terminates differently
// - (void)applicationWillTerminate:(UIApplication *)application {
//    [self unregisterAudioRecordingNotifications];
// }

// Consider adding dealloc if ARC is not guaranteed or for explicit cleanup
// - (void)dealloc {
//    [self unregisterAudioRecordingNotifications];
// }

// --- End Background Task Handling ---

@end 