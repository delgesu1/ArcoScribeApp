#import "AudioRecorderModule.h"
#import <React/RCTUtils.h>
#import <React/RCTLog.h>
#import <UIKit/UIApplication.h>
#import <AVFoundation/AVFoundation.h>

// Define Notification Names
NSNotificationName const AudioRecordingDidStartNotification = @"AudioRecordingDidStartNotification";
NSNotificationName const AudioRecordingDidStopNotification = @"AudioRecordingDidStopNotification";

// Define minimum required disk space (e.g., 100MB)
static const unsigned long long MINIMUM_REQUIRED_DISK_SPACE = 100 * 1024 * 1024;

@interface AudioRecorderModule () <AVAudioRecorderDelegate>
// Redeclare readonly properties from .h as readwrite for internal mutation
@property (nonatomic, strong, readwrite) AVAudioRecorder *audioRecorder;
@property (nonatomic, assign, readwrite) BOOL isPaused;
@property (nonatomic, strong, readwrite) NSMutableArray *recordingSegments;
@property (nonatomic, assign, readwrite) NSTimeInterval currentRecordingDuration;
@property (nonatomic, strong, readwrite) NSString *currentRecordingFilePath;
@property (nonatomic, strong, readwrite) NSString *currentRecordingId;
@property (nonatomic, assign, readwrite) NSTimeInterval totalDurationOfCompletedSegmentsSoFar;
@property (nonatomic, assign, readwrite) UIBackgroundTaskIdentifier segmentTransitionBackgroundTaskID;
@property (nonatomic, strong, readwrite) dispatch_queue_t eventDispatchQueue;
@property (nonatomic, assign, readwrite) PauseOrigin currentPauseOrigin;
@property (nonatomic, assign, readwrite) SegmentStopReason currentStopReason;

// Do not redeclare properties that are already readwrite in the .h file:
// - totalPauseDuration
// - maxSegmentDuration
// - isRecording
// - durationAtSegmentStart
// - durationOfSegmentBeforeStop
// - recordingStartTime
// - pauseStartTime
// - recordingTimer

// Private helper methods for app lifecycle
- (void)registerAppLifecycleNotifications;
- (void)unregisterAppLifecycleNotifications;
- (void)handleAppDidEnterBackground:(NSNotification *)notification;
- (void)handleAppWillEnterForeground:(NSNotification *)notification;

// Declare private helper methods
- (void)startRecordingInternal:(NSString *)filePath recordingId:(NSString *)recordingId options:(NSDictionary *)options;
- (void)handleCriticalRecordingErrorAndStop:(NSString *)errorReason;
- (NSDictionary *)getAudioRecordingSettings;

// Add promise storage
@property (nonatomic, strong) RCTPromiseResolveBlock startRecordingResolver;
@property (nonatomic, strong) RCTPromiseRejectBlock startRecordingRejecter;

@end

