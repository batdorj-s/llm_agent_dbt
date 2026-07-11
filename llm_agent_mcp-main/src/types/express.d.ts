// Express Request augmentation — shared across all route modules
declare namespace Express {
  interface Request {
    reqId?: string;
  }
}
