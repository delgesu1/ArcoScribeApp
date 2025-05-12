#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

@interface AudioRecorderModule : RCTEventEmitter <RCTBridgeModule, AVAudioRecorderDelegate>

@property (nonatomic, strong) AVAudioRecorder *audioRecorder;
@property (nonatomic, strong) NSTimer *recordingTimer;
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

@end
