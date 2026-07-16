const { execSync, spawnSync } = require('child_process');

try {
  console.log("Adding BYPASS_BILLING_EMAILS to Vercel production...");
  const addProc = spawnSync('npx.cmd', ['vercel', 'env', 'add', 'BYPASS_BILLING_EMAILS', 'production'], {
    input: 'viniciusmenezes.ofc@gmail.com',
    encoding: 'utf8'
  });
  console.log(addProc.stdout);
  if (addProc.stderr) console.error(addProc.stderr);

  console.log("Running production deploy to apply new variables...");
  execSync('npx vercel --prod --yes', { stdio: 'inherit' });
  console.log("Deploy finished!");
} catch (e) {
  console.error("Error deploying:", e);
}
