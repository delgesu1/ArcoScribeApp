// ios/BackgroundTransferManager.h
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface BackgroundTransferManager : RCTEventEmitter <RCTBridgeModule, NSURLSessionDelegate, NSURLSessionTaskDelegate, NSURLSessionDataDelegate, NSURLSessionDownloadDelegate>
@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, strong) NSMutableDictionary *taskCallbacks;
@property (nonatomic, strong) NSMutableDictionary *taskData;
@property (nonatomic, copy) void (^backgroundSessionCompletionHandler)(void);

// Declare the missing helper method
- (void)safelyRemoveTask:(NSString *)taskId;

@end
