import { config, createApp } from './app.js';

const app = createApp();

app.listen(config.port, () => {
  const tokenOk = Boolean(process.env.EDGEFOCUS_TOKEN?.trim());
  console.log(`[edgefocus] backend on http://localhost:${config.port}`);
  console.log(
    `[edgefocus] project ${config.projectId}, kanban view ${config.kanbanViewId}, bucket "${config.targetBucket}"`
  );
  if (!tokenOk) console.warn('[edgefocus] WARNING: EDGEFOCUS_TOKEN is not configured.');
});
