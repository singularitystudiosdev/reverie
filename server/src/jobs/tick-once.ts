/** `npm run tick`: run one loop tick against the configured database and print the report. */
import { createContext } from '../app.ts';
import { renderReport, tick } from './scheduler.ts';

const ctx = createContext();
const r = await tick(ctx);
console.log(renderReport(ctx, r));
