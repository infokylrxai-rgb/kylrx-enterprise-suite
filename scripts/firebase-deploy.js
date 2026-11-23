/**
 * Deploys Firestore rules and indexes and Storage rules to the project in FIREBASE_PROJECT_ID.
 *   npm run deploy:firebase                     rules + indexes + storage rules
 *   npm run deploy:firebase -- --only functions  any other --only target
 * Refuses to run when no project is configured, so nothing is ever deployed to a default project.
 */
require('dotenv').config({ quiet: true });
const { spawnSync } = require('child_process');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId || /YOUR_FIREBASE_PROJECT_ID|CHANGE_ME/.test(projectId)) {
    console.error('FIREBASE_PROJECT_ID is not set (or is still a placeholder). Set it in .env and try again.');
    process.exit(1);
}

const extra = process.argv.slice(2);
const only = extra.includes('--only') ? [] : ['--only', 'firestore:rules,firestore:indexes,storage'];
console.log(`Deploying to Firebase project "${projectId}"...`);
const result = spawnSync('firebase', ['deploy', ...only, ...extra, '--project', projectId], { stdio: 'inherit', shell: true });
process.exit(result.status === null ? 1 : result.status);
