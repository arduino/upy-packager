import MicroPythonBoard from 'micropython.js';
import path from 'path';
import fs from 'fs-extra';
import { RepositoryArchiver} from './repository-archiver.js';
import { PackageInstaller } from './package-installer.js';
import { MPyCrossCompiler } from './mpy-cross-compiler.js';

class Packager {
    constructor(serialPort) {
        this.serialPort = serialPort;
    }

    async packageAndInstall(repositoryUrl, customPackageJson) {
        let sourceFilePath, targetFilePath, packageInstaller;
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

            sourceFilePath = await archiver.archiveRepository(customPackageJson, null, downloadedFileCallback);
            console.debug(`✅ Archive created: ${sourceFilePath}`);
        } catch (error) {
            console.error(`❌ Couldn't create archive: ${error.message}`);
            await board.close();
            return;
        }

        try {
            targetFilePath = path.basename(sourceFilePath);
            packageInstaller = new PackageInstaller(board);
            console.debug('📤 Uploading file to board');
            await packageInstaller.uploadArchive(sourceFilePath, targetFilePath, (progress) => {
                console.debug(`Progress: ${progress}%`);
            });
            await packageInstaller.extractArchiveOnBoard(targetFilePath);
        } catch (error) {
            console.error(`❌ Couldn't install package: ${error.message}`);
        } finally {
            await packageInstaller.cleanUp(targetFilePath);
            console.debug('🧹 Cleaning up local archive file...');
            fs.removeSync(sourceFilePath);
            await board.close();            
        }
    }
}

export { Packager };