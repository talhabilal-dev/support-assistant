import { db } from "./db.js";

// App and vector data share one Postgres database: the document tables carry
// foreign keys to `user`, so they must live alongside the auth tables.
export const vectorDb = db;
