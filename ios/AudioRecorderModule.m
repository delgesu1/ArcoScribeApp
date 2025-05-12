#import "AudioRecorderModule.h"
#import <React/RCTUtils.h>
#import <React/RCTLog.h>
#import <UIKit/UIApplication.h>

// Define Notification Names
NSNotificationName const AudioRecordingDidStartNotification = @"AudioRecordingDidStartNotification";
NSNotificationName const AudioRecordingDidStopNotification = @"AudioRecordingDidStopNotification";

@interface AudioRecorderModule () <AVAudioRecorderDelegate>
// Internal state for new recording logic
@property (nonatomic, assign) SegmentStopReason currentStopReason; // Replaces _isManuallyStopping
@property (atomic, assign) NSTimeInterval totalDurationOfCompletedSegmentsSoFar; // Accumulates duration of successfully recorded segments
@property (nonatomic, assign) UIBackgroundTaskIdentifier segmentTransitionBackgroundTaskID; // Added for UIBackgroundTaskIdentifier
@property (nonatomic, strong) dispatch_queue_t eventDispatchQueue; // Dedicated serial dispatch queue for sendEventWithName calls
@property (nonatomic, assign) PauseOrigin currentPauseOrigin; // Added for pause origin tracking

// Private helper methods for app lifecycle
- (void)registerAppLifecycleNotifications;
- (void)unregisterAppLifecycleNotifications;
- (void)handleAppDidEnterBackground:(NSNotification *)notification;
- (void)handleAppWillEnterForeground:(NSNotification *)notification;
@end

@implementation AudioRecorderModule
{
    bool hasListeners;
    AVAudioSession *_audioSession; // Keep if used directly
    NSMutableArray *_recordingSegments; // This is a property: self.recordingSegments
    NSTimeInterval _maxSegmentDuration; // This is a property: self.maxSegmentDuration
}

RCT_EXPORT_MODULE();

#pragma mark - Initialization & Lifecycle

- (instancetype)init
{
    self = [super init];
    if (self) {
        _isPaused = NO;
        _currentRecordingDuration = 0;
        _totalPauseDuration = 0;
        _recordingSegments = [NSMutableArray new];
        self.maxSegmentDuration = 15 * 60; // Default to 15 minutes per segment (can be changed via API)
        self.currentStopReason = SegmentStopReasonNone;
        self.totalDurationOfCompletedSegmentsSoFar = 0.0;
        self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid; // Initialize background task ID
        self.eventDispatchQueue = dispatch_queue_create("com.arcoscribe.audioEventDispatchQueue", DISPATCH_QUEUE_SERIAL);
        self.currentPauseOrigin = PauseOriginNone; // Initialize pause origin
        
        [self registerAppLifecycleNotifications];
        
        // Add observers for audio session interruptions and route changes
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleAudioSessionInterruption:)
                                                     name:AVAudioSessionInterruptionNotification
                                                   object:nil];
        
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleAudioRouteChange:)
                                                     name:AVAudioSessionRouteChangeNotification
                                                   object:nil];
        
        RCTLogInfo(@"[AudioRecorderModule] Initialized");
    }
    return self;
}

- (void)dealloc
{
    [self stopRecordingTimer];
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [self unregisterAppLifecycleNotifications];
}

#pragma mark - RCTEventEmitter Implementation

- (NSArray<NSString *> *)supportedEvents
{
    return @[@"onRecordingProgress", @"onRecordingFinished", @"onRecordingError", @"onRecordingSegmentComplete"];
}

// Will be called when this module's first listener is added.
-(void)startObserving
{
    hasListeners = YES;
    RCTLogInfo(@"[AudioRecorderModule] startObserving: Listeners attached (hasListeners = YES).");
}

// Will be called when this module's last listener is removed, or on dealloc.
-(void)stopObserving
{
    hasListeners = NO;
    RCTLogInfo(@"[AudioRecorderModule] stopObserving: Listeners detached (hasListeners = NO).");
}

#pragma mark - Private Helper Methods

- (void)startRecordingTimer
{
    RCTLogInfo(@"[AudioRecorderModule] startRecordingTimer called.");
    // Ensure timer setup happens on the main thread
    dispatch_async(dispatch_get_main_queue(), ^{
        AudioRecorderModule *strongSelf = self;
        if (!strongSelf) return;
    
        RCTLogInfo(@"[AudioRecorderModule] Scheduling timer on main thread...");
        // Make sure we don't have an existing timer
        [strongSelf stopRecordingTimer];
    
        // Create a new timer that fires every 0.5 seconds (adjust as needed)
        strongSelf.recordingTimer = [NSTimer scheduledTimerWithTimeInterval:0.5
                                                                 target:strongSelf
                                                               selector:@selector(updateRecordingProgress)
                                                               userInfo:nil
                                                                repeats:YES];
    
        // Make sure the timer keeps firing even when scrolling (add to main run loop)
        [[NSRunLoop mainRunLoop] addTimer:strongSelf.recordingTimer forMode:NSRunLoopCommonModes];
        RCTLogInfo(@"[AudioRecorderModule] recordingTimer started on main thread: %@", strongSelf.recordingTimer);
    });
}

- (void)stopRecordingTimer
{
    RCTLogInfo(@"[AudioRecorderModule] stopRecordingTimer called.");
    if (self.recordingTimer) {
        RCTLogInfo(@"[AudioRecorderModule] Invalidating timer: %@", self.recordingTimer);
        [self.recordingTimer invalidate];
        self.recordingTimer = nil;
    }
}

- (void)updateRecordingProgress
{
    RCTLogInfo(@"[AudioRecorderModule] updateRecordingProgress called."); // Re-enable for debugging
    RCTLogInfo(@"[AudioRecorderModule] updateRecordingProgress: Is Main Thread? %s", [NSThread isMainThread] ? "YES" : "NO");
    if (self.audioRecorder && !self.isPaused) {
        [self.audioRecorder updateMeters]; // Update meters before reading power
        
        // Calculate effective current time based on completed segments and current recorder time
        NSTimeInterval currentSegmentTime = self.audioRecorder.currentTime;
        NSTimeInterval effectiveCurrentTime = self.totalDurationOfCompletedSegmentsSoFar + currentSegmentTime;

        // For currentRecordingDuration, we might want to reflect the total accumulated time for consistency elsewhere
        // For this phase, let's keep it reflecting the total time including current segment's progress
        self.currentRecordingDuration = effectiveCurrentTime; 

        // Get the average power. Use a default value if not available.
        float averagePower = -160.0f; // Default to minimum if not available
        if (self.audioRecorder.recording) { // Check if actually recording to avoid issues
            averagePower = [self.audioRecorder averagePowerForChannel:0];
        }
        
        RCTLogInfo(@"[AudioRecorderModule] Progress - currentTime: %f, metering: %f, recordingId: %@, segment: %lu",
                   effectiveCurrentTime, averagePower, self.currentRecordingId, (unsigned long)(self.recordingSegments.count + 1));
        
        if (hasListeners) {
            dispatch_async(self.eventDispatchQueue, ^{
                // Explicitly capture self
                AudioRecorderModule *strongSelf = self;
                if (!strongSelf) {
                    return;
                }
                [strongSelf sendEventWithName:@"onRecordingProgress" body:@{
                    @"currentTime": @(effectiveCurrentTime),
                    @"metering": @(averagePower),
                    @"recordingId": strongSelf.currentRecordingId ?: @"",
                    @"segmentNumber": @(strongSelf.recordingSegments.count + 1)
                }];
            });
        }
    } else if (self.audioRecorder && self.isPaused) {
        // Handle paused state if necessary, e.g., log or update UI differently
        RCTLogInfo(@"[AudioRecorderModule] updateRecordingProgress: Paused");
    } else {
        // Handle cases where audioRecorder might be nil unexpectedly
        RCTLogError(@"[AudioRecorderModule] updateRecordingProgress: audioRecorder is nil or not recording/paused");
    }
}

- (BOOL)setupAudioSession
{
    NSError *error = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    RCTLogInfo(@"[AudioRecorderModule] Setting up audio session...");
    
    // Use PlayAndRecord category so we can both record and play audio
    // Set options:
    // - DefaultToSpeaker: Audio will play from speaker (not earpiece) by default
    // - AllowBluetooth: Allow recording from Bluetooth devices
    // - MixWithOthers: Allow recording while other apps are playing audio
    BOOL success = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                           withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker |
                                       AVAudioSessionCategoryOptionAllowBluetooth |
                                       AVAudioSessionCategoryOptionMixWithOthers
                                 error:&error];
    
    if (!success) {
        RCTLogError(@"[AudioRecorderModule] *** FAILED to set audio session category: %@ ***", error);
        [self emitError:[NSString stringWithFormat:@"Audio Session Error: Failed to set category: %@", error.localizedDescription]];
        return NO;
    }
    RCTLogInfo(@"[AudioRecorderModule] Audio session category set successfully.");
    
    // Set audio session mode
    success = [session setMode:AVAudioSessionModeDefault error:&error];
    if (!success) {
        RCTLogError(@"[AudioRecorderModule] *** FAILED to set audio session mode: %@ ***", error);
        [self emitError:[NSString stringWithFormat:@"Audio Session Error: Failed to set mode: %@", error.localizedDescription]];
        return NO;
    }
    RCTLogInfo(@"[AudioRecorderModule] Audio session mode set successfully.");
    
    // CRITICAL: Activate the audio session
    success = [session setActive:YES error:&error];
    if (!success) {
        RCTLogError(@"[AudioRecorderModule] *** FAILED to activate audio session: %@ ***", error);
        [self emitError:[NSString stringWithFormat:@"Audio Session Error: Failed to activate session: %@", error.localizedDescription]];
        return NO;
    }
    
    RCTLogInfo(@"[AudioRecorderModule] Audio session setup completed successfully");
    return YES;
}

