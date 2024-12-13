import { extractREPLMessage } from './micropython-extensions.js';
import MicroPythonBoard from 'micropython.js';
import { getPromptWithTimeout } from './micropython-extensions.js';

/**
 * Retrieves the architecture of the board (e.g. 'xtensa')
 * @param {MicroPythonBoard} board The MicroPython board from which to retrieve the architecture
 * @returns {Promise<string>} The architecture of the board
 */
async function getArchitectureFromBoard(board) {
    await getPromptWithTimeout(board);
    await board.enter_raw_repl();
    const output = extractREPLMessage(await board.exec_raw("import platform; print(platform.platform())"));
    await board.exit_raw_repl();
    const parts = output.split('-');
    // Arch is the third part of the string when split by '-' unless the version has a -preview suffix
    const architecture = parts[2] === "preview" ? parts[3] : parts[2];
    return architecture;
}

/**
 * Retrieves the major version of the mpy file format from the board
 * @param {MicroPythonBoard} board The MicroPython board from which to retrieve the mpy file format
 * @returns {Promise<number>} The major version of the mpy file format
 */
async function getMPyFileFormatFromBoard(board){
    await getPromptWithTimeout(board);
    await board.enter_raw_repl(board);
    const output = extractREPLMessage(await board.exec_raw("import sys; print(getattr(sys.implementation, '_mpy', 0) & 0xFF)"));
    await board.exit_raw_repl();
    return parseInt(output);
}

/**
 * Gets the MicroPython version running on the board
 * @param {MicroPythonBoard} board The MicroPython board instance
 * @returns {Promise<string>} The MicroPython version. e.g. "1.21.0"
 * Strips any trailing version tags such as "-preview" or "-dev"
 */
async function getMicroPythonVersionFromBoard(board) {
    await getPromptWithTimeout(board);
    await board.enter_raw_repl();
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
    const version = await getMicroPythonVersionFromBoard(board);
    await board.close();
    return version;
}

export { getArchitectureFromBoard, getMPyFileFormatFromBoard, getMicroPythonVersionFromBoard, getMicroPythonVersionFromPort };