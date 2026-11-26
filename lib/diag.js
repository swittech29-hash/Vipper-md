// Counters that the !statuscheck command reads, so problems can be checked from WhatsApp itself
export const diag = {
  startedAt: Date.now(),
  statusEvents: 0, // every status update the bot has seen (including your own)
  ownStatusEvents: 0,
  lastStatusAt: null,
  lastStatusFrom: null,
  likesSent: 0,
  likesFailed: 0,
  lastLike: null, // { at, ok, method, error }
  keyShape: null, // what the id formats look like (no numbers)
};