- (void)emitError:(NSString *)errorMessage
{
    RCTLogError(@"[AudioRecorderModule] Emitting error: %@", errorMessage);
    if (hasListeners) {
        AudioRecorderModule *strongSelf = self;
        dispatch_async(strongSelf.eventDispatchQueue, ^{
            if (!strongSelf) return;
            [strongSelf sendEventWithName:@"onRecordingError" body:@{
                @"message": errorMessage ?: @"Unknown error",
                @"recordingId": strongSelf.currentRecordingId ?: @""
            }];
        });
    }
}

- (NSString *)generateUniqueRecordingId
{
    return [[NSUUID UUID] UUIDString];
}

- (NSString *)getRecordingsDirectory
{
    NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    NSString *documentsDirectory = [paths objectAtIndex:0];
    NSString *recordingsDir = [documentsDirectory stringByAppendingPathComponent:@"recordings"];
    
    // Create directory if it doesn't exist
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:recordingsDir]) {
        NSError *error = nil;
        [fileManager createDirectoryAtPath:recordingsDir withIntermediateDirectories:YES attributes:nil error:&error];
        if (error) {
            RCTLogError(@"[AudioRecorderModule] Error creating recordings directory: %@", error);
            return documentsDirectory; // Fallback to documents directory
        }
    }
    
    return recordingsDir;
}

- (NSString *)getFilepathForRecordingId:(NSString *)recordingId segmentNumber:(NSUInteger)segmentNumber
{
    NSString *folderPath = [self getRecordingsDirectory];
    if (!folderPath) {
        RCTLogError(@"[AudioRecorderModule] Failed to get recordings directory.");
        return nil;
    }
    
    // Generate ISO-8601 timestamp
    NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
    [dateFormatter setDateFormat:@"yyyyMMdd'T'HHmmss'Z'"];
    [dateFormatter setTimeZone:[NSTimeZone timeZoneForSecondsFromGMT:0]]; // UTC
    NSString *isoTimestamp = [dateFormatter stringFromDate:[NSDate date]];
    
    // Format: rec_<recordingID>_<ISO8601Timestamp>_segment<segmentNumber>.m4a
    NSString *filename = [NSString stringWithFormat:@"rec_%@_%@_segment%03lu.m4a", 
                                      recordingId, 
                                      isoTimestamp, 
                                      (unsigned long)segmentNumber];
    
    RCTLogInfo(@"[AudioRecorderModule] Generated filename: %@", filename);
    return [folderPath stringByAppendingPathComponent:filename];
}

- (NSDictionary *)getAudioRecordingSettings
{
    return @{
        AVFormatIDKey: @(kAudioFormatMPEG4AAC),
        AVSampleRateKey: @44100.0,
        AVNumberOfChannelsKey: @1,
        AVEncoderAudioQualityKey: @(AVAudioQualityMedium),
        AVEncoderBitRateKey: @128000
    };
}

#pragma mark - Notification Handlers

- (void)handleAudioSessionInterruption:(NSNotification *)notification
{
    NSDictionary *userInfo = notification.userInfo;
    AVAudioSessionInterruptionType interruptionType = [userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    RCTLogInfo(@"[AudioRecorderModule] handleAudioSessionInterruption: type %lu, currentPauseOrigin: %lu, isRecording: %d, isPaused: %d",
               (unsigned long)interruptionType, (unsigned long)strongSelf.currentPauseOrigin, (strongSelf.audioRecorder ? strongSelf.audioRecorder.isRecording : 0), strongSelf.isPaused);

    if (interruptionType == AVAudioSessionInterruptionTypeBegan) {
        RCTLogInfo(@"[AudioRecorderModule] Audio session interruption began.");
        // Only act if currently recording and not already paused by backgrounding or another system interruption.
        // If paused by user, an interruption should still take precedence.
        if (strongSelf.audioRecorder && strongSelf.audioRecorder.isRecording && strongSelf.currentPauseOrigin != PauseOriginBackground) {
            RCTLogInfo(@"[AudioRecorderModule] Pausing recording due to interruption.");
            strongSelf.currentPauseOrigin = PauseOriginInterruption;
            [strongSelf.audioRecorder pause];
            strongSelf.isPaused = YES;
            [strongSelf stopRecordingTimer]; // Stop progress updates during interruption

            if (strongSelf->hasListeners) {
                dispatch_async(strongSelf.eventDispatchQueue, ^{
                    AudioRecorderModule *strongSelfForBlock = strongSelf;
                    if (!strongSelfForBlock) return;
                    [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                        @"status": @"paused-by-interruption",
                        @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                        @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1)
                    }];
                });
            }
        } else {
            RCTLogInfo(@"[AudioRecorderModule] Interruption began, but not actively recording or already paused by background. No action taken.");
        }
    } else if (interruptionType == AVAudioSessionInterruptionTypeEnded) {
        RCTLogInfo(@"[AudioRecorderModule] Audio session interruption ended.");
        AVAudioSessionInterruptionOptions options = [userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue];
        BOOL shouldResume = (options & AVAudioSessionInterruptionOptionShouldResume) != 0;

        if (strongSelf.currentPauseOrigin == PauseOriginInterruption) {
            if (shouldResume) {
                RCTLogInfo(@"[AudioRecorderModule] Resuming recording after interruption.");
                if (![strongSelf setupAudioSession]) {
                    RCTLogError(@"[AudioRecorderModule] Failed to setup audio session for resume after interruption. Recording remains paused.");
                    // Potentially emit an error or change state to reflect this failure to auto-resume.
                    // For now, it will remain paused with PauseOriginInterruption.
                    return;
                }

                // Ensure audio session is active before attempting to record
                NSError *activationError = nil;
                if (![[AVAudioSession sharedInstance] setActive:YES error:&activationError]) {
                    RCTLogError(@"[AudioRecorderModule] Failed to activate audio session for resume: %@. Recording remains paused.", activationError.localizedDescription);
                    return;
                }

                if (strongSelf.audioRecorder) {
                    [strongSelf.audioRecorder record]; // This resumes the recording for the current segment
                    strongSelf.currentPauseOrigin = PauseOriginNone;
                    strongSelf.isPaused = NO;
                    [strongSelf startRecordingTimer]; // Restart progress updates

                    if (strongSelf->hasListeners) {
                        dispatch_async(strongSelf.eventDispatchQueue, ^{
                            AudioRecorderModule *strongSelfForBlock = strongSelf;
                            if (!strongSelfForBlock) return;
                            [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                                @"status": @"resumed-from-interruption",
                                @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                                @"currentSegmentPath": strongSelfForBlock.currentRecordingFilePath ?: @"",
                                @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1)
                            }];
                        });
                    }
                } else {
                     RCTLogError(@"[AudioRecorderModule] Cannot resume from interruption: audioRecorder is nil.");
                }
            } else {
                RCTLogInfo(@"[AudioRecorderModule] Interruption ended, but system does not suggest resuming. Recording remains paused by interruption.");
                // Recording remains paused, currentPauseOrigin is still PauseOriginInterruption.
                // User might need to manually resume or stop.
            }
        } else {
            RCTLogInfo(@"[AudioRecorderModule] Interruption ended, but recording was not paused by this interruption (origin: %lu). No auto-resume action taken.", (unsigned long)strongSelf.currentPauseOrigin);
        }
    }
}

- (void)handleAudioRouteChange:(NSNotification *)notification
{
    NSInteger reason = [notification.userInfo[AVAudioSessionRouteChangeReasonKey] integerValue];
    RCTLogInfo(@"[AudioRecorderModule] Audio route changed: %ld", (long)reason);
    
    AVAudioSessionRouteDescription *route = [[AVAudioSession sharedInstance] currentRoute];
    for (AVAudioSessionPortDescription *desc in route.inputs) {
        RCTLogInfo(@"[AudioRecorderModule] Using input: %@", desc.portType);
    }
}

