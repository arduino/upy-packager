import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Packager } from './packager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PackagerWebServer {
  constructor(port = 3000) {
    this.app = express();
    this.port = port;

    // Enable CORS for all origins
    this.app.use(cors());

    // Parse JSON bodies (as sent by API clients)
    this.app.use(express.json());

    // Parse URL-encoded bodies (as sent by HTML forms)
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from the 'out' directory
    // this.app.use('/downloads', express.static(path.resolve(__dirname, 'out')));
  }

  /**
   * Start the web server on the specified port
   */
  start() {
    this.installHandlers();

    this.app.listen(this.port, () => {
      console.log(`Server running at http://localhost:${this.port}`);
    });
  }

  /**
   * Handle the request to archive a repository
   * @param {Response} res The response object
   * @param {string} repoUrl The repository URL that was requested to be archived
   * @param {string} version The version of the repository to archive
   * @param {string} architecture The micro controller architecture
   * @param {string} format The MicroPython file format
   * @param {Object} customPackageJson The custom package.json override 
   */
  async handleArchiveRequest(res, repoUrl, version = null, architecture = null, format = null, customPackageJson = null) {
    // Convert empty strings to null for version, architecture, and format
    version = version || null;
    architecture = architecture || null;
    format = format || null;

    try {
      const packager = new Packager();

      // Create a temporary file path for the .tar.gz
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mpy-package-archive-'));
      await fs.ensureDir(tempDir);

      // Archive the repository and get the filename
      const tarGzFilePath = (await packager.packageForArchitectureAndFormat(repoUrl, version, architecture, format, customPackageJson)).archivePath;
      const tarGzFileName = path.basename(tarGzFilePath);

      // Move the .tar.gz file to temp directory for download
      const downloadFilePath = path.join(tempDir, tarGzFileName);
      await fs.move(tarGzFilePath, downloadFilePath);

      // Serve the .tar.gz file for download
      res.download(downloadFilePath, tarGzFileName, (err) => {
        if (err) {
          console.error('Error serving file:', err.message);
          res.status(500).send('Error serving file');
        }

        // Clean up: Remove the temporary file after download
        fs.remove(downloadFilePath)
          .catch(err => console.error('Error cleaning up file:', err.message));
      });
    } catch (error) {
      console.error('Error:', error.message);
      res.status(500).send('Internal Server Error');
    }
  }

  /**
   * Installs request handlers for the web server
   */
  installHandlers() {

    // Handle POST requests for archiving repositories
    this.app.post('/archive', (req, res) => {
      const { repoUrl, version, customPackageJson, format, architecture } = req.body;
      const customPackageJsonObj = customPackageJson ? JSON.parse(customPackageJson) : null;

      if (!repoUrl) {
        return res.status(400).send('Repository URL is required');
      }

      this.handleArchiveRequest(res, repoUrl, version, architecture, format, customPackageJsonObj)
    });

    // Handle GET requests for archiving repositories
    this.app.get('/archive', (req, res) => {
      const { repoUrl, version, format, architecture } = req.query;

      if (!repoUrl) {
        return res.status(400).send('Repository URL is required');
      }

      this.handleArchiveRequest(res, repoUrl, version, architecture, format);
    });

    this.app.get('/', (req, res) => {
      let htmlForm = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
      <style>
      body {
          font-family: 'Open Sans', sans-serif;
          margin: 20px;
      }
      </style>
      </head>
      <body>    
      <h1>uPy Packager</h1>
      <form action="/archive" method="post">
        <label for="repoUrl">Repository URL:</label><br>
        <input type="text" id="repoUrl" name="repoUrl" value="" required style="width: 800px;" ><br><br>
        <label for="architecture">Architecture:</label><br>
        <input type="text" id="architecture" name="architecture" value="" ><br>
        <label for="format">Format:</label><br>
        <input type="text" id="format" name="format" value="" ><br>
        <label for="version">Version:</label><br>
        <input type="text" id="version" name="version" value="" ><br>
        <label for="customPackageJson">Custom package.json:</label><br>
        <textarea id="customPackageJson" name="customPackageJson" rows="4" cols="50" style="width: 800px;"></textarea><br><br>
        <input type="submit" value="Download">
      </form>
      </body>
      </html>
      `;
      res.send(htmlForm);
    });
  }
}

export { PackagerWebServer };