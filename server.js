import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import GitRepoArchiver from './GitRepoArchiver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3000;

// Serve static files from the 'out' directory
app.use('/downloads', express.static(path.resolve(__dirname, 'out')));

app.get('/archive', async (req, res) => {
  const repoUrl = req.query.repoUrl;

  if (!repoUrl) {
    return res.status(400).send('Repository URL is required');
  }

  try {
    const archiver = new GitRepoArchiver(repoUrl);

    // Create a temporary file path for the .tar.gz
    const tempDir = path.join(__dirname, 'temp');
    await fs.ensureDir(tempDir);
    const packageName = archiver.getRepoName();
    const version = '1.0.0'; // Default version if not specified
    const tarGzFileName = `${packageName}-${version}.tar.gz`;
    const tarGzPath = path.join(tempDir, tarGzFileName);

    // Archive the repository
    await archiver.archiveRepo();
    
    // Move the .tar.gz file from 'out' to temp directory for download
    const outPath = path.resolve(__dirname, 'out', tarGzFileName);
    await fs.move(outPath, tarGzPath);

    // Serve the .tar.gz file for download
    res.download(tarGzPath, tarGzFileName, (err) => {
      if (err) {
        console.error('Error serving file:', err.message);
        res.status(500).send('Error serving file');
      }

      // Clean up: Remove the temporary file after download
      fs.remove(tarGzPath)
        .catch(err => console.error('Error cleaning up file:', err.message));
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});