- (void)handleAppDidEnterBackground:(NSNotification *)notification {
    RCTLogInfo(@"[AudioRecorderModule] App did enter background.");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    if (strongSelf.audioRecorder && strongSelf.audioRecorder.isRecording && strongSelf.currentPauseOrigin == PauseOriginNone) {
        RCTLogInfo(@"[AudioRecorderModule] Recording is active and not paused by user. Pausing due to backgrounding.");

        __block UIBackgroundTaskIdentifier backgroundTaskID = UIBackgroundTaskInvalid;
        backgroundTaskID = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"HandleAppBackgroundPauseTask" expirationHandler:^{
            RCTLogWarn(@"[AudioRecorderModule] Background task for app background pause expired.");
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
                backgroundTaskID = UIBackgroundTaskInvalid;
            }
        }];

        // Perform operations synchronously within the background task assertion
        strongSelf.currentPauseOrigin = PauseOriginBackground;
        strongSelf.isPaused = YES; // Mark as paused
        
        [strongSelf stopRecordingTimer]; // Stop progress updates
        
        // Stop the recorder. This will trigger audioRecorderDidFinishRecording.
        // The delegate method will need to know not to restart a segment if currentPauseOrigin is PauseOriginBackground.
        [strongSelf.audioRecorder stop];
        
        // Emit an event to JS
        if (strongSelf->hasListeners) {
            dispatch_async(strongSelf.eventDispatchQueue, ^{
                AudioRecorderModule *strongSelfForBlock = strongSelf;
                if (!strongSelfForBlock) return;
                [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                    @"status": @"paused-by-background",
                    @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                    @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1) // Current segment that was active
                }];
            });
        }
        
        RCTLogInfo(@"[AudioRecorderModule] Recording segment stopped due to backgrounding. Awaiting finalization in delegate.");

        // End the background task
        if (backgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            // backgroundTaskID = UIBackgroundTaskInvalid; // Not strictly needed here as it's a local variable
        }
    } else {
        RCTLogInfo(@"[AudioRecorderModule] App entered background, but no active recording to pause or already paused/handled.");
    }
}

- (void)handleAppWillEnterForeground:(NSNotification *)notification {
    RCTLogInfo(@"[AudioRecorderModule] App will enter foreground.");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    if (strongSelf.currentPauseOrigin == PauseOriginBackground) {
        RCTLogInfo(@"[AudioRecorderModule] Resuming recording from background pause.");

        __block UIBackgroundTaskIdentifier backgroundTaskID = UIBackgroundTaskInvalid;
        backgroundTaskID = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"HandleAppForegroundResumeTask" expirationHandler:^{
            RCTLogWarn(@"[AudioRecorderModule] Background task for app foreground resume expired.");
            // If task expires, we might not have resumed properly. Consider error handling.
            [strongSelf handleCriticalRecordingErrorAndStop:@"Foreground resume task expired."];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
                backgroundTaskID = UIBackgroundTaskInvalid;
            }
        }];

        // Ensure audio session is active and configured
        if (![strongSelf setupAudioSession]) {
            [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to setup audio session on foreground resume."];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            }
            return;
        }

        strongSelf.currentPauseOrigin = PauseOriginNone;
        strongSelf.isPaused = NO;

        // Start a new segment
        NSString *nextSegmentFilePath = [strongSelf generateRecordingFilePath:strongSelf.currentRecordingId
                                                               segmentNumber:(strongSelf.recordingSegments.count + 1)];
        if (!nextSegmentFilePath) {
            [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to generate file path for new segment on foreground resume."];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            }
            return;
        }
        strongSelf.currentRecordingFilePath = nextSegmentFilePath;

        NSDictionary *settings = [strongSelf getAudioRecordingSettings];
        NSError *error = nil;
        strongSelf.audioRecorder = [[AVAudioRecorder alloc] initWithURL:[NSURL fileURLWithPath:nextSegmentFilePath]
                                                               settings:settings
                                                                  error:&error];
        if (!strongSelf.audioRecorder || error) {
            NSString *errorMsg = error ? error.localizedDescription : @"Failed to initialize audio recorder on foreground resume.";
            [strongSelf handleCriticalRecordingErrorAndStop:errorMsg];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            }
            return;
        }
        strongSelf.audioRecorder.delegate = strongSelf;
        [strongSelf.audioRecorder prepareToRecord];

        if ([strongSelf.audioRecorder recordForDuration:strongSelf.maxSegmentDuration]) {
            RCTLogInfo(@"[AudioRecorderModule] Successfully started new segment (%lu) at %@ after foregrounding.",
                       (unsigned long)(strongSelf.recordingSegments.count + 1),
                       nextSegmentFilePath);
            [strongSelf startRecordingTimer]; // Restart progress updates
            strongSelf.currentStopReason = SegmentStopReasonNone; // Reset before potentially complex logic or returns
            // strongSelf.durationAtSegmentStart = CACurrentMediaTime(); // Reset for the new segment's own timing
            
            // Emit event
            if (strongSelf->hasListeners) {
                dispatch_async(strongSelf.eventDispatchQueue, ^{
                    AudioRecorderModule *strongSelfForBlock = strongSelf;
                    if (!strongSelfForBlock) return;
                    [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                        @"status": @"resumed-from-background",
                        @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                        @"currentSegmentPath": nextSegmentFilePath,
                        @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1)
                    }];
                });
            }
        } else {
            [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to start recording new segment on foreground resume."];
            strongSelf.audioRecorder = nil; // Ensure it's nil
        }

        // End the background task
        if (backgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
        }
    } else {
        RCTLogInfo(@"[AudioRecorderModule] App will enter foreground, but recording was not paused due to backgrounding.");
    }
}

#pragma mark - AVAudioRecorderDelegate

- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)flag
{
    RCTLogInfo(@"[AudioRecorderModule] audioRecorderDidFinishRecording: successfully: %d, recorderPath: %@, currentPauseOrigin: %lu", flag, recorder.url.path, (unsigned long)self.currentPauseOrigin);
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    // Capture path and duration before any state change that might affect them
    NSString *completedSegmentPath = recorder.url.path;
    NSTimeInterval durationOfThisSegment = recorder.currentTime;
    
    SegmentStopReason reasonForStop = strongSelf.currentStopReason;
    PauseOrigin pauseOriginWhenCalled = strongSelf.currentPauseOrigin;

    // Always clear the delegate and nil out the recorder instance that just finished.
    // A new instance will be created if/when recording continues.
    recorder.delegate = nil;
    if (strongSelf.audioRecorder == recorder) {
        strongSelf.audioRecorder = nil;
    }
    // Stop the timer if it's still running, especially if recording stopped due to an error or manual stop not through stopRecordingInternal
    [strongSelf stopRecordingTimer];

    if (flag) {
        RCTLogInfo(@"[AudioRecorderModule] Segment recorded successfully to path: %@, duration: %.2f sec", completedSegmentPath, durationOfThisSegment);
        if (completedSegmentPath && ![completedSegmentPath isEqualToString:@""]) {
            [strongSelf.recordingSegments addObject:completedSegmentPath];
            strongSelf.totalDurationOfCompletedSegmentsSoFar += durationOfThisSegment;
            // Reset current segment-specific durations as this segment is now complete
            strongSelf.currentRecordingDuration = 0;
            strongSelf.totalPauseDuration = 0;
            // strongSelf.durationAtSegmentStart = CACurrentMediaTime(); // Reset for the next segment's own timing
            
            // Emit segment completion event
            if (strongSelf->hasListeners) {
                dispatch_async(strongSelf.eventDispatchQueue, ^{
                    AudioRecorderModule *strongSelfForBlock = strongSelf;
                    if (!strongSelfForBlock) return;
                    [strongSelfForBlock sendEventWithName:@"onRecordingSegmentComplete" body:@{
                        @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                        @"segmentPath": completedSegmentPath ?: @"",
                        @"segmentNumber": @(strongSelfForBlock.recordingSegments.count), // This is now the count of *completed* segments
                        @"duration": @(durationOfThisSegment)
                    }];
                });
            }
        } else {
            RCTLogWarn(@"[AudioRecorderModule] audioRecorderDidFinishRecording: Successfully finished but segment path is nil/empty.");
            // Potentially handle as an error or decide if this state is possible/problematic
        }

        // Now, decide what to do next based on why this segment stopped
        if (pauseOriginWhenCalled == PauseOriginBackground) {
            RCTLogInfo(@"[AudioRecorderModule] Segment finished due to app backgrounding. Recording is now paused. No new segment will be started.");
            // The recording is effectively paused. isPaused should be YES, currentPauseOrigin is PauseOriginBackground.
            // No further action needed here; handleAppWillEnterForeground will manage resumption.
            // Ensure any segment transition background task is ended if it was running (unlikely path, but good for safety)
            if (strongSelf.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                RCTLogWarn(@"[AudioRecorderModule] Ending segment transition task in background pause path.");
                [[UIApplication sharedApplication] endBackgroundTask:strongSelf.segmentTransitionBackgroundTaskID];
                strongSelf.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
            }
        } else if (reasonForStop == SegmentStopReasonTimed || (reasonForStop == SegmentStopReasonNone && pauseOriginWhenCalled == PauseOriginNone)) {
            // Segment finished by time, or no specific stop reason and not paused = implicit time finish.
            // This is the path for continuous recording, start the next segment.
            RCTLogInfo(@"[AudioRecorderModule] Segment finished by time. Starting next segment.");
            
            // --- Start Background Task for Segment Transition ---
            strongSelf.segmentTransitionBackgroundTaskID = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"SegmentTransitionTask" expirationHandler:^{
                RCTLogError(@"[AudioRecorderModule] Background task for segment transition expired.");
                // If the task expires, it means we couldn't start the next segment in time.
                // Treat this as a critical failure.
                [strongSelf handleCriticalRecordingErrorAndStop:@"Segment transition background task expired."];
                
                if (strongSelf.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                    [[UIApplication sharedApplication] endBackgroundTask:strongSelf.segmentTransitionBackgroundTaskID];
                    strongSelf.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                }
            }];
            RCTLogInfo(@"[AudioRecorderModule] Began background task for segment transition: %lu", (unsigned long)strongSelf.segmentTransitionBackgroundTaskID);

            // --- Check Disk Space Before Starting Next Segment ---
            if (![strongSelf hasSufficientDiskSpaceForRecording]) {
                RCTLogError(@"[AudioRecorderModule] Insufficient disk space for next segment. Stopping recording.");
                [strongSelf handleCriticalRecordingErrorAndStop:@"Insufficient disk space for next segment."];
                // Ensure background task is ended if one was active for segment transition
                if (strongSelf.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                    [[UIApplication sharedApplication] endBackgroundTask:strongSelf.segmentTransitionBackgroundTaskID];
                    strongSelf.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                }
                return; // Do not proceed to start a new segment
            }

            // --- Start Next Segment --- 
            NSString *nextSegmentFilePath = [strongSelf generateRecordingFilePath:strongSelf.currentRecordingId segmentNumber:(strongSelf.recordingSegments.count + 1)];
            if (!nextSegmentFilePath) {
                [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to generate file path for next segment."];
                if (strongSelf.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                    [[UIApplication sharedApplication] endBackgroundTask:strongSelf.segmentTransitionBackgroundTaskID];
                    strongSelf.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                }
                return;
            }
            strongSelf.currentRecordingFilePath = nextSegmentFilePath;

            NSDictionary *settings = [strongSelf getAudioRecordingSettings];
            NSError *error = nil;
            // Release the old recorder before creating a new one for the same property
            strongSelf.audioRecorder = nil; 
            strongSelf.audioRecorder = [[AVAudioRecorder alloc] initWithURL:[NSURL fileURLWithPath:nextSegmentFilePath] 
                                                               settings:settings 
                                                                  error:&error];
            if (!strongSelf.audioRecorder || error) {
                NSString *errorMsg = error ? error.localizedDescription : @"Failed to initialize audio recorder for next segment.";
                [strongSelf handleCriticalRecordingErrorAndStop:errorMsg];
                if (strongSelf.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                    [[UIApplication sharedApplication] endBackgroundTask:strongSelf.segmentTransitionBackgroundTaskID];
                    strongSelf.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                }
                return;
            }
            strongSelf.audioRecorder.delegate = strongSelf;
            [strongSelf.audioRecorder prepareToRecord];

            if ([strongSelf.audioRecorder recordForDuration:strongSelf.maxSegmentDuration]) {
                RCTLogInfo(@"[AudioRecorderModule] Successfully started next segment (%lu) at %@ for %.f seconds", 
                           (unsigned long)(strongSelf.recordingSegments.count + 1), 
                           nextSegmentFilePath, 
                           strongSelf.maxSegmentDuration);
                strongSelf.currentStopReason = SegmentStopReasonNone; // Reset before potentially complex logic or returns
                // strongSelf.durationAtSegmentStart = CACurrentMediaTime(); // Reset for the new segment's own timing
            
                // End background task successfully
                if (strongSelf.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                    RCTLogInfo(@"[AudioRecorderModule] Ending background task successfully: %lu", (unsigned long)strongSelf.segmentTransitionBackgroundTaskID);
                    [[UIApplication sharedApplication] endBackgroundTask:strongSelf.segmentTransitionBackgroundTaskID];
                    strongSelf.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                }
            } else {
                [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to start recording next segment."];
                strongSelf.audioRecorder = nil; // Ensure it's nil if recordForDuration failed
                // End background task due to failure
                if (strongSelf.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                    RCTLogInfo(@"[AudioRecorderModule] Ending background task due to failure: %lu", (unsigned long)strongSelf.segmentTransitionBackgroundTaskID);
                    [[UIApplication sharedApplication] endBackgroundTask:strongSelf.segmentTransitionBackgroundTaskID];
                    strongSelf.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                }
                return;
            }

        } else if (reasonForStop == SegmentStopReasonManual || reasonForStop == SegmentStopReasonApiStop) {
            RCTLogInfo(@"[AudioRecorderModule] Segment finished due to manual stop or API stop. Finalizing recording session.");
            // This was the final segment due to a deliberate stop. stopRecordingInternal handles the onRecordingFinished event.
            // currentStopReason should already be set appropriately by stopRecordingInternal.
            // isPaused might be true if user paused then stopped. currentPauseOrigin could be User.
            // No new segment should be started here.
            // Final cleanup and event emission is handled by the stopRecordingInternal -> stopRecording path.
        } else if (reasonForStop == SegmentStopReasonInterrupted) {
            RCTLogInfo(@"[AudioRecorderModule] Segment finished due to interruption. Stopping recording session.");
            // This means an audio session interruption occurred and handleAudioSessionInterruption decided to stop.
            // It would have called stopRecordingInternal with SegmentStopReasonInterrupted.
            // No new segment. Final event emission via stopRecordingInternal.
            if (strongSelf->hasListeners) {
                dispatch_async(strongSelf.eventDispatchQueue, ^{
                    AudioRecorderModule *strongSelfRef = strongSelf;
                    if (!strongSelfRef) return;
                    [strongSelfRef sendEventWithName:@"onRecordingFinished" body:@{
                        @"status": @"interrupted",
                        @"recordingId": strongSelfRef.currentRecordingId ?: @"",
                        @"basePath": [strongSelfRef getRecordingsDirectory] ?: @"",
                        @"segmentPaths": [strongSelfRef.recordingSegments copy] ?: @[],
                        @"totalDuration": @(strongSelfRef.totalDurationOfCompletedSegmentsSoFar)
                    }];
                });
            }
            [[AVAudioSession sharedInstance] setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
            [strongSelf resetRecordingState];
        } else {
            RCTLogWarn(@"[AudioRecorderModule] Segment finished successfully, but with an unexpected stopReason: %lu or pauseOrigin: %lu. Not starting new segment.", (unsigned long)reasonForStop, (unsigned long)pauseOriginWhenCalled);
            // Fallback: do not start a new segment if in an unexpected state.
        }
    } else {
        // Recording failed for the current segment
        RCTLogError(@"[AudioRecorderModule] audioRecorderDidFinishRecording received failure flag.");
        strongSelf.currentStopReason = SegmentStopReasonFailed;
        [strongSelf handleCriticalRecordingErrorAndStop:@"Recording failed for segment."];
    }
}

- (void)audioRecorderEncodeErrorDidOccur:(AVAudioRecorder *)recorder error:(NSError *)error
{
    RCTLogError(@"[AudioRecorderModule] Audio encoding error: %@", error);
    [self emitError:[NSString stringWithFormat:@"Audio encoding error: %@", error.localizedDescription]];
}

#pragma mark - Internal Recording Control Methods

- (BOOL)startRecordingInternal:(NSString *)filePath recordingId:(NSString *)recordingId
{
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: Entered startRecordingInternal <<< ");
    // Make sure we're not already recording
    if (self.audioRecorder) {
        RCTLogError(@"[AudioRecorderModule] *** ERROR: Attempted to start recording while already recording. ***");
        [self emitError:@"Start Recording Error: Already recording."];
        return NO;
    }
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: Setting up audio session...");
    
    // Setup audio session
    if (![self setupAudioSession]) {
        RCTLogError(@"[AudioRecorderModule] *** ERROR: Failed to setup audio session during startRecordingInternal. ***");
        // setupAudioSession should have emitted a specific error
        return NO;
    }
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: Audio session setup complete. Initializing recorder...");
    
    // Initialize recorder
    NSError *error = nil;
    NSURL *url = [NSURL fileURLWithPath:filePath];
    NSDictionary *settings = [self getAudioRecordingSettings];
    
    self.audioRecorder = [[AVAudioRecorder alloc] initWithURL:url settings:settings error:&error];
    
    if (error) {
        RCTLogError(@"[AudioRecorderModule] *** ERROR initializing AVAudioRecorder: %@ ***", error);
        [self emitError:[NSString stringWithFormat:@"Recorder Error: Initialization failed: %@", error.localizedDescription]];
        return NO;
    }
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: AVAudioRecorder initialized successfully.");
    
    self.audioRecorder.delegate = self;
    [self.audioRecorder setMeteringEnabled:YES];
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: Preparing to record...");
    
    // Start recording for the specified segment duration
    self.currentStopReason = SegmentStopReasonTimed; // Assume it will stop due to time, unless manually stopped or fails
    if (![self.audioRecorder recordForDuration:self.maxSegmentDuration]) {
        RCTLogError(@"[AudioRecorderModule] *** FAILED to start recording (audioRecorder.recordForDuration returned NO) ***");
        self.currentStopReason = SegmentStopReasonFailed;
        [self emitError:@"Recorder Error: Failed to start recording."];
        return NO;
    }
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: Recording successfully started.");
    
    // --- ADDED: Post Start Notification ---
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: PREPARING TO POST Start Notification <<<");
    [[NSNotificationCenter defaultCenter] postNotificationName:AudioRecordingDidStartNotification object:nil];
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: FINISHED POSTING Start Notification <<<");
    // -------------------------------------
    
    // Initialize recording state variables
    self.currentRecordingFilePath = filePath;
    self.currentRecordingId = recordingId;
    self.recordingStartTime = [NSDate date];
    self.totalPauseDuration = 0;
    self.isPaused = NO;
    self.currentRecordingDuration = 0;
    // self.durationAtSegmentStart = CACurrentMediaTime(); // Initialize for the first segment
    
    // New initializations for segmentation logic
    self.totalDurationOfCompletedSegmentsSoFar = 0.0;
    
    // Reset segments array
    [self.recordingSegments removeAllObjects];
    
    // Start the timer for progress updates
    [self startRecordingTimer];
    
    RCTLogInfo(@"[AudioRecorderModule] Recording started: %@", filePath);
    return YES;
}

- (void)pauseRecordingInternal
{
    if (self.audioRecorder && !self.isPaused) {
        [self.audioRecorder pause];
        self.isPaused = YES;
        self.pauseStartTime = [NSDate date];
        
        RCTLogInfo(@"[AudioRecorderModule] Recording paused");
    }
}

- (BOOL)resumeRecordingInternal
{
    if (self.audioRecorder && self.isPaused) {
        // Calculate the additional pause duration
        NSTimeInterval pauseDuration = [[NSDate date] timeIntervalSinceDate:self.pauseStartTime];
        self.totalPauseDuration += pauseDuration;
        
        // Make sure our audio session is active
        NSError *error;
        [[AVAudioSession sharedInstance] setActive:YES error:&error];
        if (error) {
            RCTLogError(@"[AudioRecorderModule] Error reactivating audio session: %@", error);
            return NO;
        }
        
        // Resume recording
        [self.audioRecorder record];
        self.isPaused = NO;
        
        RCTLogInfo(@"[AudioRecorderModule] Recording resumed after %f seconds pause", pauseDuration);
        return YES;
    }
    
    return NO;
}

- (NSDictionary *)stopRecordingInternal
{
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: Entered stopRecordingInternal <<< ");
    if (!self.audioRecorder) {
        RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: stopRecordingInternal returning early: Not recording <<< ");
        return @{@"success": @NO, @"error": @"Not recording"};
    }
    
    // Set flag to indicate this is a manual stop
    self.currentStopReason = SegmentStopReasonManual;
    
    // Stop the recorder. This will trigger audioRecorderDidFinishRecording:successfully:
    // which will handle adding the last segment details and updating totalDurationOfCompletedSegmentsSoFar.
    [self.audioRecorder stop];
    
    // Stop the timer
    [self stopRecordingTimer];
    
    // --- ADDED: Post Stop Notification (already exists, ensure it's placed correctly) ---
    RCTLogInfo(@"[AudioRecorderModule] Posting AudioRecordingDidStopNotification");
    [[NSNotificationCenter defaultCenter] postNotificationName:AudioRecordingDidStopNotification object:nil];
    // ------------------------------------
    
    // Collect recording data
    // The actual last segment path and total duration should have been updated by audioRecorderDidFinishRecording
    NSString *finalFilePath = [self.recordingSegments lastObject];
    NSString *recordingIdToReport = self.currentRecordingId; // Capture before reset
    NSTimeInterval finalDuration = self.totalDurationOfCompletedSegmentsSoFar;
    NSArray *allSegmentPaths = [NSArray arrayWithArray:self.recordingSegments]; // Make a copy before reset
    
    RCTLogInfo(@"[AudioRecorderModule] Recording stopped. Duration: %f, Segments: %lu, Final Path: %@", 
               finalDuration, (unsigned long)allSegmentPaths.count, finalFilePath);

    // Emit the final event on the JS side (if stop was initiated from JS and has a promise)
    // The RCT_EXPORT_METHOD(stopRecording:resolver:rejecter) handles this after calling stopRecordingInternal.
    // However, we should ensure onRecordingFinished is consistently emitted for all stops.
    if (hasListeners) {
        AudioRecorderModule *strongSelf = self;
        dispatch_async(strongSelf.eventDispatchQueue, ^{
            if (!strongSelf) return;
            [strongSelf sendEventWithName:@"onRecordingFinished" body:@{
                @"success": @YES,
                @"recordingId": recordingIdToReport ?: @"",
                @"filePath": finalFilePath ?: @"",
                @"duration": @(finalDuration),
                @"segmentPaths": allSegmentPaths ?: @[]
            }];
        });
    }

    // Deactivate audio session (turn off microphone)
    NSError *error;
    [[AVAudioSession sharedInstance] setActive:NO
                                   withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                         error:&error];
    if (error) {
        RCTLogError(@"[AudioRecorderModule] Error deactivating audio session: %@", error);
    }
    
    // Reset state for the next recording session
    self.audioRecorder = nil;
    self.currentRecordingFilePath = nil;
    self.currentRecordingId = nil; 
    self.isPaused = NO;
    self.currentRecordingDuration = 0; // Reset overall duration counter
    // self.durationAtSegmentStart = 0; // Reset for segments
    self.totalDurationOfCompletedSegmentsSoFar = 0.0; // Reset accumulated segment duration
    [self.recordingSegments removeAllObjects]; // Clear segment list
    self.currentStopReason = SegmentStopReasonNone; // Reset after stop processing
    
    // Return recording details (mainly for the JS promise if called from exported method)
    return @{
        @"success": @YES,
        @"recordingId": recordingIdToReport ?: @"",
        @"filePath": finalFilePath ?: @"",
        @"duration": @(finalDuration),
        @"segmentPaths": allSegmentPaths ?: @[]
    };
}

#pragma mark - Exported Methods

RCT_EXPORT_METHOD(setMaxSegmentDuration:(NSTimeInterval)duration)
{
    RCTLogInfo(@"[AudioRecorderModule] setMaxSegmentDuration called. self = %p, duration (NSTimeInterval/double) = %f", self, (double)duration);
    if (duration > 0) {
        RCTLogInfo(@"[AudioRecorderModule] Attempting to set maxSegmentDuration...");
        self.maxSegmentDuration = duration;
        RCTLogInfo(@"[AudioRecorderModule] Successfully set maxSegmentDuration.");
        RCTLogInfo(@"[AudioRecorderModule] Maximum segment duration set to %f seconds", (double)self.maxSegmentDuration);
    } else {
        RCTLogError(@"[AudioRecorderModule] Invalid segment duration: %f", (double)duration);
    }
    RCTLogInfo(@"[AudioRecorderModule] setMaxSegmentDuration finished.");
}

- (void)_proceedWithRecordingAfterPermissionCheck:(NSDictionary *)options
                                         resolver:(RCTPromiseResolveBlock)resolve
                                         rejecter:(RCTPromiseRejectBlock)reject
{
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) { // Should not happen if called from exported method context, but good practice
        reject(@"E_SELF_NIL", @"Module instance became nil during permission check.", nil);
        return;
    }

    // Check for sufficient disk space before proceeding
    if (![strongSelf hasSufficientDiskSpaceForRecording]) {
        RCTLogError(@"[AudioRecorderModule] Insufficient disk space to start new recording.");
        reject(@"E_DISK_SPACE_LOW", @"Insufficient disk space to start recording.", nil);
        return;
    }

    // Generate a unique recording ID if not provided
    NSString *recordingId = options[@"recordingId"];
    if (!recordingId || [recordingId isEqualToString:@""]) { // Also check for empty string
        recordingId = [strongSelf generateUniqueRecordingId];
    }
    strongSelf.currentRecordingId = recordingId; // Ensure it's set on self early

    // Determine file path for the first segment
    // Note: recordingSegments should be empty at the start of a new recording session
    NSString *filePath = [strongSelf generateRecordingFilePath:recordingId segmentNumber:(strongSelf.recordingSegments.count + 1)];
    if (!filePath) {
        RCTLogError(@"[AudioRecorderModule] Failed to generate file path for recording ID: %@", recordingId);
        reject(@"E_FILE_PATH", @"Failed to generate file path for recording.", nil);
        return;
    }

    RCTLogInfo(@"[AudioRecorderModule] Proceeding to start recording with ID: %@, path: %@", recordingId, filePath);

    // Call the internal method that sets up and starts AVAudioRecorder
    if ([strongSelf startRecordingInternal:filePath recordingId:recordingId options:options]) { // Pass options if startRecordingInternal needs them (e.g., for sampleRate, channels from config)
        resolve(@{
            @"status": @"recording_started",
            @"recordingId": recordingId,
            @"filePath": filePath // Path of the first segment
        });
    } else {
        RCTLogError(@"[AudioRecorderModule] startRecording: startRecordingInternal returned NO. Rejecting promise.");
        reject(@"E_INTERNAL_START_FAILED", @"Failed to start recording due to an internal setup error.", nil);
    }
}

RCT_EXPORT_METHOD(startRecording:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: EXPORTED METHOD startRecording entered <<< ");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) { // Should not happen in exported methods, but for safety
        reject(@"E_SELF_NIL", @"Module instance is nil at startRecording.", nil);
        return;
    }

    AVAudioSession *session = [AVAudioSession sharedInstance];
    AVAudioSessionRecordPermission permissionStatus = [session recordPermission];

    switch (permissionStatus) {
        case AVAudioSessionRecordPermissionGranted: {
            RCTLogInfo(@"[AudioRecorderModule] Microphone permission already granted.");
            // Ensure this runs on the main queue if it involves UI or session setup that expects it.
            // For now, assuming _proceedWithRecordingAfterPermissionCheck handles its threading or is safe.
            [strongSelf _proceedWithRecordingAfterPermissionCheck:options resolver:resolve rejecter:reject];
            break;
        }
        case AVAudioSessionRecordPermissionDenied: {
            RCTLogError(@"[AudioRecorderModule] Microphone permission has been denied.");
            reject(@"E_PERMISSION_DENIED", @"Microphone permission denied. Please enable it in settings.", nil);
            break;
        }
        case AVAudioSessionRecordPermissionUndetermined: {
            RCTLogInfo(@"[AudioRecorderModule] Microphone permission undetermined. Requesting permission.");
            [session requestRecordPermission:^(BOOL granted) {
                // Callback can be on a different thread, dispatch to main for promise resolution and further work
                dispatch_async(dispatch_get_main_queue(), ^{
                    AudioRecorderModule *callbackStrongSelf = strongSelf; // Re-capture self for safety in block
                    if (!callbackStrongSelf) {
                         if (reject) reject(@"E_SELF_NIL_CALLBACK", @"Module instance became nil during permission request callback.", nil);
                         return;
                    }
                    if (granted) {
                        RCTLogInfo(@"[AudioRecorderModule] Microphone permission granted by user.");
                        [callbackStrongSelf _proceedWithRecordingAfterPermissionCheck:options resolver:resolve rejecter:reject];
                    } else {
                        RCTLogError(@"[AudioRecorderModule] Microphone permission denied by user after request.");
                        reject(@"E_PERMISSION_DENIED_USER", @"Microphone permission denied by user.", nil);
                    }
                });
            }];
            break;
        }
        default: // Should not happen
            RCTLogError(@"[AudioRecorderModule] Unknown microphone permission status: %ld", (long)permissionStatus);
            reject(@"E_PERMISSION_UNKNOWN", @"Unknown microphone permission status.", nil);
            break;
    }
}

