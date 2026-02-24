import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '../dist/index.html');
const dest = path.join(__dirname, '../../src/FileCabinet/SuiteScripts/trader-screen/index.html');
const destDir = path.dirname(dest);

if (!fs.existsSync(src)) {
  console.error('Build output not found. Run npm run build first.');
  process.exit(1);
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.copyFileSync(src, dest);
console.log('Copied index.html to', dest);
