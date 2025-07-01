#!/usr/bin/env node

/**
 * PDF Heading Style Test Runner
 * 
 * This script allows you to quickly test the PDF styling without going through
 * the full app recording/transcription/summarization process.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const enhancedShareUtils = require('./shareUtils-enhanced');

// Mock markdown summary with different heading levels - same as in test.html
const mockMarkdownSummary = `
# Bach Partita No. 3 - Technical Analysis

This lesson focused on the Bach Partita No. 3, with particular attention to bow technique and articulation.

## Bow Distribution

The teacher emphasized maintaining consistent bow speed throughout each phrase. The following points were highlighted:

- Use less bow at the beginning of phrases
- Gradually increase bow speed toward the middle
- Ease off at phrase endings for natural tapering

### Wrist Flexibility

The right wrist should remain flexible during string crossings. This helps to:
1. Maintain smooth articulation
2. Avoid accidental string hits
3. Create cleaner transitions between notes

## Left Hand Positioning

### Finger Placement

For the passages in the middle section:
- Keep fingers curved and close to the fingerboard
- Prepare fingers in advance for faster passages
- Maintain consistent pressure on the strings

## Interpretation Guidelines

The piece should maintain a dancing quality throughout, with special attention to:

### Dynamic Contrasts

- Begin each section with moderate dynamics
- Build gradually toward key cadential points
- Allow the natural resonance of open strings to enhance the sound

### Ornamentation

The trills should be played:
- Starting on the upper note
- With moderate speed
- With a slight lingering on the final note
`;

// Run the test
async function runTest() {
  try {
    console.log('Starting PDF formatting test...');
    
    // Define a test title
    const testTitle = "Bach Partita No. 3 Lesson Summary";
    
    // Generate enhanced HTML with better heading styles
    const enhancedHtml = enhancedShareUtils.generateEnhancedHTMLFromMarkdown(testTitle, mockMarkdownSummary);
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    // Save the HTML file for testing
    const sanitizedTitle = testTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const htmlPath = path.join(outputDir, `${sanitizedTitle}_enhanced.html`);
    fs.writeFileSync(htmlPath, enhancedHtml);
    
    console.log('Test completed successfully!');
    console.log('Enhanced HTML file created at:', htmlPath);
    console.log('\nNext steps:');
    console.log('1. Open the HTML file in a browser to verify styling');
    console.log('2. Print the HTML to PDF using browser print function to test PDF rendering');
    console.log('3. Once verified, update the actual ShareUtils.js file with the enhanced styling');
    
    // Try to open the HTML file automatically
    const openCommand = process.platform === 'darwin' ? 'open' : 
                        process.platform === 'win32' ? 'start' : 'xdg-open';
    
    console.log(`\nAttempting to open the HTML file with '${openCommand}' command...`);
    exec(`${openCommand} "${htmlPath}"`, (error) => {
      if (error) {
        console.error('Could not open the file automatically:', error.message);
        console.log(`Please manually open: ${htmlPath}`);
      }
    });
    
    // Also open the browser-based test tool which has PDF export capability
    const browserToolPath = path.join(outputDir, 'test.html');
    console.log(`\nOpening browser-based PDF testing tool...`);
    exec(`${openCommand} "${browserToolPath}"`, (error) => {
      if (error) {
        console.error('Could not open the browser tool:', error.message);
        console.log(`Please manually open: ${browserToolPath}`);
      }
    });
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Make the script executable
runTest();