RCT_EXPORT_METHOD(stopRecording:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: EXPORTED METHOD stopRecording entered <<< ");
    RCTLogInfo(@"[AudioRecorderModule] Stopping recording");
    
    NSDictionary *result = [self stopRecordingInternal];
    
    if ([result[@"success"] boolValue]) {
        // Emit the final event on the JS side
        if (hasListeners) {
            dispatch_async(self.eventDispatchQueue, ^{
                // Explicitly capture self
                AudioRecorderModule *strongSelf = self;
                if (!strongSelf) {
                    return;
                }
                [strongSelf sendEventWithName:@"onRecordingFinished" body:result];
            });
        }
        
        resolve(result);
    } else {
        reject(@"recording_error", result[@"error"], nil);
    }
}

RCT_EXPORT_METHOD(pauseRecording:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] pauseRecording called.");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) {
        reject(@"E_SELF_NIL", @"Module instance is nil", nil);
        return;
    }

    if (strongSelf.audioRecorder && strongSelf.audioRecorder.isRecording && strongSelf.currentPauseOrigin == PauseOriginNone) {
        strongSelf.currentPauseOrigin = PauseOriginUser;
        [strongSelf.audioRecorder pause];
        strongSelf.isPaused = YES;
        [strongSelf stopRecordingTimer]; // Stop progress updates
        
        if (strongSelf->hasListeners) {
            dispatch_async(strongSelf.eventDispatchQueue, ^{
                AudioRecorderModule *strongSelfForBlock = strongSelf;
                if (!strongSelfForBlock) return;
                [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                    @"status": @"paused-by-user",
                    @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                    @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1)
                }];
            });
        }
        RCTLogInfo(@"[AudioRecorderModule] Recording paused by user.");
        resolve(@{@"success": @YES, @"message": @"Recording paused"});
    } else if (strongSelf.currentPauseOrigin != PauseOriginNone) {
        RCTLogWarn(@"[AudioRecorderModule] pauseRecording: Recording already paused or pause initiated by another origin (Origin: %lu).", (unsigned long)strongSelf.currentPauseOrigin);
        reject(@"E_ALREADY_PAUSED", @"Recording is already paused or pause in progress.", nil);
    } else {
        RCTLogWarn(@"[AudioRecorderModule] pauseRecording: No active recording to pause.");
        reject(@"E_NO_RECORDING", @"No active recording to pause.", nil);
    }
}

