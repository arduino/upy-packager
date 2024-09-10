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

    /**
     * Packages the repository and installs tha package on the board
     * @param {string} repositoryUrl The URL of the repository to package and install
     * @param {boolean} overwriteExisting Whether to overwrite existing files on the board. Defaults to false.
     * When set to true, an existing package folder with the same name will be deleted before installing the new package.
     * @param {Object} customPackageJson The custom package.json object.
     * This parameter is optional. If not provided, the package.json file from the repository will be used.
     */
    async packageAndInstall(repositoryUrl, overwriteExisting = false, customPackageJson = null) {
        let tarFilePath, targetFilePath, packageInstaller, packageFolder;
        let downloadedFileCallback = null;
        const board = new MicroPythonBoard()

        try {
            await board.open(this.serialPort)
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

            const archiveResult = await archiver.archiveRepository(customPackageJson, null, downloadedFileCallback);            
            packageFolder = archiveResult.packageFolder;
            tarFilePath = archiveResult.archivePath;
            console.debug(`✅ Archive created: ${archiveResult.archivePath}`);
        } catch (error) {
            await board.close();
            throw new Error(`Couldn't create archive: ${error.message}`);
        }

        try {
            packageInstaller = new PackageInstaller(board);
            targetFilePath = path.basename(tarFilePath);

            if(overwriteExisting && await packageInstaller.packageFolderExists(packageFolder)) {
                console.debug(`🗑 Deleting existing package folder: ${packageFolder}`);
                await packageInstaller.deletePackageFolder(packageFolder);
            }
            
            console.debug('📤 Uploading file to board');
            await packageInstaller.uploadArchive(tarFilePath, targetFilePath, (progress) => {
                console.debug(`Progress: ${progress}%`);
            });
            await packageInstaller.extractArchiveOnBoard(targetFilePath);
        } catch (error) {
            throw new Error(`Couldn't install package: ${error.message}`);
        } finally {
            await packageInstaller.cleanUp(targetFilePath);
            console.debug('🧹 Cleaning up local archive file...');
            fs.removeSync(tarFilePath);
            await board.close();
        }
    }
}

export { Packager };