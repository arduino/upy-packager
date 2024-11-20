import { exec } from 'child_process';
import { platform } from 'os';
import path from 'path';
import fs from 'fs';

const __dirname = new URL('.', import.meta.url).pathname;

/**
 * Class to compile MicroPython files using the mpy-cross compiler
 */
class MPyCrossCompiler {

    /**
     * Retrieves the path to the mpy-cross compiler binary
     * @returns {string} The path to the mpy-cross compiler binary or null if the binary does not exist
     */
    getCompilerBinaryPath(){
        let binaryPath = path.join(__dirname, `../bin/${platform}/mpy-cross`);
        if(platform === 'win32'){
            binaryPath += '.exe';
        }
        // Check if file exists
        if(!fs.existsSync(binaryPath)){
            return null;
        }
        return binaryPath;
    }

    /**
     * Retrieves the major version of the supporeted mpy file format from the mpy-cross compiler
     * @returns {Promise<number>} The major version of the mpy file format
     * @throws {Error} If the compiler version cannot be determined
     */     
    async getMPyFileFormatFromCompiler(){
        // Extract the major version of mpy from the output. e.g. 6 from '... mpy-cross emitting mpy v6.3'
        const platform = process.platform;
        return new Promise((resolve, reject) => {
            exec(`${this.getCompilerBinaryPath()} --version`, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return null;
                }
                const version = stdout.match(/mpy-cross emitting mpy v(\d+)/);
                resolve(version ? parseInt(version[1]) : null);
            });
        });
    }

    /**
     * Checks if the mpy-cross compiler supports the given mpy file format
     * @param {number} mpyFileFormat The major version of the mpy file format
     * @returns {Promise<boolean>} A promise that resolves to true if the compiler
     * supports the given mpy file format
     * @throws {Error} If the compiler version cannot be determined
     */
    async supportsMpyFileFormat(mpyFileFormat){
        try {
            const compilerFileFormat = await this.getMPyFileFormatFromCompiler();
            return compilerFileFormat == mpyFileFormat
        } catch (error) {
            console.error(`Error determining compiler file format: ${error.message}`);
            return false;
        }
    }

    /**
     * Compiles the given files using the mpy-cross compiler
     * @param {string[]} filePaths The paths to the files to compile
     * @param {string} basePath The base path to use for compilation.
     * This is useful since the file path will be hardcoded in the compiled file.
     * When an excpetion is thrown in the compiled file, the hardcoded file path will be shown.
     * @param {string} boardArchitecture The architecture of the board (e.g. 'xtensa').
     * If omitted, the architecture will not be specified for compilation.
     * @returns {Promise<void[]>} A promise that resolves when all files have been compiled
     */
    async compileFiles(filePaths, basePath = null, boardArchitecture = null){
        let promises = [];
        for(const filePath of filePaths){
            promises.push(this.compileFile(filePath, basePath, boardArchitecture));
        }
        return Promise.all(promises);
    }        

    /**
     * Compiles the given file using the mpy-cross compiler
     * @param {string} filePath The path to the file to compile
     * @param {string} basePath The base path to use for compilation.
     * This is useful since the file path will be hardcoded in the compiled file.
     * When an excpetion is thrown in the compiled file, the hardcoded file path will be shown.
     * @param {string} boardArchitecture The architecture of the board (e.g. 'xtensa').
     * If omitted, the architecture will not be specified for compilation.
     * @returns {Promise<string>} A promise that resolves with the path to the compiled file.
     * The compiled file will have the same name as the input file but with the .mpy extension.
     * @throws {Error} If the compilation fails
     */
    async compileFile(filePath, basePath = null, boardArchitecture = null){                
        let flags = boardArchitecture ? `-march=${boardArchitecture}` : '';

        // If the file is already an mpy file, just return the file path
        if(filePath.endsWith('.mpy')){
            console.debug(`👍 File ${filePath} is already an mpy file. Skipping compilation.`);
            return Promise.resolve(filePath);
        }

        const compilerPath = this.getCompilerBinaryPath();
        if(!compilerPath){
            return Promise.reject(new Error('mpy-cross compiler not found'));
        }

        const relativeFilePath = basePath ? path.relative(basePath, filePath) : filePath;

        return new Promise((resolve, reject) => {
            exec(`${compilerPath} ${relativeFilePath} ${flags}`, {cwd: basePath}, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                // Resolve with the compiled file path (<filename>.mpy)
                resolve(`${filePath.slice(0, -3)}.mpy`);
            });
        });
    }
}

export { MPyCrossCompiler };