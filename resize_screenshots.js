const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const screenshotsDir = './screenshots';

// Function to check if file is an image
function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tiff', '.bmp'].includes(ext);
}

// Function to resize a single image
async function resizeImage(inputPath, outputPath) {
  const tempPath = outputPath + '.tmp';

  try {
    // Resize to temporary file first
    await sharp(inputPath)
      .resize(1280, 800, {
        fit: 'fill', // Fill the dimensions, cropping if necessary
        position: 'center' // Center crop position
      })
      .toFile(tempPath);

    // Move temporary file to final destination (overwrite original)
    fs.renameSync(tempPath, outputPath);

    console.log(`Resized: ${inputPath} -> ${outputPath}`);
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    console.error(`Error resizing ${inputPath}:`, error.message);
  }
}

// Main function
async function resizeAllScreenshots() {
  try {
    // Check if screenshots directory exists
    if (!fs.existsSync(screenshotsDir)) {
      console.log('Screenshots directory does not exist. Creating it...');
      fs.mkdirSync(screenshotsDir, { recursive: true });
      console.log('Screenshots directory created. No images to process.');
      return;
    }

    // Read all files in screenshots directory
    const files = fs.readdirSync(screenshotsDir);

    // Filter image files
    const imageFiles = files.filter(isImageFile);

    if (imageFiles.length === 0) {
      console.log('No image files found in screenshots directory.');
      return;
    }

    console.log(`Found ${imageFiles.length} image file(s) to resize:`);
    imageFiles.forEach(file => console.log(`  - ${file}`));

    // Process each image
    for (const file of imageFiles) {
      const inputPath = path.join(screenshotsDir, file);
      const outputPath = path.join(screenshotsDir, file); // Overwrite original

      await resizeImage(inputPath, outputPath);
    }

    console.log('\nAll screenshots have been resized to 1280x800!');
  } catch (error) {
    console.error('Error processing screenshots:', error.message);
  }
}

// Run the script
resizeAllScreenshots();
