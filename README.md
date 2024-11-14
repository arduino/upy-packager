# 📦 uPy-Packager

A Node.js package to install MicroPython libraries on a microcontroller board running MicroPython.
This tool requires MicroPython to be installed beforehand. The serial port of the board needs to be known.

## 💻 Usage

### ⬆️ Package and Install
The main use case is to package libraries and upload them to a connected board. To do so you can use the `Packager` class:

```js
const packager = new Packager("/dev/cu.usbmodem1234561");
  try {
    await packager.packageAndInstall("https://github.com/arduino/arduino-modulino-mpy", null, customPackageJson);
    console.debug('✅ Done');
  } catch (error) {
    console.error(`❌ ${error.message}`);
  }
```

The supported formats of the URL are:
- `github:owner/repo`
- `gitlab:owner/repo`
- `https://github.com/owner/repo`
- `https://gitlab.com/owner/repo`

It's also possible to specify custom package.json files, e.g. `https://github.com/arduino/arduino-iot-cloud-py/package.json`

Installing single files is also supported, e.g. `https://github.com/arduino/arduino-iot-cloud-py/src/arduino_iot_cloud/ucloud.py`. The files doesn't necessarily have to be hosted on Github. Any URL pointing to a Python file works.

And you can also install packages from the official [MicroPython library repository](https://github.com/micropython/micropython-lib), e.g. `ssd1306`.

#### Versions

If you would like to install a specific version you can pass it to `packageAndInstall` as the second parameter:

```js
packager.packageAndInstall(repositoryUrl, "1.0")
```

If the paramter is omitted, the `HEAD` branch will be used.

#### Overriding package.json

Sometimes you may want to override the package.json of a given library. Maybe the library is lacking the package file completely, or you may want to install only a selection of the available files. In either case you can provide your custom package.json in JavaScript object notation:

```js
const customPackageJson = {
    "urls": [
        ["modulino/__init__.py", "github:arduino/modulino-mpy/src/modulino/__init__.py"],
        ["modulino/buttons.py", "github:arduino/modulino-mpy/src/modulino/buttons.py"]
    ]
}
packager.packageAndInstall(repositoryUrl, null, customPackageJson)
```

#### Compilation

By default Python files will be compiled for the architecture and file format suitable for the connected board. If you prefer to skip compilation you can configure this in the constructor of the Packager object:

```js
const packager = new Packager("/dev/cu.usbmodem1234561", false);
```

#### Overwriting Files

By default existing packages will be deleted before a new package is installed. No check is performed if the installed package is the same version. This is because there is no guarantee that this information is availabe or accurate.
If you prefer to not overwrite existing packages, you can pass `false` to the fourth parameter of `packageAndInstall`:

```js
packager.packageAndInstall(repositoryUrl, null, null, false)
```

This might be useful to make sure installations of packages with the same name do not overwrite each other. The uniqueness of the library's folder cannot be guaranteed.

### 🌐 Package Libraries as a Web Service

It's also possible to use the built-in web server to package libraries. This is useful for web tools that may want to install libraries but are subject to CORS. They can use this tool to create a web service that serves package files from arbitrary hosts:

```js
const webServer = new PackagerWebServer();
webServer.start();
```

The web server accepts GET and POST requests.

The GET request accepts the following query parameters:
 - `repoUrl`: The URL of the repository to archive (required)
 - `version`: The version of the repository to archive
 - `architecture`: The architecture of the MicroPython file
 - `format`: The format of the MicroPython file
 
 The POST request accepts the following body parameters:
 - `repoUrl`: The URL of the repository to archive (required)
 - `version`: The version of the repository to archive (e.g. 1.0)
 - `architecture`: The architecture of the MicroPython file (e.g. xtensa)
 - `format`: The format of the MicroPython file (e.g. 6)
 - `customPackageJson`: A custom package.json object to override the package.json in the repository
 
 POST request can be encoded as `application/x-www-form-urlencoded` or `application/json`.

### Custom Use Cases

For more custom use cases, the following classes are available in the package:

- `Packager`: Download, package, upload and install libraries.
- `MPyCrossCompiler`: Compile .py files for a specific architecture and runtime.
- `PackageInstaller`: Upload and install libraries from .tar.gz archives.
- `RepositoryArchiver`: Download and package libraries as .tar.gz archives.

## 🧑‍💻 Development

All the core logic is located in the `logic` folder. Additional functionality can be added there.
The `test` folder contains a few files that help to test manually the different use cases or parts of the functionality. They can be run either using Node.js directly or via the VS-Code launch profile.

## 🐛 Reporting Issues

If you encounter any issue, please open a bug report [here](https://github.com/arduino/upy-packager/issues). 

## 💪 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## 🤙 Contact

For questions, comments, or feedback on this package, please create an issue on this repository.