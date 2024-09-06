import fs from 'fs';
import MicroPythonBoard from 'micropython.js';

/**
 * Extracts the message from the output of the REPL by removing the prefix and suffix
 * conrol characters.
 * @param {string} out The output from the REPL
 * @returns The extracted message from the REPL output
 */
function extractREPLMessage(out) {
    /*
     * Message ($msg) will come out following this template:
     * "OK${msg}\x04${err}\x04>"
     */
    return out.slice(2, -3)
}

/**
 * Determines if a file or directory exists on the board
 * @param {MicroPythonBoard} board 
 * @param {string} filePath 
 * @returns {boolean} True if the file or directory exists, false otherwise
 */
async function fileOrDirectoryExists(board, filePath) {
  let command =  `import os\n`;
      command += `try:\n`;
      command += `    os.stat("${filePath}")\n`;
      command += `    print(1)\n`;
      command += `except OSError:\n`;
      command += `    print(0)\n`;
  await board.enter_raw_repl()
  const output = await board.exec_raw(command)
  await board.exit_raw_repl()
  return output[2] == '1'
}

/**
 * 
 * @param {MicroPythonBoard} board 
 * @param {string} filePath 
 * @param {Object} templateParameters Template parameters to be replaced in the Python script
 * They are denoted by ${paramName} in the script. The key in the object should be paramName.
 */
async function executePythonFile(board, filePath, templateParameters) {
    let script = fs.readFileSync(filePath, 'utf-8');
    for (const [key, value] of Object.entries(templateParameters)) {
      // Replace all occurrences of the template parameter
      script = script.replace(new RegExp('\\${\s*' + key + '\s*}', 'g'), value);
    }
    await board.enter_raw_repl()
    const output = await board.exec_raw(script);
    await board.exit_raw_repl()
    return output;
}

export { extractREPLMessage, executePythonFile, fileOrDirectoryExists };