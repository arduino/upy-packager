import fs from 'fs';
import path from 'path';
import MicroPythonBoard from 'micropython.js';
import CRC32 from 'crc-32';

// Define __dirname for ES6 modules
const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Extracts the message from the output of the REPL by removing the prefix and suffix
 * conrol characters.
 * @param {string} out The output from the REPL
 * @param {boolean} stripTrailingLinebreak Whether to strip the trailing linebreak from the message
 * When using 'print()' in MicroPython, a \r\n linebreak is added to the output.
 * @returns The extracted message from the REPL output
 */
function extractREPLMessage(out, stripTrailingLinebreak = true) {
    /*
     * Message ($msg) will come out following this template:
     * "OK${msg}\x04${err}\x04>"
     */
    let output = out.slice(2, -3)
    if (stripTrailingLinebreak && output.endsWith('\r\n')) {
      output = output.slice(0, -2)
    }
    return output;
}

/**
 * Gets the MicroPython version running on the board
 * @param {MicroPythonBoard} board The MicroPython board instance
 * @returns {Promise<string>} The MicroPython version. e.g. "1.21.0"
 * Strips any trailing version tags such as "-preview" or "-dev"
 */
async function getMicroPythonVersion(board) {
  await board.enter_raw_repl()
  const output = await board.exec_raw("import os; print(os.uname().release)")
  await board.exit_raw_repl()
  let version = extractREPLMessage(output);  
  return version.split("-")[0]; // Remove everyting after the first dash, if any
}

/**
 * Gets the MicroPython version running on the board by connecting to the specified port
 * @param {string} port The serial port to connect to
 * @returns {Promise<string>} The MicroPython version. e.g. "1.21.0"
 * Strips any trailing version tags such as "-preview" or "-dev"
 */
async function getMicroPythonVersionFromPort(port) {
  const board = new MicroPythonBoard();
  await board.open(port);
  const version = await getMicroPythonVersion(board);
  await board.close();
  return version;
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
 * Executes a Python script file on the board by replacing template parameters
 * in the script with the specified values.
 * @param {MicroPythonBoard} board The MicroPython board instance to execute the script on
 * @param {string} filePath The path to the Python script file on the host machine
 * @param {Object} templateParameters Template parameters to be replaced in the Python script
 * They are denoted by ${paramName} in the script. The key in the object should be paramName.
 * e.g. { 'localFileHash': 'acbd18db4cc2f85cedef654fccc4a4d8', 'targetFile': 'tmp.txt' }
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

/**
 * Calculates the CRC32 checksum of the given data
 * It converts the checksum to an unsigned 32-bit integer to match Python's implementation
 * and then returns it as a Uint8Array
 * @param {number[] | Uint8Array } data 
 * @returns {Uint8Array} The CRC32 checksum as a Uint8Array
 */
function getCRC32(data){  
  const crc = CRC32.buf(data) >>> 0; // Convert to unsigned 32 bit
  const buffer = new ArrayBuffer(4); // 4 bytes for a 32-bit integer
  const view = new DataView(buffer);
  view.setUint32(0, crc); // Set the 32-bit unsigned integer at byteOffset = 0
  return new Uint8Array(buffer);
}

/**
 * Writes a file to the board and validates the CRC32 checksum of the data
 * The file is read in chunks of the specified size and the CRC32 checksum is calculated for each chunk.
 * @param {MicroPythonBoard} board The MicroPython board instance
 * @param {string} src The source file path to read from
 * @param {string} dest The destination file path to write to
 * @param {function} data_consumer The callback function to consume the data read progress
 * @param {number} chunkSize The initial chunk size to read the file in
 * @returns {Promise<string>} The output of the write operation
 */
async function writeFile(board, src, dest, data_consumer, chunkSize = 512) {
  data_consumer = data_consumer || function () { }
  if (src && dest) {
    const fileContent = fs.readFileSync(path.resolve(src), 'binary')
    const contentBuffer = Buffer.from(fileContent, 'binary')
    const scriptPath = path.join(__dirname, "python", 'crc.py');
    let output = await board.execfile(scriptPath);
    let completeOutput = ''

    if (output.slice(2, -3) != '') {
      return Promise.reject(new Error(`Error executing Python script: ${output}`))
    }

    completeOutput += await board.enter_raw_repl()
    completeOutput += await board.exec_raw(`f=open('${dest}','wb')\nw=f.write`)    
    let i = 0, currentProgress = 0
    
    while(i < contentBuffer.length) {
      let slice = Uint8Array.from(contentBuffer.subarray(i, i + chunkSize))
      const crcData = getCRC32(slice);
      const mergedData = new Uint8Array(slice.length + crcData.length);
      mergedData.set(slice);
      mergedData.set(crcData, slice.length);

      let line = `d=bytes([${mergedData}]);print(1 if validate_crc(d) else 0)`;
      output = await board.exec_raw(line)
      completeOutput += output
      const crcCorrect = output.slice(2, -5) == '1'

      if (!crcCorrect) {
        const chunkEndIndex = i + chunkSize
        chunkSize = Math.floor(chunkSize / 2) // Reduce chunk size by half
        
        if(chunkSize < 1) {
          completeOutput += await board.exec_raw(`f.close()`)
          return Promise.reject(new Error(`CRC32 check failed at byte ${i} .. ${chunkEndIndex}`))
        }
        
        continue
      } else {
        // Writa data excluding the last 4 bytes (CRC32)
        completeOutput += await board.exec_raw(`w(d[:-4])`)
        const newProgress = parseInt((i / contentBuffer.length) * 100)
        if (newProgress != currentProgress) {
          data_consumer(newProgress + '%')
          currentProgress = newProgress
        }
        i += chunkSize
      }

    }
    completeOutput += await board.exec_raw(`f.close()`)
    completeOutput += await board.exit_raw_repl()
    return Promise.resolve(completeOutput)
  }
  return Promise.reject(new Error(`Must specify source and destination paths`))
}

export { extractREPLMessage, executePythonFile, fileOrDirectoryExists, writeFile, getMicroPythonVersion, getMicroPythonVersionFromPort };