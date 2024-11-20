import { Packager } from "../logic/packager.js";

const TEST_DATA = {
  "repository": "https://github.com/arduino/arduino-modulino-mpy",
  "port": "/dev/cu.usbmodem1101",
  "customPackageJson": {
    "urls": [
      ["modulino/__init__.py", "github:arduino/modulino-mpy/src/modulino/__init__.py"],
      ["modulino/buttons.py", "github:arduino/modulino-mpy/src/modulino/buttons.py"]
    ],
    "version": "1.0.0"
  }
};

async function main() {
  let repository, port, customPackageJson = null;

  // Read repository and port from command line arguments
  const args = process.argv.slice(2);
  if(args.length < 2) {
    repository = TEST_DATA.repository;
    port = TEST_DATA.port;
    customPackageJson = TEST_DATA.customPackageJson;
  } else {
    repository = args[0];
    port = args[1];
  }

  const packager = new Packager(port);
  try {
    await packager.packageAndInstall(repository, null, customPackageJson);
    console.debug('✅ Done');
  } catch (error) {
    console.error(`❌ ${error.message}`);
  }
}

main()
