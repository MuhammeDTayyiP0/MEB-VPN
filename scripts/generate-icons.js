/**
 * Generate multi-size icons for Linux from the source icon.png
 * Uses Node.js built-in capabilities (no external dependencies)
 * 
 * For high-quality resizing, we use sharp if available,
 * otherwise fall back to electron-builder's built-in icon handling
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE_ICON = path.join(__dirname, '..', 'resources', 'icon.png');
const ICONS_DIR = path.join(__dirname, '..', 'resources', 'icons');
const SIZES = [16, 32, 48, 64, 128, 256, 512];

async function generateIcons() {
    console.log('🎨 Generating multi-size icons for Linux...');

    // Create icons directory
    if (!fs.existsSync(ICONS_DIR)) {
        fs.mkdirSync(ICONS_DIR, { recursive: true });
    }

    // Check if source icon exists
    if (!fs.existsSync(SOURCE_ICON)) {
        console.error('❌ Source icon not found:', SOURCE_ICON);
        process.exit(1);
    }

    // Try sharp first (best quality)
    try {
        const sharp = require('sharp');
        console.log('Using sharp for high-quality resizing...');
        
        for (const size of SIZES) {
            const output = path.join(ICONS_DIR, `${size}x${size}.png`);
            await sharp(SOURCE_ICON)
                .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toFile(output);
            console.log(`  ✅ ${size}x${size}.png`);
        }
        console.log('✅ All icons generated successfully!');
        return;
    } catch (e) {
        // sharp not available
    }

    // Try ImageMagick (common on Linux CI)
    try {
        execSync('convert --version', { stdio: 'ignore' });
        console.log('Using ImageMagick for resizing...');

        for (const size of SIZES) {
            const output = path.join(ICONS_DIR, `${size}x${size}.png`);
            execSync(`convert "${SOURCE_ICON}" -resize ${size}x${size} "${output}"`);
            console.log(`  ✅ ${size}x${size}.png`);
        }
        console.log('✅ All icons generated successfully!');
        return;
    } catch (e) {
        // ImageMagick not available
    }

    // Try magick (ImageMagick v7 on Windows)
    try {
        execSync('magick --version', { stdio: 'ignore' });
        console.log('Using ImageMagick v7 for resizing...');

        for (const size of SIZES) {
            const output = path.join(ICONS_DIR, `${size}x${size}.png`);
            execSync(`magick "${SOURCE_ICON}" -resize ${size}x${size} "${output}"`);
            console.log(`  ✅ ${size}x${size}.png`);
        }
        console.log('✅ All icons generated successfully!');
        return;
    } catch (e) {
        // magick not available
    }

    // Fallback: copy the source icon as 256x256 (electron-builder minimum requirement)
    console.log('⚠️  No image processing tool found (sharp, ImageMagick).');
    console.log('   Copying source icon as fallback...');
    
    // Copy the original as each size (not ideal but prevents build failure)
    for (const size of SIZES) {
        const output = path.join(ICONS_DIR, `${size}x${size}.png`);
        fs.copyFileSync(SOURCE_ICON, output);
    }
    console.log('✅ Fallback icons created (original resolution copies).');
    console.log('   For best results, install ImageMagick or sharp.');
}

generateIcons().catch(e => {
    console.error('Icon generation failed:', e);
    process.exit(1);
});
