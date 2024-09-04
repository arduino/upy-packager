import GitRepoArchiver from './GitRepoArchiver.js';

const repoUrl = 'https://github.com/arduino/arduino-modulino-mpy';
const archiver = new GitRepoArchiver(repoUrl);
archiver.archiveRepo();