@implementation AudioRecorderModule
{
    bool hasListeners;
    AVAudioSession *_audioSession; // Keep if used directly
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
        
        // Initialize playback dictionaries and counters
        self.playbackPlayers = [NSMutableDictionary new];
        self.playbackTimeObservers = [NSMutableDictionary new];
        self.nextPlayerId = 1;
        
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
    return @[
        @"onRecordingProgress",
        @"onRecordingFinished",
        @"onRecordingError",
        @"onRecordingUpdate",
        @"onRecordingSegmentComplete", // Playback events
        @"onPlaybackProgress",
        @"onPlaybackEnded"
    ];
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
    
    // Guard: Only proceed if the recorder exists and is actively recording.
    // Also ensure not paused, as sending progress events during pause might be misleading depending on UI.
    if (!self.audioRecorder || !self.audioRecorder.isRecording || self.isPaused) {
        if (!self.audioRecorder) {
            RCTLogInfo(@"[AudioRecorderModule] updateRecordingProgress: audioRecorder is nil. Skipping progress update.");
        } else if (!self.audioRecorder.isRecording) {
            RCTLogInfo(@"[AudioRecorderModule] updateRecordingProgress: audioRecorder is not recording. Skipping progress update.");
        } else if (self.isPaused) {
            RCTLogInfo(@"[AudioRecorderModule] updateRecordingProgress: Recording is paused. Skipping progress update.");
        }
        return;
    }

    [self.audioRecorder updateMeters]; // Update meters before reading power
        
    // Only emit UI progress events; no rollover or segment checks here
    NSTimeInterval currentSegmentTime = self.audioRecorder.currentTime;
    NSTimeInterval effectiveCurrentTime = self.totalDurationOfCompletedSegmentsSoFar + currentSegmentTime;
    self.currentRecordingDuration = effectiveCurrentTime;
    float averagePower = -160.0f;
    if (self.audioRecorder.recording) {
        averagePower = [self.audioRecorder averagePowerForChannel:0];
    }
    RCTLogInfo(@"[AudioRecorderModule] Progress - currentTime: %f, metering: %f, recordingId: %@, segment: %lu",
               effectiveCurrentTime, averagePower, self.currentRecordingId, (unsigned long)(self.recordingSegments.count + 1));
    if (hasListeners) {
        dispatch_async(self.eventDispatchQueue, ^{
            AudioRecorderModule *strongSelf = self;
            if (!strongSelf) return;
            [strongSelf sendEventWithName:@"onRecordingProgress" body:@{
                @"currentTime": @(effectiveCurrentTime),
                @"metering": @(averagePower),
                @"recordingId": strongSelf.currentRecordingId ?: @"",
                @"segmentNumber": @(strongSelf.recordingSegments.count + 1)
            }];
        });
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
            AudioRecorderModule *strongSelfForBlock = strongSelf;
            if (!strongSelfForBlock) return;
            [strongSelfForBlock sendEventWithName:@"onRecordingError" body:@{
                @"message": errorMessage ?: @"Unknown error",
                @"recordingId": strongSelfForBlock.currentRecordingId ?: @""
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
            [strongSelf stopRecordingTimer]; // Stop progress updates
            strongSelf.pauseStartTime = [NSDate date];
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
                    if (strongSelf.pauseStartTime) {
                        strongSelf.totalPauseDuration += [[NSDate date] timeIntervalSinceDate:strongSelf.pauseStartTime];
                        strongSelf.pauseStartTime = nil;
                    }
                    [strongSelf startRecordingTimer]; // Restart progress updates

                    if (strongSelf->hasListeners) {
                        dispatch_async(strongSelf.eventDispatchQueue, ^{
                            AudioRecorderModule *strongSelfForBlock = strongSelf;
                            if (!strongSelfForBlock) return;
                            [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                                @"status": @"resumed-from-interruption",
                                @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
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
    
    // Ignore category changes (reason = 3) which happen frequently and don't represent physical route changes
    if (reason == AVAudioSessionRouteChangeReasonCategoryChange) {
        RCTLogInfo(@"[AudioRecorderModule] Ignoring route change due to category change (reason = 3)");
        return;
    }
    
    AVAudioSessionRouteDescription *route = [[AVAudioSession sharedInstance] currentRoute];
    for (AVAudioSessionPortDescription *desc in route.inputs) {
        RCTLogInfo(@"[AudioRecorderModule] Using input: %@", desc.portType);
    }

    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    // If recording is active, log the route change
    if (strongSelf.audioRecorder && strongSelf.audioRecorder.isRecording) {
        RCTLogInfo(@"[AudioRecorderModule] Audio route changed during active recording.");
    }
}

- (void)handleAppDidEnterBackground:(NSNotification *)notification {
    RCTLogInfo(@"[AudioRecorderModule] App did enter background - continuing to record.");
    // NO pause/stop here; recorder keeps running due to background audio mode.
}

- (void)handleAppWillEnterForeground:(NSNotification *)notification {
    RCTLogInfo(@"[AudioRecorderModule] App will enter foreground - recorder already running.");
    // Nothing to do; recorder kept running.
    // Maybe emit a light update event if JS needs to know?
    /*
    if (self->hasListeners && self.audioRecorder && self.audioRecorder.isRecording) {
        dispatch_async(self.eventDispatchQueue, ^{
            AudioRecorderModule *strongSelfForBlock = self;
            if (!strongSelfForBlock) return;
            [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:@{
                @"status": @"resumed-from-background-noop", // Indicate foregrounding happened
                @"recordingId": strongSelfForBlock.currentRecordingId ?: @"",
                @"currentSegmentNumber": @(strongSelfForBlock.recordingSegments.count + 1)
            }];
        });
    }
    */
}

- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)flag
{
    RCTLogInfo(@"[AudioRecorderModule] audioRecorderDidFinishRecording: successfully: %d, recorderPath: %@", flag, recorder.url.path);
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) return;

    dispatch_async(dispatch_get_main_queue(), ^{
        AudioRecorderModule *strongSelfForBlock = strongSelf;
        if (!strongSelfForBlock) return;
        
        // Stop the recording timer if it's still running
        [strongSelfForBlock stopRecordingTimer];
        
        // Determine the stop reason
        SegmentStopReason reasonForStop = strongSelfForBlock.currentStopReason;
        PauseOrigin pauseOriginWhenCalled = strongSelfForBlock.currentPauseOrigin;
        
        // Get segment duration - use pre-captured duration if this was an API-initiated stop
        // otherwise use the recorder's current time (which may be 0 if already stopped)
        NSTimeInterval segmentDuration = 0;
        if (reasonForStop == SegmentStopReasonApiStop || reasonForStop == SegmentStopReasonManual) {
            segmentDuration = strongSelfForBlock.durationOfSegmentBeforeStop;
        } else {
            // Timed or implicit stop – recorder.currentTime is already 0, so compute based on timestamp
            segmentDuration = CACurrentMediaTime() - strongSelfForBlock.durationAtSegmentStart;
        }
        
        if (segmentDuration < 0) segmentDuration = 0; // Safety
        
        // The recorder path (current segment)
        NSString *segmentPath = recorder.url.path;
        
        RCTLogInfo(@"[AudioRecorderModule] Segment duration for %@: %.2f (using %@)", 
                  segmentPath, 
                  segmentDuration,
                  (reasonForStop == SegmentStopReasonApiStop || reasonForStop == SegmentStopReasonManual) ? @"pre-captured duration" : @"recorder.currentTime");
        
        if (flag) { // Successfully recorded
            RCTLogInfo(@"[AudioRecorderModule] Segment recorded successfully to path: %@, duration: %.2f sec", segmentPath, segmentDuration);
            
            // IMPORTANT: Only add this segment to our tracking array if it's NOT already there
            if (segmentPath && ![segmentPath isEqualToString:@""]) {
                // Always check for duplicates before adding
                if (![strongSelfForBlock.recordingSegments containsObject:segmentPath]) {
                    [strongSelfForBlock.recordingSegments addObject:segmentPath];
                    strongSelfForBlock.totalDurationOfCompletedSegmentsSoFar += segmentDuration;
                    RCTLogInfo(@"[AudioRecorderModule] Added segment in delegate. Total duration: %f", 
                            strongSelfForBlock.totalDurationOfCompletedSegmentsSoFar);
                } else {
                    RCTLogInfo(@"[AudioRecorderModule] Skipped duplicate segment path: %@", segmentPath);
                }
            }
            
            // Reset current segment-specific durations as this segment is now complete
            strongSelfForBlock.currentRecordingDuration = strongSelfForBlock.totalDurationOfCompletedSegmentsSoFar;
            strongSelfForBlock.totalPauseDuration = 0;
            
            // Capture the ID now, in case resetRecordingState clears it later
            NSString *idForEvents = [strongSelfForBlock.currentRecordingId copy];
            
            // Emit segment completion event
            if (strongSelfForBlock->hasListeners) {
                dispatch_async(strongSelfForBlock.eventDispatchQueue, ^{
                    AudioRecorderModule *strongSelfForBlock = strongSelf;
                    if (!strongSelfForBlock) return;
                    [strongSelfForBlock sendEventWithName:@"onRecordingSegmentComplete" body:@{
                        @"recordingId": idForEvents ?: @"",
                        @"segmentPath": segmentPath ?: @"",
                        @"segmentNumber": @(strongSelfForBlock.recordingSegments.count), // This is now the count of *completed* segments
                        @"duration": @(segmentDuration)
                    }];
                });
            }
            
            // Check if the recording should transition to the next segment or if we're done
            if (reasonForStop == SegmentStopReasonTimed || (reasonForStop == SegmentStopReasonNone && pauseOriginWhenCalled == PauseOriginNone)) {
                // Segment finished by time, or no specific stop reason and not paused = implicit time finish.
                // This is the path for continuous recording, start the next segment.
                RCTLogInfo(@"[AudioRecorderModule] Segment finished by time. Starting next segment.");
                strongSelfForBlock.segmentTransitionBackgroundTaskID = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"SegmentTransitionTask" expirationHandler:^{
                    AudioRecorderModule *strongSelfForBlock = strongSelf;
                    if (!strongSelfForBlock) return;
                    
                    if (strongSelfForBlock.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                        RCTLogInfo(@"[AudioRecorderModule] Ending expired background task: %lu", (unsigned long)strongSelfForBlock.segmentTransitionBackgroundTaskID);
                        [[UIApplication sharedApplication] endBackgroundTask:strongSelfForBlock.segmentTransitionBackgroundTaskID];
                        strongSelfForBlock.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                    }
                }];
                
                if (![strongSelfForBlock startNextSegment]) {
                    // Failed to start the next segment, end the background task
                    RCTLogError(@"[AudioRecorderModule] Failed to start next segment. Ending continuous recording.");
                    if (strongSelfForBlock.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
                        RCTLogInfo(@"[AudioRecorderModule] Ending background task due to failure: %lu", (unsigned long)strongSelfForBlock.segmentTransitionBackgroundTaskID);
                        [[UIApplication sharedApplication] endBackgroundTask:strongSelfForBlock.segmentTransitionBackgroundTaskID];
                        strongSelfForBlock.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
                    }
                }
            } else if (reasonForStop == SegmentStopReasonManual || reasonForStop == SegmentStopReasonApiStop) {
                RCTLogInfo(@"[AudioRecorderModule] Segment finished due to manual stop or API stop. Finalizing recording session.");
                
                // No more promise resolution here - that happens immediately in stopRecording method
                // Emit event to notify UI that recording has been stopped
                if (strongSelfForBlock->hasListeners) {
                    dispatch_async(strongSelfForBlock.eventDispatchQueue, ^{
                        AudioRecorderModule *eventSelf = strongSelfForBlock;
                        if (!eventSelf) return;
                        
                        [eventSelf sendEventWithName:@"onRecordingFinished" body:@{
                            @"recordingId": idForEvents ?: @"",
                            @"status": @"completed",
                            @"segmentCount": @(eventSelf.recordingSegments.count),
                            @"segmentPaths": [eventSelf.recordingSegments copy],
                            @"duration": @(eventSelf.totalDurationOfCompletedSegmentsSoFar)
                        }];
                    });
                }
                
                // Defer state reset until after events have been dispatched
                dispatch_async(strongSelfForBlock.eventDispatchQueue, ^{
                    dispatch_async(dispatch_get_main_queue(), ^{
                        [strongSelfForBlock resetRecordingState];
                    });
                });
            }
            
            // Always clear the delegate and nil out the recorder instance that just finished
            recorder.delegate = nil;
            if (strongSelfForBlock.audioRecorder == recorder) {
                strongSelfForBlock.audioRecorder = nil;
            }
        } else {
            // Recording failed for the current segment
            RCTLogError(@"[AudioRecorderModule] audioRecorderDidFinishRecording received failure flag.");
            strongSelfForBlock.currentStopReason = SegmentStopReasonFailed;
            [strongSelfForBlock handleCriticalRecordingErrorAndStop:@"Recording failed for segment."];
        }
    });
}

- (BOOL)startNextSegment {
    // Segment finished by time - this is the path for continuous recording
    RCTLogInfo(@"[AudioRecorderModule] Starting next segment.");
    
    // Start a background task to ensure we have time to start the next segment
    self.segmentTransitionBackgroundTaskID = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"SegmentTransitionTask" expirationHandler:^{
        RCTLogError(@"[AudioRecorderModule] Background task for segment transition expired.");
        if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
            self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
        }
        [self handleCriticalRecordingErrorAndStop:@"Segment transition background task expired."];
    }];
    RCTLogInfo(@"[AudioRecorderModule] Began background task for segment transition: %lu", (unsigned long)self.segmentTransitionBackgroundTaskID);

    if (![self hasSufficientDiskSpaceForRecording]) {
        RCTLogError(@"[AudioRecorderModule] Insufficient disk space to start new recording.");
        if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
            self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
        }
        [self handleCriticalRecordingErrorAndStop:@"Insufficient disk space for next segment."];
        return NO;
    }
    
    NSString *nextSegmentFilePath = [self getFilepathForRecordingId:self.currentRecordingId segmentNumber:(self.recordingSegments.count + 1)];
    if (!nextSegmentFilePath) {
        if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
            self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
        }
        [self handleCriticalRecordingErrorAndStop:@"Failed to generate file path for next segment."];
        return NO;
    }
    self.currentRecordingFilePath = nextSegmentFilePath;

    NSDictionary *settings = [self getAudioRecordingSettings];
    NSError *error = nil;
    self.audioRecorder = [[AVAudioRecorder alloc] initWithURL:[NSURL fileURLWithPath:nextSegmentFilePath] 
                                                       settings:settings 
                                                          error:&error];
    if (!self.audioRecorder || error) {
        NSString *errorMsg = error ? error.localizedDescription : @"Failed to initialize audio recorder for next segment.";
        if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
            [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
            self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
        }
        [self handleCriticalRecordingErrorAndStop:errorMsg];
        return NO;
    }
    self.audioRecorder.delegate = self;
    [self.audioRecorder setMeteringEnabled:YES];
    self.durationAtSegmentStart = CACurrentMediaTime();
    [self.audioRecorder prepareToRecord];
    
    if ([self.audioRecorder recordForDuration:self.maxSegmentDuration]) {
        RCTLogInfo(@"[AudioRecorderModule] Successfully started next segment (%lu) at %@ for %.f seconds", 
                   (unsigned long)(self.recordingSegments.count + 1), 
                   nextSegmentFilePath, 
                   self.maxSegmentDuration);
        self.currentStopReason = SegmentStopReasonNone;
        self.isPaused = NO;
        self.isRecording = YES;
        [self startRecordingTimer];
        
        if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
            RCTLogInfo(@"[AudioRecorderModule] Ending background task successfully: %lu", (unsigned long)self.segmentTransitionBackgroundTaskID);
            [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
            self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
        }
        return YES;
    } else {
        // Clean up the recorder
        self.audioRecorder.delegate = nil;
        self.audioRecorder = nil;
        // Try to delete the file if it was created
        [[NSFileManager defaultManager] removeItemAtPath:nextSegmentFilePath error:nil];
        
        if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
            RCTLogInfo(@"[AudioRecorderModule] Ending background task due to failure: %lu", (unsigned long)self.segmentTransitionBackgroundTaskID);
            [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
            self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
        }
        
        [self handleCriticalRecordingErrorAndStop:@"Failed to start recording next segment."];
        return NO;
    }

}

