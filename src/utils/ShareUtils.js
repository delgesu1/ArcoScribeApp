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
  const renderedHtml = md.render(markdownContent);
  
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
        <style>
          @page {
            margin: 0;
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
            font-size: 20px; 
            font-weight: 600;
            margin-top: 30px; 
            margin-bottom: 12px;
            color: #007AFF;
            border-bottom: 1px solid #e5e5e5;
            padding-bottom: 6px;
            letter-spacing: 0.02em;
          }
          h2 { 
            font-size: 16px; 
            font-weight: 500;
            margin-top: 16px; 
            margin-bottom: 10px;
            color: #0062CC;
          }
          h3 { 
            font-size: 14px; 
            font-weight: 500;
            margin-top: 15px; 
            margin-bottom: 8px;
            color: #444;
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
 * Show format selection dialog and share the file
 * @param {Object} recording - Recording data containing title and summary
 * @returns {Promise<void>}
 */
export const showFormatSelectionAndShare = async (recording) => {
  if (!recording?.summary) {
    throw new Error('No summary available to share');
  }

  return new Promise((resolve, reject) => {
    Alert.alert(
      'Choose Format',
      'Which format would you like to share?',
      [
        {
          text: 'Markdown (.md)',
          onPress: async () => {
            try {
              await shareRecordingSummaryAsMD(recording);
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
              await shareRecordingSummaryAsPDF(recording);
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
 * Share recording summary as a markdown file
 * @param {Object} recording - Recording data containing title and summary
 * @returns {Promise<boolean>}
 */
export const shareRecordingSummaryAsMD = async (recording) => {
  if (!recording?.summary) {
    throw new Error('No summary available to share');
  }
  
  try {
    // Create filename based on recording title (sanitized)
    const sanitizedTitle = recording.title
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const filename = `${sanitizedTitle}_summary.md`;
    
    // Define path where to save the file temporarily
    const path = `${RNFS.CachesDirectoryPath}/${filename}`;
    
    // Clean the summary by removing markdown code block delimiters
    const cleanedSummary = recording.summary.replace(/```(\w*)\s*|```/g, '').trim();
    
    // Write the cleaned summary to the file
    await RNFS.writeFile(path, cleanedSummary, 'utf8');
    
    // On iOS, we can share the file using the built-in Share API
    if (Platform.OS === 'ios') {
      const shareOptions = {
        title: `${recording.title} Summary`,
        message: `${recording.title} Lesson Summary`,
        url: `file://${path}`,
        type: 'text/markdown',
      };
      
      await Share.share(shareOptions);
      
      // Clean up the temporary file after a delay
      setTimeout(async () => {
        try {
          await RNFS.unlink(path);
        } catch (error) {
          console.error('Error cleaning up temporary file:', error);
        }
      }, 5000);
      
      return true;
    } 
    // For Android, we'd implement a different approach, but for now just share the text
    else {
      await Share.share({
        title: `${recording.title} Summary`,
        message: cleanedSummary,
      });
      
      // Clean up the temporary file
      await RNFS.unlink(path);
      
      return true;
    }
  } catch (error) {
    console.error('Error sharing markdown summary:', error);
    throw error;
  }
};

/**
 * Share recording summary as a PDF file
 * @param {Object} recording - Recording data containing title and summary
 * @returns {Promise<boolean>}
 */
export const shareRecordingSummaryAsPDF = async (recording) => {
  if (!recording?.summary) {
    throw new Error('No summary available to share');
  }
  
  try {
    // Clean the summary by removing markdown code block delimiters
    const cleanedSummary = recording.summary.replace(/```(\w*)\s*|```/g, '').trim();
    
    // Convert markdown to HTML
    const htmlContent = generateHTMLFromMarkdown(recording.title, cleanedSummary);
    
    // Generate PDF
    const pdfPath = await createPDFFromHTML(recording.title, htmlContent);
    
    // Share PDF
    const shareOptions = {
      title: `${recording.title} Summary`,
      message: `${recording.title} Lesson Summary`,
      url: Platform.OS === 'android' ? `file://${pdfPath}` : pdfPath,
      type: 'application/pdf',
    };
    
    await Share.share(shareOptions);
    
    // Clean up is handled by the system since we're using the Documents directory
    
    return true;
  } catch (error) {
    console.error('Error sharing PDF summary:', error);
    throw error;
  }
};

/**
 * Share recording summary (backward compatibility)
 * @param {Object} recording - Recording data containing title and summary
 * @returns {Promise<void>}
 */
export const shareRecordingSummary = async (recording) => {
  return showFormatSelectionAndShare(recording);
}; 