import { MPyCrossCompiler } from "./logic/mpy-cross-compiler.js";
import MicroPythonBoard from "micropython.js";

const DEFAULT_PORT = '/dev/cu.usbmodem1234561'
const board = new MicroPythonBoard()
await board.open(DEFAULT_PORT)

const compiler = new MPyCrossCompiler(board);
const sourceFiles = [
    '/Users/sebastian/Downloads/radio_control/__init__.py',
    '/Users/sebastian/Downloads/radio_control/transmitter.py'
]
await compiler.compileFiles(sourceFiles);
await board.close();