RCT_EXPORT_METHOD(resumeRecording:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] resumeRecording called.");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) {
        reject(@"E_SELF_NIL", @"Module instance is nil", nil);
        return;
    }

    if (strongSelf.audioRecorder && strongSelf.isPaused && strongSelf.currentPauseOrigin == PauseOriginUser) {
        strongSelf.currentPauseOrigin = PauseOriginNone;
        // Ensure audio session is active and configured before resuming
        if (![strongSelf setupAudioSession]) {
            reject(@"E_AUDIO_SESSION", @"Failed to setup audio session for resume.", nil);
            // Potentially call handleCriticalRecordingErrorAndStop if this is severe enough
            return;
        }
        
        [strongSelf.audioRecorder record]; // This resumes the recording
        strongSelf.isPaused = NO;
        [strongSelf startRecordingTimer]; // Restart progress updates

        if (strongSelf->hasListeners) {
            dispatch_async(strongSelf.eventDispatchQueue, ^{
                AudioRecorderModule *strongSelfForBlock = strongSelf;
                if (!strongSelfForBlock) return;
                [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                    @"status": @"resumed-by-user",
                    @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                    @"currentSegmentPath": strongSelfForBlock.currentRecordingFilePath ?: @"",
                    @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1)
                }];
            });
        }
        RCTLogInfo(@"[AudioRecorderModule] Recording resumed by user.");
        resolve(@{@"success": @YES, @"message": @"Recording resumed"});
    } else if (!strongSelf.audioRecorder) {
        RCTLogWarn(@"[AudioRecorderModule] resumeRecording: No audio recorder instance.");
        reject(@"E_NO_RECORDER_INSTANCE", @"No audio recorder instance to resume.", nil);
    } else if (!strongSelf.isPaused) {
        RCTLogWarn(@"[AudioRecorderModule] resumeRecording: Recording is not paused.");
        reject(@"E_NOT_PAUSED", @"Recording is not currently paused.", nil);
    } else if (strongSelf.currentPauseOrigin == PauseOriginBackground) {
        RCTLogWarn(@"[AudioRecorderModule] resumeRecording: Recording was paused by app backgrounding. Should be resumed by foregrounding event.");
        reject(@"E_PAUSED_BY_BACKGROUND", @"Recording paused by background, cannot resume manually.", nil);
    } else {
        RCTLogWarn(@"[AudioRecorderModule] resumeRecording: Cannot resume in current state (isPaused: %d, pauseOrigin: %lu).", strongSelf.isPaused, (unsigned long)strongSelf.currentPauseOrigin);
        reject(@"E_CANNOT_RESUME", @"Cannot resume recording in the current state.", nil);
    }
}

RCT_EXPORT_METHOD(getCurrentState:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSString *state;
    
    if (!self.audioRecorder) {
        state = @"idle";
    } else if (self.isPaused) {
        state = @"paused";
    } else {
        state = @"recording";
    }
    
    resolve(@{
        @"state": state,
        @"recordingId": self.currentRecordingId ?: @"",
        @"currentTime": @(self.currentRecordingDuration),
        @"isPaused": @(self.isPaused)
    });
}

