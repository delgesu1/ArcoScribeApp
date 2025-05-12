#import "AudioRecorderModule.h"
#import <React/RCTUtils.h>
#import <React/RCTLog.h>

// Define Notification Names
NSNotificationName const AudioRecordingDidStartNotification = @"AudioRecordingDidStartNotification";
NSNotificationName const AudioRecordingDidStopNotification = @"AudioRecordingDidStopNotification";

@implementation AudioRecorderModule
{
    bool hasListeners;
    NSString *activeRecordingSegmentPath;
    NSUInteger currentSegmentNumber;
    NSTimeInterval durationAtSegmentStart;
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
        _maxSegmentDuration = 15 * 60; // Default to 15 minutes per segment (can be changed via API)
        
        // Add observers for audio session interruptions and route changes
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleAudioSessionInterruption:)
                                                     name:AVAudioSessionInterruptionNotification
                                                   object:nil];
        
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleAudioRouteChange:)
                                                     name:AVAudioSessionRouteChangeNotification
                                                   object:nil];
        
        // Register for background notifications to ensure our task continues
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleAppDidEnterBackground:)
                                                     name:UIApplicationDidEnterBackgroundNotification
                                                   object:nil];
        
        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleAppWillEnterForeground:)
                                                     name:UIApplicationWillEnterForegroundNotification
                                                   object:nil];
        
        RCTLogInfo(@"[AudioRecorderModule] Initialized");
    }
    return self;
}

