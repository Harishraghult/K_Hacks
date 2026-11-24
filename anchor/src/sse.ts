import type { FastifyReply, FastifyRequest } from "fastify";
import { ENV } from "./env.js";

const clients = new Set<FastifyReply>();

export function sseHandler(req: FastifyRequest, reply: FastifyReply) {
  const origin = req.headers.origin;
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(origin && ENV.WEB_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  });
  reply.raw.write(`retry: 2000\n\nevent: hello\ndata: {}\n\n`);
  clients.add(reply);
  const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 15000);
  req.raw.on("close", () => {
    clearInterval(ping);
    clients.delete(reply);
  });
}

export function broadcast(type: string, data: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.raw.write(msg);
}

export const sseClientCount = () => clients.size;
