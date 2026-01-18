const fs = require('fs');

const filePath = 'd:\\a\\app\\LightDesign\\main.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Remove findSurfaceHit and leftover JSDoc
// Range: 556 to 602 (based on 1-indexed view)
// 0-indexed: 555 to 601
const start = 556;
const end = 602;
const startIndex = start - 1;
const deleteCount = end - start + 1;

lines.splice(startIndex, deleteCount);

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Cleanup findSurfaceHit complete.');
