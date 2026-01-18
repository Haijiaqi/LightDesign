const fs = require('fs');

const filePath = 'd:\\a\\app\\LightDesign\\manage\\InputManager.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Remove duplicate updateLocalGrid
// Range: 1204 to 1250 (1-indexed)
// 0-indexed: 1203 to 1249
lines.splice(1203, 1250 - 1204 + 1);

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Cleanup duplicate updateLocalGrid complete.');
