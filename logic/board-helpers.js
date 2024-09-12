import { extractREPLMessage } from './micropython-extensions.js';

/**
 * Retrieves the architecture of the board (e.g. 'xtensa')
 * @param {MicroPythonBoard} board The MicroPython board from which to retrieve the architecture
 * @returns {Promise<string>} The architecture of the board
 */
async function getArchitectureFromBoard(board) {
    await board.enter_raw_repl();
    const output = extractREPLMessage(await board.exec_raw("import platform; print(platform.platform())"));
    await board.exit_raw_repl();
    // Arch is the third part of the string when split by '-'
    const parts = output.split('-');
    return parts[2];
}

/**
 * Retrieves the major version of the mpy file format from the board
 * @param {MicroPythonBoard} board The MicroPython board from which to retrieve the mpy file format
 * @returns {Promise<number>} The major version of the mpy file format
 */
async function getMPyFileFormatFromBoard(board){
    await board.enter_raw_repl(board);
    const output = extractREPLMessage(await board.exec_raw("import sys; print(getattr(sys.implementation, '_mpy', 0) & 0xFF)"));
    await board.exit_raw_repl();
    return parseInt(output);
}

export { getArchitectureFromBoard, getMPyFileFormatFromBoard };