- (void)audioRecorderEncodeErrorDidOccur:(AVAudioRecorder *)recorder error:(NSError *)error
{
    RCTLogError(@"[AudioRecorderModule] Audio encoding error: %@", error);
    [self emitError:[NSString stringWithFormat:@"Audio encoding error: %@", error.localizedDescription]];
}

#pragma mark - Internal Recording Control Methods

- (void)startRecordingInternal:(NSString *)filePath recordingId:(NSString *)recordingId options:(NSDictionary *)options
{
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: Entered startRecordingInternal <<< ");
    // Make sure we're not already recording
    if (self.audioRecorder) {
        RCTLogError(@"[AudioRecorderModule] *** ERROR: Attempted to start recording while already recording. ***");
        [self emitError:@"Start Recording Error: Already recording."];
        return;
    }
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: Setting up audio session...");
    
    // Setup audio session
    if (![self setupAudioSession]) {
        RCTLogError(@"[AudioRecorderModule] *** ERROR: Failed to setup audio session during startRecordingInternal. ***");
        // setupAudioSession should have emitted a specific error
        return;
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
        return;
    }
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: AVAudioRecorder initialized successfully.");
    
    self.audioRecorder.delegate = self;
    [self.audioRecorder setMeteringEnabled:YES];
    self.durationAtSegmentStart = CACurrentMediaTime();
    RCTLogInfo(@"[AudioRecorderModule] startRecordingInternal: Preparing to record...");
    
    // Start recording for the specified segment duration
    self.currentStopReason = SegmentStopReasonTimed; // Assume it will stop due to time, unless manually stopped or fails
    if (![self.audioRecorder recordForDuration:self.maxSegmentDuration]) {
        RCTLogError(@"[AudioRecorderModule] *** FAILED to start recording (audioRecorder.recordForDuration returned NO) ***");
        self.currentStopReason = SegmentStopReasonFailed;
        [self emitError:@"Recorder Error: Failed to start recording."];
        return;
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
    
    // New initializations for segmentation logic
    self.totalDurationOfCompletedSegmentsSoFar = 0.0;
    
    // Reset segments array
    [self.recordingSegments removeAllObjects];
    
    // Start the timer for progress updates
    [self startRecordingTimer];
    
    RCTLogInfo(@"[AudioRecorderModule] Recording started: %@", filePath);
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
    RCTLogInfo(@"[AudioRecorderModule] resumeRecordingInternal called.");
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
        
        // Resume recording - if we paused, we just need to record again
        [self.audioRecorder record];
        self.isPaused = NO;
        self.currentPauseOrigin = PauseOriginNone;
        [self startRecordingTimer]; // Restart the timer
        
        RCTLogInfo(@"[AudioRecorderModule] Recording resumed after %f seconds pause", pauseDuration);
        return YES;
    }
    
    return NO;
}

