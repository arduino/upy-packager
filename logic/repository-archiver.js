import * as tar from 'tar';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

// SEE: https://github.com/micropython/micropython/blob/master/tools/mpremote/mpremote/mip.py

/**
 * Class to archive a repository by downloading files from it and creating a tar.gz archive.
 * The files to be downloaded need to be specified in a package.json file in the repository.
 * Alternatively, a custom package.json object can be provided.
 */
class RepositoryArchiver {
  constructor(repoUrl) {
    this.repoUrl = repoUrl;
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
   */
  async downloadFile(fileInfo, targetDirectory) {
    const [targetRelativePath, sourceUrl] = fileInfo;
    const rawUrl = this.getRawFileURL(sourceUrl);
    const filePath = path.join(targetDirectory, targetRelativePath);
    await fs.ensureDir(path.dirname(filePath));

    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file ${sourceUrl}: ${response.statusText}`);
    }

    const writer = fs.createWriteStream(filePath);
    await pipe(response.body, writer);
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
   * Archives the repository by downloading files from it and creating a tar.gz archive.
   * @param {Object} customPackageJson A custom package.json object to use instead of fetching it from the repository.
   * This is useful when the package.json file is not available in the repository or when the files to download are known in advance.
   * It can also be used to selectively download files.
   * @param {string} targetDirectory The directory to save the archive to. Defaults to 'out'.
   * @returns {string} The path to the created tar.gz archive.
   * @throws {Error} If an error occurs during the archiving process.
   */
  async archiveRepository(customPackageJson = null, targetDirectory = 'out') {
    try {
      let packageJson;
      if (customPackageJson) {
        packageJson = customPackageJson;
      } else {
        console.log('🌐 Fetching package.json...');
        packageJson = await this.fetchPackageJson(this.repoUrl);
      }

      // Create a temporary directory for downloaded files
      const downloadedFilesDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'downloaded_files-'));

      console.log('🌐 Downloading files from repository...');
      const downloadPromises = packageJson.urls.map(entry => this.downloadFile(entry, downloadedFilesDirectory));
      await Promise.all(downloadPromises);

      const packageName = packageJson.name || this.getRepoName();
      const version = packageJson.version;
      const tarGzFileName = version ? `${packageName}-${version}.tar.gz` : `${packageName}.tar.gz`;
      const tarGzPath = path.join(targetDirectory, tarGzFileName);

      await fs.ensureDir(targetDirectory);

      console.log('📁 Creating tar.gz archive...');
      await this.createTarGzArchive(downloadedFilesDirectory, tarGzPath);

      // Clean up: Remove the temporary directory
      await fs.remove(downloadedFilesDirectory);
      return tarGzPath;
      
    } catch (error) {
      console.error('Error:', error.message);
      throw error;
    }
  }
}

export { RepositoryArchiver };