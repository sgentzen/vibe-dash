import type { Router } from "express";
import type Database from "better-sqlite3";
import type { WsEvent } from "../types.js";

export type BroadcastFn = (event: WsEvent) => void;
export type RouteFactory = (db: Database.Database, broadcast: BroadcastFn) => Router;
