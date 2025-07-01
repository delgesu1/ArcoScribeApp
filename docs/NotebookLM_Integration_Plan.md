# NotebookLM Integration Implementation Plan

## Overview
Implementing bulletproof NotebookLM share detection with robust error handling, offline resilience, and App Store compliance based on comprehensive technical feedback.

## Implementation Phases

### Phase 1: Robust Share Detection ⏳
**Goal**: Bulletproof NotebookLM detection with proper error handling

#### 1.1 Enhanced ShareUtils.js Implementation
- [ ] Implement case-insensitive bundle ID matching: `bundleId.toLowerCase().includes('notebooklm')`
- [ ] Add proper share cancellation guards: `result.action === Share.sharedAction`
- [ ] Create transcript files with proper `.txt` extension for UTI compliance
- [ ] Add memory limit validation (100MB safety buffer under iOS 120MB limit)
- [ ] Implement debouncing to prevent duplicate share attempts

#### 1.2 File Type and Memory Management
- [ ] Ensure transcript files end in `.txt` for proper UTI recognition
- [ ] Validate file size before sharing (protect against extension memory limits)
- [ ] Clean up temporary files after sharing operations
- [ ] Handle large transcript scenarios gracefully

### Phase 2: Background-Safe Google Drive Operations ⏳
**Goal**: Handle iOS 30-second background execution limits and offline scenarios

#### 2.1 Queue-Based Drive Operations
- [ ] Create `DriveOperationQueue.js` service for persistent operation storage
- [ ] Store pending operations in AsyncStorage for app restart recovery
- [ ] Implement immediate execution if online and foreground
- [ ] Add exponential backoff retry logic for failed operations
- [ ] Use BGProcessingTask for background processing when available

#### 2.2 Resilient Drive Integration
- [ ] Add batch rename operations for transcript + summary files
- [ ] Implement `[NLM-YYYY-MM-DD]` prefix format with timestamps
- [ ] Update Google Drive appProperties with import metadata
- [ ] Add rollback capability for failed batch operations
- [ ] Queue operations when network unavailable

### Phase 3: Enhanced Data Models and Services ⏳
**Goal**: Track NotebookLM status with minimal privacy-compliant data

#### 3.1 Recording Model Updates
- [ ] Add NotebookLM fields to DataModels.js Recording class:
  ```javascript
  {
    notebookLMStatus: 'not_imported' | 'imported' | 'pending',
    notebookLMImportDate: string | null,
    importMethod: 'share_sheet' | 'manual',
    // Do NOT store bundle ID - unnecessary for functionality
  }
  ```

#### 3.2 AudioRecordingService Integration
- [ ] Add `markAsNotebookLMImported()` with immediate persistence
- [ ] Implement status validation and transition logic
- [ ] Add background queue processing on app launch
- [ ] Handle offline state updates

### Phase 4: UI/UX with Edge Case Handling ⏳
**Goal**: Smooth user experience with proper state management

#### 4.1 Recording Detail Screen Updates
- [ ] Add "Share Transcript to NotebookLM" button with loading states
- [ ] Implement debouncing to prevent duplicate operations
- [ ] Show NotebookLM import status with dates
- [ ] Add manual "Mark as Imported" fallback for desktop users
- [ ] Display Google Drive sync status for imported files

#### 4.2 Home Screen Integration
- [ ] Add NotebookLM badges for imported recordings
- [ ] Update status indicators to include import information
- [ ] Implement filter/sort options for NotebookLM status

### Phase 5: Privacy Compliance and App Store Readiness ⏳
**Goal**: Full App Store compliance with proper privacy declarations

#### 5.1 Privacy Implementation
- [ ] Prepare App Store Connect privacy questionnaire answers
- [ ] Classify bundle ID usage as "Product Interaction" data
- [ ] Implement data minimization (store only essential metadata)
- [ ] Document privacy practices for review

#### 5.2 iPad and Device Compatibility
- [ ] Handle iPad popover presentation with proper sourceView/sourceRect
- [ ] Ensure physical device testing for share extension detection
- [ ] Add graceful degradation for unsupported scenarios

## Key Technical Implementation Examples