- (void)resetRecordingState 
{
    // Reset state for the next recording session
    self.audioRecorder = nil;
    self.currentRecordingFilePath = nil;
    self.currentRecordingId = nil; 
    self.isPaused = NO;
    self.currentRecordingDuration = 0; // Reset overall duration counter
    self.totalDurationOfCompletedSegmentsSoFar = 0.0; // Reset accumulated segment duration
    [self.recordingSegments removeAllObjects]; // Clear segment list
    self.currentStopReason = SegmentStopReasonNone; // Reset after stop processing
    self.currentPauseOrigin = PauseOriginNone; // Reset pause origin
    
    // Deactivate audio session (turn off microphone) - move to background queue to prevent main thread blocking
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        NSError *error;
        [[AVAudioSession sharedInstance] setActive:NO
                                       withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                             error:&error];
        if (error) {
            RCTLogError(@"[AudioRecorderModule] Error deactivating audio session: %@", error);
        }
    });
}

- (NSDictionary *)stopRecordingInternal
{
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: Entered stopRecordingInternal <<< ");
    if (!self.audioRecorder && self.recordingSegments.count == 0) {
        RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: stopRecordingInternal returning early: Not recording and no segments <<< ");
        // No active recording but we have a pending promise to resolve
        return @{@"success": @NO, @"error": @"Not recording"};
    }
    
    // Set flag to indicate this is a manual stop via API
    self.currentStopReason = SegmentStopReasonApiStop;
    
    // If we're actively recording (not paused) or paused with existing recorder
    if (self.audioRecorder) {
        // IMPORTANT: Capture duration and path BEFORE stopping
        self.durationOfSegmentBeforeStop = self.audioRecorder.currentTime;
        NSString *segmentPath = self.currentRecordingFilePath;
        
        RCTLogInfo(@"[AudioRecorderModule] Before stopping, currentTime: %f, filePath: %@", 
                  self.durationOfSegmentBeforeStop, segmentPath);
        
        // No longer pre-emptively adding the segment here.
        // The delegate (audioRecorderDidFinishRecording) will add it once and only once.
        // We still capture durationOfSegmentBeforeStop for the delegate to use.
        
        // Now stop the recorder which will trigger audioRecorderDidFinishRecording
        [self.audioRecorder stop];
        
        // Stop the timer
        [self stopRecordingTimer];
    } else {
        // We're already paused, just use the segments we have
        RCTLogInfo(@"[AudioRecorderModule] stopRecordingInternal - recorder was already stopped/paused. Using existing segments.");
    }
    
    // Get current recording state for return value
    NSString *recordingIdToReport = self.currentRecordingId;
    NSArray *segmentPaths = [self.recordingSegments copy];
    NSTimeInterval totalDuration = self.totalDurationOfCompletedSegmentsSoFar;
    
    // Post stop notification
    RCTLogInfo(@"[AudioRecorderModule] Posting AudioRecordingDidStopNotification");
    [[NSNotificationCenter defaultCenter] postNotificationName:AudioRecordingDidStopNotification object:nil];
    
    // Return minimal information to prevent large data over bridge
    return @{
        @"success": @YES,
        @"recordingId": recordingIdToReport ?: @"",
        @"duration": @(totalDuration),
        @"segmentCount": @(segmentPaths.count)
    };
}

