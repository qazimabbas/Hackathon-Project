import { createApp } from './app.js';
import { config } from './config.js';
import { createRepository } from './repository.js';

const server = createApp({ repository: createRepository() }).listen(
  config.PORT,
  config.HOST,
  () => {
    console.log(`Hallucination Visualizer API: http://${config.HOST}:${config.PORT}`);
  },
);
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${config.PORT} is already in use. Stop the other server or change PORT in .env.`
      : 'The API could not start. Check your host and port settings.',
  );
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
