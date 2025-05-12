// ios/BackgroundTransferManager.m
#import "BackgroundTransferManager.h"
#import <React/RCTUtils.h>
// Import the automatically generated Swift header for your project
#import "ArcoScribeApp-Swift.h"

@implementation BackgroundTransferManager

// Explicitly synthesize properties with underscore prefixes
@synthesize session = _session;
@synthesize taskCallbacks = _taskCallbacks;
@synthesize taskData = _taskData;
// Note: We no longer need the backgroundSessionCompletionHandler property here,
// as the handler is managed by the Swift Singleton store.

RCT_EXPORT_MODULE();

// Utility method to ensure values are property list compatible
- (id)safePropertyListValue:(id)value {
    if (!value || [value isKindOfClass:[NSNull class]]) {
        return @""; // Convert nil or NSNull to empty string
    } else if ([value isKindOfClass:[NSString class]] || 
              [value isKindOfClass:[NSNumber class]] || 
              [value isKindOfClass:[NSDate class]]) {
        return value; // Already safe types
    } else if ([value isKindOfClass:[NSArray class]]) {
        NSMutableArray *safeArray = [NSMutableArray array];
        for (id item in (NSArray *)value) {
            [safeArray addObject:[self safePropertyListValue:item]];
        }
        return safeArray;
    } else if ([value isKindOfClass:[NSDictionary class]]) {
        NSMutableDictionary *safeDict = [NSMutableDictionary dictionary];
        [(NSDictionary *)value enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
            safeDict[key] = [self safePropertyListValue:obj];
        }];
        return safeDict;
    } else {
        // For any other object type, convert to string representation
        return [NSString stringWithFormat:@"%@", value];
    }
}

// Helper method to safely store and retrieve dictionaries in NSUserDefaults
- (void)safelyStoreActiveTasks:(NSDictionary *)taskDict forTaskId:(NSString *)taskId {
    @synchronized(self) {
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        NSMutableDictionary *activeTasks = [[defaults objectForKey:@"ArcoScribeActiveTasks"] mutableCopy] ?: [NSMutableDictionary dictionary];
        
        // Make sure the dictionary is property list compatible
        NSMutableDictionary *safePersistentInfo = [NSMutableDictionary dictionary];
        [taskDict enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
            safePersistentInfo[key] = [self safePropertyListValue:obj];
        }];
        
        [activeTasks setObject:safePersistentInfo forKey:taskId];
        
        // Validate the entire dictionary before storing
        BOOL isValid = [NSPropertyListSerialization propertyList:activeTasks 
                                             isValidForFormat:NSPropertyListBinaryFormat_v1_0];
        
        if (isValid) {
            [defaults setObject:activeTasks forKey:@"ArcoScribeActiveTasks"];
            [defaults synchronize];
            NSLog(@"[BackgroundTransferManager] Task %@ safely persisted.", taskId);
        } else {
            NSLog(@"[BackgroundTransferManager] Warning: Failed to validate active tasks dictionary. Storage skipped.");
            // Consider logging the problematic dictionary structure here for debugging
        }
    }
}

// New helper method to safely update the status of an existing task
- (void)safelyUpdateTaskStatus:(NSString *)status forTaskId:(NSString *)taskId {
    @synchronized(self) {
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        NSMutableDictionary *activeTasks = [[defaults objectForKey:@"ArcoScribeActiveTasks"] mutableCopy];

        if (activeTasks && activeTasks[taskId]) {
            NSMutableDictionary *taskInfo = [activeTasks[taskId] mutableCopy];
            if (taskInfo) {
                taskInfo[@"status"] = status ?: @"unknown"; // Update status, ensure it's safe

                // Make sure the updated dictionary is still property list compatible
                NSMutableDictionary *safeUpdatedInfo = [NSMutableDictionary dictionary];
                 [taskInfo enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
                     safeUpdatedInfo[key] = [self safePropertyListValue:obj];
                 }];

                activeTasks[taskId] = safeUpdatedInfo; // Put the updated safe dictionary back

                // Validate before saving
                BOOL isValid = [NSPropertyListSerialization propertyList:activeTasks
                                                     isValidForFormat:NSPropertyListBinaryFormat_v1_0];

                if (isValid) {
                    [defaults setObject:activeTasks forKey:@"ArcoScribeActiveTasks"];
                    [defaults synchronize];
                    NSLog(@"[BackgroundTransferManager] Updated status for task %@ to: %@", taskId, status);
                } else {
                    NSLog(@"[BackgroundTransferManager] Warning: Failed to validate active tasks dictionary during status update for task %@. Update skipped.", taskId);
                     // Consider logging the problematic dictionary structure
                }
            } else {
                 NSLog(@"[BackgroundTransferManager] Warning: Could not create mutable copy of task info for task %@ during status update.", taskId);
            }
        } else {
            NSLog(@"[BackgroundTransferManager] Warning: Task %@ not found in persistence for status update.", taskId);
        }
    }
}

