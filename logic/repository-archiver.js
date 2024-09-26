import * as tar from 'tar';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);
const MICROPYTHON_LIB_INDEX = "https://micropython.org/pi/v2";

// SEE: https://github.com/micropython/micropython/blob/master/tools/mpremote/mpremote/mip.py

/**
 * Data class to store the result of the archiving process
 * Stores the path to the created archive and the common folder of the target paths in the package.json file
 * aka the package folder.
 */
class ArchiveResult {

  /**
   * Creates a new ArchiveResult object
   * @param {string} archivePath The path to the created archive
   * @param {Array} packageFiles The target file paths of all files in the archive.
   */
  constructor(archivePath, packageFiles) {
    this.archivePath = archivePath;
    this.packageFiles = packageFiles;
  }
}

/**
 * Class to archive a repository by downloading files from it and creating a tar.gz archive.
 * The files to be downloaded need to be specified in a package.json file in the repository.
 * Alternatively, a custom package.json object can be provided.
 */
class RepositoryArchiver {
  /**
   * 
   * @param {string} repoUrl The URL of the repository to archive in the format 'github:owner/repo' or 'gitlab:owner/repo'
   * or https://github.com/owner/repo or https://gitlab.com/owner/repo
   * @param {string} version The version to archive.
   * This is the release version provided by GitHub or GitLab not the version in the package.json file
   * although they should match.
   * @param {number} mpyFormat The major version of the mpy file format to use when downloading the files.
   * This only applies when the files are available in .mpy format from the host.
   * This is the case for all official micropython-lib packages.
   * @param {Object} customPackageJson A custom package.json object to use instead of fetching it from the repository.
   * This is useful when the package.json file is not available in the repository or when the files to download are known in advance.
   * It can also be used to selectively download files.
   */
  constructor(repoUrl, version = null, mpyFormat = null, customPackageJson = null,) {
    this.repoUrl = repoUrl;
    this.customPackageJson = customPackageJson;
    this.version = version;
    this.mpyFormat = mpyFormat;
  }

  /**
   * Takes a repository URL in the format 'github:owner/repo/path/file.ext' 
   * or 'gitlab:owner/repo/path/file.ext' or https://github.com/owner/repo/path/file.ext
   * and rewrites it to a URL
   * providing the raw file content. e.g. 'https://raw.githubusercontent.com/owner/repo/HEAD/path/file.ext'
   * @param {string} url The repository URL to rewrite.
   * @param {string} branch The branch to use when rewriting the URL. Defaults to 'HEAD'.
   * @returns 
   */
  getRawFileURL(url, branch = 'HEAD') {
    if(url.startsWith('https://github.com')){
      url = url.replace('https://github.com/', 'github:');
    } else if(url.startsWith('https://gitlab.com')){
      url = url.replace('https://gitlab.com/', 'gitlab:');
    }

    if(!url.startsWith('github:') && !url.startsWith('gitlab:')){
      return url; // Assume it's already a raw file URL
    }
    
    const urlParts = url.slice(7).split('/'); // Remove the host part of the URL
    const owner = urlParts[0];
    const repoName = urlParts[1];
    const path = urlParts.slice(2).join('/');

    if (url.startsWith('github:')) {
      return `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${path}`;
    } else if (url.startsWith('gitlab:')) {
      return `https://gitlab.com/${owner}/${repoName}/-/raw/${branch}/${path}`;
    }
    return null;
  }

