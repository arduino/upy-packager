import { MPyCrossCompiler } from "./logic/mpy-cross-compiler.js";

const compiler = new MPyCrossCompiler();
const sourceFiles = [
    '/Users/sebastian/Downloads/radio_control/__init__.py',
    '/Users/sebastian/Downloads/radio_control/transmitter.py'
]
await compiler.compileFiles(sourceFiles);
await board.close();