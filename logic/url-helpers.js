/**
   * Determines if the given dependency URL is a custom package meaning
   * it doesn't refer to an official micropython-lib package.
   * @param {string} url A repository URL in the format 'github:owner/repo' or 'gitlab:owner/repo'
   * or 'http://example.com/folder' or 'https://github.com/owner/repo' or 'https://gitlab.com/owner/repo'
   * @returns True if the dependency URL is a custom package, false otherwise.
   */
function isCustomPackage(url) {
    return url.startsWith('github:') || url.startsWith('gitlab:') || url.startsWith('http://') || url.startsWith('https://');
}

export { isCustomPackage };