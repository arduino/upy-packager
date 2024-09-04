import * as tar from 'tar';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

class GitRepoArchiver {
  constructor(repoUrl) {
    this.repoUrl = repoUrl;
    this.outputDir = null;
  }

  rewriteUrl(url, branch = 'HEAD') {
    if (url.startsWith('github:')) {
      url = url.slice(7).split('/');
      return `https://raw.githubusercontent.com/${url[0]}/${url[1]}/${branch}/${url.slice(2).join('/')}`;
    } else if (url.startsWith('gitlab:')) {
      url = url.slice(7).split('/');
      return `https://gitlab.com/${url[0]}/${url[1]}/-/raw/${branch}/${url.slice(2).join('/')}`;
    }
    return url;
  }

  async fetchPackageJson() {
    const rawUrl = this.repoUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    const packageJsonUrl = `${rawUrl}/master/package.json`;

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

  async downloadFile(entry) {
    const [relativePath, url] = entry;
    const rawUrl = this.rewriteUrl(url);
    const filePath = path.join(this.outputDir, relativePath);

    await fs.ensureDir(path.dirname(filePath));

    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file ${url}: ${response.statusText}`);
    }

    const writer = fs.createWriteStream(filePath);
    await pipe(response.body, writer);
  }

  async createTarGzArchive(tarGzPath) {
    const tarStream = tar.c(
      {
        gzip: true,
        cwd: this.outputDir,
      },
      ['.']
    );

    const writeStream = fs.createWriteStream(tarGzPath);
    await pipe(tarStream, writeStream);
  }

  getRepoName() {
    return this.repoUrl.split('/').slice(-1)[0].replace('.git', '');
  }

  async archiveRepo(outputDirectory = 'out') {
    try {
      console.log('Fetching package.json...');
      const packageJson = await this.fetchPackageJson();

      // Create a temporary directory for downloaded files
      this.outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'downloaded_files-'));
      console.log(`Temporary directory created at: ${this.outputDir}`);

      console.log('Downloading files...');
      const downloadPromises = packageJson.urls.map(entry => this.downloadFile(entry));
      await Promise.all(downloadPromises);

      const packageName = packageJson.name || this.getRepoName();
      const version = packageJson.version || '1.0.0';
      const tarGzFileName = `${packageName}-${version}.tar.gz`;
      const tarGzPath = path.join(outputDirectory, tarGzFileName);

      // Ensure the output directory exists
      await fs.ensureDir(outputDirectory);

      console.log('Creating tar.gz archive...');
      await this.createTarGzArchive(tarGzPath);

      console.log(`Process completed successfully! Archive created: ${tarGzPath}`);

      // Clean up: Remove the temporary directory
      await fs.remove(this.outputDir);

      console.log('Temporary files cleaned up.');

      // Return the filename
      return tarGzFileName;
    } catch (error) {
      console.error('Error:', error.message);
      throw error; // Re-throw error to handle it in the server
    }
  }
}

export default GitRepoArchiver;