// New helper method to safely remove a task from persistence
- (void)safelyRemoveTask:(NSString *)taskId {
    @synchronized(self) {
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        NSMutableDictionary *activeTasks = [[defaults objectForKey:@"ArcoScribeActiveTasks"] mutableCopy];

        if (activeTasks && activeTasks[taskId]) {
            [activeTasks removeObjectForKey:taskId];

            // Validate before saving
            BOOL isValid = [NSPropertyListSerialization propertyList:activeTasks
                                                 isValidForFormat:NSPropertyListBinaryFormat_v1_0];

            if (isValid) {
                [defaults setObject:activeTasks forKey:@"ArcoScribeActiveTasks"];
                [defaults synchronize];
                NSLog(@"[BackgroundTransferManager] Removed task %@ from persistence.", taskId);
            } else {
                NSLog(@"[BackgroundTransferManager] Warning: Failed to validate active tasks dictionary during task removal for task %@. Update skipped.", taskId);
                // Consider logging the problematic dictionary structure
            }
        } else {
            NSLog(@"[BackgroundTransferManager] Warning: Task %@ not found in persistence for removal.", taskId);
        }
    }
}

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onTransferComplete", @"onTransferProgress", @"onTransferError"];
}

// Static variable to hold the singleton instance of the manager itself
// Ensures the same instance handles session creation and delegate callbacks
static BackgroundTransferManager *sharedInstance = nil;

+ (instancetype)sharedInstance {
    return sharedInstance;
}

// Override allocWithZone to ensure singleton instantiation
+ (id)allocWithZone:(NSZone *)zone {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [super allocWithZone:zone];
    });
    return sharedInstance;
}

- (instancetype)init {
    // Check if instance already exists (due to singleton pattern)
    if (sharedInstance != nil && sharedInstance != self) {
       // If called again (e.g., by RN bridge), return existing instance
       return sharedInstance;
    }

    self = [super init];
    if (self) {
        _taskCallbacks = [NSMutableDictionary dictionary];
        _taskData = [NSMutableDictionary dictionary];

        // Ensure background identifier is unique
        NSString *backgroundIdentifier = [NSString stringWithFormat:@"%@.backgroundtransfer", [[NSBundle mainBundle] bundleIdentifier]];
        NSURLSessionConfiguration *config = [NSURLSessionConfiguration backgroundSessionConfigurationWithIdentifier:backgroundIdentifier];
        config.discretionary = NO; // Encourage more immediate background execution
        config.sessionSendsLaunchEvents = YES;

        // Create the session using the singleton instance as the delegate
        // Use nil for the delegate queue to let URLSession use its own background serial queue.
        // Delegate methods will then need to dispatch to main queue if interacting with UI/Bridge.
        _session = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];
        NSLog(@"[BackgroundTransferManager] Session initialized with identifier: %@", backgroundIdentifier);

        // No need to check for pending handler here anymore, it's handled in the Swift store
    }
     sharedInstance = self; // Assign to static variable
    return self;
}


