'use strict';
// Runs last: every module has registered its loaders/actions by now.
(async function boot() {
  showPanel('panel-login');
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session) await startSession();          // returning visitor with a valid session
  } catch (e) { console.error('[CBR] boot', e); }
})();
