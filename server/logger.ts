import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const usePretty = process.env.LOG_PRETTY === "1";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(usePretty
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
