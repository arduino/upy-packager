import * as tar from 'tar';
import fs from 'fs-extra';
import os from 'os';
import { createGzip } from 'zlib';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

function rewriteUrl(url, branch = 'HEAD') {
  if (url.startsWith('github:')) {
    url = url.slice(7).split('/');
    return `https://raw.githubusercontent.com/${url[0]}/${url[1]}/${branch}/${url.slice(2).join('/')}`;
  } else if (url.startsWith('gitlab:')) {
    url = url.slice(7).split('/');
    return `https://gitlab.com/${url[0]}/${url[1]}/-/raw/${branch}/${url.slice(2).join('/')}`;
  }
  return url;
}

async function fetchPackageJson(repoUrl) {
  const rawUrl = repoUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
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

async function downloadFile(entry, outputDir, branch = 'HEAD') {
  const [relativePath, url] = entry;
  const rawUrl = rewriteUrl(url, branch);
  const filePath = path.join(outputDir, relativePath);

  await fs.ensureDir(path.dirname(filePath));

  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file ${url}: ${response.statusText}`);
  }

  const writer = fs.createWriteStream(filePath);
  await pipe(response.body, writer);
}

async function createTarGzArchive(outputDir, tarGzPath) {
  const tarStream = tar.c(
    {
      gzip: true,
      cwd: outputDir,
    },
    ['.']
  );

  const writeStream = fs.createWriteStream(tarGzPath);
  await pipe(tarStream, writeStream);
}

function getRepoName(repoUrl) {
  return repoUrl.split('/').slice(-1)[0].replace('.git', '');
}

async function main(repoUrl) {
  try {
    console.log('Fetching package.json...');
    const packageJson = await fetchPackageJson(repoUrl);

    // Create a temporary directory for downloaded files
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'downloaded_files-'));
    console.log(`Temporary directory created at: ${outputDir}`);

    console.log('Downloading files...');
    const downloadPromises = packageJson.urls.map(entry => downloadFile(entry, outputDir));
    await Promise.all(downloadPromises);

    const packageName = packageJson.name || getRepoName(repoUrl);
    const version = packageJson.version || '1.0.0';
    const tarGzFileName = `${packageName}-${version}.tar.gz`;
    const outDir = path.resolve('./out');
    const tarGzPath = path.join(outDir, tarGzFileName);

    // Ensure the out directory exists
    await fs.ensureDir(outDir);

    console.log('Creating tar.gz archive...');
    await createTarGzArchive(outputDir, tarGzPath);

    console.log(`Process completed successfully! Archive created: ${tarGzPath}`);

    // Clean up: Remove the temporary directory
    await fs.remove(outputDir);

    console.log('Temporary files cleaned up.');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Replace with your GitHub repository URL
const repoUrl = 'https://github.com/arduino/arduino-modulino-mpy';
main(repoUrl);