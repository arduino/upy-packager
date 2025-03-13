import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { extractREPLMessage, fileOrDirectoryExists, writeFile, getPromptWithTimeout, ensureDirectoryExists, getLibrariesSystemPath } from './micropython-extensions.js';
import MicroPythonBoard from 'micropython.js';

// Define __dirname for ES6 modules
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Class to install packages on the MicroPython board.
 * It uploads the package tar file, extracts it and verifies the hash of the extracted files.
 * This class assumes that the board's port is already open.
 * It takes care of deleting existing package folders and files if that option is enabled.
 */
class PackageInstaller {
  /**
   * Constructs a new PackageInstaller instance
   * @param {MicroPythonBoard} board The MicroPython board instance to use.
   * @param {string} libraryPath The path to the library folder on the board. 
   * If not provided, the default library path will be determined and used at installation time.
   * This class assumes that the board's port is already open.
   */
  constructor(board, libraryPath = null) {
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
    
    await getPromptWithTimeout(this.board);
    let output = extractREPLMessage(await this.board.execfile(scriptPath));
    if (output !== '') {
      throw new Error('Failed to load validate_hash.py. Output: ' + output);
    }
    await this.board.enter_raw_repl();
    output = extractREPLMessage(await this.board.exec_raw(`validate_hash('${targetFile}', b'${localFileHash}')`));
    await this.board.exit_raw_repl()
    return output === '1';
  }

  /**
   * Gets the library path on the board that was either provided
   * through the constructor or determined when calling this method the first time.
   * @returns {Promise<string>} The library path on the board.
   */
  async getLibrariesPath() {
    if (this.libraryPath === null) {
      this.libraryPath = await getLibrariesSystemPath(this.board);
      if(this.libraryPath === null) {
        // As a last resort, use a default library path that is commonly used on MicroPython boards
        // It will be created if it doesn't exist at installation time
        this.libraryPath = '/lib';
      }
    }
    return this.libraryPath;
  }

  /**
   * Determines if the given package folder or file exists on the board.
   * Please note that the package name and the package folder name are not necessarily the same.
   * The package folder is the folder where the package is extracted to.
   * @param {string} packagePath The package folder name or file path in case of single file packages.
   * This is a relative path that gets appended to the library path.
   * @returns {Promise<boolean>} True if the package folder exists, false otherwise
   */
  async packageExists(packagePath) {
    const libPath = await this.getLibrariesPath();
    return fileOrDirectoryExists(this.board, path.posix.join(libPath, packagePath));
  }

  /**
   * Deletes the given package folder on the board
   * Please note that the package name and the package folder name are not necessarily the same.
   * The package folder is the folder where the package is extracted to.
   * @param {string} packageFolder The package folder name.
   */
  async deletePackageFolder(packageFolder) {
    await getPromptWithTimeout(this.board);
    await this.board.execfile(path.join(__dirname, "python", 'remove_directory.py'));
    await this.board.enter_raw_repl();
    const libPath = await this.getLibrariesPath();
    const targetDirectory = path.posix.join(libPath, packageFolder);
    const output = extractREPLMessage(await this.board.exec_raw(`remove_directory_recursive('${targetDirectory}')`));
    await this.board.exit_raw_repl()

    if (output.includes('OSError:')) {
      const errorMessage = output.match(/OSError: \[.*\] .*/)[0];
      throw new Error(`Failed to delete existing package folder ${packageFolder}. ${errorMessage}`);
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

    const stats = fs.statSync(sourceFilePath);
    console.debug(`ℹ️ Uploading (${(stats.size / 1024).toFixed(2)} KB)...`);

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
    await getPromptWithTimeout(this.board);
    await this.board.enter_raw_repl();
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

    const libPath = await this.getLibrariesPath();
    await ensureDirectoryExists(this.board, libPath);
    await this.board.enter_raw_repl();
    const command = `untar('${archiveFilePath}', '${libPath}')`;
    output = extractREPLMessage(await this.board.exec_raw(command))
    await this.board.exit_raw_repl()

    if (output.includes('[Errno 17] EEXIST')) {
      // Find out which folders already exist from the output e.g. 'Creating directory lib/arduino_iot_cloud\r\n'
      const regex = new RegExp(/Creating directory (\S*)\r\n/g);
      const createdFolders = Array.from(output.matchAll(regex), m => m[1]);

      // Last folder is the one that failed to be created
      const failedFolder = createdFolders[createdFolders.length - 1];
      throw new Error(`Failed to extract archive because file(s) already exists: ${failedFolder}`);
    }

    if (!output.includes('Extraction complete')) {
      throw new Error('Failed to extract archive: ' + output);
    }
  }

  /**
   * Extracts the common folders of the target paths in the package.json file
   * This is useful to determine the target folder when extracting the archive on the board
   * E.g. if the target paths are ['modulino/__init__.py', 'modulino/buttons.py']
   * the common folder is 'modulino'.
   * @param {Array<string>} targetPaths The target paths of all files in the package.
   * @returns {Array<string>} The common folders of the target paths in the package.json file
   * or an empty array if no common folders are found.
   */
  getPackageFolders(targetPaths) {
    const folders = targetPaths.map(entry => {
      const parts = entry.split('/')
      if (parts.length > 1) {
        return parts[0];
      }
      return null;
    }).filter(folder => folder !== null);
    
    // Filter out duplicates
    return [...new Set(folders)];
  }

  /**
   * Installs a package on the board by uploading the package tar file, extracting it and cleaning up
   * the tar file that was uploaded and is no longer needed.
   * @param {string} packageTarFilePath The source package tar file path
   * @param {Array} packageFiles The package file paths that are expected to be extracted to the package folder.
   * This is used to check if files would be overwritten when installing the package.
   * @param {boolean} overwriteExisting Whether to overwrite existing package folders on the board.
   * Defaults to true. Please note that single files are always overwritten as they
   * are not checked for existence.
   * @param {function} onProgress An optional callback function to track the upload progress.
   * The callback takes an integer argument representing the percentage of the upload progress.
   */
  async installPackage(packageTarFilePath, packageFiles, overwriteExisting = true, onProgress = null) {
    let targetFilePath = path.basename(packageTarFilePath);
    const packageFolders = this.getPackageFolders(packageFiles);
    // Files in the library root are treated as single file packages
    const filesInLibRoot = packageFiles.filter(file => file.split('/').length === 1);

    try {
      // There is no need to handle the case of deleting existing single files 
      // as they are overwritten without raising an error
      if(!overwriteExisting) {
        for(const fileInLibRoot of filesInLibRoot) {
          if(await this.packageExists(fileInLibRoot)) {
            throw new Error(`Installation would overwrite existing file in the root of the lib folder: ${fileInLibRoot}`);
          }
        }
      }

      for(const packageFolder of packageFolders) {
        if(await this.packageExists(packageFolder)) {
          if(overwriteExisting) {
            console.debug(`🗑 Deleting existing package folder: ${packageFolder}`);
            await this.deletePackageFolder(packageFolder);
          } else {
            throw new Error(`Installation would overwrite existing package folder: ${packageFolder}`);
          }
        }
      }
      
      console.debug('📤 Uploading file to board');
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
    console.debug(`🧹 Cleaning up archive file '${remoteFile}' on board...`);
    await this.board.fs_rm(remoteFile);
  }
}

export { PackageInstaller };