import { exec } from 'child_process';
import { platform } from 'os';
import path from 'path';

const __dirname = new URL('.', import.meta.url).pathname;

/**
 * Class to compile MicroPython files using the mpy-cross compiler
 */
class MPyCrossCompiler {

    /**
     * Retrieves the path to the mpy-cross compiler binary
     * @returns {string} The path to the mpy-cross compiler binary
     */
    getCompilerBinaryPath(){
        return path.join(__dirname, `../bin/${platform}/mpy-cross`);
    }

    /**
     * Retrieves the major version of the supporeted mpy file format from the mpy-cross compiler
     * @returns {Promise<number>} The major version of the mpy file format
     */     
    async getMPyFileFormatFromCompiler(){
        // Extract the major version of mpy from the output. e.g. 6 from '... mpy-cross emitting mpy v6.3'
        const platform = process.platform;
        return new Promise((resolve, reject) => {
            exec(`${this.getCompilerBinaryPath()} --version`, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
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
        const compilerFileFormat = await this.getMPyFileFormatFromCompiler();
        return compilerFileFormat == mpyFileFormat
    }

    /**
     * Compiles the given files using the mpy-cross compiler
     * @param {string[]} filePaths The paths to the files to compile
     * @param {string} boardArchitecture The architecture of the board (e.g. 'xtensa').
     * If omitted, the architecture will not be specified for compilation.
     * @returns {Promise<void[]>} A promise that resolves when all files have been compiled
     */
    async compileFiles(filePaths, boardArchitecture = null){
        let promises = [];
        for(const filePath of filePaths){
            promises.push(this.compileFile(filePath, boardArchitecture));
        }
        return Promise.all(promises);
    }        

    /**
     * Compiles the given file using the mpy-cross compiler
     * @param {string} filePath The path to the file to compile
     * @param {string} boardArchitecture The architecture of the board (e.g. 'xtensa').
     * If omitted, the architecture will not be specified for compilation.
     * @returns {Promise<string>} A promise that resolves with the path to the compiled file.
     * The compiled file will have the same name as the input file but with the .mpy extension.
     * @throws {Error} If the compilation fails
     */
    async compileFile(filePath, boardArchitecture = null){                
        let flags = boardArchitecture ? `-march=${boardArchitecture}` : '';

        return new Promise((resolve, reject) => {
            exec(`${this.getCompilerBinaryPath()} ${filePath} ${flags}`, (error, stdout, stderr) => {
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