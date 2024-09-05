import MicroPythonBoard from 'micropython.js';
import fs from 'fs-extra';
import path from 'path';
import GitRepoArchiver from './GitRepoArchiver.js';
import crypto from 'crypto';

// Define __dirname for ES6 modules
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const REPOSITORY = "https://github.com/arduino/arduino-modulino-mpy"
// const CUSTOM_PACKAGE_JSON = {
//   "urls": [
//     ["modulino/__init__.py", "github:arduino/modulino-mpy/src/modulino/__init__.py"],
//     ["modulino/buttons.py", "github:arduino/modulino-mpy/src/modulino/buttons.py"]
//   ],
//   "version": "1.0.0"
// }
const CUSTOM_PACKAGE_JSON = null;

const DEFAULT_PORT = '/dev/cu.usbmodem1234561'

async function main() {
  // Read repository and port from command line arguments
  const args = process.argv.slice(2);
  const repository = args[0] || REPOSITORY;
  const port = args[1] || DEFAULT_PORT;

  let sourceFile, targetFile, board;

  try {
    console.log(`🔧 Creating archive from ${repository}...`);
    sourceFile = await getArchiveFromRepository(repository, CUSTOM_PACKAGE_JSON);
    console.log(`✅ Archive created: ${sourceFile}`);
  } catch (error) {
    console.error(`❌ Couldn't create archive: ${error.message}`);
    return;
  }
  
  try {
    targetFile = path.basename(sourceFile);
    board = new MicroPythonBoard()
    await board.open(port)
    await uploadArchive(board, sourceFile, targetFile);
    console.log('🔍 Verifying hash...');
    if(!await verifyHash(board, sourceFile, targetFile)) {
      throw new Error('❌ Hash mismatch');
    }
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

async function calculateHash(filePath) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
    input.on('error', reject);
  });
}

async function verifyHash(board, filePath, targetFile) {
  const localFileHash = await calculateHash(filePath);
  // TODO: Possibly read file in chunks
  const pythonCommand = `
from hashlib import sha256
from binascii import hexlify

hash = sha256()

with open('${targetFile}', 'rb') as f:    
    data = f.read()
    hash.update(data)

digest_hex = hexlify(hash.digest())

if digest_hex == b'${localFileHash}':
  print('Hash OK')
else:
  print('Hash mismatch')
`;
  await board.enter_raw_repl()
  const output = await board.exec_raw(pythonCommand)
  await board.exit_raw_repl()
  return output.includes('Hash OK');
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
  process.stdout.write('📤 Uploading file to board');
  await board.fs_put(sourceFile, targetFile, (output) => {
    process.stdout.write(".");
  });
  process.stdout.write("\n");
}

async function cleanUp(board, remoteFile, localFile) {
  console.log('🧹 Cleaning up local archive file...');
  fs.removeSync(localFile);
  console.log('🧹 Cleaning up archive file on board...');
  await board.fs_rm(remoteFile);
}