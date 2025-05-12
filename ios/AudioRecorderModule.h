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
    SegmentStopReasonInterrupted // Segment stopped due to an audio session interruption
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

@property (nonatomic, strong) AVAudioRecorder *audioRecorder;
@property (nonatomic, strong) NSTimer *recordingTimer; // Should remain for progress updates
@property (nonatomic, assign) NSTimeInterval currentRecordingDuration;
@property (nonatomic, strong) NSString *currentRecordingFilePath;
@property (nonatomic, strong) NSString *currentRecordingId;
@property (nonatomic, assign) BOOL isPaused;
@property (nonatomic, strong) NSDate *recordingStartTime;
@property (nonatomic, strong) NSDate *pauseStartTime;
@property (nonatomic, assign) NSTimeInterval totalPauseDuration;
@property (nonatomic, strong) NSMutableArray *recordingSegments;
@property (nonatomic, assign) NSTimeInterval maxSegmentDuration;
@property (nonatomic, assign) NSTimeInterval durationAtSegmentStart;
@property (nonatomic, assign) NSTimeInterval totalDurationOfCompletedSegmentsSoFar;
@property (nonatomic, assign) SegmentStopReason currentStopReason;
@property (nonatomic, assign) UIBackgroundTaskIdentifier segmentTransitionBackgroundTaskID;
@property (nonatomic, strong) dispatch_queue_t eventDispatchQueue;
@property (nonatomic, assign) PauseOrigin currentPauseOrigin;

// Method to emit errors to JavaScript
- (void)emitError:(NSString *)errorMessage;

@end
