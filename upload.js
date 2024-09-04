import MicroPythonBoard from 'micropython.js';
import fs from 'fs-extra';
import path from 'path';
import GitRepoArchiver from './GitRepoArchiver.js';

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
  let sourceFile, targetFile, board;

  try {
    console.log(`🔧 Creating archive from ${REPOSITORY}...`);
    sourceFile = await getArchiveFromRepository(REPOSITORY, CUSTOM_PACKAGE_JSON);
    console.log(`✅ Archive created: ${sourceFile}`);
  } catch (error) {
    console.error(`❌ Couldn't create archive: ${error.message}`);
    return;
  }
  
  try {
    targetFile = path.basename(sourceFile);
    const port = process.env.PORT || DEFAULT_PORT;
    board = new MicroPythonBoard()
    await board.open(port)
    await uploadArchive(board, sourceFile, targetFile);
    await extractArchiveOnBoard(board, targetFile);
  } catch (error) {
    console.error(`❌ Couldn't upload package: ${error.message}`);
  } finally {
    await cleanUp(board, targetFile, sourceFile);
    await board.close();    
    console.log('✅ Done');
  }
}

main()

async function getArchiveFromRepository(repoUrl, customPackageJson = null) {
  const archiver = new GitRepoArchiver(repoUrl);
  return await archiver.archiveRepo(customPackageJson);
}

function extractREPLMessage(out) {
  /*
   * Message ($msg) will come out following this template:
   * "OK${msg}\x04${err}\x04>"
   */
  return out.slice(2, -3)
}

async function extractArchiveOnBoard(board, archiveFileName) {
  const extractScriptFilePath = path.join(__dirname, 'extract_archive.py');
  const tarfileLibFilePath = path.join(__dirname, 'tarfile.py');

  console.log('📦 Extracting archive...')
  let output;

  await board.enter_raw_repl()
  output = extractREPLMessage(await board.exec_raw('from tarfile import TarFile, DIRTYPE'))
  await board.exit_raw_repl()
  
  // Load tarfile.py if not installed on the board
  if(output.includes('ImportError')) {
    output = extractREPLMessage(await board.execfile(tarfileLibFilePath));
    if (output !== '') {
      throw new Error('Failed to load tarfile.py. Output: ' + output);
    }
  }

  output = extractREPLMessage(await board.execfile(extractScriptFilePath));
  if (output !== '') {
    throw new Error('Failed to import extract_archive.py. Output: ' + output);
  }
  
  await board.enter_raw_repl()
  const command = `untar('${archiveFileName}')`;
  output = extractREPLMessage(await board.exec_raw(command))
  await board.exit_raw_repl()

  if(output.includes('[Errno 17] EEXIST')) {
    throw new Error('Failed to extract archive because file(s) already exists');
  }

  if (!output.includes('Extraction complete')) {
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