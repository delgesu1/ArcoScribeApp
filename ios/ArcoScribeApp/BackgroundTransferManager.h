#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <Foundation/Foundation.h>

@interface BackgroundTransferManager : RCTEventEmitter <RCTBridgeModule, NSURLSessionTaskDelegate, NSURLSessionDownloadDelegate>

// Add the declaration for the clearTask method
RCT_EXTERN_METHOD(clearTask:(NSString *)taskId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject);

@end 