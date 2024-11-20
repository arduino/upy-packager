import { MPyCrossCompiler } from "../logic/mpy-cross-compiler.js";
import MicroPythonBoard from 'micropython.js';

const board = new MicroPythonBoard();
await board.open("/dev/cu.usbmodem1101");

const compiler = new MPyCrossCompiler();
const sourceFiles = [
    '~/Downloads/radio_control/__init__.py',
    '~/Downloads/radio_control/transmitter.py'
]
const basePath = '~/Downloads/';
await compiler.compileFiles(sourceFiles, basePath);
await board.close();