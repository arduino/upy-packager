import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { extractREPLMessage, fileOrDirectoryExists, writeFile } from './micropython-extensions.js';
import MicroPythonBoard from 'micropython.js';

// Define __dirname for ES6 modules
const __dirname = path.dirname(new URL(import.meta.url).pathname);

class PackageInstaller {
  /**
   * Constructs a new PackageInstaller instance
   * @param {MicroPythonBoard} board The MicroPython board instance to use.
   * @param {string} libraryPath The path to the library folder on the board. Defaults to 'lib'.
   * This class assumes that the board's port is already open.
   */
  constructor(board, libraryPath = "lib") {
    this.board = board;
    this.libraryPath = libraryPath;
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
    const scriptPath = path.join(__dirname, "python", 'validate_hash.py');

    let output = extractREPLMessage(await this.board.execfile(scriptPath));
    if (output !== '') {
      throw new Error('Failed to load validate_hash.py. Output: ' + output);
    }
    await this.board.enter_raw_repl()
    output = extractREPLMessage(await this.board.exec_raw(`validate_hash('${targetFile}', b'${localFileHash}')`));
    await this.board.exit_raw_repl()
    return output === '1';
  }

  /**
   * Determines if the given package folder exists on the board.
   * Please note that the package name and the package folder name are not necessarily the same.
   * The package folder is the folder where the package is extracted to.
   * @param {string} packageFolder The package folder name.
   * @returns {Promise<boolean>} True if the package folder exists, false otherwise
   */
  async packageFolderExists(packageFolder) {
    return fileOrDirectoryExists(this.board, path.join(this.libraryPath, packageFolder));
  }

  /**
   * Deletes the given package folder on the board
   * Please note that the package name and the package folder name are not necessarily the same.
   * The package folder is the folder where the package is extracted to.
   * @param {string} packageFolder The package folder name.
   */
  async deletePackageFolder(packageFolder) {
    await this.board.execfile(path.join(__dirname, "python", 'remove_directory.py'));
    await this.board.enter_raw_repl()
    const targetDirectory = path.join(this.libraryPath, packageFolder);
    const output = extractREPLMessage(await this.board.exec_raw(`remove_directory_recursive('${targetDirectory}')`));
    await this.board.exit_raw_repl()

    if (output.includes('OSError:')) {
      const errorMessage = output.match(/OSError: \[.*\] .*/)[0];
      throw new Error(`Failed to delete existing package folder. ${errorMessage}`);
    }
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
    if (targetFilePath === null) {
      targetFilePath = path.basename(sourceFilePath);
    }

    const start = Date.now();
    await writeFile(this.board, sourceFilePath, targetFilePath, (output) => {
      if (onProgress) {
        onProgress(parseInt(output.replace('%', '')));
      }
    });
    const end = Date.now();
    console.debug(`🕒 Upload completed in ${(end - start) / 1000} s`);

    console.debug('🔍 Verifying hash...');
    if (!await this.verifyHash(sourceFilePath, targetFilePath)) {
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
    if (output.includes('ImportError')) {
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
    const command = `untar('${archiveFilePath}', '${this.libraryPath}')`;
    output = extractREPLMessage(await this.board.exec_raw(command))
    await this.board.exit_raw_repl()

    if (output.includes('[Errno 17] EEXIST')) {
      throw new Error('Failed to extract archive because file(s) already exists');
    }

    if (!output.includes('Extraction complete')) {
      throw new Error('Failed to extract archive' + output);
    }
  }

  /**
   * Installs a package on the board by uploading the package tar file, extracting it and cleaning up
   * the tar file that was uploaded and is no longer needed.
   * @param {string} packageTarFilePath The source package tar file path
   * @param {string} packageFolder The package folder name where the package is expected to be extracted to
   * Note that changing this does not extract the package to a different folder.
   * However it is needed to check if the package folder already exists on the board in case of overwriting.
   * @param {boolean} overwriteExisting 
   * @param {function} onProgress 
   */
  async installPackage(packageTarFilePath, packageFolder, overwriteExisting = false, onProgress = null) {
    let targetFilePath;

    try {
      if (overwriteExisting && await this.packageFolderExists(packageFolder)) {
        console.debug(`🗑 Deleting existing package folder: ${packageFolder}`);
        await this.deletePackageFolder(packageFolder);
      }
      
      console.debug('📤 Uploading file to board');
      targetFilePath = path.basename(packageTarFilePath);
      await this.uploadArchive(packageTarFilePath, targetFilePath, onProgress);
      await this.extractArchiveOnBoard(targetFilePath);
    } catch (error) {
      throw new Error(`Couldn't install package: ${error.message}`);
    } finally {
      await this.cleanUp(targetFilePath);
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