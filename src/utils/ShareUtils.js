import { Share, Platform, Alert } from 'react-native';
import RNFS from 'react-native-fs';
import RNHTMLtoPDF from 'react-native-html-to-pdf';
import MarkdownIt from 'markdown-it';

// Initialize markdown parser
const md = new MarkdownIt();

/**
 * Create a PDF file from HTML content
 * @param {string} title - Title of the content
 * @param {string} htmlContent - HTML content to convert to PDF
 * @returns {Promise<string>} - Path to the created PDF file
 */
export const createPDFFromHTML = async (title, htmlContent) => {
  try {
    const sanitizedTitle = title
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();

    const options = {
      html: htmlContent,
      fileName: `${sanitizedTitle}_summary`,
      directory: 'Documents',
      width: 612, // Standard US Letter width in points (8.5 x 72)
      height: 792, // Standard US Letter height in points (11 x 72)
      padding: 0, // We'll handle padding in the HTML to have more control
      backgroundColor: '#FFFFFF',
    };

    const file = await RNHTMLtoPDF.convert(options);
    return file.filePath;
  } catch (error) {
    console.error('Error creating PDF:', error);
    throw error;
  }
};

/**
 * Generate HTML from markdown string
 * @param {string} title - Title of content
 * @param {string} markdownContent - Markdown content to convert to HTML
 * @returns {string} - HTML string
 */
export const generateHTMLFromMarkdown = (title, markdownContent) => {
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
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
            font-size: 12px;
          }
          table, th, td {
            border: 1px solid #ddd;
          }
          th {
            background-color: #f5f5f5;
            padding: 6px;
            text-align: left;
          }
          td {
            padding: 6px;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          /* Specific styling for music lessons */
          .technique {
            background-color: rgba(232, 245, 254, 0.6);
            padding: 10px 12px;
            border-radius: 4px;
            margin: 10px 0;
            font-size: 12px;
            border-left: 2px solid #0062CC;
          }
          .musical-example {
            font-style: italic;
            border: 1px solid #e5e5e5;
            padding: 8px 10px;
            border-radius: 4px;
            margin: 10px 0;
            background-color: rgba(255, 251, 234, 0.5);
            font-size: 12px;
          }
          .practice-tip {
            background-color: rgba(230, 247, 238, 0.6);
            padding: 10px 12px;
            border-radius: 4px;
            margin: 10px 0;
            font-size: 12px;
            border-left: 2px solid #34A853;
          }
          .page-number {
            position: absolute;
            bottom: 15px;
            right: 40px;
            font-size: 10px;
            color: #888;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">${title}</h1>
          </div>
          
          <div class="content">
            ${renderedHtml}
            
            <div class="footer">
              Generated on ${currentDate} with ArcoScribe
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};

/**
 * Cleans markdown summary by removing code block fences.
 * @param {string} summary - The raw summary markdown.
 * @returns {string} - Cleaned markdown string.
 */
export const cleanSummaryMarkdown = (summary) => {
  if (!summary) return '';
  return summary.replace(/```(\w*)\s*|```/g, '').trim();
};

/**
 * Generates combined markdown content from multiple recordings.
 * @param {Array<Object>} recordings - Array of recording objects.
 * @returns {string} - Combined markdown string.
 */
export const generateCombinedSummaryContent = (recordings) => {
  let combinedContent = '# Combined Recording Summaries\n\n';
  recordings.forEach((recording, index) => {
    if (recording.summary) {
      const cleanedSummary = cleanSummaryMarkdown(recording.summary);
      combinedContent += `## Summary for: ${recording.title || `Recording ${index + 1}`}\n\n`;
      combinedContent += `${cleanedSummary}\n\n`;
      if (index < recordings.length - 1) {
        combinedContent += '---\n\n'; // Add separator
      }
    }
  });
  return combinedContent;
};

/**
 * Share content as a markdown file.
 * @param {string} title - Base title for the shared file.
 * @param {string} markdownContent - The markdown content to share.
 * @returns {Promise<boolean>}
 */
export const shareContentAsMD = async (title, markdownContent) => {
  try {
    const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${sanitizedTitle}_summary.md`;
    const path = `${RNFS.CachesDirectoryPath}/${filename}`;
    
    await RNFS.writeFile(path, markdownContent, 'utf8');
    
    const shareOptions = {
      title: `${title} Summary`,
      message: `${title} Lesson Summary`,
      url: Platform.OS === 'ios' ? `file://${path}` : path, // Ensure correct path format
      type: 'text/markdown',
    };
    
    await Share.share(shareOptions);
    
    // Clean up temporary file
    setTimeout(() => RNFS.unlink(path).catch(err => console.error('MD cleanup failed:', err)), 5000);
    
    return true;
  } catch (error) {
    console.error('Error sharing markdown summary:', error);
    throw error;
  }
};

/**
 * Share content as a PDF file.
 * @param {string} title - Base title for the shared file.
 * @param {string} markdownContent - The markdown content to convert and share.
 * @returns {Promise<boolean>}
 */
export const shareContentAsPDF = async (title, markdownContent) => {
  try {
    const htmlContent = generateHTMLFromMarkdown(title, markdownContent);
    const pdfPath = await createPDFFromHTML(title, htmlContent);
    
    const shareOptions = {
      title: `${title} Summary`,
      message: `${title} Lesson Summary`,
      url: Platform.OS === 'ios' ? pdfPath : `file://${pdfPath}`, // Ensure correct path format
      type: 'application/pdf',
    };
    
    await Share.share(shareOptions);

    // PDF cleanup might depend on RNHTMLtoPDF implementation, assuming it manages its output
    // If issues arise, add: setTimeout(() => RNFS.unlink(pdfPath).catch(err => console.error('PDF cleanup failed:', err)), 5000);

    return true;
  } catch (error) {
    console.error('Error sharing PDF summary:', error);
    throw error;
  }
};

/**
 * Show format selection dialog and share the generated content.
 * @param {string} title - Base title for the shared file.
 * @param {string} contentGenerator - Function that generates the markdown content to share (e.g., () => recording.summary or () => generateCombinedSummaryContent(selectedRecordings)).
 * @returns {Promise<boolean>} - True if shared, false if cancelled.
 */
export const showFormatSelectionAndShare = async (title, contentGenerator) => {
  return new Promise((resolve, reject) => {
    Alert.alert(
      'Choose Format',
      'Which format would you like to share?',
      [
        {
          text: 'Markdown (.md)',
          onPress: async () => {
            try {
              const content = contentGenerator(); // Generate content only when needed
              await shareContentAsMD(title, content);
              resolve(true);
            } catch (error) {
              reject(error);
            }
          }
        },
        {
          text: 'PDF (.pdf)',
          onPress: async () => {
            try {
              const content = contentGenerator(); // Generate content only when needed
              await shareContentAsPDF(title, content);
              resolve(true);
            } catch (error) {
              reject(error);
            }
          }
        },
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => resolve(false)
        }
      ]
    );
  });
};

/**
 * Share SINGLE recording summary (backward compatibility / specific use case)
 * @param {Object} recording - Recording data containing title and summary
 * @returns {Promise<boolean>} - True if shared, false if cancelled.
 */
export const shareRecordingSummary = async (recording) => {
  if (!recording?.summary) {
    Alert.alert('No Summary', 'This recording does not have a summary to share.');
    return false;
  }
  const cleanedSummary = cleanSummaryMarkdown(recording.summary);
  return showFormatSelectionAndShare(recording.title, () => cleanedSummary);
}; 