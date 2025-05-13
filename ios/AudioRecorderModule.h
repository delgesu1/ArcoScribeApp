#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h> // For UIBackgroundTaskIdentifier

// Define SegmentStopReason enum
typedef NS_ENUM(NSUInteger, SegmentStopReason) {
    SegmentStopReasonNone,      // Initial state or after successful processing
    SegmentStopReasonTimed,     // Segment stopped because its duration was reached
    SegmentStopReasonManual,    // Segment stopped due to a manual call to stopRecording
    SegmentStopReasonFailed,    // Segment stopped due to an error during recording
    SegmentStopReasonInterrupted, // Segment stopped due to an audio session interruption
    SegmentStopReasonRouteChange, // Segment stopped due to an audio route change
    SegmentStopReasonApiStop 
};

// Enum to represent the origin of a pause action
typedef NS_ENUM(NSUInteger, PauseOrigin) {
    PauseOriginNone,      // Not paused, or recording has not started
    PauseOriginUser,      // Paused by user action
    PauseOriginBackground, // Paused automatically due to app backgrounding
    PauseOriginInterruption // Paused automatically due to audio session interruption
};

// Notification name
extern NSString * const AudioRecordingDidStopNotification;

@interface AudioRecorderModule : RCTEventEmitter <RCTBridgeModule, AVAudioRecorderDelegate>

@property (nonatomic, strong, readonly) AVAudioRecorder *audioRecorder;
@property (nonatomic, strong) NSTimer *recordingTimer; // Should remain for progress updates
@property (nonatomic, assign, readonly) NSTimeInterval currentRecordingDuration;
@property (nonatomic, strong, readonly) NSString *currentRecordingFilePath;
@property (nonatomic, strong, readonly) NSString *currentRecordingId;
@property (nonatomic, assign, readonly) BOOL isPaused;
@property (nonatomic, strong) NSDate *recordingStartTime;
@property (nonatomic, strong) NSDate *pauseStartTime;
@property (nonatomic, assign) NSTimeInterval totalPauseDuration;
@property (nonatomic, strong, readonly) NSMutableArray *recordingSegments;
@property (nonatomic, assign, readwrite) NSTimeInterval maxSegmentDuration; // Redeclare as readwrite
@property (nonatomic, assign) BOOL isRecording;
@property (nonatomic, assign) CFTimeInterval durationAtSegmentStart;
@property (nonatomic, assign) NSTimeInterval durationOfSegmentBeforeStop;

// Promise storage properties for deferred stop recording
// Promise resolution now happens immediately in stopRecording - no pending resolvers needed

// Property to track segment duration captured before stopping

@property (nonatomic, assign, readonly) NSTimeInterval totalDurationOfCompletedSegmentsSoFar;
@property (nonatomic, assign, readonly) SegmentStopReason currentStopReason;
@property (nonatomic, assign, readonly) UIBackgroundTaskIdentifier segmentTransitionBackgroundTaskID;
@property (nonatomic, strong, readonly) dispatch_queue_t eventDispatchQueue;
@property (nonatomic, assign, readonly) PauseOrigin currentPauseOrigin;

// Method to emit errors to JavaScript
- (void)emitError:(NSString *)errorMessage;

// Add the new method definition
- (void)concatenateSegments:(NSArray<NSString *> *)segmentPaths
                 outputPath:(NSString *)outputPath
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject;

@end