#pragma mark - Exported Methods

RCT_EXTERN_METHOD(configureSessionForPlayback)

RCT_EXPORT_METHOD(setMaxSegmentDuration:(NSTimeInterval)duration)
{
    RCTLogInfo(@"[AudioRecorderModule] setMaxSegmentDuration called. self = %p, duration (NSTimeInterval/double) = %f", self, (double)duration);
    if (duration > 0) {
        RCTLogInfo(@"[AudioRecorderModule] Attempting to set maxSegmentDuration...");
        _maxSegmentDuration = duration; // Use ivar directly to avoid recursion
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
    if (!strongSelf) { // Should not happen if called from exported method context, but for safety
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
    NSString *filePath = [strongSelf getFilepathForRecordingId:recordingId segmentNumber:(strongSelf.recordingSegments.count + 1)];
    if (!filePath) {
        RCTLogError(@"[AudioRecorderModule] Failed to generate file path for recording ID: %@", recordingId);
        reject(@"E_FILE_PATH", @"Failed to generate file path for recording.", nil);
        return;
    }

    RCTLogInfo(@"[AudioRecorderModule] Proceeding to start recording with ID: %@, path: %@", recordingId, filePath);

    // Store resolver and rejecter for potential async failure reporting
    strongSelf.startRecordingResolver = resolve;
    strongSelf.startRecordingRejecter = reject;

    // Call the internal method to start the process asynchronously
    [strongSelf startRecordingInternal:filePath recordingId:recordingId options:options];

    // Resolve immediately, assuming the async process has started.
    // Errors within startRecordingInternal should reject the stored promise.
    resolve(@{
        @"status": @"recording_initiated",
        @"recordingId": recordingId,
        @"filePath": filePath // Path of the first segment
    });

    // Clear the stored promise blocks *if* startRecordingInternal is guaranteed
    // to eventually call one of them or if we decide errors are only reported via events.
    // For now, assume startRecordingInternal handles the promise.
    // If startRecordingInternal *doesn't* handle its own errors via the promise,
    // then we might need a different approach (e.g., resolve here, emit errors later).

    // Let's comment out the immediate clearing for now, assuming startRecordingInternal handles the promise.
    // strongSelf.startRecordingResolver = nil;
    // strongSelf.startRecordingRejecter = nil;
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

RCT_EXPORT_METHOD(stopRecording:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
#if DEBUG
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: EXPORTED METHOD stopRecording entered <<< ");
#endif
    
    AudioRecorderModule *strongSelf = self;
    
    if (!strongSelf) {
        reject(@"E_SELF_NIL", @"Module instance is nil", nil);
        return;
    }
    
    // Performance optimization: Check if recording is active before proceeding
    if (!strongSelf.audioRecorder && strongSelf.recordingSegments.count == 0) {
#if DEBUG
        RCTLogInfo(@"[AudioRecorderModule] No active recording to stop");
#endif
        reject(@"E_NO_RECORDING", @"No active recording to stop", nil);
        return;
    }
    
    // Get current state of recording segments before stopping
    // This will be used to resolve the promise immediately
    NSArray *segmentPaths = [strongSelf.recordingSegments copy];
    
    // When we're still holding an AVAudioRecorder, one *more* segment
    // is in progress but not yet inside `recordingSegments`.
    BOOL willFinishCurrentSegment = (strongSelf.audioRecorder != nil);
    NSUInteger pendingCount       = segmentPaths.count + (willFinishCurrentSegment ? 1 : 0);
    
    // Get the first path - either current recording or first in completed segments
    NSString *firstPath = strongSelf.currentRecordingFilePath ?: segmentPaths.firstObject;
    
    // Same idea for duration: add the recorder's running time if needed
    NSTimeInterval totalDuration  = strongSelf.totalDurationOfCompletedSegmentsSoFar +
                                    (willFinishCurrentSegment ? strongSelf.audioRecorder.currentTime : 0);
    NSString *recordingId = [strongSelf.currentRecordingId copy];
    
    // Create a result to return to the JS thread immediately
    // Include essential path data for playback and upload while keeping payload small
    NSDictionary *earlyResult = @{
        @"success": @YES,
        @"recordingId": recordingId ?: @"",
        @"duration": @(totalDuration),
        @"segmentCount": @(pendingCount),       // accurate, never zero in normal cases
        @"firstSegmentPath": firstPath ?: @"",
        @"segmentPaths": [segmentPaths copy], // Include full array
        @"status": @"processing"
    };
    
    // Set up for stopping, but don't wait for the delegate to resolve
    strongSelf.currentStopReason = SegmentStopReasonApiStop;
    
    // Immediately resolve the promise to unblock UI
#if DEBUG
    RCTLogInfo(@"[AudioRecorderModule] Returning early result to unblock UI thread");
#endif
    resolve(earlyResult);
    
    // Create a dedicated serial queue for stopping operations
    static dispatch_queue_t stopProcessingQueue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        stopProcessingQueue = dispatch_queue_create("com.arcoapp.stopprocessing", DISPATCH_QUEUE_SERIAL);
    });
    
    // Perform the actual stop operation on a separate thread
    dispatch_async(stopProcessingQueue, ^{
        // Call internal stop and ignore the result - promise already resolved above
        [strongSelf stopRecordingInternal];
        
        // If we have listeners, notify them about the recording being processed
        if (strongSelf->hasListeners) {
            dispatch_async(strongSelf.eventDispatchQueue, ^{
                AudioRecorderModule *strongSelfForBlock = strongSelf;
                if (!strongSelfForBlock) return;
                
                [strongSelfForBlock sendEventWithName:@"onRecordingUpdate" body:earlyResult];
            });
        }
    });
}

RCT_EXPORT_METHOD(pauseRecording:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] pauseRecording called.");
    AudioRecorderModule *strongSelf = self;
    if (!strongSelf) {
        reject(@"E_SELF_NIL", @"Module instance is nil", nil);
        return;
    }

    if (strongSelf.audioRecorder && strongSelf.audioRecorder.isRecording && strongSelf.currentPauseOrigin == PauseOriginNone) {
        strongSelf.currentPauseOrigin = PauseOriginUser;
        // True pause implementation (no stop, just pause)
        if (strongSelf.audioRecorder && !strongSelf.isPaused) {
            // Use pause instead of stop to maintain the recorder and file
            [strongSelf.audioRecorder pause];
            
            // Update pause state
            strongSelf.isPaused = YES;
            strongSelf.currentPauseOrigin = PauseOriginUser;
            strongSelf.pauseStartTime = [NSDate date];
            [strongSelf stopRecordingTimer];
            
            RCTLogInfo(@"[AudioRecorderModule] Recording paused by user (using pause, not stop).");
        }
        resolve(@{@"success": @YES, @"message": @"Recording paused"});
    } else if (strongSelf.currentPauseOrigin != PauseOriginNone) {
        RCTLogWarn(@"[AudioRecorderModule] pauseRecording: Recording already paused or pause initiated by another origin (Origin: %lu).", (unsigned long)strongSelf.currentPauseOrigin);
        reject(@"E_ALREADY_PAUSED", @"Recording is already paused or pause in progress.", nil);
    } else {
        RCTLogWarn(@"[AudioRecorderModule] pauseRecording: No active recording to pause.");
        reject(@"E_NO_RECORDING", @"No active recording to pause.", nil);
    }
}

