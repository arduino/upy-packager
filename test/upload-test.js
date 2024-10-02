import MicroPythonBoard from 'micropython.js';
import { writeFile } from '../logic/micropython-extensions.js';

const sourceFile = '~/Desktop/E-Paper-Driver-HAT-Schematic.pdf';
const board = new MicroPythonBoard();
await board.open("/dev/cu.usbmodem1234561");

const output = await writeFile(board, sourceFile, 'dummy.pdf', (progress) => {
    console.log(progress)
});
console.log(output);
await board.close();