RCT_EXPORT_METHOD(concatenateSegments:(NSArray<NSString *> *)segmentPaths
                  outputFilePath:(NSString *)outputFilePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] Starting concatenation for %lu segments to output: %@", (unsigned long)segmentPaths.count, outputFilePath);

    if (!segmentPaths || segmentPaths.count == 0) {
        reject(@"concatenation_error", @"No segment paths provided", nil);
        return;
    }

    AVMutableComposition *composition = [AVMutableComposition composition];
    AVMutableCompositionTrack *compositionAudioTrack = [composition addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
    CMTime currentDuration = kCMTimeZero;
    BOOL success = YES;

    for (NSString *path in segmentPaths) {
        NSURL *url = [NSURL fileURLWithPath:path];
        AVAsset *asset = [AVAsset assetWithURL:url];
        NSArray<AVAssetTrack *> *tracks = [asset tracksWithMediaType:AVMediaTypeAudio];

        if (tracks.count == 0) {
            RCTLogError(@"[AudioRecorderModule] Segment has no audio tracks: %@", path);
            // Optionally skip this segment or fail
            // For now, let's try to continue, but log it
            continue;
        }

        AVAssetTrack *clipAudioTrack = tracks[0];
        CMTimeRange timeRange = CMTimeRangeMake(kCMTimeZero, asset.duration);

        NSError *error = nil;
        if (![compositionAudioTrack insertTimeRange:timeRange ofTrack:clipAudioTrack atTime:currentDuration error:&error]) {
            RCTLogError(@"[AudioRecorderModule] Failed to insert track from segment %@: %@", path, error);
            success = NO;
            break;
        }
        currentDuration = CMTimeAdd(currentDuration, asset.duration);
    }

    if (!success) {
        reject(@"concatenation_error", @"Failed to compose audio tracks", nil);
        return;
    }

    // Delete existing output file if it exists
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if ([fileManager fileExistsAtPath:outputFilePath]) {
        NSError *deleteError = nil;
        if (![fileManager removeItemAtPath:outputFilePath error:&deleteError]) {
            RCTLogError(@"[AudioRecorderModule] Failed to delete existing output file at %@: %@", outputFilePath, deleteError);
            // Proceed anyway, export might overwrite or fail
        }
    }

    AVAssetExportSession *exportSession = [AVAssetExportSession exportSessionWithAsset:composition presetName:AVAssetExportPresetAppleM4A];
    if (!exportSession) {
        reject(@"concatenation_error", @"Failed to create export session", nil);
        return;
    }

    exportSession.outputURL = [NSURL fileURLWithPath:outputFilePath];
    exportSession.outputFileType = AVFileTypeAppleM4A;

    [exportSession exportAsynchronouslyWithCompletionHandler:^{
        dispatch_async(dispatch_get_main_queue(), ^{
            switch (exportSession.status) {
                case AVAssetExportSessionStatusCompleted:
                    RCTLogInfo(@"[AudioRecorderModule] Concatenation successful: %@", outputFilePath);
                    resolve(outputFilePath);
                    break;
                case AVAssetExportSessionStatusFailed:
                    RCTLogError(@"[AudioRecorderModule] Concatenation failed: %@", exportSession.error);
                    reject(@"concatenation_error", [NSString stringWithFormat:@"Export failed: %@", exportSession.error.localizedDescription], exportSession.error);
                    break;
                case AVAssetExportSessionStatusCancelled:
                    reject(@"concatenation_error", @"Export cancelled", nil);
                    break;
                default:
                    reject(@"concatenation_error", @"Export resulted in unknown status", nil);
                    break;
            }
        });
    }];
}

#pragma mark - Private Helper Methods

- (void)handleCriticalRecordingErrorAndStop:(NSString *)errorReason {
    RCTLogError(@"[AudioRecorderModule] CRITICAL ERROR: %@. Stopping recording.", errorReason);
    
    // Ensure the stop reason reflects failure
    self.currentStopReason = SegmentStopReasonFailed;
    
    if (self.audioRecorder && self.audioRecorder.isRecording) {
        [self.audioRecorder stop]; // Stop if somehow still recording
    }
    self.audioRecorder = nil;
    
    [self stopRecordingTimer];
    
    // Emit onRecordingFinished with error status
    // Collect available data, even if partial
    NSArray *segmentPaths = [self.recordingSegments copy];
    NSTimeInterval totalDuration = self.totalDurationOfCompletedSegmentsSoFar;
    if (hasListeners) {
        AudioRecorderModule *strongSelf = self;
        dispatch_async(strongSelf.eventDispatchQueue, ^{
            if (!strongSelf) return;
            [strongSelf sendEventWithName:@"onRecordingFinished" body:@{
                @"status": @"error",
                @"errorMessage": errorReason ?: @"Unknown critical error",
                @"recordingId": strongSelf.currentRecordingId ?: @"",
                @"basePath": [strongSelf getRecordingsDirectory] ?: @"",
                @"segmentPaths": segmentPaths ?: @[],
                @"totalDuration": @(totalDuration)
            }];
        });
    }
    
    [[AVAudioSession sharedInstance] setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
    [self resetRecordingState]; // Resets most state, including currentRecordingId
    // currentStopReason is already set to Failed, resetRecordingState will set it to None afterwards if not careful
    // Ensure resetRecordingState preserves or is aware of the need to keep SegmentStopReasonFailed temporarily if error event relies on it before full reset
    // For now, resetRecordingState sets it to None. This is fine as error event has been sent.
}

- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)flag {
    RCTLogInfo(@"[AudioRecorderModule] audioRecorderDidFinishRecording: successfully: %d, recorderPath: %@", flag, recorder.url.path);
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    SegmentStopReason reasonForStop = strongSelf.currentStopReason;
    NSString *completedSegmentPath = recorder.url.path;
    NSTimeInterval durationOfThisSegment = 0; // Will be calculated based on context

    if (reasonForStop == SegmentStopReasonManual) {
        RCTLogInfo(@"[AudioRecorderModule] audioRecorderDidFinishRecording: Manual stop detected. Finalizing segment.");
        // Duration calculation for manually stopped segment is handled by stopRecordingInternal which calls this.
        // Or, if stop was called directly on recorder, need to get current time.
        // For now, assuming stopRecordingInternal sets up everything before this is called for manual stop.
        // The critical part is that stopRecordingInternal has already set the currentStopReason.
        // It will finalize the recording after this delegate returns.
        // Add segment to list if path exists
        if (completedSegmentPath && ![completedSegmentPath isEqualToString:@""]) {
            [strongSelf.recordingSegments addObject:completedSegmentPath];
            // Duration of this last segment is recorder.currentTime if available, or maxSegmentDuration if it ran full then stopped.
            // This path should primarily be for cleanup after stopRecordingInternal has done its main job.
            // Let's assume stopRecordingInternal will sum up the final bit.
            // For robustness, calculate and send onRecordingSegmentComplete here too for the manual stop.
            durationOfThisSegment = recorder.currentTime; // This recorder is the one that was manually stopped.
            strongSelf.totalDurationOfCompletedSegmentsSoFar += durationOfThisSegment;
            if (hasListeners) {
                dispatch_async(strongSelf.eventDispatchQueue, ^{
                    AudioRecorderModule *strongSelfRef = strongSelf;
                    if (!strongSelfRef) return;
                    [strongSelfRef sendEventWithName:@"onRecordingSegmentComplete" body:@{
                        @"recordingId": strongSelfRef.currentRecordingId ?: @"",
                        @"segmentPath": completedSegmentPath ?: @"",
                        @"segmentNumber": @(strongSelfRef.recordingSegments.count),
                        @"duration": @(durationOfThisSegment)
                    }];
                });
            }
        }
        // Let stopRecordingInternal handle the rest (timer, onRecordingFinished, cleanup)
        // Resetting currentStopReason to None is also handled by stopRecordingInternal after all processing.
        return;
    }

    if (!flag) { // Recording failed for the current segment
        RCTLogError(@"[AudioRecorderModule] audioRecorderDidFinishRecording: Recording failed for segment at path: %@", completedSegmentPath);
        strongSelf.currentStopReason = SegmentStopReasonFailed;
        // No segment to add, but stop everything.
        [strongSelf handleCriticalRecordingErrorAndStop:@"Recording failed for segment."];
        return;
    }

    // If flag is YES, and it wasn't a manual stop, it's either timed or interrupted.
    // Add the successfully completed segment
    if (completedSegmentPath && ![completedSegmentPath isEqualToString:@""]) {
        [strongSelf.recordingSegments addObject:completedSegmentPath];
        // If timed or none, duration is maxSegmentDuration. If interrupted, it's recorder.currentTime.
        if (reasonForStop == SegmentStopReasonTimed || reasonForStop == SegmentStopReasonNone) {
            durationOfThisSegment = strongSelf.maxSegmentDuration;
        } else if (reasonForStop == SegmentStopReasonInterrupted) {
            durationOfThisSegment = recorder.currentTime; // Actual recorded duration before interruption
        }
        strongSelf.totalDurationOfCompletedSegmentsSoFar += durationOfThisSegment;

        if (hasListeners) {
            dispatch_async(strongSelf.eventDispatchQueue, ^{
                AudioRecorderModule *strongSelfRef = strongSelf;
                if (!strongSelfRef) return;
                [strongSelfRef sendEventWithName:@"onRecordingSegmentComplete" body:@{
                    @"recordingId": strongSelfRef.currentRecordingId ?: @"",
                    @"segmentPath": completedSegmentPath ?: @"",
                    @"segmentNumber": @(strongSelfRef.recordingSegments.count),
                    @"duration": @(durationOfThisSegment)
                }];
            });
        }
    } else {
        RCTLogWarn(@"[AudioRecorderModule] audioRecorderDidFinishRecording: Successfully finished but segment path is nil/empty.");
        // This case should ideally not happen if flag is YES.
    }

    // Now decide what to do based on the original reasonForStop
    if (reasonForStop == SegmentStopReasonTimed || reasonForStop == SegmentStopReasonNone) { // Timed or implicitly first segment completion
        RCTLogInfo(@"[AudioRecorderModule] Segment finished by time. Phase 1: Stopping entirely after one segment.");
        // PHASE 1 BEHAVIOR: Stop entirely after one segment.
        [self stopRecordingTimer];
        // Prepare data for onRecordingFinished
        NSDictionary *recordingResult = @{
            @"success": @YES,
            @"recordingId": self.currentRecordingId ?: @"",
            @"filePath": completedSegmentPath ?: @"", // Or self.currentRecordingFilePath which should be the same
            @"duration": @(self.totalDurationOfCompletedSegmentsSoFar), // Total duration of all segments
            @"segmentPaths": [NSArray arrayWithArray:self.recordingSegments]
        };

        if (hasListeners) {
            dispatch_async(self.eventDispatchQueue, ^{
                AudioRecorderModule *strongSelf = self;
                if (!strongSelf) return;
                [strongSelf sendEventWithName:@"onRecordingFinished" body:recordingResult];
            });
        }

        // Deactivate audio session and clean up
        NSError *error;
        [[AVAudioSession sharedInstance] setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:&error];
        if (error) {
            RCTLogError(@"[AudioRecorderModule] Error deactivating audio session: %@", error);
        }
        self.audioRecorder = nil; // Release the recorder
        self.currentRecordingFilePath = nil;
        // self.currentRecordingId = nil; // Keep currentRecordingId for now if onRecordingFinished needs it just above?
                                        // Let's keep it, stopRecordingInternal usually clears it, but we are bypassing that full method here.
        self.isPaused = NO;
        // No longer incrementing currentSegmentNumber
    }
}

