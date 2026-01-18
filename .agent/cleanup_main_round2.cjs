const fs = require('fs');

const filePath = 'd:\\a\\app\\LightDesign\\main.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Ranges to remove (1-indexed based on current 1429 line file)
// [start, end] inclusive
const rangesToRemove = [
    [855, 1346], // enterEditState...moveObjectTo
    [797, 842],  // findClickedObjectCenter
    [784, 789],  // onMouseClick
    [602, 771]   // calculateImpulse...applyTouchImpulseSimple(end)
];

rangesToRemove.sort((a, b) => b[0] - a[0]);

for (const [start, end] of rangesToRemove) {
    const startIndex = start - 1;
    const deleteCount = end - start + 1;
    lines.splice(startIndex, deleteCount);
}

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Cleanup Round 2 complete.');
