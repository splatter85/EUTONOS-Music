#!/usr/bin/env node
/** stdio entry point: `node dist/src/authoring/mcp-main.js`. Logs to stderr only. */
import {defaultWorkspace} from './broker.js';
import {UnsupportedHost, type HostAdapter} from './host.js';
import {McpSession} from './mcp-server.js';

async function selectHost(): Promise<HostAdapter> {
  if (process.platform === 'win32') {
    const {WindowsFlHost} = await import('./host-windows.js');
    return new WindowsFlHost();
  }
  return new UnsupportedHost(`no FL Studio host adapter for ${process.platform} yet; offline inspection and edits still work`);
}

const log = (line: string) => process.stderr.write(`[eutonos-music] ${line}\n`);
const session = new McpSession({
  workspace: defaultWorkspace(),
  host: await selectHost(),
  write: line => process.stdout.write(line + '\n'),
  log,
});

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).replace(/\r$/, '');
    buffer = buffer.slice(nl + 1);
    void session.handleLine(line).catch(e => log(`unhandled: ${String(e)}`));
  }
});
process.stdin.on('end', () => log('stdin closed'));
log(`ready; workspace ${defaultWorkspace()}`);
