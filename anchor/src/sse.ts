import type { FastifyReply, FastifyRequest } from "fastify";
import { ENV } from "./env.js";

/** `senderId` set = a signed-in customer: they only receive events about their own transfers. */
interface Client {
  reply: FastifyReply;
  senderId?: string;
}
const clients = new Set<Client>();

export function openStream(req: FastifyRequest, reply: FastifyReply, senderId?: string) {
  const origin = req.headers.origin;
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(origin && ENV.WEB_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } : {}),
  });
  reply.raw.write(`retry: 2000\n\nevent: hello\ndata: {}\n\n`);
  const client: Client = { reply, senderId };
  clients.add(client);
  const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 15000);
  req.raw.on("close", () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

export const sseHandler = (req: FastifyRequest, reply: FastifyReply) => openStream(req, reply);

/**
 * scope undefined   → everyone (content-free refresh signals)
 * scope "admin"     → operator/demo streams only
 * scope <senderId>  → operator streams + that customer
 */
export function broadcast(type: string, data: unknown, scope?: string) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.senderId && scope !== undefined && scope !== c.senderId) continue;
    c.reply.raw.write(msg);
  }
}

export const sseClientCount = () => clients.size;
