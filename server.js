import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import cors from 'cors';
import GitRepoArchiver from './GitRepoArchiver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3000;

// Enable CORS for all origins
app.use(cors());

// Serve static files from the 'out' directory
app.use('/downloads', express.static(path.resolve(__dirname, 'out')));

app.get('/archive', async (req, res) => {
  const repoUrl = req.query.repoUrl;
  const outputDir = req.query.outputDir || path.join(__dirname, 'out');

  if (!repoUrl) {
    return res.status(400).send('Repository URL is required');
  }

  try {
    const archiver = new GitRepoArchiver(repoUrl);

    // Create a temporary file path for the .tar.gz
    const tempDir = path.join(__dirname, 'temp');
    await fs.ensureDir(tempDir);

    // Archive the repository and get the filename
    const tarGzFileName = await archiver.archiveRepo(outputDir);

    // Move the .tar.gz file from 'out' to temp directory for download
    const tarGzPath = path.join(tempDir, tarGzFileName);
    const outPath = path.resolve(outputDir, tarGzFileName);
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