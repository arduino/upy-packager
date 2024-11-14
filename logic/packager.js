import MicroPythonBoard from 'micropython.js';
import path from 'path';
import fs from 'fs-extra';
import { ArchiveResult, RepositoryArchiver } from './repository-archiver.js';
import { PackageInstaller } from './package-installer.js';
import { MPyCrossCompiler } from './mpy-cross-compiler.js';
import { getArchitectureFromBoard, getMPyFileFormatFromBoard } from './board-helpers.js';

class Packager {
    constructor(serialPort, compileFiles = true) {
        this.serialPort = serialPort;
        this.board = new MicroPythonBoard();
        this.compileFiles = compileFiles;
    }

    /**
     * Packages the repository into a .tar.gz archive for the given architecture and mpy file format
     * @param {string} repositoryUrl The URL of the repository to package
     * @param {string} version The version of the repository to package.
     * @param {string} architecture The architecture of the board (e.g. 'xtensa')
     * @param {number} mpyFormat The major version of the mpy file format (e.g. 6)
     * @param {Object} customPackageJson The custom package.json object.
     * This parameter is optional. If not provided, the package.json file from the repository will be used.
     * @returns {Promise<ArchiveResult>} A promise that resolves to the result of the archive operation,
     * including the path of the archive file and the package folders.
     * and the path of the package folder
     * @throws {Error} If the package cannot be created
     */
    async packageForArchitectureAndFormat(repositoryUrl, version, architecture, mpyFormat, customPackageJson = null) {
        const compiler = new MPyCrossCompiler();
        let downloadedFileCallback = null;

        if (architecture && mpyFormat && await compiler.supportsMpyFileFormat(mpyFormat)) {
            downloadedFileCallback = async (filePath) => {
                const fileName = path.basename(filePath);
                console.debug(`✅ File downloaded: ${fileName}`);
                console.debug(`🔧 Compiling ${fileName}...`);
                return await compiler.compileFile(filePath, architecture);
            }
        }

        const archiver = new RepositoryArchiver(repositoryUrl, version, mpyFormat, customPackageJson);
        return archiver.archiveRepository(downloadedFileCallback);                        
    }

    /**
     * Packages the repository into a .tar.gz archive
     * It does so by first determining the architecture and mpy file format of the board
     * and then compiling the files if necessary.
     * @param {string} repositoryUrl The URL of the repository to package
     * @param {string} version The version of the repository to package. Defaults to latest.
     * @param {Object} customPackageJson The custom package.json object.
     * This parameter is optional. If not provided, the package.json file from the repository will be used.
     * @param {boolean} closePort Whether to close the serial port after packaging the repository. Defaults to true.
     * @returns {Promise<ArchiveResult>} A promise that resolves to the result of the archive operation,
     * including the path of the archive file, the package folders.
     * and the path of the package folder.
     * @throws {Error} If the package cannot be created
     */
    async package(repositoryUrl, version = null, customPackageJson = null, closePort = true) {        
        let archiveResult;
        let architecture = null;
        let mpyFormat = null;
        version = version || "HEAD";

        try {            
            if(!this.board.serial?.isOpen) {
                await this.board.open(this.serialPort);
            }
            console.debug(`🔧 Creating archive from ${repositoryUrl}...`);

            // If the files need to be compiled, get the architecture and mpy file format
            // Not specifying those will result in the compilation being skipped.
            if(this.compileFiles) {         
                architecture = await getArchitectureFromBoard(this.board);
                mpyFormat = await getMPyFileFormatFromBoard(this.board);
            }

            archiveResult = await this.packageForArchitectureAndFormat(repositoryUrl, version, architecture, mpyFormat, customPackageJson);
            console.debug(`✅ Archive created: ${archiveResult.archivePath}`);
        } catch (error) {
            throw new Error(`Couldn't package archive: ${error.message}`);
        } finally {
            if(closePort) await this.board.close();
        }

        return archiveResult;
    }

    /**
     * Packages the repository and installs tha package on the board
     * @param {string} repositoryUrl The URL of the repository to package and install
     * @param {string} version The version of the repository to install. Defaults to latest.
     * @param {Object} customPackageJson The custom package.json object.
     * This parameter is optional. If not provided, the package.json file from the repository will be used.
     * @param {boolean} overwriteExisting Whether to overwrite existing files on the board. Defaults to true.
     * When set to true, an existing package folder with the same name will be deleted before installing the new package.
     */
    async packageAndInstall(repositoryUrl, version = null, customPackageJson = null, overwriteExisting = true) {
        if(!this.board.serial?.isOpen) {
            await this.board.open(this.serialPort);
        }

        version = version || "HEAD";
        const archiveResult = await this.package(repositoryUrl, version, customPackageJson, false);
        const packageFiles = archiveResult.packageFiles;
        const tarFilePath = archiveResult.archivePath;
        const packageInstaller = new PackageInstaller(this.board);
        
        try {
            await packageInstaller.installPackage(tarFilePath, packageFiles, overwriteExisting, (progress) => {
                console.debug(`Progress: ${progress}%`);
            });
        } catch (error) {
            throw error;
        } finally {
            console.debug('🧹 Cleaning up local archive file...');
            fs.removeSync(tarFilePath);
            await this.board.close();
        }
    }
}

export { Packager };