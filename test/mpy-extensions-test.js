import MicroPythonBoard from 'micropython.js';
import { getLibrariesSystemPath } from '../logic/micropython-extensions.js';

const board = new MicroPythonBoard();
await board.open("/dev/cu.usbmodem101");

const output = await getLibrariesSystemPath(board);
console.log(output);
await board.close();