RCT_EXPORT_METHOD(startUploadTask:(NSDictionary *)taskInfo
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {

  NSLog(@"[BackgroundTransferManager] NATIVE startUploadTask called (Actual Upload)!");

  NSString *taskId = [NSUUID UUID].UUIDString;
  NSString *filePath = taskInfo[@"filePath"];
  NSString *apiUrl = taskInfo[@"apiUrl"];
  NSDictionary *headers = taskInfo[@"headers"];
  NSString *taskType = taskInfo[@"taskType"];
  NSDictionary *metadata = taskInfo[@"metadata"];
  NSString *recordingId = metadata ? metadata[@"recordingId"] : nil;
  NSString *bodyString = taskInfo[@"body"]; // JSON string for form fields or OpenAI body

  NSLog(@"[BackgroundTransferManager] Starting task %@: Type=%@, RecID=%@, URL=%@", taskId, taskType, recordingId, apiUrl);

  // --- Persistence (Keep this) ---
  // Create a dictionary with safe values
  NSDictionary *persistentInfo = @{
      @"taskId": taskId,
      @"filePath": filePath ?: @"", 
      @"apiUrl": apiUrl ?: @"",    
      @"taskType": taskType ?: @"",  
      @"recordingId": recordingId ?: @"",
      @"status": @"pending"
  };
  
  // Use the new helper method to safely store the task info
  [self safelyStoreActiveTasks:persistentInfo forTaskId:taskId];

  // --- Request Setup ---
  NSURL *url = [NSURL URLWithString:apiUrl];
  if (!url) {
      NSLog(@"[BackgroundTransferManager] Invalid API URL string: %@", apiUrl);
      reject(@"invalid_api_url", @"Invalid API URL format", nil);
      return;
  }
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"POST";

  // Add headers
  for (NSString *key in headers) {
      // Skip Content-Type if we are building multipart form, as it needs the boundary
      if ([key isEqualToString:@"Content-Type"] && [headers[key] hasPrefix:@"multipart/form-data"]) {
          continue;
      }
      [request setValue:headers[key] forHTTPHeaderField:key];
  }

  NSURLSessionUploadTask *uploadTask;
  // Declare tempFilePathURL outside the specific blocks but initialize to nil
  NSURL *tempFilePathURL = nil; 

  @try {
      NSString *contentTypeHeader = headers[@"Content-Type"];
      BOOL isMultipart = (contentTypeHeader && [contentTypeHeader hasPrefix:@"multipart/form-data"]);
      NSData *requestBodyData = nil;

      if (isMultipart && filePath && bodyString) {
          // --- Multipart Form Data Upload (e.g., ElevenLabs) ---
          NSLog(@"[BackgroundTransferManager] Preparing MULTIPART upload for task %@", taskId);
          NSData *bodyData = [bodyString dataUsingEncoding:NSUTF8StringEncoding];
          NSError *jsonError;
          NSDictionary *formFields = [NSJSONSerialization JSONObjectWithData:bodyData options:0 error:&jsonError];

          if (jsonError) {
              NSLog(@"[BackgroundTransferManager] Error parsing JSON form data: %@", jsonError);
              reject(@"invalid_form_data", @"Could not parse form data JSON", jsonError);
              return;
          }

          NSString *boundary = [NSString stringWithFormat:@"Boundary-%@", [[NSUUID UUID] UUIDString]];
          [request setValue:[NSString stringWithFormat:@"multipart/form-data; boundary=%@", boundary] forHTTPHeaderField:@"Content-Type"];

          NSMutableData *multipartData = [NSMutableData data];
          NSLog(@"[BackgroundTransferManager] Creating multipart form with fields: %@", formFields);

          // Add form fields
          for (NSString *key in formFields) {
             // ... (Append form fields logic - same as before) ...
              [multipartData appendData:[[NSString stringWithFormat:@"--%@\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
              [multipartData appendData:[[NSString stringWithFormat:@"Content-Disposition: form-data; name=\"%@\"\r\n\r\n", key] dataUsingEncoding:NSUTF8StringEncoding]];
              id value = formFields[key];
              NSString *valueString;
               if ([value isKindOfClass:[NSString class]]) { valueString = value; }
               else if ([value isKindOfClass:[NSNumber class]]) { valueString = [value stringValue]; }
               else if ([value isKindOfClass:[NSNull class]]) { valueString = @""; }
               else { 
                  NSData *valueData = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
                  valueString = [[NSString alloc] initWithData:valueData encoding:NSUTF8StringEncoding];
               }
              [multipartData appendData:[[NSString stringWithFormat:@"%@\r\n", valueString ?: @""] dataUsingEncoding:NSUTF8StringEncoding]];
               NSLog(@"[BackgroundTransferManager] Added form field: %@ = %@", key, valueString ?: @"<nil>");
          }

          // Add file data (Must be last for ElevenLabs)
          if (![filePath hasPrefix:@"file://"]) {
             filePath = [NSString stringWithFormat:@"file://%@", filePath];
          }
          NSURL *fileURL = [NSURL URLWithString:filePath];
          if (fileURL && [fileURL isFileURL] && [[NSFileManager defaultManager] fileExistsAtPath:[fileURL path]]) {
              NSData *fileData = [NSData dataWithContentsOfURL:fileURL];
              NSString *filename = [fileURL lastPathComponent];
              NSLog(@"[BackgroundTransferManager] Adding file: %@ (%lu bytes)", filename, (unsigned long)fileData.length);
              
              [multipartData appendData:[[NSString stringWithFormat:@"--%@\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
              [multipartData appendData:[[NSString stringWithFormat:@"Content-Disposition: form-data; name=\"file\"; filename=\"%@\"\r\n", filename] dataUsingEncoding:NSUTF8StringEncoding]];
              
              NSString *fileContentType = @"audio/m4a"; // Default
              NSString *fileExtension = [[fileURL pathExtension] lowercaseString];
              if ([fileExtension isEqualToString:@"mp3"]) { fileContentType = @"audio/mpeg"; }
               else if ([fileExtension isEqualToString:@"wav"]) { fileContentType = @"audio/wav"; }
               else if ([fileExtension isEqualToString:@"ogg"]) { fileContentType = @"audio/ogg"; }
               else if ([fileExtension isEqualToString:@"flac"]) { fileContentType = @"audio/flac"; }
               // Add other supported types if necessary

              [multipartData appendData:[[NSString stringWithFormat:@"Content-Type: %@\r\n\r\n", fileContentType] dataUsingEncoding:NSUTF8StringEncoding]];
              [multipartData appendData:fileData];
              [multipartData appendData:[@"\r\n" dataUsingEncoding:NSUTF8StringEncoding]];
          } else {
              NSLog(@"[BackgroundTransferManager] Error: File not found or invalid URL for multipart: %@", filePath);
              reject(@"multipart_file_error", @"File not found or invalid for multipart upload", nil);
              return;
          }

          // Add closing boundary
          [multipartData appendData:[[NSString stringWithFormat:@"--%@--\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
          NSLog(@"[BackgroundTransferManager] Final multipart request size: %lu bytes", (unsigned long)multipartData.length);

          requestBodyData = multipartData; // Assign the final multipart data
          
      } else if (bodyString && !isMultipart) {
          // --- Standard Body Data Upload (e.g., OpenAI JSON) ---
           NSLog(@"[BackgroundTransferManager] Preparing JSON body upload for task %@", taskId);
          requestBodyData = [bodyString dataUsingEncoding:NSUTF8StringEncoding];
          if (![request valueForHTTPHeaderField:@"Content-Type"]) {
              NSLog(@"[BackgroundTransferManager] Warning: Content-Type not set, assuming application/json");
              [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
          }
          
      } else {
           NSLog(@"[BackgroundTransferManager] Invalid input combination for task %@.", taskId);
           reject(@"invalid_input", @"Invalid input for upload task.", nil);
           return;
      }

      // --- Save requestBodyData to Temporary File --- 
      if (!requestBodyData) {
          NSLog(@"[BackgroundTransferManager] Error: Request body data is nil for task %@", taskId);
          reject(@"body_creation_error", @"Failed to generate request body data.", nil);
          return;
      }

      NSString *tempDir = NSTemporaryDirectory();
      NSString *tempFileName = [NSString stringWithFormat:@"upload_body_%@.tmp", taskId];
      NSString *tempFilePath = [tempDir stringByAppendingPathComponent:tempFileName];
      tempFilePathURL = [NSURL fileURLWithPath:tempFilePath]; // Assign to the outer variable

      NSError *writeError = nil;
      BOOL success = [requestBodyData writeToURL:tempFilePathURL options:NSDataWritingAtomic error:&writeError];

      if (!success) {
          NSLog(@"[BackgroundTransferManager] Error saving request body to temporary file: %@", writeError);
          reject(@"temp_file_error", @"Failed to save request body to temporary file.", writeError);
          return;
      }
      NSLog(@"[BackgroundTransferManager] Saved request body for task %@ to temporary file: %@", taskId, tempFilePath);

      // --- Create Upload Task from Temporary File --- 
      uploadTask = [self.session uploadTaskWithRequest:request fromFile:tempFilePathURL];

      // --- Task Management (Common) ---
      if (!uploadTask) {
          NSLog(@"[BackgroundTransferManager] Failed to create upload task %@", taskId);
          reject(@"task_creation_failed", @"Could not create URLSessionUploadTask", nil);
          return;
      }

      uploadTask.taskDescription = taskId;

      // Store callback info, INCLUDING the temporary file path for cleanup
      if (taskType && recordingId && tempFilePathURL) {
          self.taskCallbacks[taskId] = @{
            @"taskType": taskType,
            @"recordingId": recordingId,
            @"tempFilePath": tempFilePathURL.path // Store path string
          };
      } else {
          NSLog(@"[BackgroundTransferManager] Warning: Missing data for callbacks/cleanup for task %@", taskId);
          self.taskCallbacks[taskId] = @{}; 
      }

      NSLog(@"[BackgroundTransferManager] Attempting to resume task: %@", taskId);
      [uploadTask resume];
      NSLog(@"[BackgroundTransferManager] Task %@ resumed.", taskId);

      resolve(taskId); // Resolve the promise once the task is successfully started

  } @catch (NSException *exception) {
      NSLog(@"[BackgroundTransferManager] Exception creating/starting task %@: %@", taskId, exception.reason);
      NSLog(@"[BackgroundTransferManager] Call stack: %@", exception.callStackSymbols);
      // Clean up temp file if created before exception
      if (tempFilePathURL && [[NSFileManager defaultManager] fileExistsAtPath:tempFilePathURL.path]) {
          [[NSFileManager defaultManager] removeItemAtURL:tempFilePathURL error:nil];
          NSLog(@"[BackgroundTransferManager] Cleaned up temporary file after exception for task %@", taskId);
      }
      reject(@"exception", exception.reason, nil);
  }
}

// --- NSURLSessionDelegate Methods ---

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)downloadTask didFinishDownloadingToURL:(NSURL *)location {
    NSString *taskId = downloadTask.taskDescription;
     if (!taskId) {
        NSLog(@"[BackgroundTransferManager] DOWNLOAD TEST: didFinishDownloadingToURL without taskId");
        return;
    }
    NSLog(@"[BackgroundTransferManager] DOWNLOAD TEST SUCCESS: Task %@ finished downloading to: %@", taskId, location);

    NSDictionary *callbackInfo = self.taskCallbacks[taskId];
    NSString *taskType = callbackInfo[@"taskType"] ?: @"download_test";
    NSString *recordingId = callbackInfo[@"recordingId"] ?: @"test_recording_id";
    
    // Create a safe response dictionary for React Native
    NSDictionary *safeResponseInfo = @{
        @"taskId": taskId,
        @"taskType": taskType,
        @"recordingId": recordingId,
        @"response": [NSString stringWithFormat:@"Downloaded to %@", location.path]
    };
    
    // Dispatch event emission to the main queue (as required by React Native)
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:@"onTransferComplete" body:safeResponseInfo];
    });
    
    [self.taskCallbacks removeObjectForKey:taskId];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    NSString *taskId = task.taskDescription;
    if (!taskId) {
        NSLog(@"[BackgroundTransferManager] didCompleteWithError called for task without description.");
        return;
    }

    NSDictionary *callbackInfo = self.taskCallbacks[taskId];
    NSString *taskType = callbackInfo[@"taskType"] ?: @"unknown";
    NSString *recordingId = callbackInfo[@"recordingId"] ?: @"unknown";
    NSString *tempFilePath = callbackInfo[@"tempFilePath"]; // Retrieve temp file path

    NSLog(@"[BackgroundTransferManager] Task %@ (%@) didCompleteWithError: %@", taskId, taskType, error ? error.localizedDescription : @"Success");

    // --- Cleanup Temporary File (runs on background thread) --- 
    if (tempFilePath && [[NSFileManager defaultManager] fileExistsAtPath:tempFilePath]) {
        NSError *removeError = nil;
        BOOL removed = [[NSFileManager defaultManager] removeItemAtPath:tempFilePath error:&removeError];
        if (removed) {
            NSLog(@"[BackgroundTransferManager] Successfully deleted temporary file for task %@: %@", taskId, tempFilePath);
        } else {
            NSLog(@"[BackgroundTransferManager] Error deleting temporary file for task %@: %@", taskId, removeError);
        }
    } else if (tempFilePath) {
         NSLog(@"[BackgroundTransferManager] Temporary file already deleted or path not found for task %@: %@", taskId, tempFilePath);
    } else {
         NSLog(@"[BackgroundTransferManager] No temporary file path found in callback info for task %@", taskId);
    }
    // --- End Cleanup ---

    if (error) {
        NSLog(@"[BackgroundTransferManager] Detailed error: %@", error);
        NSLog(@"[BackgroundTransferManager] Error domain: %@, code: %ld", error.domain, (long)error.code);
        NSLog(@"[BackgroundTransferManager] Error user info: %@", error.userInfo);

        // --- Persist Error Status ---
        [self safelyUpdateTaskStatus:@"error" forTaskId:taskId]; 
        // --- End Persist Error Status ---

        // Create a safe error dictionary for React Native
        NSDictionary *safeErrorInfo = @{
            @"taskId": taskId,
            @"taskType": taskType,
            @"recordingId": recordingId,
            @"error": error.localizedDescription ?: @"Unknown error"
        };
        
        // Dispatch event emission to the main queue
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventWithName:@"onTransferError" body:safeErrorInfo];
        });
        
        [self.taskCallbacks removeObjectForKey:taskId];
        [self.taskData removeObjectForKey:taskId];
        // Note: No return here, let URLSessionDidFinishEventsForBackgroundURLSession handle completion call
    } else {
         // If error is nil, it means success.
         // For downloads, success is handled in didFinishDownloadingToURL.
         // For uploads (when we re-enable them), handle success here based on response.
         if ([taskType isEqualToString:@"transcription"] || [taskType isEqualToString:@"summarization"]) {
             NSHTTPURLResponse *response = (NSHTTPURLResponse *)task.response;
             NSLog(@"[BackgroundTransferManager] Handling non-error completion for UPLOAD task %@", taskId);
             NSInteger statusCode = response ? response.statusCode : 0;
             NSData *responseData = self.taskData[taskId] ?: [NSData data];
             NSString *responseString = [[NSString alloc] initWithData:responseData encoding:NSUTF8StringEncoding] ?: @"";

             if (statusCode >= 200 && statusCode < 300) {
                 NSLog(@"[BackgroundTransferManager] Upload Task %@ completed successfully (Status %ld).", taskId, (long)statusCode);
                 
                 // --- Persist Complete Status ---
                 [self safelyUpdateTaskStatus:@"complete" forTaskId:taskId];
                 // --- End Persist Complete Status ---

                 // Create a safe dictionary for React Native
                 NSDictionary *safeResponseInfo = @{
                     @"taskId": taskId,
                     @"taskType": taskType,
                     @"recordingId": recordingId,
                     @"response": responseString
                 };
                 
                 dispatch_async(dispatch_get_main_queue(), ^{
                    [self sendEventWithName:@"onTransferComplete" body:safeResponseInfo];
                 });
             } else {
                NSLog(@"[BackgroundTransferManager] Upload Task %@ failed with HTTP Status %ld.", taskId, (long)statusCode);
                NSString *errorMessage = [NSString stringWithFormat:@"HTTP Error: %ld - %@", (long)statusCode, responseString];
                
                // --- Persist Error Status (HTTP Error) ---
                [self safelyUpdateTaskStatus:@"error" forTaskId:taskId];
                // --- End Persist Error Status ---

                // Create a safe error dictionary for React Native
                NSDictionary *safeErrorInfo = @{
                    @"taskId": taskId,
                    @"taskType": taskType,
                    @"recordingId": recordingId,
                    @"error": errorMessage
                };
                
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self sendEventWithName:@"onTransferError" body:safeErrorInfo];
                });
             }
             [self.taskData removeObjectForKey:taskId];
             [self.taskCallbacks removeObjectForKey:taskId];
         } else if (![taskType isEqualToString:@"download_test"]) {
              NSLog(@"[BackgroundTransferManager] Task %@ completed without error, unknown type: %@", taskId, taskType);
              [self.taskCallbacks removeObjectForKey:taskId];
              [self.taskData removeObjectForKey:taskId];
         }
         // Download success is handled elsewhere.
    }
}


- (void)URLSessionDidFinishEventsForBackgroundURLSession:(NSURLSession *)session {
    NSString *identifier = session.configuration.identifier;
    NSLog(@"[BackgroundTransferManager] URLSessionDidFinishEventsForBackgroundURLSession for session: %@", identifier);

    // Retrieve the completion handler stored by AppDelegate via the Swift Singleton Store
    // Use the correct Objective-C selector generated from the Swift method getAndRemoveHandler(for:)
    void (^completionHandler)(void) = [[BackgroundSessionHandlerStore shared] getAndRemoveHandlerFor:identifier];

    if (completionHandler) {
        NSLog(@"[BackgroundTransferManager] Calling background session completion handler retrieved from store.");
        completionHandler();
    } else {
        NSLog(@"[BackgroundTransferManager] No background session completion handler found in store for identifier: %@!", identifier);
    }
}

// --- Other Delegate Methods (Keep as they were) ---

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data {
    NSString *taskId = dataTask.taskDescription;
    if (!taskId) return;
    NSMutableData *currentData = self.taskData[taskId];
    if (!currentData) {
        currentData = [NSMutableData data];
        self.taskData[taskId] = currentData;
    }
    [currentData appendData:data];
    // NSLog(@"[BackgroundTransferManager] Received %lu bytes for task %@", (unsigned long)data.length, taskId); // Optional: Log data chunks
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didSendBodyData:(int64_t)bytesSent totalBytesSent:(int64_t)totalBytesSent totalBytesExpectedToSend:(int64_t)totalBytesExpectedToSend {
    NSString *taskId = task.taskDescription;
    if (!taskId) return;
    if (totalBytesExpectedToSend > 0 && (totalBytesSent % 50000 == 0 || totalBytesSent == totalBytesExpectedToSend)) {
        NSLog(@"[BackgroundTransferManager] Task %@ upload progress: %lld/%lld bytes (%.1f%%)",
              taskId, totalBytesSent, totalBytesExpectedToSend,
              ((float)totalBytesSent / totalBytesExpectedToSend * 100.0));
    }
}

// --- Required Bridge Methods ---

+ (BOOL)requiresMainQueueSetup {
    // Run init on main thread to ensure singleton setup before other calls
    return YES;
}

// Add this method to ensure events are sent on the main thread
- (dispatch_queue_t)methodQueue {
    return dispatch_get_main_queue();
}


// --- Methods Exported to JS (Keep as they were) ---

RCT_EXPORT_METHOD(getActiveTasks:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @synchronized(self) {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSDictionary *activeTasks = [defaults objectForKey:@"ArcoScribeActiveTasks"];
    
    if (!activeTasks) {
      resolve(@{});
      return;
    }
    
    // Verify the dictionary is valid before returning
    NSError *error = nil;
    NSData *plistData = [NSPropertyListSerialization dataWithPropertyList:activeTasks
                                                                   format:NSPropertyListBinaryFormat_v1_0
                                                                  options:0
                                                                    error:&error];
    
    if (error) {
      NSLog(@"[BackgroundTransferManager] Error validating activeTasks dictionary: %@", error);
      // If the dictionary is corrupted, return an empty dictionary and reset the storage
      [defaults setObject:@{} forKey:@"ArcoScribeActiveTasks"];
      [defaults synchronize];
      resolve(@{});
    } else {
      resolve(activeTasks);
    }
  }
}

RCT_EXPORT_METHOD(clearTask:(NSString *)taskId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSLog(@"[BackgroundTransferManager] Clearing task: %@", taskId);
  
  @synchronized(self) {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSMutableDictionary *activeTasks = [[defaults objectForKey:@"ArcoScribeActiveTasks"] mutableCopy];

    if (activeTasks && activeTasks[taskId]) {
      [activeTasks removeObjectForKey:taskId];
      
      // Validate the dictionary before saving
      BOOL isValid = [NSPropertyListSerialization propertyList:activeTasks 
                                          isValidForFormat:NSPropertyListBinaryFormat_v1_0];
      
      if (isValid) {
        [defaults setObject:activeTasks forKey:@"ArcoScribeActiveTasks"];
        [defaults synchronize]; // Ensure changes are saved immediately
        NSLog(@"[BackgroundTransferManager] Task %@ cleared from persistence.", taskId);
        resolve(@(YES)); // Indicate success
      } else {
        NSLog(@"[BackgroundTransferManager] Warning: activeTasks dictionary validation failed during clearTask.");
        // If validation fails, reset the entire storage
        [defaults setObject:@{} forKey:@"ArcoScribeActiveTasks"];
        [defaults synchronize];
        resolve(@(NO));
      }
    } else {
      NSLog(@"[BackgroundTransferManager] Task %@ not found in persistence for clearing.", taskId);
      resolve(@(NO)); // Indicate task was not found, but not necessarily an error
    }
  }
}

// Attempt to deserialize the data, handle corruption
static NSDictionary* safelyDeserializePlist(NSData* data, NSString* key) {
    if (!data) return nil;
    NSError *error = nil;
    id plist = [NSPropertyListSerialization propertyListWithData:data
                                                         options:NSPropertyListImmutable
                                                          format:NULL
                                                           error:&error];
    
    if (error || ![plist isKindOfClass:[NSDictionary class]]) {
        NSLog(@"[BackgroundTransferManager] Warning: Corrupted data detected for key '%@'. Discarding.", key);
        // Optionally remove the corrupted data from defaults
        // [[NSUserDefaults standardUserDefaults] removeObjectForKey:key];
        // [[NSUserDefaults standardUserDefaults] synchronize];
        return nil;
    }
    return (NSDictionary *)plist;
}

// Handle completed background tasks
- (void)handleTaskCompletion:(NSURLSessionTask *)task withError:(NSError *)error {
    NSString *taskId = task.taskDescription;
    if (!taskId) {
        NSLog(@"[BackgroundTransferManager] Task completed without a taskId.");
        return;
    }

    NSDictionary *callbackInfo = self.taskCallbacks[taskId];
    NSString *taskType = callbackInfo[@"taskType"] ?: @"unknown";
    NSString *recordingId = callbackInfo[@"recordingId"] ?: @"unknown";
    NSString *tempFilePath = callbackInfo[@"tempFilePath"]; // Path to the temporary file we created

    // Always clean up the temporary request body file
    if (tempFilePath && [[NSFileManager defaultManager] fileExistsAtPath:tempFilePath]) {
        NSError *removeError;
        [[NSFileManager defaultManager] removeItemAtPath:tempFilePath error:&removeError];
        if (removeError) {
             NSLog(@"[BackgroundTransferManager] Error removing temporary file %@: %@", tempFilePath, removeError);
        } else {
             NSLog(@"[BackgroundTransferManager] Cleaned up temporary file: %@", tempFilePath);
        }
    }

    // Clean up NSUserDefaults entry using the helper
    [self safelyRemoveTask:taskId];
    
    // Clean up local callback dictionaries
    @synchronized(self) {
        [self.taskCallbacks removeObjectForKey:taskId];
        [self.taskData removeObjectForKey:taskId];
    }

    if (error) {
        // Handle network or session errors
        NSLog(@"[BackgroundTransferManager] Task %@ (%@ for %@) failed: %@", taskId, taskType, recordingId, error);
        NSDictionary *errorBody = @{
            @"taskId": taskId,
            @"taskType": taskType,
            @"recordingId": recordingId,
            @"message": error.localizedDescription ?: @"Background task failed"
        };
        // Dispatch event emission to main queue
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventWithName:@"onTransferError" body:errorBody];
        });
    } else {
        // Handle HTTP errors and successful responses
        NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)task.response;
        NSInteger statusCode = httpResponse.statusCode;
        NSData *responseData = self.taskData[taskId];
        // Note: Don't remove responseData from self.taskData here yet, let cleanup handle it.
        
        NSString *responseString = [[NSString alloc] initWithData:responseData encoding:NSUTF8StringEncoding];
        NSLog(@"[BackgroundTransferManager] Task %@ completed with status code %ld", taskId, (long)statusCode);
        // Uncomment for full response logging:
        // NSLog(@"[BackgroundTransferManager] Task %@ response body: %@", taskId, responseString);

        if (statusCode >= 200 && statusCode < 300) {
            // Successful HTTP response
            NSLog(@"[BackgroundTransferManager] Task %@ (%@ for %@) completed successfully.", taskId, taskType, recordingId);
            NSDictionary *successBody = @{
                @"taskId": taskId,
                @"taskType": taskType,
                @"recordingId": recordingId,
                @"response": responseString ?: @""
            };
             // Dispatch event emission to main queue
            dispatch_async(dispatch_get_main_queue(), ^{
                [self sendEventWithName:@"onTransferComplete" body:successBody];
            });
        } else {
            // HTTP error (non-2xx status code)
            NSLog(@"[BackgroundTransferManager] Task %@ (%@ for %@) failed with HTTP status %ld", taskId, taskType, recordingId, (long)statusCode);
            NSDictionary *errorBody = @{
                @"taskId": taskId,
                @"taskType": taskType,
                @"recordingId": recordingId,
                @"message": [NSString stringWithFormat:@"HTTP Error: %ld", (long)statusCode],
                @"response": responseString ?: @""
            };
            // Dispatch event emission to main queue
            dispatch_async(dispatch_get_main_queue(), ^{
                [self sendEventWithName:@"onTransferError" body:errorBody];
            });
        }
    }
    
    // No need to call the completion handler here anymore, the Swift store manages it.
}

// Method to save application state to NSUserDefaults
- (void)saveApplicationState {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSMutableDictionary *appState = [NSMutableDictionary dictionary];
    // Example: Save the state of active tasks
    appState[@"activeTasks"] = self.taskCallbacks;
    // Add other state information as needed
//    NSData *plistData = [NSPropertyListSerialization dataWithPropertyList:appState options:NSPropertyListXMLFormat_v1_0 error:nil];
    [defaults setObject:appState forKey:@"AppStateData"];
    [defaults synchronize];
    NSLog(@"[BackgroundTransferManager] Application state saved.");
}

// Method to restore application state from NSUserDefaults
- (void)restoreApplicationState {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSDictionary *appState = [defaults objectForKey:@"AppStateData"];
    if (appState) {
        // Example: Restore active tasks state
        self.taskCallbacks = [appState[@"activeTasks"] mutableCopy];
        // Restore other state information as needed
        NSLog(@"[BackgroundTransferManager] Application state restored.");
    } else {
        NSLog(@"[BackgroundTransferManager] No saved application state found.");
    }
}

@end
