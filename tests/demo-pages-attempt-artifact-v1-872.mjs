import assert from 'node:assert/strict';
import fs from 'node:fs';
const workflow=fs.readFileSync(new URL('../.github/workflows/owner-browser-demo-pages.yml',import.meta.url),'utf8');
const artifact='github-pages-${{ github.run_id }}-${{ github.run_attempt }}';
const upload=workflow.slice(workflow.indexOf('- name: Upload demo only'),workflow.indexOf('- name: Deploy demo'));
const deploy=workflow.slice(workflow.indexOf('- name: Deploy demo'),workflow.indexOf('- name: Verify published link'));
assert.match(upload,/uses: actions\/upload-pages-artifact@v4/);
assert.match(deploy,/uses: actions\/deploy-pages@v4/);
assert.ok(upload.includes('name: '+artifact),'retry upload needs attempt-specific artifact');
assert.ok(deploy.includes('artifact_name: '+artifact),'deployment must target same exact attempt');
const readiness=workflow.slice(workflow.indexOf('- name: Confirm exact demo artifact'),workflow.indexOf('- name: Deploy demo'));
assert.ok(readiness.includes('DEMO_ARTIFACT: '+artifact),'readiness check must be attempt-specific');
assert.ok(readiness.includes('actions/runs/$GITHUB_RUN_ID/artifacts'));
assert.ok(readiness.includes('name="$DEMO_ARTIFACT"'));
assert.ok(readiness.includes('grep -Fxq "$DEMO_ARTIFACT"'));
assert.ok(readiness.includes('select(.expired == false)'));
assert.ok(readiness.includes('seq 1 15')&&readiness.includes('exit 1'),'bounded readiness check must fail closed');
assert.match(workflow,/actions: read/);

assert.ok(workflow.includes("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'"),
 'pull requests must never publish the demo');
assert.match(workflow,/concurrency:\s*\n\s*group: pages\s*\n\s*cancel-in-progress: false/);
assert.match(workflow,/never TAMÃO production/);
assert.doesNotMatch(deploy,/github-pages\s*\n/,'do not default to old artifact');
console.log('PASS #872: Pages upload and deploy select same run/attempt artifact on retry, never commercial production');
