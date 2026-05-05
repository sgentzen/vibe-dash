import { randomUUID } from "crypto";

const TICKET_TTL_MS = 30_000;

interface Ticket {
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, ticket] of tickets) {
    if (now > ticket.expiresAt) tickets.delete(id);
  }
}

export function issueTicket(): string {
  pruneExpired();
  const id = randomUUID();
  tickets.set(id, { expiresAt: Date.now() + TICKET_TTL_MS });
  return id;
}

export function consumeTicket(id: string): boolean {
  const ticket = tickets.get(id);
  if (!ticket || Date.now() > ticket.expiresAt) {
    tickets.delete(id);
    return false;
  }
  tickets.delete(id);
  return true;
}