- (void)dealloc
{
    [self stopRecordingTimer];
    [[NSNotificationCenter defaultCenter] removeObserver:self];
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
        RCTLogInfo(@"[AudioRecorderModule] updateRecordingProgress: hasListeners = %s", hasListeners ? "YES" : "NO");
        if (hasListeners) {
            // Calculate current duration correctly accounting for pauses
            // *** SIMPLIFIED TIME CALCULATION FOR DEBUGGING ***
            // Use only the start time and pause duration
            NSTimeInterval timeSinceStart = [[NSDate date] timeIntervalSinceDate:self.recordingStartTime];
            NSTimeInterval currentTime = timeSinceStart - self.totalPauseDuration;
            currentTime = MAX(0, currentTime); // Ensure time doesn't go negative
            
            // Keep track of total duration
            self.currentRecordingDuration = currentTime;
            RCTLogInfo(@"[AudioRecorderModule] Calculated currentTime: %f", currentTime);

            // Calculate time elapsed in the current segment
            NSTimeInterval timeInCurrentSegment = currentTime - self.durationAtSegmentStart;
            RCTLogInfo(@"[AudioRecorderModule] Calculated timeInCurrentSegment: %f", timeInCurrentSegment);
            
            // Send progress event to JS
            dispatch_async(dispatch_get_main_queue(), ^{
                // Explicitly capture self to silence the warning
                AudioRecorderModule *strongSelf = self;
                if (!strongSelf) {
                    return;
                }
                RCTLogInfo(@"[AudioRecorderModule] Sending onRecordingProgress event with time: %f", currentTime);
                [strongSelf sendEventWithName:@"onRecordingProgress" body:@{
                    @"currentTime": @(currentTime),
                    @"metering": @([strongSelf.audioRecorder averagePowerForChannel:0]),
                    @"recordingId": strongSelf.currentRecordingId ?: @"",
                    @"segmentNumber": @(strongSelf->currentSegmentNumber)
                }];
            });
            
            // Check if we need to start a new segment based on time in THIS segment
            if (self.maxSegmentDuration > 0 && timeInCurrentSegment >= self.maxSegmentDuration) { 
                RCTLogInfo(@"[AudioRecorderModule] Segment duration reached (%f >= %f). Starting new segment.", timeInCurrentSegment, self.maxSegmentDuration);
                [self startNewRecordingSegment];
            }
        }
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
    if (hasListeners) {
        dispatch_async(dispatch_get_main_queue(), ^{
            // Explicitly capture self
            AudioRecorderModule *strongSelf = self;
            if (!strongSelf) {
                return;
            }
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
    NSString *recordingsDir = [self getRecordingsDirectory];
    NSString *fileName;
    
    if (segmentNumber > 0) {
        fileName = [NSString stringWithFormat:@"recording_%@_segment_%ld.m4a", recordingId, (long)segmentNumber];
    } else {
        fileName = [NSString stringWithFormat:@"recording_%@.m4a", recordingId];
    }
    
    return [recordingsDir stringByAppendingPathComponent:fileName];
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

- (void)startNewRecordingSegment
{
    RCTLogInfo(@"[AudioRecorderModule] Starting new recording segment");
    
    // Make sure we're actually recording
    if (!self.audioRecorder || !self.currentRecordingId) {
        [self emitError:@"Cannot start new segment: not recording"];
        return;
    }

    // Store the total duration before this segment starts
    self.durationAtSegmentStart = self.currentRecordingDuration;
    RCTLogInfo(@"[AudioRecorderModule] Setting durationAtSegmentStart to: %f", self.durationAtSegmentStart);
    
    // Get the previous segment path
    NSString *previousSegmentPath = self.currentRecordingFilePath;
    NSUInteger previousSegmentNumber = currentSegmentNumber;
    
    // Stop the current recorder - this will finalize the segment
    [self.audioRecorder stop];
    
    // Increment segment number
    currentSegmentNumber++;
    
    // Create a new path for the next segment
    NSString *newSegmentPath = [self getFilepathForRecordingId:self.currentRecordingId 
                                                 segmentNumber:currentSegmentNumber];
    
    // Add the completed segment to our list
    if (previousSegmentPath) {
        [self.recordingSegments addObject:previousSegmentPath];
        
        // Notify JS that a segment is complete
        if (hasListeners) {
            dispatch_async(dispatch_get_main_queue(), ^{
                // Explicitly capture self
                AudioRecorderModule *strongSelf = self;
                if (!strongSelf) {
                    return;
                }
                [strongSelf sendEventWithName:@"onRecordingSegmentComplete" body:@{
                    @"recordingId": strongSelf.currentRecordingId,
                    @"segmentPath": previousSegmentPath,
                    @"segmentNumber": @(previousSegmentNumber),
                    @"duration": @(strongSelf.currentRecordingDuration)
                }];
            });
        }
    }
    
    // Start a new recording to the new file path
    NSError *error;
    NSURL *url = [NSURL fileURLWithPath:newSegmentPath];
    NSDictionary *settings = [self getAudioRecordingSettings];
    
    self.audioRecorder = [[AVAudioRecorder alloc] initWithURL:url settings:settings error:&error];
    
    if (error) {
        RCTLogError(@"[AudioRecorderModule] Error creating new segment recorder: %@", error);
        [self emitError:[NSString stringWithFormat:@"Failed to create new segment: %@", error.localizedDescription]];
        return;
    }
    
    self.audioRecorder.delegate = self;
    [self.audioRecorder setMeteringEnabled:YES];
    
    // Start the new recording
    if (![self.audioRecorder record]) {
        // CRITICAL FAILURE: Failed to start the next segment.
        RCTLogError(@"[AudioRecorderModule] *** CRITICAL FAILURE: Failed to start recording new segment (%lu) at path: %@ ***", (unsigned long)self->currentSegmentNumber, newSegmentPath);

        // Check record permission just in case
        AVAudioSessionRecordPermission permission = [[AVAudioSession sharedInstance] recordPermission];
        RCTLogWarn(@"[AudioRecorderModule] Record permission status during failure: %ld (Granted=%ld)", (long)permission, (long)AVAudioSessionRecordPermissionGranted);

        // Stop the progress timer immediately
        [self stopRecordingTimer];

        // Emit a critical error
        [self emitError:@"Critical Error: Failed to start new recording segment. Recording stopped."];
        
        // --- ADDED: Post stop notification before attempting cleanup ---
        RCTLogInfo(@"[AudioRecorderModule] Posting stop notification due to critical segment start failure.");
        RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: PREPARING TO POST Stop Notification (Segment Fail) <<<");
        [[NSNotificationCenter defaultCenter] postNotificationName:AudioRecordingDidStopNotification object:nil];
        RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: FINISHED POSTING Stop Notification (Segment Fail) <<<");
        // -------------------------------------------------------------

        // Clean up the FAILED recorder instance FIRST
        self.audioRecorder = nil;
        // Revert path and segment number to the last known GOOD state
        self.currentRecordingFilePath = previousSegmentPath;
        self->currentSegmentNumber--; 
        
        // Now, attempt to stop the recording cleanly based on the previous successful state
        RCTLogInfo(@"[AudioRecorderModule] Attempting to stop recording cleanly after segment failure...");
        NSDictionary *stopResult = [self stopRecordingInternal]; 
        RCTLogInfo(@"[AudioRecorderModule] Result of automatic stop after segment failure: %@", stopResult);
        // The stopRecordingInternal method already handles emitting the onRecordingFinished event

        return; // Stop further processing in this method
    }
    
    // Update the current file path (Only if record succeeded)
    self.currentRecordingFilePath = newSegmentPath;
    
    RCTLogInfo(@"[AudioRecorderModule] Started new recording segment: %@", newSegmentPath);
}

#pragma mark - Notification Handlers

- (void)handleAudioSessionInterruption:(NSNotification *)notification
{
    NSInteger type = [notification.userInfo[AVAudioSessionInterruptionTypeKey] integerValue];
    
    if (type == AVAudioSessionInterruptionTypeBegan) {
        // Interruption began (e.g., phone call)
        RCTLogInfo(@"[AudioRecorderModule] Audio session interrupted");
        
        if (self.audioRecorder && !self.isPaused) {
            // Auto-pause recording
            [self pauseRecordingInternal];
        }
    } else if (type == AVAudioSessionInterruptionTypeEnded) {
        // Interruption ended
        RCTLogInfo(@"[AudioRecorderModule] Audio session interruption ended");
        
        // Check if we should resume
        NSInteger options = [notification.userInfo[AVAudioSessionInterruptionOptionKey] integerValue];
        BOOL shouldResume = (options & AVAudioSessionInterruptionOptionShouldResume) != 0;
        
        if (shouldResume && self.audioRecorder && self.isPaused) {
            // Auto-resume recording if the system indicates it should
            [self resumeRecordingInternal];
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

- (void)handleAppDidEnterBackground:(NSNotification *)notification
{
    RCTLogInfo(@"[AudioRecorderModule] App entered background");
    
    // Ensure our AVAudioSession stays active
    if (self.audioRecorder && !self.isPaused) {
        NSError *error = nil;
        BOOL success = [[AVAudioSession sharedInstance] setActive:YES error:&error];
        if (!success) {
            RCTLogError(@"[AudioRecorderModule] Failed to keep audio session active in background: %@", error);
        }
    }
}

- (void)handleAppWillEnterForeground:(NSNotification *)notification
{
    RCTLogInfo(@"[AudioRecorderModule] App will enter foreground");
    
    // Make sure our audio session is properly configured
    if (self.audioRecorder) {
        [self setupAudioSession];
    }
}

#pragma mark - AVAudioRecorderDelegate

- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)flag
{
    RCTLogInfo(@"[AudioRecorderModule] Audio recorder finished: success=%d", flag);
    
    if (!flag) {
        [self emitError:@"Recording failed to complete successfully"];
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
    
    // Start recording
    if (![self.audioRecorder record]) {
        RCTLogError(@"[AudioRecorderModule] *** FAILED to start recording (audioRecorder.record returned NO) ***");
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
    self.durationAtSegmentStart = 0; // Initialize for the first segment
    currentSegmentNumber = 1;
    
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
    
    // Stop the recorder
    [self.audioRecorder stop];
    
    // Stop the timer
    [self stopRecordingTimer];
    
    // --- ADDED: Post Stop Notification ---
    RCTLogInfo(@"[AudioRecorderModule] Posting AudioRecordingDidStopNotification");
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: PREPARING TO POST Stop Notification <<<");
    [[NSNotificationCenter defaultCenter] postNotificationName:AudioRecordingDidStopNotification object:nil];
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: FINISHED POSTING Stop Notification <<<");
    // ------------------------------------
    
    // Collect recording data
    NSString *filePath = self.currentRecordingFilePath;
    NSString *recordingId = self.currentRecordingId;
    NSTimeInterval duration = self.currentRecordingDuration;
    
    // Collect all segment paths
    NSMutableArray *segmentPaths = [NSMutableArray arrayWithArray:self.recordingSegments];
    // Add the final segment if it exists and isn't already in the array
    if (filePath && ![segmentPaths containsObject:filePath]) {
        [segmentPaths addObject:filePath];
    }
    
    // Deactivate audio session (turn off microphone)
    NSError *error;
    [[AVAudioSession sharedInstance] setActive:NO
                                   withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                         error:&error];
    if (error) {
        RCTLogError(@"[AudioRecorderModule] Error deactivating audio session: %@", error);
    }
    
    // Reset state
    self.audioRecorder = nil;
    self.currentRecordingFilePath = nil;
    self.currentRecordingId = nil;
    self.isPaused = NO;
    
    RCTLogInfo(@"[AudioRecorderModule] Recording stopped. Duration: %f, Segments: %lu", 
               duration, (unsigned long)segmentPaths.count);
    
    // Return recording details
    return @{
        @"success": @YES,
        @"recordingId": recordingId ?: @"",
        @"filePath": filePath ?: @"",
        @"duration": @(duration),
        @"segmentPaths": segmentPaths ?: @[]
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

RCT_EXPORT_METHOD(startRecording:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] >>> RCTLog: EXPORTED METHOD startRecording entered <<< ");
    // Generate a unique recording ID if not provided
    NSString *recordingId = options[@"recordingId"];
    if (!recordingId) {
        recordingId = [self generateUniqueRecordingId];
    }
    
    // Get the recording directory
    NSString *recordingsDir = [self getRecordingsDirectory];
    
    // Create a file path for this recording
    NSString *filePath = [self getFilepathForRecordingId:recordingId segmentNumber:1];
    
    RCTLogInfo(@"[AudioRecorderModule] Starting recording with ID: %@, path: %@", recordingId, filePath);
    
    // Start recording
    if ([self startRecordingInternal:filePath recordingId:recordingId]) {
        resolve(@{
            @"recordingId": recordingId,
            @"filePath": filePath
        });
    } else {
        RCTLogError(@"[AudioRecorderModule] startRecording: startRecordingInternal returned NO. Rejecting promise.");
        reject(@"recording_error", @"Failed to start recording (Internal error)", nil);
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
            dispatch_async(dispatch_get_main_queue(), ^{
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
    RCTLogInfo(@"[AudioRecorderModule] Pausing recording");
    
    if (!self.audioRecorder) {
        reject(@"recording_error", @"Not recording", nil);
        return;
    }
    
    if (self.isPaused) {
        resolve(@{@"status": @"already_paused"});
        return;
    }
    
    [self pauseRecordingInternal];
    resolve(@{@"status": @"paused"});
}

RCT_EXPORT_METHOD(resumeRecording:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    RCTLogInfo(@"[AudioRecorderModule] Resuming recording");
    
    if (!self.audioRecorder) {
        reject(@"recording_error", @"Not recording", nil);
        return;
    }
    
    if (!self.isPaused) {
        resolve(@{@"status": @"already_recording"});
        return;
    }
    
    if ([self resumeRecordingInternal]) {
        resolve(@{@"status": @"recording"});
    } else {
        reject(@"recording_error", @"Failed to resume recording", nil);
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

@end