- (void)handleAppDidEnterBackground:(NSNotification *)notification {
    RCTLogInfo(@"[AudioRecorderModule] App did enter background.");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    if (strongSelf.audioRecorder && strongSelf.audioRecorder.isRecording && strongSelf.currentPauseOrigin == PauseOriginNone) {
        RCTLogInfo(@"[AudioRecorderModule] Recording is active and not paused by user. Pausing due to backgrounding.");

        __block UIBackgroundTaskIdentifier backgroundTaskID = UIBackgroundTaskInvalid;
        backgroundTaskID = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"HandleAppBackgroundPauseTask" expirationHandler:^{
            RCTLogWarn(@"[AudioRecorderModule] Background task for app background pause expired.");
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
                backgroundTaskID = UIBackgroundTaskInvalid;
            }
        }];

        // Perform operations synchronously within the background task assertion
        strongSelf.currentPauseOrigin = PauseOriginBackground;
        strongSelf.isPaused = YES; // Mark as paused
        
        [strongSelf stopRecordingTimer]; // Stop progress updates
        
        // Stop the recorder. This will trigger audioRecorderDidFinishRecording.
        // The delegate method will need to know not to restart a segment if currentPauseOrigin is PauseOriginBackground.
        [strongSelf.audioRecorder stop];
        
        // Emit an event to JS
        if (strongSelf->hasListeners) {
            dispatch_async(strongSelf.eventDispatchQueue, ^{
                AudioRecorderModule *strongSelfForBlock = strongSelf;
                if (!strongSelfForBlock) return;
                [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                    @"status": @"paused-by-background",
                    @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                    @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1) // Current segment that was active
                }];
            });
        }
        
        RCTLogInfo(@"[AudioRecorderModule] Recording segment stopped due to backgrounding. Awaiting finalization in delegate.");

        // End the background task
        if (backgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            // backgroundTaskID = UIBackgroundTaskInvalid; // Not strictly needed here as it's a local variable
        }
    } else {
        RCTLogInfo(@"[AudioRecorderModule] App entered background, but no active recording to pause or already paused/handled.");
    }
}

- (void)handleAppWillEnterForeground:(NSNotification *)notification {
    RCTLogInfo(@"[AudioRecorderModule] App will enter foreground.");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    if (strongSelf.currentPauseOrigin == PauseOriginBackground) {
        RCTLogInfo(@"[AudioRecorderModule] Resuming recording from background pause.");

        __block UIBackgroundTaskIdentifier backgroundTaskID = UIBackgroundTaskInvalid;
        backgroundTaskID = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"HandleAppForegroundResumeTask" expirationHandler:^{
            RCTLogWarn(@"[AudioRecorderModule] Background task for app foreground resume expired.");
            // If task expires, we might not have resumed properly. Consider error handling.
            [strongSelf handleCriticalRecordingErrorAndStop:@"Foreground resume task expired."];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
                backgroundTaskID = UIBackgroundTaskInvalid;
            }
        }];

        // Ensure audio session is active and configured
        if (![strongSelf setupAudioSession]) {
            [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to setup audio session on foreground resume."];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            }
            return;
        }

        strongSelf.currentPauseOrigin = PauseOriginNone;
        strongSelf.isPaused = NO;

        // Start a new segment
        NSString *nextSegmentFilePath = [strongSelf generateRecordingFilePath:strongSelf.currentRecordingId
                                                               segmentNumber:(strongSelf.recordingSegments.count + 1)];
        if (!nextSegmentFilePath) {
            [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to generate file path for new segment on foreground resume."];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            }
            return;
        }
        strongSelf.currentRecordingFilePath = nextSegmentFilePath;

        NSDictionary *settings = [strongSelf getAudioRecordingSettings];
        NSError *error = nil;
        strongSelf.audioRecorder = [[AVAudioRecorder alloc] initWithURL:[NSURL fileURLWithPath:nextSegmentFilePath]
                                                               settings:settings
                                                                  error:&error];
        if (!strongSelf.audioRecorder || error) {
            NSString *errorMsg = error ? error.localizedDescription : @"Failed to initialize audio recorder on foreground resume.";
            [strongSelf handleCriticalRecordingErrorAndStop:errorMsg];
            if (backgroundTaskID != UIBackgroundTaskInvalid) {
                [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
            }
            return;
        }
        strongSelf.audioRecorder.delegate = strongSelf;
        [strongSelf.audioRecorder prepareToRecord];

        if ([strongSelf.audioRecorder recordForDuration:strongSelf.maxSegmentDuration]) {
            RCTLogInfo(@"[AudioRecorderModule] Successfully started new segment (%lu) at %@ after foregrounding.",
                       (unsigned long)(strongSelf.recordingSegments.count + 1),
                       nextSegmentFilePath);
            [strongSelf startRecordingTimer]; // Restart progress updates
            strongSelf.currentStopReason = SegmentStopReasonNone;
            // strongSelf.durationAtSegmentStart = CACurrentMediaTime(); // Reset for new segment

            // Emit event
            if (strongSelf->hasListeners) {
                dispatch_async(strongSelf.eventDispatchQueue, ^{
                    AudioRecorderModule *strongSelfForBlock = strongSelf;
                    if (!strongSelfForBlock) return;
                    [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                        @"status": @"resumed-from-background",
                        @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                        @"currentSegmentPath": nextSegmentFilePath,
                        @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1)
                    }];
                });
            }
        } else {
            [strongSelf handleCriticalRecordingErrorAndStop:@"Failed to start recording new segment on foreground resume."];
            strongSelf.audioRecorder = nil; // Ensure it's nil
        }

        // End the background task
        if (backgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:backgroundTaskID];
        }
    } else {
        RCTLogInfo(@"[AudioRecorderModule] App will enter foreground, but recording was not paused due to backgrounding.");
    }
}

#pragma mark - Private Helper Methods

- (void)resetRecordingState {
    RCTLogInfo(@"[AudioRecorderModule] Resetting recording state.");
    self.audioRecorder.delegate = nil;
    self.audioRecorder = nil;
    self.currentRecordingPath = nil;
    self.currentRecordingId = nil;
    self.isPaused = NO;
    self.currentPauseOrigin = PauseOriginNone; // Reset pause origin
    self.currentRecordingDuration = 0;
    self.totalPauseDuration = 0;
    [self.recordingSegments removeAllObjects];
    self.currentStopReason = SegmentStopReasonNone;
    self.totalDurationOfCompletedSegmentsSoFar = 0.0;
    // No need to reset maxSegmentDuration here as it's a configurable setting
    
    // Ensure any pending background task for segment transition is ended
    if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
        RCTLogWarn(@"[AudioRecorderModule] Resetting state with an active segment transition background task. Ending task.");
        [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
        self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
    }
    [self unregisterAppLifecycleNotifications]; // Also unregister here as state is fully reset
}

- (void)handleCriticalRecordingErrorAndStop:(NSString *)errorReason {
    // ... (rest of the code remains the same)
}

// Define minimum required disk space (e.g., 100MB)
static const unsigned long long MINIMUM_REQUIRED_DISK_SPACE = 100 * 1024 * 1024;

- (BOOL)hasSufficientDiskSpaceForRecording {
    NSError *error = nil;
    NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfFileSystemForPath:[self getRecordingsDirectory] error:&error];

    if (error) {
        RCTLogError(@"[AudioRecorderModule] Error getting file system attributes: %@", error.localizedDescription);
        // In case of error, conservatively assume not enough space or let it proceed and fail later.
        // For now, let's be conservative and return NO.
        return NO;
    }

    unsigned long long freeSpace = [attributes[NSFileSystemFreeSize] unsignedLongLongValue];
    RCTLogInfo(@"[AudioRecorderModule] Available disk space: %llu bytes (%.2f MB)", freeSpace, (double)freeSpace / (1024*1024));

    if (freeSpace < MINIMUM_REQUIRED_DISK_SPACE) {
        RCTLogError(@"[AudioRecorderModule] Insufficient disk space. Available: %.2f MB, Required: %.2f MB",
                    (double)freeSpace / (1024*1024),
                    (double)MINIMUM_REQUIRED_DISK_SPACE / (1024*1024));
        return NO;
    }

    return YES;
}

- (NSDictionary *)getAudioRecordingSettings
{
    return @{
        AVFormatIDKey: @(kAudioFormatMPEG4AAC),
        AVSampleRateKey: @44100.0,
        AVNumberOfChannelsKey: @1,
        AVEncoderAudioQualityKey: @(AVAudioQualityMedium),
        AVEncoderBitRateKey: @128000
    };
}
