# Source provenance

The plugin source and build/test configuration were recovered from
https://github.com/FilhoRicardo/task-dash-plugin_DEL at commit
f8a5074 (TaskDash 2.2 preview).

Two Tasks-page Close handlers in `src/app/App.jsx` were corrected from
`onClick={closeTask}` to `onClick={()=>closeTask(task.id)}` to match the shipped
September 1 build. These corrections were already present in the bundled code.

A production build with those two changes produced a byte-for-byte match to the
original `main.js`. `manifest.json` and generated `styles.css` also matched.
The recovered baseline suite contains 89 passing tests across 11 test files.

Run `npm ci`, `npm test`, and `npm run build` to develop and verify this plugin.
`data.json` contains local vault configuration and must not be overwritten by fixes.