### Share Detection Core
```javascript
export const shareTranscriptToNotebookLM = async (recording) => {
  const transcriptPath = await createTranscriptFile(recording, '.txt');
  
  const result = await Share.share({
    url: `file://${transcriptPath}`,
    type: 'text/plain'
  });
  
  // Robust detection with safeguards
  if (result.action === Share.sharedAction && result.activityType) {
    const bundleId = result.activityType.toLowerCase();
    if (bundleId.includes('notebooklm')) {
      await handleNotebookLMShare(recording.id);
    }
  }
}
```

### Background-Safe Operations
```javascript
async handleNotebookLMShare(recordingId) {
  // Immediate local update
  await markAsNotebookLMImported(recordingId, 'share_sheet');
  
  // Queue Drive operations for background processing
  await queueDriveOperation({
    type: 'rename_for_notebooklm',
    recordingId,
    timestamp: Date.now()
  });
}
```

### Queue-Based Drive Operations
```javascript
class DriveOperationQueue {
  async queueOperation(operation) {
    // Store in AsyncStorage for persistence
    // Process immediately if online and foreground
    // Otherwise defer to next launch or background task
  }
  
  async processPendingOperations() {
    // Called on app launch and network restoration
    // Uses BGProcessingTask if available
    // Implements exponential backoff for failures
  }
}
```

## Testing Strategy

### Required Testing Scenarios
- [ ] **Physical Device Testing**: NotebookLM extension detection and bundle ID capture
- [ ] **Offline Scenarios**: Drive operation queuing and retry mechanisms
- [ ] **Memory Limits**: Large transcript handling and size validation
- [ ] **iPad Compatibility**: Popover presentation and source rect handling
- [ ] **Share Cancellation**: User dismissal and false positive prevention
- [ ] **Background Limits**: 30-second execution window compliance
- [ ] **Privacy Audit**: Data collection and storage validation

### Debug/Development Testing
- [ ] Print bundle ID in debug builds to confirm NotebookLM identifier
- [ ] Test with airplane mode to verify offline queue behavior
- [ ] Test large transcripts (approaching 100MB limit)
- [ ] Test rapid share button tapping (debouncing)
- [ ] Test app backgrounding during Drive operations

## Technical Requirements

### iOS Considerations
- **Bundle ID Detection**: Case-insensitive matching for `notebooklm`
- **Memory Limits**: iOS share extensions limited to ~120MB
- **Background Execution**: 30-second window after app backgrounds
- **UTI Compliance**: Files must have proper extensions for app recognition

### Privacy Compliance
- **App Store Classification**: Bundle ID usage = "Product Interaction" data
- **Data Minimization**: Store only essential metadata, not full bundle IDs
- **User Transparency**: Clear indication of NotebookLM integration status

### File Management
- **File Naming**: `{title}_transcript.txt` format for UTI recognition
- **Cleanup**: Remove temporary files after sharing
- **Size Validation**: Check transcript size before share attempt

## Benefits

- **Production-Ready**: Handles all iOS constraints and edge cases
- **Privacy Compliant**: Minimal data collection with proper declarations
- **Offline Resilient**: Queue-based operations survive network issues
- **Memory Safe**: Proper file size validation and cleanup
- **Future-Proof**: Robust bundle ID matching survives app updates
- **User-Friendly**: Seamless mobile workflow with desktop fallback

## Implementation Notes

### Phase Dependencies
- Phase 1 must complete before Phase 4 (UI depends on share functionality)
- Phase 2 can be developed in parallel with Phase 1
- Phase 3 (data models) should be completed early to support all other phases
- Phase 5 (privacy) should be addressed throughout development

### Development Priority
1. **High Priority**: Phase 1 (core functionality) and Phase 3 (data models)
2. **Medium Priority**: Phase 2 (background operations) and Phase 4 (UI)
3. **Low Priority**: Phase 5 (compliance) - important but can be finalized later

### Success Criteria
- User can share transcript to NotebookLM via iOS share sheet
- App automatically detects NotebookLM selection and updates status
- Google Drive files are automatically renamed with [NLM] prefix
- All operations work offline with proper queuing
- App Store submission passes privacy review