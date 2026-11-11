import { createContext, createServer } from './app.ts';
import { startScheduler } from './jobs/scheduler.ts';

const ctx = createContext();
const server = createServer(ctx);
server.listen(ctx.cfg.port, () => {
  console.log(
    `[reverie] listening on http://localhost:${ctx.cfg.port} - ${ctx.personas.servable().length} servable personas, LLM ${ctx.llm.enabled ? `on (${ctx.cfg.llm.model})` : 'off (offline fallbacks)'}`,
  );
});
const stop = startScheduler(ctx);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    stop();
    server.close(() => process.exit(0));
  });