RCT_EXPORT_METHOD(resumeRecording:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
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
        reject(@"concatenation_error", @"No segment paths provided for concatenation.", nil);
        return;
    }
    
    // Create a dedicated serial queue for audio processing
    static dispatch_queue_t audioProcessingQueue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        audioProcessingQueue = dispatch_queue_create("com.arcoapp.audioprocessing", DISPATCH_QUEUE_SERIAL);
    });
    
    // Immediately resolve the promise to unblock UI
    // Store the resolver for later use when the export is complete
    RCTPromiseResolveBlock retainedResolver = [resolve copy];
    RCTPromiseRejectBlock retainedRejecter = [reject copy];
    
    // Create a mutable copy so we can deduplicate paths in case of repeats
    NSMutableArray<NSString *> *uniqueSegmentPaths = [NSMutableArray array];
    NSSet<NSString *> *uniquePathsSet = [NSSet set]; // For quick lookup
    
    // Deduplicate segment paths
    for (NSString *path in segmentPaths) {
        if ([uniquePathsSet containsObject:path]) {
            RCTLogInfo(@"[AudioRecorderModule] Skipping duplicate segment path: %@", path);
            continue;
        }
        
        // Check if file exists and has content
        if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
            RCTLogWarn(@"[AudioRecorderModule] Segment file doesn't exist, skipping: %@", path);
            continue;
        }
        
        [uniqueSegmentPaths addObject:path];
        uniquePathsSet = [uniquePathsSet setByAddingObject:path];
    }
    
    RCTLogInfo(@"[AudioRecorderModule] Processing %lu unique segments (removed %lu duplicates)", 
              (unsigned long)uniqueSegmentPaths.count, 
              (unsigned long)(segmentPaths.count - uniqueSegmentPaths.count));
    
    // Optimization: If we only have one unique segment, just copy the file instead of exporting
    if (uniqueSegmentPaths.count == 1) {
        NSString *singleSegmentPath = uniqueSegmentPaths[0];
        RCTLogInfo(@"[AudioRecorderModule] Only one unique segment, copying file instead of exporting: %@", singleSegmentPath);
        
        // Copy the file on a background queue
        dispatch_async(audioProcessingQueue, ^{
            NSError *copyError;
            NSFileManager *fileManager = [NSFileManager defaultManager];
            
            // Delete destination if it exists
            if ([fileManager fileExistsAtPath:outputFilePath]) {
                [fileManager removeItemAtPath:outputFilePath error:nil];
            }
            
            BOOL success = [fileManager copyItemAtPath:singleSegmentPath toPath:outputFilePath error:&copyError];
            
            // Return to JS thread to resolve
            dispatch_async(dispatch_get_main_queue(), ^{
                if (success) {
                    RCTLogInfo(@"[AudioRecorderModule] File copy successful: %@", outputFilePath);
                    retainedResolver(@{@"success": @YES, @"outputPath": outputFilePath});
                } else {
                    RCTLogError(@"[AudioRecorderModule] File copy failed: %@", copyError.localizedDescription);
                    retainedRejecter(@"copy_failed", [NSString stringWithFormat:@"File copy failed: %@", copyError.localizedDescription], copyError);
                }
            });
        });
        return;
    }
    
    // For multiple segments, process on background queue
    dispatch_async(audioProcessingQueue, ^{
        AVMutableComposition *composition = [AVMutableComposition composition];
        AVMutableCompositionTrack *compositionAudioTrack = [composition addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
        CMTime cursor = kCMTimeZero;
        NSError *localError = nil;
        
        for (NSString *path in uniqueSegmentPaths) {
            NSURL *fileURL = [NSURL fileURLWithPath:path];
            AVURLAsset *asset = [AVURLAsset URLAssetWithURL:fileURL options:nil];
            NSArray<AVAssetTrack *> *tracks = [asset tracksWithMediaType:AVMediaTypeAudio];
            
            if (tracks.count == 0) {
                RCTLogWarn(@"[AudioRecorderModule] Segment at %@ has no audio tracks, skipping.", path);
                continue;
            }
            
            AVAssetTrack *clipAudioTrack = tracks[0];
            CMTimeRange timeRange = CMTimeRangeMake(kCMTimeZero, asset.duration);

            BOOL success = [compositionAudioTrack insertTimeRange:timeRange ofTrack:clipAudioTrack atTime:cursor error:&localError];
            if (!success || localError) {
                RCTLogError(@"[AudioRecorderModule] Failed to insert track from segment %@: %@", path, localError.localizedDescription);
                
                // Return to main queue to reject promise
                dispatch_async(dispatch_get_main_queue(), ^{
                    retainedRejecter(@"E_CONCAT_INSERT_FAILED", [NSString stringWithFormat:@"Failed to insert track from segment %@: %@", path, localError.localizedDescription ?: @"Unknown error"], localError);
                });
                return;
            }
            
            cursor = CMTimeAdd(cursor, asset.duration);
        }
        
        // Set up the session for the export
        AVAssetExportSession *exportSession = [[AVAssetExportSession alloc] initWithAsset:composition presetName:AVAssetExportPresetAppleM4A];
        
        if (!exportSession) {
            dispatch_async(dispatch_get_main_queue(), ^{
                retainedRejecter(@"session_error", @"Failed to create export session.", nil);
            });
            return;
        }
        
        exportSession.outputURL = [NSURL fileURLWithPath:outputFilePath];
        exportSession.outputFileType = AVFileTypeAppleM4A; // For .m4a files
        exportSession.shouldOptimizeForNetworkUse = YES;
        
        // Delete any existing file at the output path
        NSFileManager *fileManager = [NSFileManager defaultManager];
        if ([fileManager fileExistsAtPath:outputFilePath]) {
            NSError *removeError;
            if (![fileManager removeItemAtPath:outputFilePath error:&removeError]) {
                RCTLogError(@"[AudioRecorderModule] Failed to remove existing file at output path: %@", removeError.localizedDescription);
                dispatch_async(dispatch_get_main_queue(), ^{
                    retainedRejecter(@"file_error", [NSString stringWithFormat:@"Failed to remove existing file: %@", removeError.localizedDescription], removeError);
                });
                return;
            }
        }
        
        // Export the file asynchronously
        [exportSession exportAsynchronouslyWithCompletionHandler:^{
            dispatch_async(dispatch_get_main_queue(), ^{
                AVAssetExportSessionStatus status = exportSession.status;
                NSError *exportError = exportSession.error;
                
                switch (status) {
                    case AVAssetExportSessionStatusCompleted:
                        RCTLogInfo(@"[AudioRecorderModule] Concatenation successful. Output: %@", outputFilePath);
                        retainedResolver(@{@"success": @YES, @"outputPath": outputFilePath});
                        break;
                        
                    case AVAssetExportSessionStatusFailed:
                        RCTLogError(@"[AudioRecorderModule] Concatenation failed: %@", exportError.localizedDescription);
                        retainedRejecter(@"export_failed", [NSString stringWithFormat:@"Export failed: %@", exportError.localizedDescription ?: @"Unknown error"], exportError);
                        break;
                        
                    case AVAssetExportSessionStatusCancelled:
                        RCTLogWarn(@"[AudioRecorderModule] Concatenation cancelled.");
                        retainedRejecter(@"export_cancelled", @"Export was cancelled", nil);
                        break;
                        
                    default:
                        RCTLogWarn(@"[AudioRecorderModule] Unexpected export status: %ld", (long)status);
                        retainedRejecter(@"export_unknown", [NSString stringWithFormat:@"Export completed with unknown status: %ld", (long)status], nil);
                        break;
                }
            });
        }];
    });
}

