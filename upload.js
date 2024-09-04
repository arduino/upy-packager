import MicroPythonBoard from 'micropython.js';
import fs from 'fs-extra';
import path from 'path';
import GitRepoArchiver from './GitRepoArchiver.js';
import { r } from 'tar';

// Define __dirname for ES6 modules
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const REPOSITORY = "https://github.com/arduino/arduino-modulino-mpy"
const CUSTOM_PACKAGE_JSON = {
  "urls": [
    ["modulino/__init__.py", "github:arduino/modulino-mpy/src/modulino/__init__.py"],
    ["modulino/buttons.py", "github:arduino/modulino-mpy/src/modulino/buttons.py"]
  ],
  "version": "1.0.0"
}

const DEFAULT_PORT = '/dev/cu.usbmodem1234561'

async function main() {
  let sourceFile, board;
  
  try {
    console.log(`🔧 Creating archive from ${REPOSITORY}...`);
    sourceFile = await getArchiveFromRepository(REPOSITORY, CUSTOM_PACKAGE_JSON);
    console.log(`✅ Archive created: ${sourceFile}`);
  } catch (error) {
    console.error(`❌ Couldn't create archive: ${error.message}`);
    return;
  }
  
  try {
    const targetFile = path.basename(sourceFile);
    const port = process.env.PORT || DEFAULT_PORT;
    board = new MicroPythonBoard()
    await board.open(port)
    await uploadArchive(board, sourceFile, targetFile);
    await extractArchiveOnBoard(board, targetFile, false);
    await cleanUp(board, targetFile, sourceFile);
  } catch (error) {
    console.error(`❌ Couldn't upload package: ${error.message}`);
  } finally {
    await board.close();    
    console.log('✅ Done');
  }
}

main()

async function getArchiveFromRepository(repoUrl, customPackageJson = null) {
  const archiver = new GitRepoArchiver(repoUrl);
  return await archiver.archiveRepo(customPackageJson);
}

async function extractArchiveOnBoard(board, archiveFileName, loadTarfileLib = true) {
  const extractScriptFilePath = path.join(__dirname, 'extract_archive.py');
  const tarfileLibFilePath = path.join(__dirname, 'tarfile.py');

  console.log('📦 Extracting archive...')
  let output;

  if(loadTarfileLib) {
    output = await board.execfile(tarfileLibFilePath);
    if (output.slice(0, 2) !== 'OK') {
      throw new Error('Failed to load tarfile.py. Output: ' + output);
    }
  } else {
    await board.enter_raw_repl()
    output = await board.exec_raw('from tarfile import TarFile, DIRTYPE')
    await board.exit_raw_repl()
    if (output.slice(0, 2) !== 'OK') {
      throw new Error('Failed to import tarfile. Output: ' + output);
    }
  }

  output = await board.execfile(extractScriptFilePath);
  // Fail if first two characters are not OK
  if (output.slice(0, 2) !== 'OK') {
    throw new Error('Failed to import extract_archive.py. Output: ' + output);
  }
  
  await board.enter_raw_repl()
  const command = `untar('${archiveFileName}')`;
  output = await board.exec_raw(command)
  await board.exit_raw_repl()

  if (output.slice(0, 2) !== 'OK') {
    throw new Error('Failed to extract archive' + output);
  }
}

async function uploadArchive(board, sourceFile, targetFile) {
  console.log('⬆️ Sending file to board...');
  await board.fs_put(sourceFile, targetFile, console.log);
}

async function cleanUp(board, remoteFile, localFile) {
  console.log('🧹 Cleaning up archive file on board...');
  await board.fs_rm(remoteFile);
  console.log('🧹 Cleaning up local archive file...');
  fs.removeSync(localFile);
}