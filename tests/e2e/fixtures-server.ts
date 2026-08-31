import { createServer, type Server } from 'node:http';

const IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n2YAAAAASUVORK5CYII=',
  'base64'
);

export interface FixtureServer {
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('无法确定夹具服务器端口'));
        return;
      }
      resolve(address.port);
    });
  });
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (pathname === '/image.png' || pathname.endsWith('.jpg')) {
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(IMAGE_BYTES.byteLength)
      });
      response.end(IMAGE_BYTES);
      return;
    }
    if (pathname === '/v1/chat/completions' && request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push(body);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'AI 整理后的测试商品',
                    description: '商品信息已整理，请以当前页面和实物为准。',
                    warnings: []
                  })
                }
              }
            ]
          })
        );
      });
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('未找到夹具');
  });
  const port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      })
  };
}