  /**
   * Fetches the package.json file from the given repository URL and branch
   * @param {string} repositoryUrl The URL of the repository in https:// or github: or gitlab: format.
   * It can also be a direct link to the package.json file.
   * @param {string} branch The branch to use when fetching the package.json file.
   * @returns 
   */
  async fetchPackageJson(repositoryUrl, branch) {
    let url = repositoryUrl;

    if(!repositoryUrl.endsWith(".json")){
      url = repositoryUrl.endsWith("/") ? `${repositoryUrl}package.json` : `${repositoryUrl}/package.json`;
    }
    const packageJsonUrl = this.getRawFileURL(url, branch);

    try {
      const response = await fetch(packageJsonUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch package.json: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error('Failed to fetch package.json: ' + error.message);
    }
  }

  /**
   * Downloads a file from the given source URL and saves it to the target directory
   * The target path is taken from the fileInfo array and will be reflected
   * eventually on the board when extracting the archive.
   * @param {Array} fileInfo The file info array containing the target path and the source URL
   * The format is [targetRelativePath, sourceUrl] e.g. ['modulino/__init__.py', 'github:arduino/modulino-mpy/src/modulino/__init__.py']
   * @param {string} targetDirectory The local directory to save the file to.
   * @param {string} version The version to use when downloading the file.
   * This does not apply when downloading files from the official micropython-lib index which
   * use a different versioning scheme.
   * @param {async function} processFileCallback An async callback function to process the downloaded file.
   * The callback takes a file path as argument and should return a new file path.
   */
  async downloadFile(fileInfo, targetDirectory, version = null, processFileCallback = null) {
    const [targetRelativePath, sourceUrl] = fileInfo;
    const rawUrl = this.getRawFileURL(sourceUrl, version);
    const filePath = path.join(targetDirectory, targetRelativePath);
    await fs.ensureDir(path.dirname(filePath));

    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file ${sourceUrl}: ${response.statusText}`);
    }

    const writer = fs.createWriteStream(filePath);
    await pipe(response.body, writer);

    if (processFileCallback) {
      const newFilePath = await processFileCallback(filePath);
      if (newFilePath && filePath !== newFilePath) {
        // If the processed file has a different path
        // delete the original file.
        await fs.remove(filePath);
      }

      return newFilePath;
    }

    return filePath;
  }

  /**
   * Creates a tar.gz archive from the given source directory
   * and saves it to the target path
   * @param {string} sourceDirectory The directory to archive
   * @param {string} targetPath The path to save the archive to
   */
  async createTarGzArchive(sourceDirectory, targetPath) {
    const tarStream = tar.c(
      {
        // Make gzip use highest compression level
        gzip: { level: 9 },
        cwd: sourceDirectory,
      }, ['.']
    );

    const writeStream = fs.createWriteStream(targetPath);
    await pipe(tarStream, writeStream);
  }

  /**
   * Extracts the repository name from the given URL 
   * (e.g. https://github.com/arduino/upy-packager -> upy-packager)
   * @returns {string} Repository name
   */
  getRepoName() {
    return this.repoUrl.split('/').slice(-1)[0].replace('.git', '');
  }

  /**
   * Extracts the target file paths from the package.json data
   * @param {Object} packageJsonData The package.json data object
   * @returns {Array<string>} The target files in the package.json data object
   * e.g. ['modulino/__init__.py', 'github:arduino/modulino/src/__init__.py'] -> modulino/__init__.py
   */
  getPackageFiles(packageJsonData) {
    const targetProperty = packageJsonData.urls ? 'urls' : 'hashes';
    return packageJsonData[targetProperty].map(entry => entry[0]);
  }

  /**
   * Downloads files from the given URL and version.
   * If it's a custom package, it downloads the files from the repository, if it's an official micropython-lib package,
   * it downloads the files from the official micropython-lib index.
   * @param {string} url The URL of the repository in https:// or github: or gitlab: format or a package name from the official micropython-lib index.
   * @param {string} version The release version to download. Works with branch names
   * and release tags.
   * @param {string} targetDirectory The directory to save the files to.
   * @param {Object} customPackageJson A custom package.json object to use instead of fetching it from the repository.
   * This is useful when the package.json file is not available in the repository or when the files to download are known in advance.
   * It can also be used to selectively download files.
   * @param {async function} processFileCallback An async callback function to process the downloaded file.
   * The callback takes a file path as argument and should return a new file path.
   * @returns {Array} An array of package.json objects containing the URLs and dependencies.
   * @throws {Error} If an error occurs during the download process.
   */
  async downloadFilesFromUrl(url, version, targetDirectory, customPackageJson = null, processFileCallback = null) {
    let packageJsonFiles = [];
    let packageJson  
    if (this.isCustomPackage(url)) {
      packageJson = await this.downloadFilesFromRepository(url, version, targetDirectory, customPackageJson, processFileCallback);
    } else {
      packageJson = await this.downloadFilesFromIndex(url, version, targetDirectory);
    }
    packageJsonFiles.push(packageJson);

    if (packageJson.deps) {
      for (const dep of packageJson.deps) {
        const [depUrl, depVersion] = dep;
        const depPackageJsonFiles = await this.downloadFilesFromUrl(depUrl, depVersion, targetDirectory, null, processFileCallback); 
        packageJsonFiles.push(...depPackageJsonFiles);        
      }
    }
    return packageJsonFiles;
  }


  /**
   * Downloads files from the official micropython-lib index
   * Doesn't support file processing as official micropython-lib packages are already in .mpy format
   * @param {string} packageName The name of the package to download e.g. 'senml'
   * @param {string} version The version of the package to download e.g. '1.0.0'
   * @param {string} targetDirectory The directory to save the files to.
   * Subdirectories will be created for the package if specified in the package file.
   */
  async downloadFilesFromIndex(packageName, version, targetDirectory){
    version ||= 'latest'; // Default to latest version
    const mpyFormat = this.mpyFormat || 'py'; // Use plain .py format unless mpy format is specified
    console.debug(`🌐 Downloading package '${packageName}' ${version} from ${MICROPYTHON_LIB_INDEX}...`);
    const packageURL = `${MICROPYTHON_LIB_INDEX}/package/${mpyFormat}/${packageName}/${version}.json`;
    const response = await fetch(packageURL);
    let packageJson;

    try {
      if (!response.ok) {
        throw new Error(`Failed to fetch package index: ${response.statusText}`);
      }
      packageJson = await response.json();
    } catch (error) {
      throw new Error('Failed to fetch package index: ' + error.message);
    }

    const downloadPromises = packageJson.hashes.map(hashData => {
      const [targetPath, hash] = hashData;
      const fileURL = `${MICROPYTHON_LIB_INDEX}/file/${hash.slice(0, 2)}/${hash}`;
      const fileInfo = [targetPath, fileURL];
      return this.downloadFile(fileInfo, targetDirectory);
    });
    await Promise.all(downloadPromises);
    return packageJson;
  }

  /**
   * Downloads files from the given repository URL and version
   * @param {string} repoUrl The URL of the repository in https:// or github: or gitlab: format.
   * @param {string} version The release version to download. Works with branch names
   * and release tags.
   * @param {string} targetDirectory The directory to save the files to.
   * @param {Object} customPackageJson A custom package.json object to use instead of fetching it from the repository.
   * This is useful when the package.json file is not available in the repository or when the files to download are known in advance.
   * It can also be used to selectively download files.
   * @param {async function} processFileCallback An async callback function to process the downloaded file.
   * The callback takes a file path as argument and should return a new file path.
   * @returns {Object} The package.json object containing the URLs and dependencies.
   * @throws {Error} If an error occurs during the download process.
   */
  async downloadFilesFromRepository(repoUrl, version, targetDirectory, customPackageJson = null, processFileCallback = null) {
    version ||= 'HEAD'; // Defaults to HEAD branch
    console.debug(`🌐 Downloading files from ${repoUrl} version ${version}...`);
    let packageJson;

    if(repoUrl.endsWith(".py") || repoUrl.endsWith(".mpy")){
      // Direct link to a file, will be downloaded to the root of the target directory
      const fileInfo = [path.basename(repoUrl), repoUrl];
      // Use the new file path in case the file is processed e.g. compiled and thus has a .mpy extension
      const newFilePath = await this.downloadFile(fileInfo, targetDirectory, version, processFileCallback);
      return { urls: [[path.basename(newFilePath), repoUrl]] }; // Return a package.json-like object
    }

    if (customPackageJson) {
      packageJson = customPackageJson;
    } else {
      console.debug('🌐 Fetching package.json...');
      packageJson = await this.fetchPackageJson(repoUrl, version);
    }
    const downloadPromises = packageJson.urls.map(entry => this.downloadFile(entry, targetDirectory, version, processFileCallback));
    const downloadedFiles = await Promise.all(downloadPromises);
    
    // Adjust urls in the package.json object to reflect the potential new file paths
    // The files might have been processed e.g. compiled and thus have a different file extension
    packageJson.urls = downloadedFiles.map(filePath => {
      const targetRelativePath = path.relative(targetDirectory, filePath);
      return [targetRelativePath, this.getRawFileURL(filePath, version)];
    });
    
    return packageJson;
  }

  /**
   * Determines if the given dependency URL is a custom package meaning
   * it doesn't refer to an official micropython-lib package.
   * @param {string} url A repository URL in the format 'github:owner/repo' or 'gitlab:owner/repo'
   * or 'http://example.com/folder' or 'https://github.com/owner/repo' or 'https://gitlab.com/owner/repo'
   * @returns True if the dependency URL is a custom package, false otherwise.
   */
  isCustomPackage(url) {
    return url.startsWith('github:') || url.startsWith('gitlab:') || url.startsWith('http://') || url.startsWith('https://');
  }

  /**
   * Archives the repository by downloading files from it and creating a tar.gz archive.   
   * @param {function} processFileCallback A callback function to process the downloaded file one by one.
   * The callback takes a file path as argument and should return a new file path.
   * @param {string} targetDirectory The directory to save the archive to.
   * Defaults to a temporary directory.
   * @returns {ArchiveResult} The result of the archiving process containing the path to the created archive and the package folders.
   * @throws {Error} If an error occurs during the archiving process.
   */
  async archiveRepository(processFileCallback = null, targetDirectory = null) {
    if(!targetDirectory){
      targetDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mpy-package-archive-'));
    }

    try {
      // Create a temporary directory for downloaded files
      const downloadedFilesDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'downloaded_files-'));
            
      const allPackageJsonData = await this.downloadFilesFromUrl(this.repoUrl, this.version, downloadedFilesDirectory, this.customPackageJson, processFileCallback);
      const mainPackageJson = allPackageJsonData[0]; // Use the first package.json file

      const allPackageFiles = allPackageJsonData.map(packageJsonData => this.getPackageFiles(packageJsonData)).flat();
      const packageName = mainPackageJson.name || this.getRepoName();
      const packageVersion = mainPackageJson.version;
      const repoVersion = this.version?.replace(/^v/, '') || 'HEAD';
      
      if(packageVersion && repoVersion != "HEAD" && packageVersion !== repoVersion){
        console.warn(`👀 Version mismatch: package.json version ${packageVersion} does not match the provided version ${this.version}`);
      }
      
      const versionForTarFile = packageVersion || (repoVersion === "HEAD" ? 'latest' : repoVersion);
      const tarGzFileName = `${packageName}-${versionForTarFile}.tar.gz`;
      const tarGzPath = path.join(targetDirectory, tarGzFileName);
      
      console.debug('📁 Creating tar.gz archive...');
      await fs.ensureDir(targetDirectory);
      await this.createTarGzArchive(downloadedFilesDirectory, tarGzPath);      

      // Clean up: Remove the temporary directory
      await fs.remove(downloadedFilesDirectory);
      return new ArchiveResult(tarGzPath, allPackageFiles);
    } catch (error) {
      console.error('Error:', error.message);
      throw error;
    }
  }
}

export { RepositoryArchiver, ArchiveResult };