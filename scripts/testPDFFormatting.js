// PDF Formatting Test Script
// This script creates a test PDF from mock markdown content
// to verify heading styles are preserved in the exported PDF

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');

// Mock markdown summary with different heading levels
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

// Initialize markdown parser
const md = new MarkdownIt();

/**
 * Generate enhanced HTML from markdown string with improved heading styling
 * @param {string} title - Title of content
 * @param {string} markdownContent - Markdown content to convert to HTML
 * @returns {string} - HTML string
 */
const generateEnhancedHTMLFromMarkdown = (title, markdownContent) => {
  // Convert markdown to HTML using MarkdownIt
  let renderedHtml = md.render(markdownContent);
  
  // Enhanced inline styling for headings - more comprehensive approach
  renderedHtml = renderedHtml
    .replace(/<h1(.*?)>/g, '<h1$1 style="color:#007AFF; font-size:20px; font-weight:600; margin-top:30px; margin-bottom:12px; border-bottom:1px solid #e5e5e5; padding-bottom:6px;">')
    .replace(/<h2(.*?)>/g, '<h2$1 style="color:#0062CC; font-size:16px; font-weight:500; margin-top:16px; margin-bottom:10px;">')
    .replace(/<h3(.*?)>/g, '<h3$1 style="color:#444; font-size:14px; font-weight:500; margin-top:15px; margin-bottom:8px;">');
  
  // Get current date for PDF footer
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <!-- PDF-specific metadata to enhance color support -->
        <meta name="pdfkit-colorspace" content="CMYK">
        <meta name="pdfkit-preserve-colors" content="true">
        <style>
          @page {
            margin: 0;
            size: 8.5in 11in;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          body {
            font-family: 'SF Pro Display', 'SF Pro', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.25;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #ffffff;
            font-size: 11px;
          }
          .container {
            max-width: 100%;
            margin: 0;
            padding: 0;
          }
          .header {
            background: linear-gradient(135deg, #0062CC, #0080FF);
            color: white;
            padding: 8px 40px;
            margin: 0;
          }
          .title {
            font-size: 12px;
            font-weight: 300;
            opacity: 0.7;
            margin: 0;
            padding: 0;
            border: none;
            border-bottom: none;
            letter-spacing: 0.03em;
          }
          .subtitle {
            font-size: 14px;
            opacity: 0.9;
            margin-top: 2px;
          }
          .content {
            padding: 8px 50px 30px 50px;
          }
          /* These CSS rules are preserved but will be applied via inline styles as well for redundancy */
          .content h1 { 
            font-size: 20px !important; 
            font-weight: 600 !important;
            margin-top: 30px !important; 
            margin-bottom: 12px !important;
            color: #007AFF !important;
            border-bottom: 1px solid #e5e5e5 !important;
            padding-bottom: 6px !important;
            letter-spacing: 0.02em !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .content h2 { 
            font-size: 16px !important; 
            font-weight: 500 !important;
            margin-top: 16px !important; 
            margin-bottom: 10px !important;
            color: #0062CC !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .content h3 { 
            font-size: 14px !important; 
            font-weight: 500 !important;
            margin-top: 15px !important; 
            margin-bottom: 8px !important;
            color: #444 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          h4 { 
            font-size: 13px; 
            margin-top: 10px; 
            margin-bottom: 5px;
            color: #555;
          }
          p { 
            margin-bottom: 8px; 
            text-align: left;
            font-size: 12px;
          }
          ul, ol { 
            margin-top: 5px;
            margin-bottom: 10px; 
            padding-left: 22px; 
          }
          li { 
            margin-bottom: 4px; 
            font-size: 12px;
            position: relative;
          }
          ul li strong, ol li strong {
            color: #0062CC;
            font-weight: 500;
          }
          code {
            font-family: monospace;
            background-color: #f5f5f5;
            padding: 1px 3px;
            border-radius: 3px;
            font-size: 11px;
          }
          pre {
            background-color: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            border-left: 4px solid #007AFF;
            font-size: 11px;
          }
          a { 
            color: #007AFF; 
            text-decoration: none;
            border-bottom: 1px dotted #007AFF;
          }
          blockquote {
            margin: 12px 0;
            padding: 8px 15px;
            border-left: 3px solid #0062CC;
            background-color: #f9f9f9;
            font-style: italic;
            font-size: 12px;
          }
          .footer {
            margin-top: 25px;
            padding-top: 12px;
            border-top: 1px solid #eeeeee;
            font-size: 10px;
            color: #999;
            text-align: center;
            font-weight: 300;
            letter-spacing: 0.02em;
          }
          
          /* Add print media query for better PDF generation */
          @media print {
            body {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            h1, h2, h3, h4, h5, h6 {
              page-break-after: avoid;
              color-adjust: exact !important;
            }
            table, figure {
              page-break-inside: avoid;
            }
            .content h1, .content h2, .content h3 {
              color-adjust: exact !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <p class="title">VIOLIN LESSON SUMMARY</p>
            <p class="subtitle">${title}</p>
          </div>
          <div class="content">
            ${renderedHtml}
            <div class="footer">
              Generated on ${currentDate}
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};

// Save the HTML to a file for testing
const saveHtmlFile = (title, htmlContent) => {
  const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const outputDir = path.join(__dirname, 'output');
  
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  
  const htmlPath = path.join(outputDir, `${sanitizedTitle}_test.html`);
  fs.writeFileSync(htmlPath, htmlContent);
  
  console.log(`HTML file saved to: ${htmlPath}`);
  return htmlPath;
};

// Main function to run the test
const runTest = () => {
  try {
    console.log('Starting HTML formatting test...');
    
    // Define a test title
    const testTitle = "Bach Partita No. 3 Lesson Summary";
    
    // Generate enhanced HTML with better heading styles
    const enhancedHtml = generateEnhancedHTMLFromMarkdown(testTitle, mockMarkdownSummary);
    
    // Save the HTML file for testing
    const htmlPath = saveHtmlFile(testTitle, enhancedHtml);
    
    console.log('Test completed successfully!');
    console.log('HTML file created at:', htmlPath);
    console.log('\nNext steps:');
    console.log('1. Open the HTML file in a browser to verify styling');
    console.log('2. Use the improved styling approach in ShareUtils.js');
    console.log('3. Print the HTML to PDF using browser print function to test PDF rendering');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
};

// Run the test
runTest();