#pragma mark - Playback Helpers

- (void)sendPlaybackProgressForPlayer:(NSNumber *)playerId currentTime:(CMTime)time duration:(CMTime)duration {
    if (!hasListeners) return;
    double currentSec = CMTimeGetSeconds(time);
    double totalSec = CMTimeGetSeconds(duration);
    dispatch_async(self.eventDispatchQueue, ^{
        [self sendEventWithName:@"onPlaybackProgress" body:@{
            @"playerId": playerId ?: @(0),
            @"currentTime": @(currentSec),
            @"duration": @(totalSec)
        }];
    });
}

#pragma mark - Seamless Playback API

RCT_EXPORT_METHOD(createPlaybackItem:(NSArray<NSString *> *)segmentPaths
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    if (segmentPaths.count == 0) {
        reject(@"no_segments", @"Segment paths array is empty", nil);
        return;
    }
    // Build composition
    AVMutableComposition *composition = [AVMutableComposition composition];
    CMTime cursor = kCMTimeZero;
    for (NSString *path in segmentPaths) {
        NSURL *url = [NSURL fileURLWithPath:path];
        AVURLAsset *asset = [AVURLAsset assetWithURL:url];
        if (!asset) continue;
        CMTimeRange range = CMTimeRangeMake(kCMTimeZero, asset.duration);
        NSError *err = nil;
        if (![composition insertTimeRange:range ofAsset:asset atTime:cursor error:&err]) {
            RCTLogError(@"[AudioRecorderModule] Failed to insert asset %@: %@", path, err);
        }
        cursor = CMTimeAdd(cursor, asset.duration);
    }
    AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:composition];
    AVPlayer *player = [AVPlayer playerWithPlayerItem:item];
    
    NSNumber *playerId = @(self.nextPlayerId++);
    self.playbackPlayers[playerId] = player;
    
    __weak typeof(self) weakSelf = self;
    // Progress observer every 0.2s
    id timeObs = [player addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(0.2, NSEC_PER_SEC)
                                                      queue:nil
                                                 usingBlock:^(CMTime time) {
        typeof(self) strongSelf = weakSelf;
        if (!strongSelf) return;
        [strongSelf sendPlaybackProgressForPlayer:playerId currentTime:time duration:item.duration];
    }];
    self.playbackTimeObservers[playerId] = timeObs;
    
    // Ended notification
    [[NSNotificationCenter defaultCenter] addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:item queue:nil usingBlock:^(NSNotification * _Nonnull note) {
        typeof(self) strongSelf = weakSelf;
        if (!strongSelf) return;
        if (hasListeners) {
            [strongSelf sendEventWithName:@"onPlaybackEnded" body:@{ @"playerId": playerId }];
        }
    }];
    
    resolve(playerId);
}

RCT_EXPORT_METHOD(play:(nonnull NSNumber *)playerId)
{
    AVPlayer *player = self.playbackPlayers[playerId];
    if (player) {
        [player play];
    }
}

