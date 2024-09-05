import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { extractREPLMessage, executePythonFile } from './micropython-extensions.js';

// Define __dirname for ES6 modules
const __dirname = path.dirname(new URL(import.meta.url).pathname);

class PackageInstaller {
    constructor(board) {
        this.board = board;
    }

    async calculateHash(filePath) {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(filePath);
        return new Promise((resolve, reject) => {
          input.on('data', chunk => hash.update(chunk));
          input.on('end', () => resolve(hash.digest('hex')));
          input.on('error', reject);
        });
      }
        
      async verifyHash(filePath, targetFile) {
        const localFileHash = await this.calculateHash(filePath);
        const templateParameters = { 'localFileHash': localFileHash, 'targetFile': targetFile };
        const output = await executePythonFile(this.board, path.join(__dirname, "python", 'validate_hash.py'), templateParameters);
        return extractREPLMessage(output).includes('Hash OK');
      }

    async uploadArchive(sourceFile, targetFile) {
        process.stdout.write('📤 Uploading file to board');
        const start = Date.now();
        await this.board.fs_put(sourceFile, targetFile, (output) => {
          process.stdout.write(".");
        });
        const end = Date.now();
        process.stdout.write("\n");
        console.log(`🕒 Upload completed in ${(end - start)/1000} s`);

        console.log('🔍 Verifying hash...');
        if(!await this.verifyHash(sourceFile, targetFile)) {
          throw new Error('❌ Hash mismatch');
        }
    }

    async extractArchiveOnBoard(archiveFileName) {
        const extractScriptFilePath = path.join(__dirname, "python", 'extract_archive.py');
        const tarfileLibFilePath = path.join(__dirname, "python", 'tarfile.py');
      
        console.log('📦 Extracting archive...')
        let output;
      
        await this.board.enter_raw_repl()
        output = extractREPLMessage(await this.board.exec_raw('from tarfile import TarFile, DIRTYPE'))
        await this.board.exit_raw_repl()
        
        // Load tarfile.py if not installed on the board
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
        const command = `untar('${archiveFileName}')`;
        output = extractREPLMessage(await this.board.exec_raw(command))
        await this.board.exit_raw_repl()
      
        if(output.includes('[Errno 17] EEXIST')) {
          throw new Error('Failed to extract archive because file(s) already exists');
        }
      
        if (!output.includes('Extraction complete')) {
          throw new Error('Failed to extract archive' + output);
        }

    }

    async cleanUp(remoteFile) {
        console.log('🧹 Cleaning up archive file on board...');
        await this.board.fs_rm(remoteFile);
    }
}

export { PackageInstaller };