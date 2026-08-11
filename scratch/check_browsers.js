const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const edgeUserDataDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
  const chromeUserDataDir = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');

  console.log('Checking Edge User Data:', fs.existsSync(edgeUserDataDir), edgeUserDataDir);
  console.log('Checking Chrome User Data:', fs.existsSync(chromeUserDataDir), chromeUserDataDir);

  let userDataDir = null;
  let channel = null;

  if (fs.existsSync(edgeUserDataDir)) {
    userDataDir = edgeUserDataDir;
    channel = 'msedge';
  } else if (fs.existsSync(chromeUserDataDir)) {
    userDataDir = chromeUserDataDir;
    channel = 'chrome';
  }

  console.log('Selected browser configuration:', { userDataDir, channel });
})();
