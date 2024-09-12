import MicroPythonBoard from 'micropython.js';
import path from 'path';
import fs from 'fs-extra';
import { RepositoryArchiver } from './repository-archiver.js';
import { PackageInstaller } from './package-installer.js';
import { MPyCrossCompiler } from './mpy-cross-compiler.js';
import { getArchitectureFromBoard, getMPyFileFormatFromBoard } from './board-helpers.js';

class Packager {
    constructor(serialPort) {
        this.serialPort = serialPort;
        this.board = new MicroPythonBoard();
    }

    /**
     * Packages the repository into a .tar.gz archive for the given architecture and mpy file format
     * @param {string} repositoryUrl The URL of the repository to package
     * @param {string} architecture The architecture of the board (e.g. 'xtensa')
     * @param {number} format The major version of the mpy file format (e.g. 6)
     * @param {Object} customPackageJson The custom package.json object.
     * This parameter is optional. If not provided, the package.json file from the repository will be used.
     * @returns {Promise<{ archivePath: string, packageFolder: string }>} A promise that resolves to the path of the archive file
     * and the path of the package folder
     * @throws {Error} If the package cannot be created
     */
    async packageForArchitectureAndFormat(repositoryUrl, architecture, format, customPackageJson = null) {
        const compiler = new MPyCrossCompiler();
        let downloadedFileCallback = null;

        if (architecture && format && await compiler.supportsMpyFileFormat(format)) {
            downloadedFileCallback = async (filePath) => {
                const fileName = path.basename(filePath);
                console.debug(`✅ File downloaded: ${fileName}`);
                console.debug(`🔧 Compiling ${fileName}...`);
                return await compiler.compileFile(filePath, architecture);
            }
        }

        const archiver = new RepositoryArchiver(repositoryUrl);
        return archiver.archiveRepository(customPackageJson, null, downloadedFileCallback);                        
    }

    /**
     * Packages the repository into a .tar.gz archive
     * It does so by first determining the architecture and mpy file format of the board
     * and then compiling the files if necessary.
     * @param {string} repositoryUrl The URL of the repository to package
     * @param {Object} customPackageJson The custom package.json object.
     * This parameter is optional. If not provided, the package.json file from the repository will be used.
     * @returns {Promise<{ archivePath: string, packageFolder: string }>} A promise that resolves to the path of the archive file
     * and the path of the package folder.
     * @throws {Error} If the package cannot be created
     */
    async package(repositoryUrl, customPackageJson = null) {        
        let archiveResult;        

        try {            
            console.debug(`🔧 Creating archive from ${repositoryUrl}...`);            
            const architecture = await getArchitectureFromBoard(this.board);
            const format = await getMPyFileFormatFromBoard(this.board);
            archiveResult = await this.packageForArchitectureAndFormat(repositoryUrl, architecture, format, customPackageJson);
            console.debug(`✅ Archive created: ${archiveResult.archivePath}`);
        } catch (error) {
            throw new Error(`Couldn't package archive: ${error.message}`);
        }

        return archiveResult;
    }

    /**
     * Packages the repository and installs tha package on the board
     * @param {string} repositoryUrl The URL of the repository to package and install
     * @param {boolean} overwriteExisting Whether to overwrite existing files on the board. Defaults to false.
     * When set to true, an existing package folder with the same name will be deleted before installing the new package.
     * @param {Object} customPackageJson The custom package.json object.
     * This parameter is optional. If not provided, the package.json file from the repository will be used.
     */
    async packageAndInstall(repositoryUrl, overwriteExisting = false, customPackageJson = null) {
        await this.board.open(this.serialPort);

        const archiveResult = await this.package(repositoryUrl, customPackageJson);
        const packageFolder = archiveResult.packageFolder;
        const tarFilePath = archiveResult.archivePath;
        const packageInstaller = new PackageInstaller(this.board);
        
        try {
            await packageInstaller.installPackage(tarFilePath, packageFolder, overwriteExisting, (progress) => {
                console.debug(`Progress: ${progress}%`);
            });
        } catch (error) {
            throw new Error(`Couldn't install package: ${error.message}`);
        } finally {
            console.debug('🧹 Cleaning up local archive file...');
            fs.removeSync(tarFilePath);
            await this.board.close();
        }
    }
}

export { Packager };