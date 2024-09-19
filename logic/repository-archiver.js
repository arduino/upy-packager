import * as tar from 'tar';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

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
   * @param {string} packageFolder The common folder of the target paths in the package.json file
   */
  constructor(archivePath, packageFolder) {
    this.archivePath = archivePath;
    this.packageFolder = packageFolder;
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
   * @param {string} version The version to archive. Defaults to 'HEAD'.
   * This is the release version provided by GitHub or GitLab not the version in the package.json file
   * although they should match.
   * @param {number} mpyFormat The major version of the mpy file format to use when downloading the files.
   * This only applies when the files are available in .mpy format from the host.
   * This is the case for all official micropython-lib packages.
   * @param {Object} customPackageJson A custom package.json object to use instead of fetching it from the repository.
   * This is useful when the package.json file is not available in the repository or when the files to download are known in advance.
   * It can also be used to selectively download files.
   */
  constructor(repoUrl, version = "HEAD", mpyFormat, customPackageJson = null,) {
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
      // Transform the URL to the official micropython-lib index format
      // e.g. https://micropython.org/pi/v2/package/6/mip/latest.json
      const index = "https://micropython.org/pi/v2/package";
      // TODO: Implement the logic to transform the URL
      // package = f"{index}/package/{mpy_version}/{package}/{version}.json"
      // use this.mpyFormat to get the mpy version
      throw new Error('Not implemented yet');
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
   * @param {string} repositoryUrl The URL of the repository in https:// format
   * @param {string} branch The branch to use when fetching the package.json file. Defaults to 'HEAD'.
   * @returns 
   */
  async fetchPackageJson(repositoryUrl, branch = 'HEAD') {
    const packageJsonUrl = this.getRawFileURL(`${repositoryUrl}/package.json`, branch);

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
   * @param {async function} processFileCallback An async callback function to process the downloaded file.
   * The callback takes a file path as argument and should return a new file path.
   */
  async downloadFile(fileInfo, targetDirectory, processFileCallback = null) {
    const [targetRelativePath, sourceUrl] = fileInfo;
    const rawUrl = this.getRawFileURL(sourceUrl, this.version);
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
    }
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
   * Extracts the common folder of the target paths in the package.json file
   * This is useful to determine the target folder when extracting the archive on the board
   * E.g. if the target paths are ['modulino/__init__.py', 'modulino/buttons.py']
   * the common folder is 'modulino'.
   * @param {Object} packageJsonData 
   * @returns {string} The common folder of the target paths in the package.json file
   */
  getPackageFolder(packageJsonData) {
    const targetPaths = packageJsonData.urls.map(entry => entry[0]);
    const folders = targetPaths.map(entry => {
      const parts = entry.split('/')
      if (parts.length > 1) {
        return parts[0];
      }
      return null;
    }).filter(folder => folder !== null);
    
    if (folders.length === 0) {
      throw new Error('The target paths in package.json do not contain any folders. Please ensure all files are in a folder.');
    }
    
    // Check if all target paths have the same folder
    if (folders.every(folder => folder === folders[0])) {
      return folders[0];
    } else {
      // If the target paths have different folders, throw an error
      throw new Error('The target paths in package.json have different folders. Please ensure all files are in the same folder.');
    }
  }

  async downloadFilesFromRepository(repoUrl, version = "HEAD", targetDirectory, customPackageJson = null, processFileCallback = null) {
    console.debug(`🌐 Downloading files from ${repoUrl}...`);
    let packageJson;

    if (customPackageJson) {
      packageJson = customPackageJson;
    } else {
      console.debug('🌐 Fetching package.json...');
      packageJson = await this.fetchPackageJson(repoUrl, version);
    }
    const downloadPromises = packageJson.urls.map(entry => this.downloadFile(entry, targetDirectory, processFileCallback));
    await Promise.all(downloadPromises);

    if (packageJson.deps) {
      // for (const dep of packageJson.deps) {
      //   const [depUrl, depVersion] = dep;
      //   await this.downloadFilesFromRepository(depUrl, depVersion, targetDirectory, null, processFileCallback);
      // }
    }        

    return packageJson;
  }

  /**
   * Archives the repository by downloading files from it and creating a tar.gz archive.   
   * @param {function} processFileCallback A callback function to process the downloaded file one by one.
   * The callback takes a file path as argument and should return a new file path.
   * @param {string} targetDirectory The directory to save the archive to.
   * Defaults to a temporary directory.
   * @returns {ArchiveResult} The result of the archiving process containing the path to the created archive and the package folder.
   * @throws {Error} If an error occurs during the archiving process.
   */
  async archiveRepository(processFileCallback = null, targetDirectory = null) {
    if(!targetDirectory){
      targetDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mpy-package-archive-'));
    }

    try {
      // Create a temporary directory for downloaded files
      const downloadedFilesDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'downloaded_files-'));

      let packageJson = await this.downloadFilesFromRepository(this.repoUrl, this.version, downloadedFilesDirectory, this.customPackageJson, processFileCallback);

      const packageName = packageJson.name || this.getRepoName();
      const packageVersion = packageJson.version;
      const repoVersion = this.version?.replace(/^v/, '');
      
      if(packageVersion && repoVersion != "HEAD" && packageVersion !== repoVersion){
        console.warn(`👀 Version mismatch: package.json version ${packageVersion} does not match the provided version ${this.version}`);
      }
      
      const versionForTarFile = packageVersion || (repoVersion === "HEAD" ? 'latest' : repoVersion);
      const tarGzFileName = `${packageName}-${versionForTarFile}.tar.gz`;
      const tarGzPath = path.join(targetDirectory, tarGzFileName);

      await fs.ensureDir(targetDirectory);

      console.debug('📁 Creating tar.gz archive...');
      await this.createTarGzArchive(downloadedFilesDirectory, tarGzPath);

      // Clean up: Remove the temporary directory
      await fs.remove(downloadedFilesDirectory);
      return new ArchiveResult(tarGzPath, this.getPackageFolder(packageJson));
    } catch (error) {
      console.error('Error:', error.message);
      throw error;
    }
  }
}

export { RepositoryArchiver, ArchiveResult };