RCT_EXPORT_METHOD(pause:(nonnull NSNumber *)playerId)
{
    AVPlayer *player = self.playbackPlayers[playerId];
    if (player) {
        [player pause];
    }
}

RCT_EXPORT_METHOD(seekTo:(nonnull NSNumber *)playerId time:(double)seconds)
{
    AVPlayer *player = self.playbackPlayers[playerId];
    if (player) {
        CMTime target = CMTimeMakeWithSeconds(seconds, NSEC_PER_SEC);
        [player seekToTime:target toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero];
    }
}

RCT_EXPORT_METHOD(destroyPlaybackItem:(nonnull NSNumber *)playerId)
{
    AVPlayer *player = self.playbackPlayers[playerId];
    if (!player) return;
    
    id observer = self.playbackTimeObservers[playerId];
    if (observer) {
        [player removeTimeObserver:observer];
        [self.playbackTimeObservers removeObjectForKey:playerId];
    }
    [player pause];
    [self.playbackPlayers removeObjectForKey:playerId];
    // Remove any end notification observers related to this item
    [[NSNotificationCenter defaultCenter] removeObserver:self name:AVPlayerItemDidPlayToEndTimeNotification object:player.currentItem];
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
    
    // Additional cleanup that might not be covered by resetRecordingState
    if (self.segmentTransitionBackgroundTaskID != UIBackgroundTaskInvalid) {
        RCTLogWarn(@"[AudioRecorderModule] Resetting state with an active segment transition background task. Ending task.");
        [[UIApplication sharedApplication] endBackgroundTask:self.segmentTransitionBackgroundTaskID];
        self.segmentTransitionBackgroundTaskID = UIBackgroundTaskInvalid;
    }
    [self unregisterAppLifecycleNotifications]; // Also unregister here as state is fully reset
}

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

#pragma mark - App-lifecycle notification helpers

- (void)registerAppLifecycleNotifications
{
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];

    [nc addObserver:self
           selector:@selector(handleAppDidEnterBackground:)
               name:UIApplicationDidEnterBackgroundNotification
             object:nil];

    [nc addObserver:self
           selector:@selector(handleAppWillEnterForeground:)
               name:UIApplicationWillEnterForegroundNotification
             object:nil];
}

- (void)unregisterAppLifecycleNotifications
{
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];

    [nc removeObserver:self
                  name:UIApplicationDidEnterBackgroundNotification
                object:nil];

    [nc removeObserver:self
                  name:UIApplicationWillEnterForegroundNotification
                object:nil];
}

#pragma mark - Helper Methods

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

- (void)configureSessionForPlayback
{
    RCTLogInfo(@"[AudioRecorderModule] Configuring audio session for playback.");
    NSError *error = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    
    // Deactivate first to allow category change
    if (![session setActive:NO error:&error]) {
        RCTLogWarn(@"[AudioRecorderModule] Failed to deactivate session for category change: %@", error.localizedDescription);
    }
    
    // Set category to Playback without any options
    if (![session setCategory:AVAudioSessionCategoryPlayback error:&error]) {
        RCTLogError(@"[AudioRecorderModule] Failed to set audio session category to Playback: %@", error.localizedDescription);
        return;
    }
    
    // Reactivate the session
    if (![session setActive:YES error:&error]) {
        RCTLogError(@"[AudioRecorderModule] Failed to activate audio session for playback: %@", error.localizedDescription);
    } else {
        RCTLogInfo(@"[AudioRecorderModule] Audio session successfully configured for playback.");
    }
}

#pragma mark - Export Composition

RCT_EXPORT_METHOD(exportCompositionToFile:(NSArray<NSString *> *)segmentPaths
                     outputPath:(NSString *)outputPath
                       resolver:(RCTPromiseResolveBlock)resolve
                       rejecter:(RCTPromiseRejectBlock)reject)
{
    if (segmentPaths.count == 0) {
        reject(@"no_segments", @"Segment paths array is empty", nil);
        return;
    }
    
    // Build composition (reuse helper from createPlaybackItem)
    AVMutableComposition *composition = [AVMutableComposition composition];
    CMTime insertTime = kCMTimeZero;
    for (NSString *path in segmentPaths) {
        NSURL *url = [NSURL fileURLWithPath:path];
        AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
        if (!asset) continue;
        CMTimeRange range = CMTimeRangeMake(kCMTimeZero, asset.duration);
        NSError *err = nil;
        AVMutableCompositionTrack *compTrack = [composition addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
        if (![compTrack insertTimeRange:range ofTrack:asset.tracks[0] atTime:insertTime error:&err]) {
            reject(@"insert_failed", err.localizedDescription ?: @"Failed to insert track", err);
            return;
        }
        insertTime = CMTimeAdd(insertTime, asset.duration);
    }
    
    // Prepare export session
    NSURL *outURL = [NSURL fileURLWithPath:outputPath];
    // Remove existing file if any
    [[NSFileManager defaultManager] removeItemAtURL:outURL error:nil];
    
    AVAssetExportSession *exportSession = [[AVAssetExportSession alloc] initWithAsset:composition presetName:AVAssetExportPresetAppleM4A];
    exportSession.outputURL = outURL;
    exportSession.outputFileType = AVFileTypeAppleM4A;
    
    UIApplication *app = [UIApplication sharedApplication];
    __block UIBackgroundTaskIdentifier bgTask = UIBackgroundTaskInvalid;
    bgTask = [app beginBackgroundTaskWithName:@"ExportComposition" expirationHandler:^{
        [exportSession cancelExport];
        [app endBackgroundTask:bgTask];
        bgTask = UIBackgroundTaskInvalid;
    }];
    
    [exportSession exportAsynchronouslyWithCompletionHandler:^{
        [app endBackgroundTask:bgTask];
        bgTask = UIBackgroundTaskInvalid;
        switch (exportSession.status) {
            case AVAssetExportSessionStatusCompleted:
                resolve(outputPath);
                break;
            case AVAssetExportSessionStatusFailed:
            case AVAssetExportSessionStatusCancelled:
            default:
                reject(@"export_failed", exportSession.error.localizedDescription ?: @"Export failed", exportSession.error);
                break;
        }
    }];
}

@end
