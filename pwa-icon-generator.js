
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const source = 'assets/icon.png';
const dest192 = 'static/pwa-192x192.png';
const dest512 = 'static/pwa-512x512.png';

async function generate() {
    console.log('Generating PWA icons...');
    if (!fs.existsSync(source)) {
        console.error('Source icon not found:', source);
        process.exit(1);
    }

    // Ensure static directory exists
    if (!fs.existsSync('static')) {
        fs.mkdirSync('static');
    }

    await sharp(source)
        .resize(192, 192)
        .toFile(dest192);
    console.log(`Generated ${dest192}`);

    await sharp(source)
        .resize(512, 512)
        .toFile(dest512);
    console.log(`Generated ${dest512}`);
}

generate().catch(err => {
    console.error(err);
    process.exit(1);
});
