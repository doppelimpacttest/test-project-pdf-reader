import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerRoutes } from "./routes/api.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const server = Fastify({ logger: true });

await server.register(fastifyMultipart, {
  limits: {
    fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB ?? "10", 10)) * 1024 * 1024,
  },
});

await server.register(fastifyStatic, {
  root: path.join(ROOT_DIR, "public"),
  prefix: "/",
});

await registerRoutes(server);

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = "0.0.0.0";

try {
  await server.listen({ port: PORT, host: HOST });
  // eslint-disable-next-line no-console
  console.log(`PDF-QA server running at http://0.0.0.0:${PORT}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
