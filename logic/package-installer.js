import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { extractREPLMessage, executePythonFile } from './micropython-extensions.js';
import MicroPythonBoard from 'micropython.js';

// Define __dirname for ES6 modules
const __dirname = path.dirname(new URL(import.meta.url).pathname);

class PackageInstaller {
    /**
     * Constructs a new PackageInstaller instance
     * @param {MicroPythonBoard} board The MicroPython board instance to use.
     * This class assumes that the board's port is already open.
     */
    constructor(board) {
        this.board = board;
    }

    /**
     * Calculates the hash of the given local file
     * @param {string} filePath 
     * @returns {Promise<string>} The hash of the file
     */
    async calculateHash(filePath) {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(filePath);
        return new Promise((resolve, reject) => {
          input.on('data', chunk => hash.update(chunk));
          input.on('end', () => resolve(hash.digest('hex')));
          input.on('error', reject);
        });
      }
        
    /**
     * Verifies the hash of the given file on the board
     * by comparing it to the hash of the local file to the one on the board
     * @param {string} filePath The local file path
     * @param {string} targetFile The file path on the board
     * @returns {Promise<boolean>} True if the hash matches, false otherwise
     */
    async verifyHash(filePath, targetFile) {
        const localFileHash = await this.calculateHash(filePath);
        const templateParameters = { 'localFileHash': localFileHash, 'targetFile': targetFile };
        const output = await executePythonFile(this.board, path.join(__dirname, "python", 'validate_hash.py'), templateParameters);
        return extractREPLMessage(output).includes('Hash OK');
    }

    /**
     * Uploads the given file to the board
     * @param {string} sourceFilePath The local file path
     * @param {string} targetFilePath The file path on the board. 
     * Defaults to the file name taken from the source file path
     * @param {function} onProgress An optional callback function to track the upload progress.
     * The callback takes an integer argument representing the percentage of the upload progress.
     */
    async uploadArchive(sourceFilePath, targetFilePath = null, onProgress = null) {
        if(targetFilePath === null) {
            targetFilePath = path.basename(sourceFilePath);
        }
        
        const start = Date.now();
        await this.board.fs_put(sourceFilePath, targetFilePath, (output) => {
          if(onProgress) {
            onProgress(parseInt(output.replace('%', '')));
          }
        });
        const end = Date.now();        
        console.debug(`🕒 Upload completed in ${(end - start)/1000} s`);

        console.debug('🔍 Verifying hash...');
        if(!await this.verifyHash(sourceFilePath, targetFilePath)) {
          throw new Error('❌ Hash mismatch');
        }
    }

    /**
     * Extracts the given archive tar file on the board
     * @param {string} archiveFilePath The tar file path on the board
     */
    async extractArchiveOnBoard(archiveFilePath) {
        const extractScriptFilePath = path.join(__dirname, "python", 'extract_archive.py');
        const tarfileLibFilePath = path.join(__dirname, "python", 'tarfile.py');
      
        console.debug('📦 Extracting archive...')
        let output;
        await this.board.enter_raw_repl()
        output = extractREPLMessage(await this.board.exec_raw('from tarfile import TarFile, DIRTYPE'))
        await this.board.exit_raw_repl()
        
        // Load tarfile.py if tarfile module is not installed on the board
        if(output.includes('ImportError')) {
          output = extractREPLMessage(await this.board.execfile(tarfileLibFilePath));
          if (output !== '') {
            throw new Error('Failed to load tarfile.py. Output: ' + output);
          }
        }
      
        output = extractREPLMessage(await this.board.execfile(extractScriptFilePath));
        if (output !== '') {
          throw new Error('Failed to import extract_archive.py. Output: ' + output);
        }
        
        await this.board.enter_raw_repl()
        const command = `untar('${archiveFilePath}')`;
        output = extractREPLMessage(await this.board.exec_raw(command))
        await this.board.exit_raw_repl()
      
        if(output.includes('[Errno 17] EEXIST')) {
          throw new Error('Failed to extract archive because file(s) already exists');
        }
      
        if (!output.includes('Extraction complete')) {
          throw new Error('Failed to extract archive' + output);
        }
    }

    /**
     * Cleans up the given file on the board
     * This is useful to remove temporary files after they have been used e.g. the uploaded archive file
     * @param {string} remoteFile The file path on the board to remove
     */
    async cleanUp(remoteFile) {
        console.debug('🧹 Cleaning up archive file on board...');
        await this.board.fs_rm(remoteFile);
    }
}

export { PackageInstaller };