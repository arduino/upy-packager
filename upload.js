import MicroPythonBoard from 'micropython.js';
import path from 'path';
import fs from 'fs-extra';
import { RepositoryArchiver} from './logic/repository-archiver.js';
import { PackageInstaller } from './logic/package-installer.js';
import { MPyCrossCompiler } from './logic/mpy-cross-compiler.js';

const REPOSITORY = "https://github.com/arduino/arduino-modulino-mpy"
// const CUSTOM_PACKAGE_JSON = {
//   "urls": [
//     ["modulino/__init__.py", "github:arduino/modulino-mpy/src/modulino/__init__.py"],
//     ["modulino/buttons.py", "github:arduino/modulino-mpy/src/modulino/buttons.py"]
//   ],
//   "version": "1.0.0"
// }
// const REPOSITORY = null;
const CUSTOM_PACKAGE_JSON = null;

const DEFAULT_PORT = '/dev/cu.usbmodem1234561'

async function main() {
  // Read repository and port from command line arguments
  const args = process.argv.slice(2);
  const repository = args[0] || REPOSITORY;
  const port = args[1] || DEFAULT_PORT;

  let sourceFilePath, targetFilePath, packageInstaller;
  let downloadedFileCallback = null;
  const board = new MicroPythonBoard()
  
  try {
    await board.open(port)
    console.log(`🔧 Creating archive from ${repository}...`);
    const archiver = new RepositoryArchiver(repository);
    const compiler = new MPyCrossCompiler(board);

    if(await compiler.supportsBoardMpyFileFormat()) {
      const architecture = await compiler.getArchitectureFromBoard();
      
      downloadedFileCallback = async (filePath) => {
        const fileName = path.basename(filePath);
        console.log(`✅ File downloaded: ${fileName}`);
        console.log(`🔧 Compiling ${fileName}...`);
        return await compiler.compileFile(filePath, architecture);
      }
    }

    sourceFilePath = await archiver.archiveRepository(CUSTOM_PACKAGE_JSON, null, downloadedFileCallback);
    console.log(`✅ Archive created: ${sourceFilePath}`);
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
    console.log('🧹 Cleaning up local archive file...');
    fs.removeSync(sourceFilePath);
    await board.close();    
    console.log('✅ Done');
  }
}

main()
