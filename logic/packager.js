import MicroPythonBoard from 'micropython.js';
import path from 'path';
import fs from 'fs-extra';
import { RepositoryArchiver } from './repository-archiver.js';
import { PackageInstaller } from './package-installer.js';
import { MPyCrossCompiler } from './mpy-cross-compiler.js';

class Packager {
    constructor(serialPort) {
        this.serialPort = serialPort;
    }

    async package(board, repositoryUrl, customPackageJson = null, mpyFileFormat = null) {        
        let archiveResult;
        let downloadedFileCallback = null;

        try {            
            console.debug(`🔧 Creating archive from ${repositoryUrl}...`);
            const archiver = new RepositoryArchiver(repositoryUrl);
            const compiler = new MPyCrossCompiler(board);

            if (await compiler.supportsBoardMpyFileFormat()) {
                const architecture = await compiler.getArchitectureFromBoard();

                downloadedFileCallback = async (filePath) => {
                    const fileName = path.basename(filePath);
                    console.debug(`✅ File downloaded: ${fileName}`);
                    console.debug(`🔧 Compiling ${fileName}...`);
                    return await compiler.compileFile(filePath, architecture);
                }
            }

            archiveResult = await archiver.archiveRepository(customPackageJson, null, downloadedFileCallback);                        
            console.debug(`✅ Archive created: ${archiveResult.archivePath}`);
        } catch (error) {
            await board.close();
            throw new Error(`Couldn't create archive: ${error.message}`);
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
        const board = new MicroPythonBoard();
        await board.open(this.serialPort);

        const archiveResult = await this.package(board, repositoryUrl, customPackageJson);
        const packageFolder = archiveResult.packageFolder;
        const tarFilePath = archiveResult.archivePath;
        const packageInstaller = new PackageInstaller(board);
        
        try {
            await packageInstaller.installPackage(tarFilePath, packageFolder, overwriteExisting, (progress) => {
                console.debug(`Progress: ${progress}%`);
            });
        } catch (error) {
            throw new Error(`Couldn't install package: ${error.message}`);
        } finally {
            console.debug('🧹 Cleaning up local archive file...');
            fs.removeSync(tarFilePath);
            await board.close();
        }
    }
}

export { Packager };