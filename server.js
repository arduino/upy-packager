import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Packager } from './logic/packager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3000;

// Enable CORS for all origins
app.use(cors());

// Parse JSON bodies (as sent by API clients)
app.use(express.json());

// Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'out' directory
// app.use('/downloads', express.static(path.resolve(__dirname, 'out')));

// Helper function to handle the archive request
async function handleArchiveRequest(res, repoUrl, version = null, architecture = null, format = null, customPackageJson = null) {
    try {
      const packager = new Packager();
  
      // Create a temporary file path for the .tar.gz
      const tempDir = path.join(__dirname, 'temp');
      await fs.ensureDir(tempDir);
  
      // Archive the repository and get the filename
      const tarGzFilePath = (await packager.packageForArchitectureAndFormat(repoUrl, version, architecture, format, customPackageJson)).archivePath;
      const tarGzFileName = path.basename(tarGzFilePath);

      // Move the .tar.gz file from 'out' to temp directory for download
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

  
// Handle POST requests for archiving repositories
app.post('/archive', (req, res) => {
    const { repoUrl, version, customPackageJson, format, architecture } = req.body;
    const customPackageJsonObj = customPackageJson ? JSON.parse(customPackageJson) : null;

    if (!repoUrl) {
        return res.status(400).send('Repository URL is required');
    }

    handleArchiveRequest(res, repoUrl, version, architecture, format, customPackageJsonObj)
});

// Handle GET requests for archiving repositories
app.get('/archive', (req, res) => {
    const { repoUrl } = req.query;

    if (!repoUrl) {
        return res.status(400).send('Repository URL is required');
    }

    handleArchiveRequest(res, repoUrl);
});

app.get('/', (req, res) => {
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
      <label for="customPackageJson">Custom package.json:</label><br>
      <textarea id="customPackageJson" name="customPackageJson" rows="4" cols="50" style="width: 800px;"></textarea><br><br>
      <input type="submit" value="Download">
    </form>
    </body>
    </html>
    `;
    res.send(htmlForm);    
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
