const fs = require('fs');
const path = require('path');

const filePath = 'd:\\a\\app\\LightDesign\\main.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Ranges to remove (1-indexed input, converting to 0-indexed)
// Format: [start, end] inclusive
const rangesToRemove = [
    [2023, 2244], // enterEditState...snapToNearestLayer
    [1028, 1727], // measureObjectRadius...rotateFocusedObject
    [683, 848],   // setupEventListeners (Replace)
    [539, 678],   // userRotate...applyVelocities
    [188, 387]    // handleViewContinuousInput...handleEditKeyDown
];

// Replacement logic for setupEventListeners
const newSetupEventListeners = `        function setupEventListeners() {
          window.addEventListener("resize", () => {
            SystemState.ifControl = true;
            resizeCanvas();
            SystemState.hiddenWindow = new Window(
              SystemState.screenWidthPx,
              SystemState.screenHeightPx,
              CONFIG.screenXLengthCm,
              CONFIG.screenYLengthCm,
              "hidden",
            );
            SystemState.lightWindow = new Window(
              SystemState.screenWidthPx,
              SystemState.screenHeightPx,
              CONFIG.screenXLengthCm,
              CONFIG.screenYLengthCm,
              "light",
            );
            SystemState.mainWindow.resizeRefresh(
              window.innerWidth,
              window.innerHeight,
              (window.innerWidth / CONFIG.screenWidth) * CONFIG.screenXLengthCm,
              (window.innerHeight / CONFIG.screenHeight) * CONFIG.screenYLengthCm,
            );
          });
        }`;

// Sort ranges descending to avoid index shift
rangesToRemove.sort((a, b) => b[0] - a[0]);

for (const [start, end] of rangesToRemove) {
    // 0-indexed
    const startIndex = start - 1;
    const deleteCount = end - start + 1;

    // Check if this is the setupEventListeners range
    if (start === 683) {
        // Replace
        lines.splice(startIndex, deleteCount, newSetupEventListeners);
    } else {
        // Delete
        lines.splice(startIndex, deleteCount);
    }
}

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Cleanup complete.');
